// Subject layer v2 (High saja) — tanpa detector baru, tanpa tebak presisi.
// Prioritas eviden: zona wajah bila wajah terdeteksi (blok atas-tengah) →
// blok subjek tengah (existing) → fallback global. Box hanya diagnostik.

export interface SubjectDetection {
  type: 'face' | 'heuristic' | 'unknown'
  box: { x: number; y: number; w: number; h: number } // relatif 0-1
  confidence: number // 0-1
  importance: number // 0-1, dominasi frame
}

export interface SubjectFocus {
  subject: SubjectDetection
  focus: number | null // ketajaman zona subjek 0-100, null bila tak ada eviden
  confidence: number
}

function blockVar(gray: Float32Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): number {
  let s = 0, s2 = 0, n = 0
  const ax0 = Math.max(1, Math.floor(x0 * w)), ax1 = Math.min(w - 1, Math.ceil(x1 * w))
  const ay0 = Math.max(1, Math.floor(y0 * h)), ay1 = Math.min(h - 1, Math.ceil(y1 * h))
  for (let y = ay0; y < ay1; y++) {
    const row = y * w
    for (let x = ax0; x < ax1; x++) {
      const i = row + x
      const v = -4 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w]
      s += v; s2 += v * v; n++
    }
  }
  if (!n) return 0
  return Math.max(0, s2 / n - (s / n) * (s / n))
}

function toScore(v: number): number {
  const s = 30 * Math.log10(v + 1)
  return Math.round(Math.max(5, Math.min(95, s)))
}

export function analyzeSubjectFocus(
  gray: Float32Array, w: number, h: number, hasFace: boolean, faceConfidence: number
): SubjectFocus {
  if (hasFace) {
    // Zona wajah: sepertiga atas-tengah (tempat wajah bila skin terklaster tengah).
    const v = blockVar(gray, w, h, 0.25, 0.1, 0.75, 0.55)
    return {
      subject: { type: 'face', box: { x: 0.25, y: 0.1, w: 0.5, h: 0.45 }, confidence: faceConfidence, importance: 0.8 },
      focus: toScore(v), confidence: faceConfidence,
    }
  }
  // Heuristik: bandingkan ketajaman tengah vs rata-rata; tengah jauh lebih tajam
  // = subjek terdefinisi di tengah. Tanpa itu = unknown (jangan pura-punya box).
  const center = blockVar(gray, w, h, 0.3, 0.3, 0.7, 0.7)
  const whole = blockVar(gray, w, h, 0, 0, 1, 1)
  if (center > whole * 1.5 && center > 30) {
    return {
      subject: { type: 'heuristic', box: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, confidence: 0.55, importance: 0.6 },
      focus: toScore(center), confidence: 0.55,
    }
  }
  return {
    subject: { type: 'unknown', box: { x: 0, y: 0, w: 1, h: 1 }, confidence: 0.3, importance: 0.3 },
    focus: null, confidence: 0.3,
  }
}
