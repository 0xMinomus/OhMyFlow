// Pass-2 eye ROI (Fase 6) — analisis mata pada crop wajah, bukan full frame.
// Pure JS bilinear crop + resize (bekerja di Web Worker, browser, dan Node tanpa DOM canvas).

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
    const w = image.width, h = image.height
    if (w < 4 || h < 4) return null
    // Expand 1.3x agar kelopak + alis masuk; clamp frame.
    const cx = (box.x + box.w / 2) * w, cy = (box.y + box.h / 2) * h
    let cw = box.w * w * 1.3, ch = box.h * h * 1.3
    const scale = Math.min(2, 512 / Math.max(1, Math.max(cw, ch)))
    cw = Math.max(8, Math.round(cw * scale))
    ch = Math.max(8, Math.round(ch * scale))
    let sx = Math.round(cx - cw / scale / 2), sy = Math.round(cy - ch / scale / 2)
    sx = Math.max(0, Math.min(w - 1, sx)); sy = Math.max(0, Math.min(h - 1, sy))
    const sw = Math.max(1, Math.min(w - sx, Math.round(cw / scale)))
    const sh = Math.max(1, Math.min(h - sy, Math.round(ch / scale)))

    const sd = image.data
    const out = new Uint8ClampedArray(cw * ch * 4)
    const xRatio = (sw - 1) / Math.max(1, cw - 1)
    const yRatio = (sh - 1) / Math.max(1, ch - 1)
    for (let y = 0; y < ch; y++) {
      const gy = sy + y * yRatio
      const y0 = Math.min(h - 1, Math.floor(gy)), y1 = Math.min(h - 1, y0 + 1)
      const fy = gy - y0, iy = 1 - fy
      for (let x = 0; x < cw; x++) {
        const gx = sx + x * xRatio
        const x0 = Math.min(w - 1, Math.floor(gx)), x1 = Math.min(w - 1, x0 + 1)
        const fx = gx - x0, ix = 1 - fx
        const w00 = ix * iy, w10 = fx * iy, w01 = ix * fy, w11 = fx * fy
        const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4
        const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4
        const o = (y * cw + x) * 4
        out[o] = Math.round(sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11)
        out[o + 1] = Math.round(sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11)
        out[o + 2] = Math.round(sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11)
        out[o + 3] = 255
      }
    }
    const crop = typeof ImageData !== 'undefined'
      ? new ImageData(out, cw, ch)
      : ({ data: out, width: cw, height: ch } as ImageData)
    const r = heuristicFaceDetect(crop)
    if (r.eyesState === 'no-face') return null
    return { eyesState: r.eyesState, eyesClosedProbability: r.eyesClosedProbability, boxArea: box.w * box.h }
  } catch {
    return null
  }
}
