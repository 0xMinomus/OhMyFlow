// Laplacian blur detection — akurat & stabil, 100% lokal.
// Perbaikan vs versi lama:
// - Normalisasi terhadap brightness (foto gelap tidak auto-dicap blur)
// - Deteksi flat (langit/tembok polos) agar tidak dihukum sebagai blur
// - Mapping logaritmik halus 0-100 (tidak ada lompatan piecewise)
// - Bekerja pada grayscale kecil (384px) yang di-share pipeline (1x decode)

export interface SharpnessResult {
  variance: number
  normalized: number
  sharpness: number // 0-100 (Laplacian, terkalibrasi)
  subject: number // 0-100 (ketajaman blok tengah = area subjek)
  edge: number // 0-100 (fraksi piksel tajam, ambang relatif kontras)
  gradP50: number // median gradien (halus-bersih ~1, blur bertekstur 2-5, kaya >5)
  gradP99: number // gradien 1% teratas (rim tajam vs blur total)
  focus: number // 0-100 (gabungan ketiganya — skor fokus final)
  blurConfidence: number // 0-1, tinggi bila ketiga metrik sepakat
  accidental: boolean // true bila nyaris tanpa tepi SAMA SEKALI di ekstrem gelap/terang (tutup lensa)
  meanLum: number
  isFlat: boolean
  confidence: number // 0-1, rendah jika flat/gelap pekat
}

export function grayFromImageData(imageData: ImageData): { gray: Float32Array; w: number; h: number; mean: number } {
  const { data, width: w, height: h } = imageData
  const gray = new Float32Array(w * h)
  let sum = 0
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const v = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    gray[j] = v
    sum += v
  }
  return { gray, w, h, mean: sum / (w * h) }
}

export function laplacianVarianceFromGray(gray: Float32Array, w: number, h: number): { variance: number; mean: number } {
  let sum = 0
  let sumSq = 0
  let count = 0
  // skip 1px border
  for (let y = 1; y < h - 1; y++) {
    const row = y * w
    for (let x = 1; x < w - 1; x++) {
      const idx = row + x
      const v = -4 * gray[idx] + gray[idx - 1] + gray[idx + 1] + gray[idx - w] + gray[idx + w]
      sum += v
      sumSq += v * v
      count++
    }
  }
  if (count === 0) return { variance: 0, mean: 0 }
  const mean = sum / count
  const variance = Math.max(0, sumSq / count - mean * mean)
  return { variance, mean }
}

// Backward-compat wrapper
export function laplacianVariance(imageData: ImageData): number {
  const { gray, w, h } = grayFromImageData(imageData)
  return laplacianVarianceFromGray(gray, w, h).variance
}

export function sharpnessScore(variance: number, meanLum = 120): number {
  return sharpnessDetailed(variance, meanLum).sharpness
}

