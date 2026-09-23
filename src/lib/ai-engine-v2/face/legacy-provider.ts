import { heuristicFaceDetect, type FaceResult } from '../../ai-engine/face'
import type { FaceAnalysis } from '../types/analysis'
import type { FaceAnalysisProvider } from './provider'

export function normalizeLegacyFace(face: FaceResult, durationMs = 0): FaceAnalysis {
  // The full-frame heuristic cannot localize each eye. Never duplicate its
  // aggregate guess into two supposedly measured per-eye results.
  const unknown = { value: 'unknown' as const, confidence: null, status: 'unknown' as const, source: 'legacy-full-frame' }
  return { status: 'ok', source: 'legacy', modelVersion: 'heuristic-2026-09', durationMs,
    eyeAnalyzerRan: false,
    faces: face.hasFace ? [{ box: null, confidence: face.faceConfidence, eyes: { left: unknown, right: { ...unknown } } }] : [] }
}
export class LegacyFaceProvider implements FaceAnalysisProvider {
  readonly id = 'legacy'
  async initialize() {}
  isAvailable() { return true }
  async analyze(image: ImageData): Promise<FaceAnalysis> {
    const start = performance.now()
    try { return normalizeLegacyFace(heuristicFaceDetect(image), performance.now() - start) }
    catch (e) { return { status: 'error', faces: [], source: this.id, eyeAnalyzerRan: false,
      durationMs: performance.now() - start, errorCode: String((e as Error)?.message || e) } }
  }
}
