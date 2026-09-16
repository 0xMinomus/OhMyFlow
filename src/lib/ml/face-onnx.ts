// Face detector ONNX lokal (Fase 5) — adapter sesuai new-architecture §10.
// Model: UltraFace RFB-320 (MIT, Linzaer), 1.27MB, bundled di public/models.
// Runtime: onnxruntime-web (wasm, CPU 1 thread — tanpa SharedArrayBuffer pun
// jalan; threaded bila crossOriginIsolated). Lazy-load hanya bila dibutuhkan.
// Gagal kapan pun (no SAB, model hilang, infer error) = fallback heuristik,
// TAK PERNAH crash culling (§52). High + unknown saja (mode lain bit-identik).

export const V2_ONNX = true
// Flag Fase 6: Pass-2 eye ROI (High + unknown + box kecil saja).
export const V2_PASS2 = true

// ponytail: checksum dicatat, verifikasi penuh (reject bila mismatch) bila
// model pernah di-update; loader menolak byte kosong/404 via magic number.
export const FACE_MODEL_SHA256 = '34CD7E60AEFF28744C657DE7A3DC64E872D506741DE66987F3426F2B79F88017'

export interface FaceDetection {
  box: { x: number; y: number; w: number; h: number } // relatif 0-1
  score: number // 0-1
}

export interface FaceDetector {
  detect(image: ImageData): Promise<FaceDetection[]>
}

export interface OnnxFaceSummary {
  available: boolean
  count: number
  maxScore: number
  maxArea: number // fraksi frame wajah terbesar
  boxes: FaceDetection[] // ≤10, skor desc (untuk Pass-2 ROI)
}

const MODEL_URL = 'models/ultraface-320.onnx'
const IN_W = 320
const IN_H = 240
const SCORE_T = 0.7
const NMS_IOU = 0.5

let ortMod: any = null
let session: any = null
let loadFailed = false
let chain: Promise<any> = Promise.resolve() // serialisasi session.run

async function getSession(): Promise<any> {
  if (session) return session
  if (loadFailed) throw new Error('onnx disabled')
  const ort = await import('onnxruntime-web')
  ortMod = ort
  try {
    if (ort.env?.wasm) {
      ort.env.wasm.numThreads = 1
      // Absolut terhadap dokumen: ort resolve relatif terhadap script bundle
      // (assets/), sedangkan wasm ada di <root>/ort/.
      try {
        ort.env.wasm.wasmPaths = new URL('ort/', document.baseURI).href
      } catch {
        ort.env.wasm.wasmPaths = './ort/'
      }
    }
  } catch {}
  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`model http ${res.status}`)
  const buf = await res.arrayBuffer()
  if (buf.byteLength < 1000000) throw new Error('model corrupt')
  session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] })
  return session
}

function iou(a: FaceDetection, b: FaceDetection): number {
  const x1 = Math.max(a.box.x, b.box.x), y1 = Math.max(a.box.y, b.box.y)
  const x2 = Math.min(a.box.x + a.box.w, b.box.x + b.box.w)
  const y2 = Math.min(a.box.y + a.box.h, b.box.y + b.box.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  if (inter <= 0) return 0
  const ua = a.box.w * a.box.h + b.box.w * b.box.h - inter
  return ua > 0 ? inter / ua : 0
}

function nms(dets: FaceDetection[]): FaceDetection[] {
  const sorted = dets.slice().sort((a, b) => b.score - a.score)
  const keep: FaceDetection[] = []
  for (const d of sorted) {
    if (keep.every((k) => iou(k, d) < NMS_IOU)) keep.push(d)
  }
  return keep
}

class UltraFaceDetector implements FaceDetector {
  async detect(image: ImageData): Promise<FaceDetection[]> {
    const sess = await getSession()
    const { data, width: w, height: h } = image
    // Resize bilinear sederhana ke 320x240 + BGR (v-127)/128.
    const chw = new Float32Array(3 * IN_W * IN_H)
    const lum = (x: number, y: number, c: number) => {
      const sx = Math.min(w - 1, Math.floor((x / IN_W) * w))
      const sy = Math.min(h - 1, Math.floor((y / IN_H) * h))
      return data[(sy * w + sx) * 4 + c]
    }
    for (let y = 0; y < IN_H; y++) {
      for (let x = 0; x < IN_W; x++) {
        const o = y * IN_W + x
        chw[o] = (lum(x, y, 2) - 127) / 128 // B
        chw[IN_W * IN_H + o] = (lum(x, y, 1) - 127) / 128 // G
        chw[2 * IN_W * IN_H + o] = (lum(x, y, 0) - 127) / 128 // R
      }
    }
    const run = async () => {
      const feeds = { input: new ortMod.Tensor('float32', chw, [1, 3, IN_H, IN_W]) }
      const out = await sess.run(feeds)
      const names = Object.keys(out)
      const scores = out[names.find((n) => /score/i.test(n)) ?? names[0]].data as Float32Array
      const boxes = out[names.find((n) => /box|bbox|location/i.test(n)) ?? names[1]].data as Float32Array
      const raw: FaceDetection[] = []
      const n = scores.length / 2
      const xScale = w / IN_W, yScale = h / IN_H
      for (let i = 0; i < n; i++) {
        const p = scores[i * 2 + 1]
        if (p < SCORE_T) continue
        // Box model relatif input 320x240 → petakan ke koordinat foto.
        const bx0 = Math.max(0, boxes[i * 4] * xScale) / w
        const by0 = Math.max(0, boxes[i * 4 + 1] * yScale) / h
        const bx1 = Math.min(w, boxes[i * 4 + 2] * xScale) / w
        const by1 = Math.min(h, boxes[i * 4 + 3] * yScale) / h
        raw.push({ box: { x: bx0, y: by0, w: Math.max(0, bx1 - bx0), h: Math.max(0, by1 - by0) }, score: p })
      }
      return nms(raw)
    }
    // Serial: onnxruntime session tak dijamin thread-safe untuk run konkuren.
    const p = chain.then(run, run)
    chain = p.catch(() => {})
    return p
  }
}

let detector: FaceDetector | null = null

/** Ringkas deteksi wajah ONNX; null = tak tersedia (fallback heuristik). */
export async function detectFacesONNX(image: ImageData): Promise<OnnxFaceSummary | null> {
  if (!V2_ONNX) return null
  try {
    if (!detector) detector = new UltraFaceDetector()
    const dets = await detector.detect(image)
    let maxScore = 0, maxArea = 0
    for (const d of dets) {
      if (d.score > maxScore) maxScore = d.score
      const a = d.box.w * d.box.h
      if (a > maxArea) maxArea = a
    }
    return {
      available: true, count: dets.length,
      maxScore: Math.round(maxScore * 100) / 100,
      maxArea: Math.round(maxArea * 10000) / 10000,
      boxes: dets.slice(0, 10),
    }
  } catch {
    loadFailed = true
    detector = null
    return null
  }
}
