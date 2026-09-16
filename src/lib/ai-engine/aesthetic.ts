// Aesthetic scoring — akurat & konservatif (tidak ngawur), 100% lokal.
// Perbaikan:
// - Single-pass + clipping highlight/shadow (gaun blown & jas crushed = sinyal reject terkuat)
// - White-balance cast detection
// - Threshold alasan konservatif (hanya jika bukti kuat) agar tidak spam alasan
// - Skor tanpa bonus arbitrer, dengan penalti clipping eksplisit

export interface AestheticResult {
  score: number // 0-100
  exposure: number
  contrast: number
  colorfulness: number
  meanLum: number
  clippedHiPct: number // % pixel >250 (blown)
  clippedHiCenterPct: number // % pixel >250 di area tengah (subjek blown = fatal)
  clippedHiBorderPct: number // % pixel >250 di bibir tepi (bg putih studio vs langit gosong)
  clippedLoPct: number // % pixel <6 (crushed)
  whiteBackground: boolean // latar putih studio yang disengaja (bukan cacat)
  whiteBalanceCast: number // 0-100, makin tinggi makin cast
  isFlat: boolean
  confidence: number
  reasons: string[]
  reasonsEn: string[]
}

export function analyzeAestheticFromPixels(
  data: Uint8ClampedArray, pixelCount: number, meanLum: number, hist: number[]
): AestheticResult {
  // contrast dari histogram
  let lumVar = 0
  for (let i = 0; i < 256; i++) lumVar += hist[i] * Math.pow(i - meanLum, 2)
  lumVar /= Math.max(1, pixelCount)
  const std = Math.sqrt(lumVar)
  // std 0-90 → 0-100 dengan kurva (std 45 = bagus ~75)
  const contrast = Math.max(0, Math.min(100, (std / 55) * 100 * (std < 12 ? std / 12 : 1)))

  // colorfulness + WB — butuh pass kedua, dilakukan caller via analyzeAestheticFull
  return {
    score: 50, exposure: 50, contrast: Math.round(contrast), colorfulness: 50,
    meanLum: Math.round(meanLum), clippedHiPct: 0, clippedHiCenterPct: 0, clippedHiBorderPct: 0, clippedLoPct: 0, whiteBackground: false,
    whiteBalanceCast: 0, isFlat: std < 10, confidence: 1, reasons: [], reasonsEn: []
  }
}

