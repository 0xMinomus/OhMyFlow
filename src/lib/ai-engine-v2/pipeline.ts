import type { PhotoItem } from '@/types'
import { cullPhotos as legacyCull, type CullOptions } from '../ai-engine/culler'
import { decodeOnce, clearPipelineCache } from '../ai-engine/pipeline'
import type { FaceAnalysisProvider } from './face/provider'
import { LegacyFaceProvider } from './face/legacy-provider'
import type { EngineTrace } from './diagnostics/trace'
import { classifyV2, type Decision } from './policy/classify'
import { preserveSurvivors } from './burst/compare'
export type EngineMode = 'legacy' | 'v2-shadow' | 'v2-active'

// Release gate remains false until an independent labeled test set is supplied.
export const V2_RELEASE_APPROVED = false

export async function runEngine(items: PhotoItem[], options: CullOptions & {
  engine?: EngineMode; provider?: FaceAnalysisProvider; allowExperimentalActive?: boolean
}): Promise<PhotoItem[]> {
  const requested = options.engine ?? 'legacy'
  const engine = requested === 'v2-active' && !V2_RELEASE_APPROVED && !options.allowExperimentalActive ? 'v2-shadow' : requested
  const results = await legacyCull(items, { ...options, onTrace: undefined })
  if ((results as any).cullDebug?.cancelled) return results
  const provider: FaceAnalysisProvider = options.provider ?? new LegacyFaceProvider()
  const decisions = new Map<string, Decision>()
  try {
    for (const item of results) {
      if (options.shouldCancel?.()) { (results as any).cullDebug.cancelled = true; return results }
      const trace = (item as any).engineTrace as EngineTrace
      trace.engine = engine; trace.legacyDecision = item.category
      if (engine !== 'legacy') {
        const start = performance.now()
        const image = await decodeOnce(item.analysisUrl || item.thumbUrl || item.dataUrl || '', 768)
        try {
          trace.provider = image ? await provider.analyze(image) : {
            status: 'unavailable', source: provider.id, faces: [], durationMs: 0, eyeAnalyzerRan: false, errorCode: 'IMAGE_UNAVAILABLE',
          }
        } catch (e) {
          trace.provider = { status: 'error', source: provider.id, faces: [], durationMs: performance.now() - start,
            eyeAnalyzerRan: false, errorCode: String((e as Error)?.message || e) }
        }
        trace.timingMs.face += trace.provider.durationMs
        trace.timingMs.total += performance.now() - start
        decisions.set(item.id, classifyV2(item, options.mode, trace.provider))
      }
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    if (engine !== 'legacy') preserveSurvivors(results, decisions)
    for (const item of results) {
      const trace = (item as any).engineTrace as EngineTrace
      const decision = decisions.get(item.id)
      if (decision) {
        trace.shadowDecision = decision.category
        trace.shadowReasons = decision.reasonCodes
        if (engine === 'v2-active') {
          item.category = decision.category; item.reasons = decision.reasons; item.reasonsEn = decision.reasonsEn
          trace.reasons = decision.reasonCodes
        }
      }
      trace.decision = item.category
      options.onTrace?.(trace)
    }
    return results
  } finally { provider.dispose?.(); clearPipelineCache() }
}