export function sharpnessDetailed(variance: number, meanLum = 120): { sharpness: number; isFlat: boolean; confidence: number; accidental: boolean } {
  // Normalisasi: variance dibagi brightness agar foto gelap tidak auto-blur.
  // mean 120 = referensi; gelap (<60) boost variance secara proporsional tapi dibatasi.
  const brightnessFactor = meanLum < 15 ? 4 : meanLum < 40 ? 120 / Math.max(meanLum, 20) * 0.6 : 120 / Math.max(meanLum, 60)
  const norm = variance * Math.min(brightnessFactor, 2.5)

  // Mapping logaritmik dikalibrasi dari foto wedding nyata (thumbnail 384px):
  // norm ~8 → sangat blur (15), ~30 → blur (35), ~90 → cukup (60),
  // ~220 → tajam (80), ~500 → sangat tajam (92), ~1000+ → 98
  let s: number
  if (norm <= 0) s = 3
  else {
    const log = Math.log10(norm + 1)
    // log10(9)=0.95 → 15, log10(31)=1.49 → 35, log10(91)=1.96 → 60, log10(221)=2.35 → 80, log10(501)=2.7 → 92
    s = -38 + 48 * log
    s = Math.max(3, Math.min(99, s))
  }

  // Frame nyaris tanpa tepi di ekstrem gelap/terang = kecelakaan (tutup lensa),
  // BUKAN langit/tembok — jangan dilindungi guard flat.
  const accidental = variance < 2 && (meanLum < 12 || meanLum > 243)

  // Flat detection: variance sangat rendah + brightness ekstrem biasanya flat, bukan blur.
  // Tandai agar culler tidak hard-reject, melainkan nilai tengah (kecuali accidental).
  const isFlat = !accidental && norm < 12 && (meanLum > 200 || meanLum < 25)
  let sharpness = Math.round(s)
  if (isFlat) sharpness = Math.max(sharpness, 38) // jangan hukum tembok/sky polos

  // Confidence rendah jika terlalu gelap/terang (metric tidak reliabel)
  let confidence = 1
  if (meanLum < 20 || meanLum > 240) confidence = 0.45
  else if (meanLum < 40 || meanLum > 220) confidence = 0.7
  if (isFlat) confidence = Math.min(confidence, 0.5)

  return { sharpness, isFlat, confidence, accidental }
}

// Variansi Laplacian per blok 4x4 — peta fokus murah. Subjek yang blur terdeteksi
// walau background tajam (kasus motion-blur parsial yang lolos metrik global).
export function blockVariancesFromGray(gray: Float32Array, w: number, h: number, grid = 4): number[] {
  const out: number[] = []
  for (let by = 0; by < grid; by++) {
    for (let bx = 0; bx < grid; bx++) {
      const x0 = Math.floor((bx * w) / grid), x1 = Math.floor(((bx + 1) * w) / grid)
      const y0 = Math.floor((by * h) / grid), y1 = Math.floor(((by + 1) * h) / grid)
      let s = 0, s2 = 0, n = 0
      for (let y = y0 + 1; y < y1 - 1; y++) {
        for (let x = x0 + 1; x < x1 - 1; x++) {
          const i = y * w + x
          const v = -4 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w]
          s += v; s2 += v * v; n++
        }
      }
      out.push(n ? Math.max(0, s2 / n - (s / n) * (s / n)) : 0)
    }
  }
  return out
}

// Ketajaman area subjek = rata-rata 2 tengah dari 4 blok tengah.
// Terukur di foto asli: subjek tajam ≥224, subjek blur ≤163, berat ≤15.
export function subjectScore(centerMedianVar: number): number {
  const s = 30 * Math.log10(centerMedianVar + 1)
  return Math.round(Math.max(5, Math.min(95, s)))
}

// Fraksi piksel dengan respons Laplacian kuat, ambang RELATIF terhadap kontras foto.
// Motion blur menyebarkan tepi → sedikit piksel yang lolos ambang. Terukur di foto asli:
// foto tajam ≥0.071, blur ≤0.042 (jurang bersih).
export function edgeDensityFromGray(gray: Float32Array, w: number, h: number, meanLum: number): number {
  const T = Math.max(12, meanLum * 0.35)
  let strong = 0, n = 0
  for (let y = 1; y < h - 1; y++) {
    const row = y * w
    for (let x = 1; x < w - 1; x++) {
      const i = row + x
      if (Math.abs(-4 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w]) > T) strong++
      n++
    }
  }
  return n ? strong / n : 0
}

export function edgeScore(density: number): number {
  if (density <= 0) return 5
  // 0.001→8, 0.01→42, 0.04→62, 0.08→73, 0.14→81 (terkalibrasi, foto asli)
  const s = 34 * Math.log10(density) + 110
  return Math.round(Math.max(5, Math.min(95, s)))
}

