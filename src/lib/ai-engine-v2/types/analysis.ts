import type { FaceDetection } from '../../ml/face-geometry'
import type { EyeResult, Metric, SignalStatus } from './signals'
export interface FaceResult {
  box: FaceDetection['box'] | null
  confidence: number | null
  eyes: EyeResult
  blinkLeft?: Metric<number>
  blinkRight?: Metric<number>
  squintLeft?: Metric<number>
  squintRight?: Metric<number>
}
export interface FaceAnalysis {
  status: SignalStatus
  faces: FaceResult[]
  source: string
  modelVersion?: string
  durationMs: number
  errorCode?: string
  eyeAnalyzerRan: boolean
}
