import type { PhotoItem, Sensitivity, CullCategory } from '@/types'
import type { FaceAnalysis } from '../types/analysis'
import { classifyLegacy } from '../../ai-engine/legacy-policy'
import type { EngineTrace } from '../diagnostics/trace'

export interface Decision { category: CullCategory; reasonCodes: string[]; reasons: string[]; reasonsEn: string[] }

/** Initial safety policy. No new calibrated threshold or model coefficient is
 * allowed to hard-reject. Legacy technical thresholds remain the baseline. */
export function classifyV2(item: PhotoItem, mode: Sensitivity, face: FaceAnalysis): Decision {
  const trace = (item as any).engineTrace as EngineTrace
  if (trace.inputStatus !== 'ok') return { category: 'maybe', reasonCodes: ['ANALYSIS_UNAVAILABLE'],
    reasons: ['Analisis tidak tersedia — perlu review manual'], reasonsEn: ['Analysis unavailable — needs manual review'] }
  const probe: any = { ...item, engineTrace: { ...trace }, reasons: [...(item.reasons || [])], reasonsEn: [...(item.reasonsEn || [])],
    // Eye and redundancy flags cannot manufacture a technical Reject.
    eyesClosed: false, isDuplicate: false, softestInBurst: false, redundantInBurst: false,
    blurReject: false, v2cap: (item as any).onnxDominantUnknown && !((item as any).subjFocus != null && (item as any).subjFocus < 55) ? '' : (item as any).v2cap }
  classifyLegacy(probe, mode)
  let category: CullCategory = probe.category
  const reasonCodes = [...(probe.reasonCodes || [])]
  const reasons = [...(probe.reasons || [])], reasonsEn = [...(probe.reasonsEn || [])]
  const closed = face.status === 'ok' && face.faces.some(f =>
    [f.eyes.left, f.eyes.right].some(e => e.status === 'ok' && e.value === 'closed'))
  if (closed && category === 'picks') {
    category = 'maybe'; reasonCodes.push('EYE_REVIEW_ONLY')
    reasons.push('Bukti mata tertutup — perlu review'); reasonsEn.push('Closed-eye evidence — needs review')
  }
  if (item.isDuplicate && category === 'picks') {
    category = 'maybe'; reasonCodes.push('BURST_ALTERNATE')
  }
  return { category, reasonCodes, reasons, reasonsEn }
}
