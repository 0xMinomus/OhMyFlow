import type { Sensitivity } from '@/types'
import { setOnnxBaseUrl } from '../ml/face-onnx'
import { analyzeSinglePhoto, type AnalyzedPhotoOutput } from './analyze-photo'

export interface WorkerRequest {
  id: number
  src: string
  mode: Sensitivity
  analysisSize: number
  baseUrl: string
}

export interface WorkerResponse {
  id: number
  ok: boolean
  result: AnalyzedPhotoOutput | null
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const { id, src, mode, analysisSize, baseUrl } = ev.data
  try {
    if (baseUrl) setOnnxBaseUrl(baseUrl)
    const result = await analyzeSinglePhoto(src, mode, analysisSize)
    const msg: WorkerResponse = { id, ok: true, result }
    self.postMessage(msg)
  } catch {
    const msg: WorkerResponse = { id, ok: false, result: null }
    self.postMessage(msg)
  }
}
