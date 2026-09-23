import { eyeCrop } from './eye-crop'
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
    const geometry = eyeCrop(w, h, box)
    if (!geometry) return null
    const { sx, sy, sw, sh, cw, ch } = geometry
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
