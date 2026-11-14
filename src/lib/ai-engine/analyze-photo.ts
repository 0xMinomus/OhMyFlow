import type { OnnxFaceSummaryLike, Pass2EyeResult, Sensitivity } from '@/types'
import { analyzeImageData, decodeOnce, downsampleImageData, V2_HIEYE, type PipelineFeatures } from './pipeline'
import { detectFacesONNX, V2_ONNX, V2_PASS2 } from '../ml/face-onnx'
import { refineEyesWithROI } from '../ml/eye-roi'

export interface AnalyzedPhotoOutput {
  feat: PipelineFeatures
  onnxFace: OnnxFaceSummaryLike | null
  onnxDominantUnknown: boolean
  pass2: Pass2EyeResult | null
  hiFace: PipelineFeatures['face'] | null
}

/**
 * Analisis satu foto di browser/Web Worker dengan single-pass decode reuse:
 * decode base (512px di High) 1x, lalu jika wajah unknown perlu pass-2,
 * decode 768px 1x saja dan reuse untuk ONNX, Pass-2 ROI, dan Hi-Eye.
 */
export async function analyzeSinglePhoto(
  src: string,
  mode: Sensitivity,
  analysisSize: number,
  analyzeOverride?: (src: string, size: number) => Promise<PipelineFeatures | null>,
): Promise<AnalyzedPhotoOutput | null> {
  if (analyzeOverride) {
    const feat = await analyzeOverride(src, analysisSize)
    if (!feat) return null
    let onnxFace: OnnxFaceSummaryLike | null = null
    let onnxDominantUnknown = false
    let pass2: Pass2EyeResult | null = null
    let hiFace: PipelineFeatures['face'] | null = null

    if (mode === 'high' && feat.face.hasFace && feat.face.eyesState === 'unknown') {
      if (V2_ONNX) {
        try {
          const img = await decodeOnce(src, 320)
          const sum = img ? await detectFacesONNX(img) : null
          onnxFace = sum
          if (sum && sum.available && sum.maxArea > 0.12) onnxDominantUnknown = true
        } catch {
          onnxFace = null
        }
      }
      if (V2_PASS2 && onnxFace) {
        try {
          const cands = onnxFace.boxes
            .filter((b) => b.score >= 0.7 && (b.box.w * b.box.h) < 0.12)
            .sort((a, b) => b.score - a.score)
          if (cands.length) {
            const img640 = await decodeOnce(src, 640)
            pass2 = img640 ? await refineEyesWithROI(img640, cands[0].box) : null
          }
        } catch {
          pass2 = null
        }
      }
      if (V2_HIEYE) {
        try {
          const hi = await analyzeOverride(src, 768)
          if (hi?.face?.hasFace) hiFace = hi.face
        } catch {
          hiFace = null
        }
      }
    }
    return { feat, onnxFace, onnxDominantUnknown, pass2, hiFace }
  }

  const imgBase = await decodeOnce(src, analysisSize)
  if (!imgBase) return null
  const feat = analyzeImageData(imgBase)
  if (!feat) return null

  let onnxFace: OnnxFaceSummaryLike | null = null
  let onnxDominantUnknown = false
  let pass2: Pass2EyeResult | null = null
  let hiFace: PipelineFeatures['face'] | null = null

  if (mode === 'high' && feat.face.hasFace && feat.face.eyesState === 'unknown') {
    const needHi = V2_PASS2 || V2_HIEYE
    const img768 = needHi ? await decodeOnce(src, 768) : null

    if (V2_ONNX) {
      try {
        // UltraFaceDetector sudah resample langsung ke 320x240 dari imgBase tanpa decode kedua
        const sum = await detectFacesONNX(imgBase)
        onnxFace = sum
        if (sum && sum.available && sum.maxArea > 0.12) onnxDominantUnknown = true
      } catch {
        onnxFace = null
      }
    }

    if (V2_PASS2 && onnxFace) {
      try {
        const cands = onnxFace.boxes
          .filter((b) => b.score >= 0.7 && (b.box.w * b.box.h) < 0.12)
          .sort((a, b) => b.score - a.score)
        if (cands.length) {
          const roiSrc = img768 ? downsampleImageData(img768, 640) : imgBase
          pass2 = await refineEyesWithROI(roiSrc, cands[0].box)
        }
      } catch {
        pass2 = null
      }
    }

    if (V2_HIEYE && img768) {
      try {
        const hi = analyzeImageData(img768)
        if (hi?.face?.hasFace) hiFace = hi.face
      } catch {
        hiFace = null
      }
    }
  }

  return { feat, onnxFace, onnxDominantUnknown, pass2, hiFace }
}
