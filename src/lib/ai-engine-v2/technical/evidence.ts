import type { PipelineFeatures } from '../../ai-engine/pipeline'
import type { Metric } from '../types/signals'
export interface TechnicalEvidence {
  focus: Metric<number>
  exposure: Metric<number>
  composition: Metric<number>
  motion: Metric<number>
}
/** Adapts measured facts only; never chooses a final category. */
export function technicalEvidence(features: PipelineFeatures): TechnicalEvidence {
  const metric = (value: number, confidence: number | null, source: string): Metric<number> => ({ value, confidence, source, status: Number.isFinite(value) ? 'ok' : 'error' })
  return {
    focus: metric(features.sharpness.focus, features.sharpness.confidence, 'legacy:focus'),
    exposure: metric(features.aesthetic.exposure, features.aesthetic.confidence, 'legacy:exposure'),
    composition: metric(features.composition.score, features.composition.confidence, 'legacy:composition'),
    motion: metric(features.motion.motionLikelihood, null, 'legacy:uncalibrated-motion'),
  }
}
