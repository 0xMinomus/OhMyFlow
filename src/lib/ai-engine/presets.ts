import type { Sensitivity } from '@/types'

interface ModePreset {
  analysisSize: number
  batchSize: number
  sharpWeight: number
  faceWeight: number
  aestheticWeight: number
  compWeight: number
  duplicateThreshold: number
  dupPenalty: number
  picksAt: number
  rejectBelow: number
  hardBlurBelow: number
  picksFocusMin: number
  blownRejectAt: number
  confRejectFloor: number
  darkRejectAt: number // exposure ≤ ini + lum rendah = rejects (0 = mati; high saja)
  eyeThreshold: number
  exposureHardReject: boolean
  compositionHardReject: boolean
}

// Fast = sortir awal (hanya yang jelas gagal dibuang, sisanya Maybe).
// Balanced = harian, objektif. High = seleksi akhir (paling berani me-reject).
export const PRESETS: Record<Sensitivity, ModePreset> = {
  fast:     { analysisSize: 256, batchSize: 8, sharpWeight: 0.37, faceWeight: 0.27, aestheticWeight: 0.26, compWeight: 0.10, duplicateThreshold: 9, dupPenalty: 8,  picksAt: 75, rejectBelow: 40, hardBlurBelow: 45, picksFocusMin: 60, blownRejectAt: 18, confRejectFloor: 0.45, darkRejectAt: 0, eyeThreshold: 0.70, exposureHardReject: false, compositionHardReject: false },
  balanced: { analysisSize: 384, batchSize: 6, sharpWeight: 0.34, faceWeight: 0.26, aestheticWeight: 0.25, compWeight: 0.15, duplicateThreshold: 7, dupPenalty: 10, picksAt: 70, rejectBelow: 45, hardBlurBelow: 55, picksFocusMin: 60, blownRejectAt: 14, confRejectFloor: 0.32, darkRejectAt: 0, eyeThreshold: 0.60, exposureHardReject: true,  compositionHardReject: false },
  high:     { analysisSize: 512, batchSize: 4, sharpWeight: 0.32, faceWeight: 0.24, aestheticWeight: 0.24, compWeight: 0.20, duplicateThreshold: 5, dupPenalty: 14, picksAt: 72, rejectBelow: 48, hardBlurBelow: 60, picksFocusMin: 60, blownRejectAt: 12, confRejectFloor: 0.28, darkRejectAt: 15, eyeThreshold: 0.50, exposureHardReject: true,  compositionHardReject: true },
}

