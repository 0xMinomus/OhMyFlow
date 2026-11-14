// Single-decode pipeline — kunci ringan + konsisten.
// Sebelumnya: 1 foto di-decode 4x (blur 512px, aesthetic 512px, face 256px, dHash 9x8)
//   → 4x Image, 4x canvas, 4x getImageData. Untuk 1500 foto = 6000 decode → berat & GC thrashing.
// Sekarang: 1x decode ke max 384px → 1 ImageData → semua analisis reuse piksel yang sama.
// Hasil: ~4x lebih cepat, memori turun drastis, skor konsisten (tidak beda skala).

import { grayFromImageData, analyzeSharpnessFromGray, type SharpnessResult } from './blur'
import { analyzeAesthetic, type AestheticResult } from './aesthetic'
import { analyzeCompositionFromGray, type CompositionResult } from './composition'
import { dHashFromGray } from './duplicate'
import { heuristicFaceDetect, type FaceResult } from './face'
import { analyzeTiltFromGray, type TiltResult } from './tilt'
import { analyzeSubjectFocus, type SubjectFocus } from './subject'
import { analyzeMotionFromGray, type MotionResult } from './motion'

export interface PipelineFeatures {
  sharpness: SharpnessResult
  aesthetic: AestheticResult
  composition: CompositionResult
  face: FaceResult
  tilt: TiltResult
  subject: SubjectFocus
  motion: MotionResult
  dhash: string
  width: number
  height: number
}

// Feature flag v2 (rollback: false = path thumbnail lama untuk semua mode).
export const V2_ANALYSIS_IMAGE = true
// Flag Fase 2 (rollback: false = skoring v1 murni).
export const V2_SUBJECT = true
// Flag Fase 4: ranking burst + redundant reject (High saja).
export const V2_BURST_RANK = true
// GT-2026-09: eye second-pass resolusi tinggi (High + wajah + unknown saja).
export const V2_HIEYE = true
// Resolusi analysis image per mode (§7 new-architecture; High aktif dulu).
export const ANALYSIS_IMAGE_SIZE = { fast: 640, balanced: 896, high: 1280 } as const

const decodeCache = new Map<string, Promise<ImageData | null>>()

function dataUrlKey(dataUrl: string): string {
  // dataUrl bisa 50KB — jangan pakai string penuh sebagai key; pakai prefix+panjang+hash cepat
  let h = 5381
  const n = Math.min(dataUrl.length, 4000)
  for (let i = 0; i < n; i++) h = ((h << 5) + h + dataUrl.charCodeAt(i)) | 0
  return `${dataUrl.length}:${h}:${dataUrl.slice(-64)}`
}
function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',')
  if (comma === -1 || !dataUrl.slice(0, comma).includes('base64')) return null
  const mime = dataUrl.slice(5, comma).split(';')[0] || 'image/jpeg'
  const bin = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function decodeViaBitmap(dataUrl: string, maxSide: number): Promise<ImageData | null> {
  const blob = dataUrlToBlob(dataUrl)
  if (!blob) return null
  const bmp = await createImageBitmap(blob)
  try {
    let w = bmp.width, h = bmp.height
    if (!w || !h) return null
    if (w > maxSide || h > maxSide) {
      const s = Math.min(maxSide / w, maxSide / h)
      w = Math.max(2, Math.round(w * s)); h = Math.max(2, Math.round(h * s))
    }
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, w, h)
    return ctx.getImageData(0, 0, w, h)
  } finally {
    bmp.close()
  }
}

/** Downsample ImageData in memory (bilinear) to avoid redundant image decodes. */
export function downsampleImageData(src: ImageData, maxSide: number): ImageData {
  const sw = src.width, sh = src.height
  if (sw <= maxSide && sh <= maxSide) return src
  const s = Math.min(maxSide / sw, maxSide / sh)
  const dw = Math.max(2, Math.round(sw * s))
  const dh = Math.max(2, Math.round(sh * s))
  const out = new Uint8ClampedArray(dw * dh * 4)
  const sd = src.data
  const xRatio = (sw - 1) / Math.max(1, dw - 1)
  const yRatio = (sh - 1) / Math.max(1, dh - 1)
  for (let y = 0; y < dh; y++) {
    const gy = y * yRatio
    const y0 = Math.floor(gy), y1 = Math.min(sh - 1, y0 + 1)
    const fy = gy - y0, iy = 1 - fy
    for (let x = 0; x < dw; x++) {
      const gx = x * xRatio
      const x0 = Math.floor(gx), x1 = Math.min(sw - 1, x0 + 1)
      const fx = gx - x0, ix = 1 - fx
      const w00 = ix * iy, w10 = fx * iy, w01 = ix * fy, w11 = fx * fy
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4
      const o = (y * dw + x) * 4
      out[o] = Math.round(sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11)
      out[o + 1] = Math.round(sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11)
      out[o + 2] = Math.round(sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11)
      out[o + 3] = 255
    }
  }
  return typeof ImageData !== 'undefined'
    ? new ImageData(out, dw, dh)
    : ({ data: out, width: dw, height: dh } as ImageData)
}

