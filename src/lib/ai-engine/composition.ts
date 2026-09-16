// Penilaian komposisi/framing — deterministik, 100% lokal.
// Menjawab "proporsinya jelek": subjek menumpuk di satu sudut, terlalu kecil,
// terpotong tepi, atau tidak ada subjek yang jelas.
// Bekerja pada grayscale yang sama dengan pipeline (tanpa decode tambahan).
// Prinsip: hanya menghukum yang JELAS buruk; sisanya netral.
//
// Catatan skala (penting): semua porsi dihitung dari JUMLAH energi (sum),
// bukan rata-rata blok — mencampur keduanya menghancurkan semua rasio.

export interface CompositionResult {
  score: number // 0-100
  centerBias: number // 0-1, porsi ketertarikan di tengah
  maxCellShare: number // 0-1, sel 3x3 paling dominan
  borderShare: number // 0-1, porsi ketertarikan di bibir tepi
  subjectSize: number // 0-1, fraksi blok yang "ramai"
  maxEdge: number // rata-rata gradien blok paling bertepi (bukti ada yang tajam di frame)
  isFlat: boolean
  confidence: number // 0-1
  reasons: string[]
  reasonsEn: string[]
}

const COLS = 16
const ROWS = 12

export function analyzeCompositionFromGray(
  gray: Float32Array, w: number, h: number, meanLum: number
): CompositionResult {
  const nBlocks = COLS * ROWS
  const blockSum = new Float32Array(nBlocks)
  let total = 0

  // Energi ketertarikan = magnitudo gradien sederhana |dx|+|dy| per piksel,
  // dijumlahkan per blok 16x12. Satu pass, murah.
  for (let y = 1; y < h - 1; y++) {
    const row = y * w
    const by = Math.min(ROWS - 1, Math.floor((y / h) * ROWS))
    for (let x = 1; x < w - 1; x++) {
      const i = row + x
      const g = Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - w])
      const bx = Math.min(COLS - 1, Math.floor((x / w) * COLS))
      blockSum[by * COLS + bx] += g
      total += g
    }
  }

  // Ukuran blok bervariasi di tepi (floor), jadi normalisasi ke rata-rata per piksel
  // untuk mengukur "keramaian" yang adil antar-blok.
  const pxPerBlock = ((w - 2) * (h - 2)) / nBlocks
  let maxMean = 0
  const means = new Float32Array(nBlocks)
  for (let b = 0; b < nBlocks; b++) {
    means[b] = blockSum[b] / pxPerBlock
    if (means[b] > maxMean) maxMean = means[b]
  }

  // Flat = nyaris tanpa tepi KUAT di mana pun (bukan rata-rata kecil — subjek mungil
  // di frame kosong tetap punya tepi kuat dan TIDAK boleh lolos sebagai "flat").
  const isFlat = maxMean < 2.5
  if (isFlat || total <= 0) {
    return {
      score: 55, centerBias: 0.3, maxCellShare: 0.2, borderShare: 0.2,
      subjectSize: 0, maxEdge: maxMean, isFlat: true, confidence: 0.4, reasons: [], reasonsEn: [],
    }
  }

  // Semua porsi dari SUM (skala konsisten dengan total).
  const cells = new Float32Array(9)
  let center = 0
  let border = 0
  let busy = 0
  const busyThr = maxMean * 0.4
  for (let by = 0; by < ROWS; by++) {
    for (let bx = 0; bx < COLS; bx++) {
      const b = by * COLS + bx
      const v = blockSum[b]
      const cx = Math.min(2, Math.floor((bx / COLS) * 3))
      const cy = Math.min(2, Math.floor((by / ROWS) * 3))
      cells[cy * 3 + cx] += v
      // tengah: 50% lebar x 60% tinggi
      if (bx >= COLS * 0.25 && bx < COLS * 0.75 && by >= ROWS * 0.2 && by < ROWS * 0.8) center += v
      if (bx === 0 || by === 0 || bx === COLS - 1 || by === ROWS - 1) border += v
      if (means[b] > busyThr) busy++
    }
  }
  let maxCell = 0
  for (let c = 0; c < 9; c++) if (cells[c] > maxCell) maxCell = cells[c]

  const centerBias = center / total
  const maxCellShare = maxCell / total
  const borderShare = border / total
  const subjectSize = busy / nBlocks

  let score = 78
  const reasons: string[] = []
  const reasonsEn: string[] = []
  const confident = meanLum >= 35 && meanLum <= 225

  if (maxCellShare > 0.6) {
    score -= 28
    if (confident) { reasons.push('Subjek menumpuk di satu sudut'); reasonsEn.push('Subject cramped in one corner') }
  }
  // Catatan: ketertarikan yang MERATA (group shot, crowd, landscape) adalah komposisi
  // yang sah — bukan "tidak ada subjek". Aturan uniform dihapus setelah terbukti
  // salah sasaran di 183/231 foto asli. Yang dihukum hanya yang JELAS buruk.
  if (borderShare > 0.5) {
    score -= 20
    if (confident) { reasons.push('Subjek terpotong / tepi ramai'); reasonsEn.push('Subject cut off / busy edges') }
  }
  if (subjectSize < 0.06) {
    score -= 25
    if (confident) { reasons.push('Subjek terlalu kecil'); reasonsEn.push('Subject too small') }
  }
  if (centerBias < 0.15 && maxCellShare < 0.45) {
    score -= 12
    if (confident && reasons.length < 2) { reasons.push('Tengah frame kosong'); reasonsEn.push('Empty center') }
  }

  score = Math.max(5, Math.min(95, Math.round(score)))
  if (reasons.length > 2) { reasons.length = 2; reasonsEn.length = 2 }

  let confidence = 1
  if (!confident) confidence = 0.5
  else if (meanLum < 55 || meanLum > 205) confidence = 0.75

  return { score, centerBias, maxCellShare, borderShare, subjectSize, maxEdge: maxMean, isFlat: false, confidence, reasons, reasonsEn }
}
