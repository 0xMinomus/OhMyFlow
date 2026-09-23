import type { FaceLandmarker } from '@mediapipe/tasks-vision'
import type { FaceAnalysisProvider } from './provider'
import type { FaceAnalysis } from '../types/analysis'
import type { Metric } from '../types/signals'
import { normalizedBox } from '../../ml/face-geometry'

export class MediaPipeFaceProvider implements FaceAnalysisProvider {
  readonly id = 'mediapipe'
  private model: FaceLandmarker | null = null
  private loading: Promise<void> | null = null
  private loadError: string | null = null
  isAvailable() { return this.model !== null }
  initialize(): Promise<void> {
    if (!this.loading) this.loading = this.load()
    return this.loading
  }
  private async load() {
    try {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const files = await FilesetResolver.forVisionTasks(new URL('mediapipe/', document.baseURI).href)
      const response = await fetch(new URL('models/face_landmarker.task', document.baseURI))
      if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`)
      const bytes = await response.arrayBuffer()
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
      if (hash !== '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff') throw new Error('MODEL_CHECKSUM_MISMATCH')
      this.model = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetBuffer: new Uint8Array(bytes), delegate: 'CPU' },
        runningMode: 'IMAGE', numFaces: 10, outputFaceBlendshapes: true,
      })
    } catch (e) { this.loadError = String((e as Error)?.message || e) }
  }
  async analyze(image: ImageData): Promise<FaceAnalysis> {
    const start = performance.now()
    await this.initialize()
    const base = { source: this.id, modelVersion: 'face_landmarker/float16/1;tasks-vision/0.10.32', durationMs: 0, eyeAnalyzerRan: false }
    if (!this.model) return { ...base, status: 'unavailable', faces: [], errorCode: this.loadError || 'MODEL_UNAVAILABLE', durationMs: performance.now() - start }
    try {
      const result = this.model.detect(image)
      return { ...base, status: 'ok', durationMs: performance.now() - start, eyeAnalyzerRan: result.faceBlendshapes.length > 0,
        faces: result.faceLandmarks.map((landmarks, i) => {
          const xs = landmarks.map(p => p.x), ys = landmarks.map(p => p.y)
          const categories = result.faceBlendshapes[i]?.categories || []
          const coefficient = (name: string): Metric<number> => {
            const value = categories.find(c => c.categoryName === name)?.score
            return { value: value ?? null, confidence: null, status: value === undefined ? 'unknown' : 'ok', source: `mediapipe:${name}` }
          }
          // Blendshape coefficients are NOT calibrated eye-state probabilities.
          // Preserve raw evidence; no fabricated precision or closed threshold.
          const unknown = { value: 'unknown' as const, confidence: null, status: 'unknown' as const, source: 'mediapipe:uncalibrated' }
          return { box: normalizedBox([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]),
            confidence: null, eyes: { left: unknown, right: { ...unknown } },
            blinkLeft: coefficient('eyeBlinkLeft'), blinkRight: coefficient('eyeBlinkRight'),
            squintLeft: coefficient('eyeSquintLeft'), squintRight: coefficient('eyeSquintRight') }
        }) }
    } catch (e) { return { ...base, status: 'error', faces: [], durationMs: performance.now() - start, errorCode: String((e as Error)?.message || e) } }
  }
  dispose() { this.model?.close(); this.model = null; this.loading = null; this.loadError = null }
}
