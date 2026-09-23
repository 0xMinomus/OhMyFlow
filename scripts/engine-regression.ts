import assert from 'node:assert/strict'
import { cullPhotos } from '../src/lib/ai-engine/culler'
import { detectFacesONNX } from '../src/lib/ml/face-onnx'
import { normalizedBox, pixelBox, nms, preprocessUltraFace, decodeDetections } from '../src/lib/ml/face-geometry'
import { eyeCrop } from '../src/lib/ml/eye-crop'
import { normalizeLegacyFace } from '../src/lib/ai-engine-v2/face/legacy-provider'
import { classifyV2 } from '../src/lib/ai-engine-v2/policy/classify'
import { preserveSurvivors } from '../src/lib/ai-engine-v2/burst/compare'
import { newTrace } from '../src/lib/ai-engine-v2/diagnostics/trace'
import { classifyLegacy } from '../src/lib/ai-engine/legacy-policy'
import { analyzeImageData } from '../src/lib/ai-engine/pipeline'
import { runEngine } from '../src/lib/ai-engine-v2/pipeline'

async function main() {
  let failed = 0
  async function test(name: string, run: () => unknown) {
    try { await run(); console.log(`PASS ${name}`) }
    catch (e) { failed++; console.error(`FAIL ${name}: ${(e as Error).message}`) }
  }
  await test('normalized bbox remains frame-relative and clamps invalid boxes', () => {
    assert.deepEqual(normalizedBox([0.25, 0.125, 0.75, 0.875]), { x: 0.25, y: 0.125, w: 0.5, h: 0.75 })
    assert.deepEqual(pixelBox(normalizedBox([0.25, 0.125, 0.75, 0.875])!, 800, 400), { x: 200, y: 50, w: 400, h: 300 })
    assert.equal(normalizedBox([1, 0, 0, 1]), null)
    assert.equal(normalizedBox([NaN, 0, 1, 1]), null)
  })
  await test('NMS keeps stronger overlap and a separate face', () => {
    const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
    assert.deepEqual(nms([{ box, score: 0.8 }, { box, score: 0.9 }, { box: { ...box, x: 0.7 }, score: 0.75 }]).map(d => d.score), [0.9, 0.75])
    assert.throws(() => decodeDetections([0, 1], [0, 0]), /INVALID_MODEL_OUTPUT/)
  })
  await test('legacy preprocessing uses BGR CHW and exact normalization', () => {
    const tensor = preprocessUltraFace({ width: 1, height: 1, data: new Uint8ClampedArray([255, 127, 0, 255]) })
    assert.equal(tensor.length, 3 * 320 * 240)
    assert.equal(tensor[0], -127 / 128)
    assert.equal(tensor[320 * 240], 0)
    assert.equal(tensor[2 * 320 * 240], 1)
  })
  await test('ROI is clamped to image and bounded to 512 pixels', () => {
    const crop = eyeCrop(640, 480, { x: 0.8, y: 0.8, w: 0.2, h: 0.2 })!
    assert.ok(crop.sx >= 0 && crop.sy >= 0 && crop.sx + crop.sw <= 640 && crop.sy + crop.sh <= 480)
    assert.ok(crop.cw <= 512 && crop.ch <= 512)
    assert.equal(eyeCrop(0, 480, { x: 0, y: 0, w: 1, h: 1 }), null)
  })
  await test('aggregate legacy eyes are not invented bilateral measurements', () => {
    const f = normalizeLegacyFace({ hasFace: true, faceCount: 1, faceConfidence: 0.9, skinRatio: 0.2, eyesClosedProbability: 0.99, eyesClosed: true, eyesState: 'closed', pupilHits: 0 })
    assert.equal(f.faces[0].eyes.left.status, 'unknown')
    assert.equal(f.faces[0].eyes.right.confidence, null)
    assert.equal(f.eyeAnalyzerRan, false)
  })
  const base: any = { id: 'one', fileName: 'one.jpg', filePath: 'one.jpg', isRaw: false, isPaired: false, ext: '.jpg', size: 0, baseName: 'one', score: 85, sharpness: 85, exposure: 85, composition: 70, confidence: 0.9, reasons: ['Fokus baik'], reasonsEn: ['Good focus'], engineTrace: { ...newTrace('one'), inputStatus: 'ok' } }
  const provider: any = { status: 'ok', source: 'fixture', faces: [], durationMs: 0, eyeAnalyzerRan: false }
  await test('unknown and unavailable face do not imply bad photo', () => {
    assert.equal(classifyV2(base, 'high', provider).category, 'picks')
    assert.equal(classifyV2(base, 'high', { ...provider, status: 'unavailable', errorCode: 'missing model' }).category, 'picks')
  })
  await test('closed eye cannot automatically reject a keeper', () => {
    const metric = { value: 'closed', status: 'ok', confidence: 1, source: 'fixture' }
    assert.equal(classifyV2(base, 'high', { ...provider, faces: [{ box: null, confidence: 1, eyes: { left: metric, right: metric } }] }).category, 'maybe')
  })
  await test('production safety policy never auto-rejects uncalibrated eyes', () => {
    for (const mode of ['fast', 'balanced', 'high'] as const) {
      const photo = { ...base, engineTrace: { ...base.engineTrace }, eyesClosed: true }
      classifyLegacy(photo, mode)
      assert.equal(photo.category, 'maybe')
      assert.equal(photo.engineTrace.policyRule, 'EYE_REVIEW_ONLY')
    }
  })
  await test('shadow policy never mutates legacy trace or reasons', () => {
    const input = structuredClone(base), snapshot = JSON.stringify(input)
    classifyV2(input, 'high', provider)
    assert.equal(JSON.stringify(input), snapshot)
  })
  await test('technical subject cap survives provider replacement', () => {
    assert.equal(classifyV2({ ...base, v2cap: 'maybe', subjFocus: 40, hasFace: true }, 'high', provider).category, 'maybe')
  })
  await test('technical defect still rejects without a face model', () => {
    assert.equal(classifyV2({ ...base, sharpness: 10 }, 'high', { ...provider, status: 'error' }).category, 'rejects')
  })
  await test('similarity alone never rejects acceptable alternates', () => {
    assert.equal(classifyV2({ ...base, isDuplicate: true, softestInBurst: true, redundantInBurst: true }, 'high', provider).category, 'maybe')
  })
  await test('all-bad burst retains a survivor, deterministic tie order', () => {
    const decisions = new Map(['one', 'two'].map(id => [id, { category: 'rejects' as const, reasons: [], reasonsEn: [], reasonCodes: [] }]))
    preserveSurvivors([{ ...base, burstId: 'group' }, { ...base, id: 'two', burstId: 'group' }], decisions)
    assert.equal(decisions.get('one')?.category, 'maybe')
    assert.equal(decisions.get('two')?.category, 'rejects')
  })
  await test('model failure is distinguishable from no faces', async () => {
    const result = await detectFacesONNX({ width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData)
    assert.ok(result && (result as any).status !== 'ok', 'failure must return explicit status, not null')
    assert.ok((result as any).errorCode)
  })
  await test('unreadable preview is Maybe in every mode', async () => {
    for (const mode of ['fast', 'balanced', 'high'] as const) {
      const [result] = await cullPhotos([{ id: 'missing', fileName: 'missing.jpg', filePath: 'missing.jpg', isRaw: false, isPaired: false, ext: '.jpg', size: 0, baseName: 'missing' }], { mode })
      assert.equal(result.category, 'maybe', mode)
    }
  })
  await test('rerun clears stale inference and burst evidence', async () => {
    const pixels = new Uint8ClampedArray(32 * 32 * 4).fill(255)
    const analyze = async () => analyzeImageData({ width: 32, height: 32, data: pixels } as ImageData)
    const input = { ...base, thumbUrl: 'fixture' }
    const [fresh] = await cullPhotos([input], { mode: 'high', analyze })
    const [rerun] = await cullPhotos([{ ...input, onnxDominantUnknown: true, softestInBurst: true, clusterRank: 0, clusterSize: 2 } as any], { mode: 'high', analyze })
    assert.equal((rerun as any).onnxDominantUnknown, (fresh as any).onnxDominantUnknown)
    assert.equal((rerun as any).clusterSize, (fresh as any).clusterSize)
    assert.equal(rerun.category, fresh.category)
  })
  await test('unapproved active engine is gated to shadow with legacy output', async () => {
    const [result] = await runEngine([base], { mode: 'high', engine: 'v2-active' })
    assert.equal((result as any).engineTrace.engine, 'v2-shadow')
    assert.equal(result.category, (result as any).engineTrace.legacyDecision)
  })
  process.exitCode = failed ? 1 : 0
}
main().catch(e => { console.error(e); process.exitCode = 1 })