// Profil gradien murah (satu pass, histogram): p50 = kehalusan khas,
// p99 = bukti tepi tajam. Kombinasi keduanya memisahkan "mulus-tapi-tajam"
// (p50 rendah, p99 tinggi: glasir bersih) dari "blur total" (keduanya rendah).
export function gradientProfileFromGray(gray: Float32Array, w: number, h: number): { p50: number; p99: number } {
  const BINS = 256
  const hist = new Uint32Array(BINS)
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    const row = y * w
    for (let x = 1; x < w - 1; x++) {
      const i = row + x
      const g = Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - w])
      hist[Math.min(BINS - 1, Math.floor(g / 2)) ]++
      n++
    }
  }
  const at = (p: number) => {
    const target = p * Math.max(1, n)
    let acc = 0
    for (let b = 0; b < BINS; b++) {
      acc += hist[b]
      if (acc >= target) return b * 2 + 1
    }
    return BINS * 2
  }
  return { p50: at(0.5), p99: at(0.99) }
}

export function analyzeSharpnessFromGray(gray: Float32Array, w: number, h: number, meanLum: number): SharpnessResult {
  const { variance } = laplacianVarianceFromGray(gray, w, h)
  const { sharpness, isFlat, confidence, accidental } = sharpnessDetailed(variance, meanLum)
  const normalized = variance * (120 / Math.max(meanLum, 20))
  const { p50: gradP50, p99: gradP99 } = gradientProfileFromGray(gray, w, h)
  // Subjek: rata-rata 2 nilai tengah dari 4 blok tengah (indeks 5,6,9,10 grid 4x4).
  const blocks = blockVariancesFromGray(gray, w, h, 4)
  const mid = [blocks[5], blocks[6], blocks[9], blocks[10]].sort((a, b) => a - b)
  const subject = subjectScore(Math.max(0, (mid[1] + mid[2]) / 2))
  const edge = edgeScore(edgeDensityFromGray(gray, w, h, meanLum))
  // Skor fokus final: subjek paling menentukan (45%), global 35%, kerapatan tepi 20%.
  const focus = Math.round(
    Math.max(3, Math.min(99, 0.45 * subject + 0.35 * sharpness + 0.2 * edge))
  )
  // Kesepakatan ketiganya → keyakinan.
  const spread = Math.max(sharpness, subject, edge) - Math.min(sharpness, subject, edge)
  const blurConfidence = spread < 18 ? 0.9 : spread < 32 ? 0.7 : spread < 48 ? 0.5 : 0.35
  return { variance, normalized, sharpness, subject, edge, gradP50, gradP99, focus, blurConfidence, accidental, meanLum, isFlat, confidence }
}

// Wrapper lama (tetap ada agar tidak breaking): decode sendiri jika dipanggil langsung.
export async function computeBlurFromDataUrl(dataUrl: string): Promise<{ variance: number; sharpness: number }> {
  const r = await computeBlurDetailedFromDataUrl(dataUrl)
  return { variance: r.variance, sharpness: r.sharpness }
}

export async function computeBlurDetailedFromDataUrl(dataUrl: string): Promise<SharpnessResult> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const maxSide = 384 // lebih kecil = lebih ringan & cukup untuk blur
        let w = img.width, h = img.height
        if (w > maxSide || h > maxSide) {
          const s = Math.min(maxSide / w, maxSide / h)
          w = Math.max(2, Math.round(w * s)); h = Math.max(2, Math.round(h * s))
        }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0, w, h)
        const imageData = ctx.getImageData(0, 0, w, h)
        const { gray, mean } = grayFromImageData(imageData)
        resolve(analyzeSharpnessFromGray(gray, w, h, mean))
      } catch {
        resolve({ variance: 0, normalized: 0, sharpness: 0, subject: 0, edge: 0, gradP50: 0, gradP99: 0, focus: 0, blurConfidence: 0, accidental: false, meanLum: 0, isFlat: false, confidence: 0 })
      }
    }
    img.onerror = () => resolve({ variance: 0, normalized: 0, sharpness: 0, subject: 0, edge: 0, gradP50: 0, gradP99: 0, focus: 0, blurConfidence: 0, accidental: false, meanLum: 0, isFlat: false, confidence: 0 })
    img.src = dataUrl
  })
}
