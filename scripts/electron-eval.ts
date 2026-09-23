import { cullPhotos } from '../src/lib/ai-engine/culler'
import type { PhotoItem } from '../src/types'
import { prefetchAnalysisBatch, prefetchThumbsBatch } from '../src/lib/thumbCache'
import { runEngine } from '../src/lib/ai-engine-v2/pipeline'
import { MediaPipeFaceProvider } from '../src/lib/ai-engine-v2/face/mediapipe-provider'

async function main() {
  const api = (window as any).ohmyflow
  const job = await api.engineEvalJob()
  // Evaluation-only fault injection exercises the real loader's HTTP failure.
  // Production UI never imports this entry and never replaces fetch.
  if (job.fault) {
    const originalFetch = globalThis.fetch.bind(globalThis)
    const asset = job.fault === 'onnx' ? 'ultraface-320.onnx' : 'face_landmarker.task'
    globalThis.fetch = (input, init) => String(input instanceof Request ? input.url : input).includes(asset)
      ? Promise.resolve(new Response('injected model unavailable', { status: 404 }))
      : originalFetch(input, init)
  }
  const rows: any[] = []
  for (const split of ['human', 'nonhuman']) {
    const samples = job.samples.filter((s: any) => s.split === split)
    const items: PhotoItem[] = []
    for (let i = 0; i < samples.length; i += 24) {
      const chunk = samples.slice(i, i + 24)
      const thumbs = await prefetchThumbsBatch(chunk)
      const analysis = job.mode === 'high' ? await prefetchAnalysisBatch(chunk, 1280) : new Map()
      for (const sample of chunk) items.push({ id: sample.id, fileName: sample.id.split('/').pop(), filePath: sample.filePath,
        isRaw: false, isPaired: false, ext: '.jpg', size: 0, baseName: sample.id,
        thumbUrl: thumbs.get(sample.filePath) ?? null, analysisUrl: analysis.get(sample.filePath) ?? null })
    }
    const results = job.engine && job.engine !== 'legacy'
      ? await runEngine(items, { mode: job.mode, engine: job.engine, provider: new MediaPipeFaceProvider(), allowExperimentalActive: true })
      : await cullPhotos(items, { mode: job.mode })
    for (const result of results) {
      const { dataUrl, thumbUrl, analysisUrl, ...row } = result
      rows.push(row)
    }
  }
  await api.engineEvalComplete({ rows, runtime: { crossOriginIsolated, userAgent: navigator.userAgent }, error: null })
}
main().catch(async e => { await (window as any).ohmyflow.engineEvalComplete({ rows: [], error: String(e?.stack || e) }) })
