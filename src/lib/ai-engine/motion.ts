// Motion blur detection — heuristik murni (tanpa model).
// Motion searah = gradien collapse di satu sumbu: energi |dx| vs |dy| timpang
// pada tepi kuat, sementara blur defocus simetris. Ditambah delta subjek-vs-
// background: subjek lunak + background tajam = kandidat motion/partial blur.

export interface MotionResult {
  motionLikelihood: number // 0-1
  axis: 'horizontal' | 'vertical' | 'none'
  subjectBgDelta: number // fokus tengah minus fokus tepi (-95..95)
}

export function analyzeMotionFromGray(gray: Float32Array, w: number, h: number): MotionResult {
  let ex = 0, ey = 0, n = 0
  for (let y = 1; y < h - 1; y += 2) {
    const row = y * w
    for (let x = 1; x < w - 1; x += 2) {
      const i = row + x
      const dx = Math.abs(gray[i] - gray[i - 1])
      const dy = Math.abs(gray[i] - gray[i - w])
      if (dx + dy > 12) { ex += dx; ey += dy; n++ }
    }
  }
  let motionLikelihood = 0
  let axis: MotionResult['axis'] = 'none'
  if (n > 200) {
    const ratio = Math.min(ex, ey) / Math.max(1, Math.max(ex, ey))
    // Seimbang ~1 (defocus/tekstur); timpang <0.45 = satu sumbu collapse.
    // ponytail: ambang kasar global, kalibrasi ulang bila FP tinggi
    if (ratio < 0.45) {
      motionLikelihood = Math.min(1, (0.45 - ratio) * 3)
      axis = ex < ey ? 'horizontal' : 'vertical'
    }
  }
  // Delta tengah vs tepi (blok): subjek-gerak-bg-tajam = tengah lunak.
  const band = (x0: number, y0: number, x1: number, y1: number) => {
    let s = 0, c = 0
    for (let y = Math.max(1, Math.floor(y0 * h)); y < Math.min(h - 1, Math.ceil(y1 * h)); y += 2) {
      const row = y * w
      for (let x = Math.max(1, Math.floor(x0 * w)); x < Math.min(w - 1, Math.ceil(x1 * w)); x += 2) {
        s += Math.abs(gray[row + x] - gray[row + x - 1]) + Math.abs(gray[row + x] - gray[row + x - w])
        c++
      }
    }
    return c ? s / c : 0
  }
  const center = band(0.3, 0.3, 0.7, 0.7)
  const edge = (band(0, 0, 1, 0.2) + band(0, 0.8, 1, 1) + band(0, 0, 0.2, 1) + band(0.8, 0, 1, 1)) / 4
  const subjectBgDelta = Math.round((center - edge) * 2)
  return { motionLikelihood: Math.round(motionLikelihood * 100) / 100, axis, subjectBgDelta }
}
