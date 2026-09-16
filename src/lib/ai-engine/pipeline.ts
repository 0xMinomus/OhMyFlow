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

export function decodeOnce(dataUrl: string, maxSide = 384): Promise<ImageData | null> {
  // Guard: input tidak valid (mis. thumbnail gagal dibuat) → null, JANGAN throw.
  // Sebelumnya dataUrl undefined bikin TypeError di sini yang merembet mematikan seluruh culling.
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
  if (decodeCache.size > 60) {
    const first = decodeCache.keys().next().value
    if (first) decodeCache.delete(first)
  }
  const p = new Promise<ImageData | null>((resolve) => {
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
      // bebaskan referensi img agar GC cepat
      ;(img as any).src = ''
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
  decodeCache.set(key, p)
  // hapus dari cache setelah dipakai + 30s agar tidak menumpuk (AI hanya butuh sekali)
  p.then(() => setTimeout(() => decodeCache.delete(key), 30000))
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
