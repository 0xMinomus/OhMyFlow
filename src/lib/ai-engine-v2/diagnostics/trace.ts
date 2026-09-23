import type { OnnxFaceSummary } from '../../ml/face-onnx'
import type { EyeROIResult } from '../../ml/eye-roi'
import type { FaceAnalysis } from '../types/analysis'
import type { CullCategory } from '@/types'
import type { TechnicalEvidence } from '../technical/evidence'
export interface EngineTrace {
  schemaVersion: 2
  photoId: string
  engine: 'legacy' | 'v2-shadow' | 'v2-active'
  inputStatus: 'ok' | 'unavailable' | 'error'
  inputError?: string
  technical?: TechnicalEvidence
  onnx: OnnxFaceSummary | { status: 'unknown'; errorCode: 'NOT_REQUESTED' }
  onnxDominantUnknown: boolean
  eyeBefore?: string
  eyeAfter?: string
  eyeProbability?: number
  pass2: { status: 'not-requested' | 'ok' | 'unknown' | 'error'; result?: EyeROIResult | null; errorCode?: string }
  hiEye: { status: 'not-requested' | 'ok' | 'unknown' | 'error'; errorCode?: string }
  provider?: FaceAnalysis
  focusScore?: number
  burstId?: string
  decision?: CullCategory
  legacyDecision?: CullCategory
  shadowDecision?: CullCategory
  shadowReasons?: string[]
  reasons: string[]
  policyRule?: string
  timingMs: { technical: number; face: number; total: number }
}
export function newTrace(photoId: string): EngineTrace {
  return { schemaVersion: 2, photoId, engine: 'legacy', inputStatus: 'unavailable',
    onnx: { status: 'unknown', errorCode: 'NOT_REQUESTED' }, onnxDominantUnknown: false,
    pass2: { status: 'not-requested' }, hiEye: { status: 'not-requested' }, reasons: [],
    timingMs: { technical: 0, face: 0, total: 0 } }
}
