import type { FaceDetection } from './face-geometry'
/** Frozen ROI geometry, shared by runtime and regression tests. */
export function eyeCrop(width: number, height: number, box: FaceDetection['box']) {
  if (width < 1 || height < 1 || !Object.values(box).every(Number.isFinite) || box.w <= 0 || box.h <= 0) return null
  const cx = (box.x + box.w / 2) * width, cy = (box.y + box.h / 2) * height
  let cw = box.w * width * 1.3, ch = box.h * height * 1.3
  const scale = Math.min(2, 512 / Math.max(cw, ch))
  cw = Math.max(8, Math.round(cw * scale)); ch = Math.max(8, Math.round(ch * scale))
  let sx = Math.round(cx - cw / scale / 2), sy = Math.round(cy - ch / scale / 2)
  sx = Math.max(0, Math.min(width - 1, sx)); sy = Math.max(0, Math.min(height - 1, sy))
  return { sx, sy, sw: Math.max(1, Math.min(width - sx, Math.round(cw / scale))),
    sh: Math.max(1, Math.min(height - sy, Math.round(ch / scale))), cw, ch }
}
