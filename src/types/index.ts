export type Sensitivity = 'fast' | 'balanced' | 'high'

export type CullCategory = 'picks' | 'maybe' | 'rejects'

export interface PhotoItem {
  id: string
  fileName: string
  filePath: string
  pairedPath?: string
  previewPath?: string // path yang dipakai untuk thumbnail (paired JPG jika RAW+JPG)
  isPaired: boolean
  isRaw: boolean
  ext: string
  size: number
  mtimeMs?: number
  baseName: string
  dataUrl?: string | null // legacy full-res (jangan diisi untuk folder besar)
  thumbUrl?: string | null // thumbnail ringan 480px dari main process (yang dipakai UI + AI)
  analysisUrl?: string | null // analysis image 1280px q85 (v2, High saja; AI pakai ini bila ada)
  thumbLoading?: boolean
  // AI results
  score?: number // 0-100
  confidence?: number // 0-1
  category?: CullCategory
  reasons?: string[] // id alasan indo
  reasonsEn?: string[]
  sharpness?: number // 0-100
  exposure?: number
  eyesClosed?: boolean
  isDuplicate?: boolean
  duplicateGroup?: string
  aesthetic?: number
  composition?: number
}

export interface CullStats {
  total: number
  picks: number
  maybe: number
  rejects: number
  durationMs: number
  throughputPerMin: number
  thumbNull?: number // prefetch gagal (masuk Maybe tanpa AI)
  featNull?: number // decode/analisis gagal (masuk Maybe tanpa AI)
}

export interface AppSettings {
  language: 'id' | 'en'
  sensitivity: Sensitivity
}