export function decodeOnce(dataUrl: string, maxSide = 384): Promise<ImageData | null> {
  // Guard: input tidak valid (mis. thumbnail gagal dibuat) → null, JANGAN throw.
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
    return Promise.resolve(null)
  }
  let key: string
  try {
    key = `${maxSide}:` + dataUrlKey(dataUrl)
  } catch {
    return Promise.resolve(null)
  }
  const cached = decodeCache.get(key)
  if (cached) return cached
  // batasi cache agar tidak bocor memori (LRU sederhana)
  if (decodeCache.size > 24) {
    const first = decodeCache.keys().next().value
    if (first) decodeCache.delete(first)
  }
  const p = (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined')
    ? decodeViaBitmap(dataUrl, maxSide).catch(() => null)
    : (typeof Image === 'undefined' || typeof document === 'undefined')
      ? Promise.resolve(null)
      : new Promise<ImageData | null>((resolve) => {
          const img = new Image()
          img.onload = () => {
            try {
              let w = img.width, h = img.height
              if (!w || !h) { resolve(null); return }
              if (w > maxSide || h > maxSide) {
                const s = Math.min(maxSide / w, maxSide / h)
                w = Math.max(2, Math.round(w * s)); h = Math.max(2, Math.round(h * s))
              }
              const canvas = document.createElement('canvas')
              canvas.width = w; canvas.height = h
              const ctx = canvas.getContext('2d', { willReadFrequently: true })
              if (!ctx) { resolve(null); return }
              ctx.drawImage(img, 0, 0, w, h)
              resolve(ctx.getImageData(0, 0, w, h))
            } catch { resolve(null) }
            ;(img as any).src = ''
          }
          img.onerror = () => resolve(null)
          img.src = dataUrl
        })
  decodeCache.set(key, p)
  p.then(() => setTimeout(() => decodeCache.delete(key), 15000))
  return p
}

export async function analyzeOne(dataUrl: string, maxSide = 384): Promise<PipelineFeatures | null> {
  if (!dataUrl) return null
  const size = Math.max(128, Math.min(768, Math.round(maxSide)))
  let imageData: ImageData | null = null
  try {
    imageData = await decodeOnce(dataUrl, size)
  } catch {
    return null
  }
  if (!imageData) return null
  return analyzeImageData(imageData)
}

// Versi murni (tanpa DOM): dipakai pipeline browser DAN harness Node.
// Terima ImageData apa pun (canvas browser, sharp raw, dsb).
export function analyzeImageData(imageData: ImageData): PipelineFeatures | null {
  try {
    const w = imageData.width, h = imageData.height
    if (!w || !h) return null
    const { gray, mean } = grayFromImageData(imageData)
    if (gray.length !== w * h) return null
    const sharpness = analyzeSharpnessFromGray(gray, w, h, mean)
    const aesthetic = analyzeAesthetic(imageData)
    const composition = analyzeCompositionFromGray(gray, w, h, mean)
    const face = heuristicFaceDetect(imageData, { sharpness: sharpness.sharpness })
    const tilt = analyzeTiltFromGray(gray, w, h)
    const subject = analyzeSubjectFocus(gray, w, h, face.hasFace, face.faceConfidence)
    const motion = analyzeMotionFromGray(gray, w, h)
    const dhash = dHashFromGray(gray, w, h)
    return { sharpness, aesthetic, composition, face, tilt, subject, motion, dhash, width: w, height: h }
  } catch {
    return null
  }
}

export function clearPipelineCache() {
  decodeCache.clear()
}