// Fungsi utama yang dipakai pipeline: terima ImageData sekali jadi.
export function analyzeAesthetic(imageData: ImageData): AestheticResult {
  const { data, width: w, height: h } = imageData
  const pixelCount = w * h
  const hist = new Array(256).fill(0)
  let lumSum = 0
  let rSum = 0, gSum = 0, bSum = 0
  let hi = 0, lo = 0
  let hiCenter = 0, centerN = 0
  let hiBorder = 0, borderN = 0

  for (let y = 0; y < h; y++) {
    const inCenterY = y >= h * 0.2 && y < h * 0.8
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = data[i], g = data[i + 1], b = data[i + 2]
      rSum += r; gSum += g; bSum += b
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      lumSum += lum
      const li = lum < 0 ? 0 : lum > 255 ? 255 : Math.round(lum)
      hist[li]++
      if (lum > 250) hi++
      else if (lum < 6) lo++
      // Highlight di TENGAH = subjek yang gosong (fatal); di tepi = background (ringan).
      // Bibir tepi yang gosong + tengah bersih = latar putih studio (bukan cacat).
      if (inCenterY && x >= w * 0.25 && x < w * 0.75) {
        centerN++
        if (lum > 250) hiCenter++
      }
      if (x < w * 0.06 || x >= w * 0.94 || y < h * 0.06 || y >= h * 0.94) {
        borderN++
        if (lum > 250) hiBorder++
      }
    }
  }
  const lumMean = lumSum / Math.max(1, pixelCount)
  const rMean = rSum / Math.max(1, pixelCount)
  const gMean = gSum / Math.max(1, pixelCount)
  const bMean = bSum / Math.max(1, pixelCount)
  const hiPct = (hi / Math.max(1, pixelCount)) * 100
  const loPct = (lo / Math.max(1, pixelCount)) * 100
  const hiCenterPct = (hiCenter / Math.max(1, centerN)) * 100
  const hiBorderPct = (hiBorder / Math.max(1, borderN)) * 100

  // exposure: ideal 105-145, dengan toleransi lebar agar tidak ngawur
  let exposure: number
  if (lumMean < 30) exposure = 8
  else if (lumMean < 55) exposure = 25 + (lumMean - 30) * 1.4
  else if (lumMean < 85) exposure = 60 + (lumMean - 55) * 1.0
  else if (lumMean < 105) exposure = 90 + (lumMean - 85) * 0.5
  else if (lumMean < 150) exposure = 100
  else if (lumMean < 185) exposure = 100 - (lumMean - 150) * 0.7
  else if (lumMean < 220) exposure = 75 - (lumMean - 185) * 1.1
  else exposure = Math.max(5, 36 - (lumMean - 220) * 0.8)
  exposure = Math.max(0, Math.min(100, exposure))

  // Latar terang yang BERSIH (tak ada piksel gosong) = exposure benar (putih studio,
  // high-key), bukan cacat. Jangan dihukum oleh kurva kecerahan umum.
  if (hiPct < 3 && lumMean > 185) exposure = Math.max(60, 105 - (lumMean - 150) * 0.45)

  // Latar putih studio: tepi gosong + tengah bersih + bayangan minim.
  // Dihukum seperti langit gosong = salah sasaran (terbukti di foto produk).
  const whiteBg = hiPct > 8 && hiBorderPct > 30 && hiCenterPct < 10 && loPct < 15
  if (whiteBg) exposure = Math.max(exposure, 70)

  // penalti clipping langsung ke exposure
  if (!whiteBg && hiPct > 5) exposure = Math.max(5, exposure - (hiPct - 5) * 2.2)
  if (loPct > 22) exposure = Math.max(5, exposure - (loPct - 22) * 0.9)

  // contrast
  let lumVar = 0
  for (let i = 0; i < 256; i++) lumVar += hist[i] * Math.pow(i - lumMean, 2)
  lumVar /= Math.max(1, pixelCount)
  const std = Math.sqrt(lumVar)
  let contrast = Math.min(100, (std / 52) * 100)
  if (std < 10) contrast *= std / 10 // flat → rendah tapi tidak 0 mendadak
  // Latar terang bersih (putih studio): kontras rendah di sana = bersih, bukan cacat.
  const brightClean = hiPct < 3 && lumMean > 190
  if (brightClean) contrast = Math.max(contrast, 65)

  // colorfulness Hasler & Suesstrunk (single pass kedua digabung di sini)
  let rgSum = 0, ybSum = 0, rgSq = 0, ybSq = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const rg = r - g
    const yb = 0.5 * (r + g) - b
    rgSum += rg; ybSum += yb
    rgSq += rg * rg; ybSq += yb * yb
  }
  const n = Math.max(1, pixelCount)
  const rgMean = rgSum / n, ybMean = ybSum / n
  const rgStd = Math.sqrt(Math.max(0, rgSq / n - rgMean * rgMean))
  const ybStd = Math.sqrt(Math.max(0, ybSq / n - ybMean * ybMean))
  const stdRoot = Math.sqrt(rgStd * rgStd + ybStd * ybStd)
  const meanRoot = Math.sqrt(rgMean * rgMean + ybMean * ybMean)
  const rawColor = Math.sqrt(stdRoot * stdRoot + 0.3 * meanRoot * meanRoot)
  const colorfulness = Math.max(0, Math.min(100, rawColor / 2.1))

  // white balance cast: selisih channel rata-rata
  const maxC = Math.max(rMean, gMean, bMean), minC = Math.min(rMean, gMean, bMean)
  const cast = lumMean > 15 ? ((maxC - minC) / Math.max(1, lumMean)) * 100 : 0

  const isFlat = std < 11

  // skor final: tanpa bonus +15 (itu yang bikin ngawur ke atas)
  let clipPenalty = 0
  if (!whiteBg && hiPct > 6) clipPenalty += Math.min(22, (hiPct - 6) * 1.6)
  if (loPct > 28) clipPenalty += Math.min(12, (loPct - 28) * 0.5)
  // Warna pastel (8-20) = pilihan artistik yang sah (keramik!), bukan cacat.
  // Kurva jenuh: abu-abu mati (<8) tetap dihukum, pastel diangkat, vivid utuh.
  // Terukur: 0/231 foto manusia di bawah 20 → perubahan ini tak menyentuh mereka.
  const colorForScore = colorfulness < 8
    ? colorfulness * 3.75
    : colorfulness < 20
      ? 30 + (colorfulness - 8) * 3.33
      : Math.min(100, 70 + (colorfulness - 20) * 1.2)
  let score = exposure * 0.42 + contrast * 0.3 + colorForScore * 0.28 - clipPenalty
  if (isFlat) score = Math.min(score, 58) // foto flat jangan jadi picks
  score = Math.max(4, Math.min(98, score))

  // Alasan KONSERVATIF — hanya jika bukti kuat (anti-ngawur).
  // Latar putih studio bukan cacat: alasannya dibungkam.
  const reasons: string[] = []
  const reasonsEn: string[] = []
  if (!whiteBg && hiPct > 6) { reasons.push(`Highlight pecah (${hiPct.toFixed(1)}%)`); reasonsEn.push(`Blown highlights (${hiPct.toFixed(1)}%)`) }
  else if (!whiteBg && lumMean > 218 && hiPct > 5) { reasons.push('Terlalu terang / overexposed'); reasonsEn.push('Overexposed') }
  if (loPct > 30 && lumMean < 60) { reasons.push('Terlalu gelap'); reasonsEn.push('Too dark') }
  else if (exposure < 32) { reasons.push('Pencahayaan buruk'); reasonsEn.push('Poor exposure') }
  if (contrast < 18 && !isFlat) { reasons.push('Kontras rendah'); reasonsEn.push('Low contrast') }
  if (colorfulness < 10 && lumMean > 40 && lumMean < 210) { reasons.push('Warna pucat'); reasonsEn.push('Washed out colors') }
  if (cast > 42 && colorfulness > 12) { reasons.push('White balance melenceng'); reasonsEn.push('Color cast') }

  let confidence = 1
  if (isFlat) confidence = 0.6
  if (pixelCount < 60 * 60) confidence = Math.min(confidence, 0.7)

  return {
    score: Math.round(score), exposure: Math.round(exposure),
    contrast: Math.round(contrast), colorfulness: Math.round(colorfulness),
    meanLum: Math.round(lumMean), clippedHiPct: Math.round(hiPct * 10) / 10,
    clippedHiCenterPct: Math.round(hiCenterPct * 10) / 10,
    clippedHiBorderPct: Math.round(hiBorderPct * 10) / 10,
    clippedLoPct: Math.round(loPct * 10) / 10,
    whiteBackground: whiteBg,
    whiteBalanceCast: Math.round(cast), isFlat, confidence, reasons, reasonsEn
  }
}

export async function computeAestheticFromDataUrl(dataUrl: string): Promise<AestheticResult> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const maxSide = 384
        let w = img.width, h = img.height
        if (w > maxSide || h > maxSide) { const s = Math.min(maxSide / w, maxSide / h); w = Math.max(2, Math.round(w * s)); h = Math.max(2, Math.round(h * s)) }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0, w, h)
        resolve(analyzeAesthetic(ctx.getImageData(0, 0, w, h)))
      } catch {
        resolve({ score: 50, exposure: 50, contrast: 50, colorfulness: 50, meanLum: 120, clippedHiPct: 0, clippedHiCenterPct: 0, clippedHiBorderPct: 0, clippedLoPct: 0, whiteBackground: false, whiteBalanceCast: 0, isFlat: false, confidence: 0, reasons: [], reasonsEn: [] })
      }
    }
    img.onerror = () => resolve({ score: 50, exposure: 50, contrast: 50, colorfulness: 50, meanLum: 120, clippedHiPct: 0, clippedHiCenterPct: 0, clippedHiBorderPct: 0, clippedLoPct: 0, whiteBackground: false, whiteBalanceCast: 0, isFlat: false, confidence: 0, reasons: [], reasonsEn: [] })
    img.src = dataUrl
  })
}
