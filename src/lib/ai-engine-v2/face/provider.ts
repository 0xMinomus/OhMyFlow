import type { FaceAnalysis } from '../types/analysis'
export interface FaceAnalysisProvider {
  readonly id: string
  initialize(): Promise<void>
  isAvailable(): boolean
  analyze(image: ImageData): Promise<FaceAnalysis>
  dispose?(): void
}
