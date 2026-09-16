// Deteksi horizon miring — heuristik murni, 100% lokal.
// Langit/laut/panggung: energi tepi horizontal terkuat berkumpul di satu baris.
// Belah frame kiri vs kanan; bila baris-tepi-terkuat keduanya jauh berbeda dan
// energi horizontal dominan di kedua belah = horizon miring. Efek ringan:
// penalti skor komposisi + alasan, TAK PERNAH hard-reject (arsitektur diagonal
// dan pose bisa meniru pola ini).

export interface TiltResult {
  tilted: boolean
  confidence: number // 0-1
  slope: number // beda baris relatif tinggi frame (-1..1)
}

export function analyzeTiltFromGray(gray: Float32Array, w: number, h: number): TiltResult {
  const bands = 24
  const left = new Float32Array(bands)
  const right = new Float32Array(bands)
  // Tepi HORIZONTAL (garis horizon, atap, panggung) = perubahan antar-BARIS (dy).
  let horiz = 0
  let vert = 0
  for (let y = 1; y < h - 1; y += 2) {
    const band = Math.min(bands - 1, Math.floor((y / h) * bands))
    const row = y * w
    for (let x = 1; x < w - 1; x += 2) {
      const i = row + x
      const dx = Math.abs(gray[i] - gray[i - 1])
      const dy = Math.abs(gray[i] - gray[i - w])
      horiz += dy
      vert += dx
      if (dy > dx * 1.5) {
        if (x < w / 2) left[band] += dy
        else right[band] += dy
      }
    }
  }
  // Butuh karakter landscape: tepi horizontal jelas dominan.
  if (horiz < vert * 1.2 || horiz <= 0) return { tilted: false, confidence: 0, slope: 0 }
  let bl = 0, br = 0
  for (let b = 0; b < bands; b++) {
    if (left[b] > left[bl]) bl = b
    if (right[b] > right[br]) br = b
  }
  const surf = (a: Float32Array, b: number) => a[b] / Math.max(1, horiz / 2)
  // Puncak harus nyata (bukan noise): masing-masing ≥8% energi horizontal.
  if (surf(left, bl) < 0.08 || surf(right, br) < 0.08) return { tilted: false, confidence: 0, slope: 0 }
  const slope = (br - bl) / bands
  const tilted = Math.abs(slope) > 0.06
  // ponytail: ambang kasar global, ganti Hough bila false-positive tinggi
  return { tilted, confidence: tilted ? 0.7 : 0, slope: Math.round(slope * 100) / 100 }
}
