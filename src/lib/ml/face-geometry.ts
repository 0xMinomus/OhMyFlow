export interface FaceDetection {
  box: { x: number; y: number; w: number; h: number }
  score: number
}

/** UltraFace outputs normalized xyxy, independent of input pixel dimensions. */
export function normalizedBox(values: ArrayLike<number>, offset = 0): FaceDetection['box'] | null {
  const v = Array.from({ length: 4 }, (_, i) => values[offset + i])
  if (!v.every(Number.isFinite)) return null
  const [x, y, right, bottom] = v.map(n => Math.max(0, Math.min(1, n)))
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null
}

export function pixelBox(box: FaceDetection['box'], width: number, height: number) {
  const b = normalizedBox([box.x, box.y, box.x + box.w, box.y + box.h])
  if (!b || width < 1 || height < 1) return null
  const x = Math.floor(b.x * width), y = Math.floor(b.y * height)
  return { x, y, w: Math.ceil((b.x + b.w) * width) - x, h: Math.ceil((b.y + b.h) * height) - y }
}

export function iou(a: FaceDetection, b: FaceDetection): number {
  const intersection = Math.max(0, Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x))
    * Math.max(0, Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y))
  const union = a.box.w * a.box.h + b.box.w * b.box.h - intersection
  return union > 0 ? intersection / union : 0
}

export function nms(detections: FaceDetection[], threshold = 0.5): FaceDetection[] {
  const kept: FaceDetection[] = []
  for (const detection of detections.slice().sort((a, b) => b.score - a.score)) {
    if (kept.every(other => iou(other, detection) < threshold)) kept.push(detection)
  }
  return kept
}

/** Frozen legacy preprocessing: nearest-neighbor stretch, BGR CHW (v-127)/128.
 * Changing channel order or interpolation is a separate evaluated experiment.
 */
export function preprocessUltraFace(image: Pick<ImageData, 'width' | 'height' | 'data'>): Float32Array {
  const { width, height, data } = image
  if (width < 1 || height < 1 || data.length !== width * height * 4) throw new Error('INVALID_IMAGE')
  const plane = 320 * 240, result = new Float32Array(plane * 3)
  for (let y = 0; y < 240; y++) for (let x = 0; x < 320; x++) {
    const src = (Math.min(height - 1, Math.floor(y / 240 * height)) * width + Math.min(width - 1, Math.floor(x / 320 * width))) * 4
    const dst = y * 320 + x
    result[dst] = (data[src + 2] - 127) / 128
    result[plane + dst] = (data[src + 1] - 127) / 128
    result[2 * plane + dst] = (data[src] - 127) / 128
  }
  return result
}

export function decodeDetections(scores: ArrayLike<number>, boxes: ArrayLike<number>): FaceDetection[] {
  if (scores.length % 2 || boxes.length !== scores.length * 2) throw new Error('INVALID_MODEL_OUTPUT')
  const raw: FaceDetection[] = []
  for (let i = 0; i < scores.length / 2; i++) {
    const score = scores[i * 2 + 1], box = normalizedBox(boxes, i * 4)
    if (box && Number.isFinite(score) && score >= 0.7 && score <= 1) raw.push({ box, score })
  }
  return nms(raw)
}
