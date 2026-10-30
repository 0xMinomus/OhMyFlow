export type Sensitivity = 'fast' | 'balanced' | 'high'

export type CullCategory = 'picks' | 'maybe' | 'rejects'

// Bentuk struktural ringkasan ONNX — sengaja tidak mengimpor src/lib agar
// types tetap bebas runtime dan tidak menimbulkan siklus.
export interface OnnxFaceBox {
  box: { x: number; y: number; w: number; h: number }
  score: number
}

export interface OnnxFaceSummaryLike {
  available: boolean
  count: number
  maxScore: number
  maxArea: number
  boxes: OnnxFaceBox[]
}

export interface Pass2EyeResult {
  eyesState: string
  eyesClosedProbability: number
  boxArea: number
}

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
  // Diagnostik engine (diisi culler/pipeline; semua opsional — jangan dipakai UI langsung)
  dhash?: string // dHash 64-bit untuk grouping duplikat
  reasonCodes?: string[]
  subjFocus?: number | null // ketajaman zona subjek (null = tak ada eviden)
  motion?: number
  onnxFace?: OnnxFaceSummaryLike | null
  onnxDominantUnknown?: boolean
  pass2?: Pass2EyeResult | null
  eyeHi?: unknown
  pupilHits?: number
  objMode?: boolean
  whiteBg?: boolean
  hasFace?: boolean
  faceConfidence?: number
  clippedHi?: number
  clippedLo?: number
  centerHi?: number
  meanLum?: number
  hiPct?: number
  borderHi?: number
  loPct?: number
  maxEdge?: number
  compConfidence?: number
  subject?: number // skor ketajaman area subjek (0-100), bukan box
  edge?: number
  gradP50?: number
  gradP99?: number
  color?: number
  accidental?: boolean
  eyesState?: 'open' | 'closed' | 'unknown' | 'no-face' | ''
  eyesP?: number
  eyesOpenProtect?: boolean
  skinRatio?: number
  blurFloor?: number
  blurReject?: boolean
  v2cap?: '' | 'maybe' | 'reject'
  clusterRank?: number
  clusterSize?: number
  marginToBest?: number
  softestInBurst?: boolean
  redundantDiverse?: boolean
  redundantInBurst?: boolean
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
