// Face detector ONNX lokal (Fase 5) — adapter sesuai new-architecture §10.
// Model: UltraFace RFB-320 (MIT, Linzaer), 1.27MB, bundled di public/models.
// Runtime: onnxruntime-web (wasm, CPU 1 thread — tanpa SharedArrayBuffer pun
// jalan; threaded bila crossOriginIsolated). Lazy-load hanya bila dibutuhkan.
// Gagal kapan pun (no SAB, model hilang, infer error) = fallback heuristik,
// TAK PERNAH crash culling (§52). High + unknown saja (mode lain bit-identik).

export const V2_ONNX = true
// Flag Fase 6: Pass-2 eye ROI (High + unknown + box kecil saja).
export const V2_PASS2 = true

// Pinned model identity; checked before creating the runtime session.
export const FACE_MODEL_SHA256 = '34CD7E60AEFF28744C657DE7A3DC64E872D506741DE66987F3426F2B79F88017'

import { preprocessUltraFace, decodeDetections, type FaceDetection } from './face-geometry'
export type { FaceDetection } from './face-geometry'

export interface FaceDetector {
  detect(image: ImageData): Promise<FaceDetection[]>
}

export interface OnnxFaceSummary {
  status: 'ok' | 'unavailable' | 'error'
  errorCode?: string
  durationMs: number
  available: boolean
  count: number
  maxScore: number
  maxArea: number // fraksi frame wajah terbesar
  boxes: FaceDetection[] // ≤10, skor desc (untuk Pass-2 ROI)
}

const MODEL_URL = 'models/ultraface-320.onnx'
const IN_W = 320
const IN_H = 240

let ortMod: any = null
let session: any = null
let loadFailed = false
let loadError = ''
let loading: Promise<any> | null = null
let chain: Promise<any> = Promise.resolve() // serialisasi session.run

async function getSession(): Promise<any> {
  if (session) return session
  if (loadFailed) throw new Error(loadError)
  if (!loading) loading = loadSession().catch(e => {
    loadFailed = true
    loadError = String(e?.message || e)
    throw e
  })
  return loading
}

async function loadSession(): Promise<any> {
  if (session) return session
  if (loadFailed) throw new Error('onnx disabled')
  const ort = await import('onnxruntime-web')
  ortMod = ort
  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = new URL('ort/', document.baseURI).href
  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`model http ${res.status}`)
  const buf = await res.arrayBuffer()
  if (buf.byteLength < 1000000) throw new Error('model corrupt')
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  if (hash !== FACE_MODEL_SHA256) throw new Error('MODEL_CHECKSUM_MISMATCH')
  session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] })
  return session
}

class UltraFaceDetector implements FaceDetector {
  async detect(image: ImageData): Promise<FaceDetection[]> {
    const sess = await getSession()
    const chw = preprocessUltraFace(image)
    const run = async () => {
      const feeds = { input: new ortMod.Tensor('float32', chw, [1, 3, IN_H, IN_W]) }
      const out = await sess.run(feeds)
      const names = Object.keys(out)
      const scores = out[names.find((n) => /score/i.test(n)) ?? names[0]].data as Float32Array
      const boxes = out[names.find((n) => /box|bbox|location/i.test(n)) ?? names[1]].data as Float32Array
      return decodeDetections(scores, boxes)
    }
    // Serial: onnxruntime session tak dijamin thread-safe untuk run konkuren.
    const p = chain.then(run, run)
    chain = p.catch(() => {})
    return p
  }
}

let detector: FaceDetector | null = null

/** Explicit failure retains the distinction between no detections and no inference. */
export async function detectFacesONNX(image: ImageData): Promise<OnnxFaceSummary> {
  const started = performance.now()
  const failure = (status: 'unavailable' | 'error', errorCode: string): OnnxFaceSummary => ({
    status, errorCode, durationMs: performance.now() - started, available: false, count: 0, maxScore: 0, maxArea: 0, boxes: [],
  })
  if (!V2_ONNX) return failure('unavailable', 'ONNX_DISABLED')
  if (typeof document === 'undefined') return failure('unavailable', 'BROWSER_RUNTIME_REQUIRED')
  try {
    if (!detector) detector = new UltraFaceDetector()
    const dets = await detector.detect(image)
    let maxScore = 0, maxArea = 0
    for (const d of dets) {
      if (d.score > maxScore) maxScore = d.score
      const a = d.box.w * d.box.h
      if (a > maxArea) maxArea = a
    }
    return {
      status: 'ok', durationMs: performance.now() - started,
      available: true, count: dets.length,
      maxScore: Math.round(maxScore * 100) / 100,
      maxArea: Math.round(maxArea * 10000) / 10000,
      boxes: dets.slice(0, 10),
    }
  } catch (e) {
    return failure(session ? 'error' : 'unavailable', String((e as Error)?.message || e))
  }
}
