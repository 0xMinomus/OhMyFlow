// Pass-2 eye ROI (Fase 6) — analisis mata pada crop wajah, bukan full frame.
// Wajah kecil/jauh: pupil 2-3px di full frame tak terbaca → crop box ONNX
// (upscale ≤2x, ≤512px) lalu heuristik mata yang SAMA (tanpa kode baru).
// Renderer-only (butuh canvas); Node/harness = null → bit-identik fallback.

import { heuristicFaceDetect } from '../ai-engine/face'
import type { FaceDetection } from './face-onnx'

export interface EyeROIResult {
  eyesState: 'open' | 'closed' | 'unknown'
  eyesClosedProbability: number
  boxArea: number
}

export async function refineEyesWithROI(
  image: ImageData, box: FaceDetection['box']
): Promise<EyeROIResult | null> {
  try {
    if (typeof document === 'undefined') return null
    const w = image.width, h = image.height
    // Expand 1.3x agar kelopak + alis masuk; clamp frame.
    const cx = (box.x + box.w / 2) * w, cy = (box.y + box.h / 2) * h
    let cw = box.w * w * 1.3, ch = box.h * h * 1.3
    const scale = Math.min(2, 512 / Math.max(cw, ch))
    cw = Math.max(8, Math.round(cw * scale))
    ch = Math.max(8, Math.round(ch * scale))
    let sx = Math.round(cx - cw / scale / 2), sy = Math.round(cy - ch / scale / 2)
    sx = Math.max(0, Math.min(w - 1, sx)); sy = Math.max(0, Math.min(h - 1, sy))
    const sw = Math.max(1, Math.min(w - sx, Math.round(cw / scale)))
    const sh = Math.max(1, Math.min(h - sy, Math.round(ch / scale)))
    const src = document.createElement('canvas')
    src.width = w; src.height = h
    const sctx = src.getContext('2d', { willReadFrequently: true })
    if (!sctx) return null
    sctx.putImageData(image, 0, 0)
    const dst = document.createElement('canvas')
    dst.width = cw; dst.height = ch
    const dctx = dst.getContext('2d', { willReadFrequently: true })
    if (!dctx) return null
    dctx.imageSmoothingEnabled = true
    dctx.drawImage(src, sx, sy, sw, sh, 0, 0, cw, ch)
    const crop = dctx.getImageData(0, 0, cw, ch)
    const r = heuristicFaceDetect(crop)
    if (r.eyesState === 'no-face') return null
    const area = box.w * box.h
    return { eyesState: r.eyesState, eyesClosedProbability: r.eyesClosedProbability, boxArea: area }
  } catch {
    return null
  }
}
