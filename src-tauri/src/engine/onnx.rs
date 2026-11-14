use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::sync::LazyLock;
use tract_onnx::prelude::*;

use super::blur::js_round;
use super::decode::RgbaImageBuf;

pub const V2_ONNX: bool = true;
pub const V2_PASS2: bool = true;

const FACE_MODEL_BYTES: &[u8] = include_bytes!("../../../public/models/ultraface-320.onnx");
const FACE_MODEL_SHA256: &str = "34CD7E60AEFF28744C657DE7A3DC64E872D506741DE66987F3426F2B79F88017";

const IN_W: usize = 320;
const IN_H: usize = 240;
const SCORE_T: f32 = 0.7;
const NMS_IOU: f64 = 0.5;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FaceBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FaceDetection {
    #[serde(rename = "box")]
    pub bbox: FaceBox,
    pub score: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnnxFaceSummary {
    pub available: bool,
    pub count: usize,
    pub max_score: f64,
    pub max_area: f64,
    pub boxes: Vec<FaceDetection>,
}

type RunnableFaceModel = SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>;

static FACE_MODEL: LazyLock<Option<RunnableFaceModel>> = LazyLock::new(|| {
    if FACE_MODEL_BYTES.len() < 1_000_000 {
        return None;
    }
    let digest = Sha256::digest(FACE_MODEL_BYTES);
    let hex: String = digest.iter().map(|b| format!("{:02X}", b)).collect();
    if hex != FACE_MODEL_SHA256 {
        return None;
    }
    let mut cursor = Cursor::new(FACE_MODEL_BYTES);
    tract_onnx::onnx()
        .model_for_read(&mut cursor)
        .ok()?
        .with_input_fact(0, f32::fact([1, 3, IN_H, IN_W]).into())
        .ok()?
        .into_optimized()
        .ok()?
        .into_runnable()
        .ok()
});

fn get_model() -> Option<&'static RunnableFaceModel> {
    FACE_MODEL.as_ref()
}

fn iou(a: &FaceDetection, b: &FaceDetection) -> f64 {
    let x1 = a.bbox.x.max(b.bbox.x);
    let y1 = a.bbox.y.max(b.bbox.y);
    let x2 = (a.bbox.x + a.bbox.w).min(b.bbox.x + b.bbox.w);
    let y2 = (a.bbox.y + a.bbox.h).min(b.bbox.y + b.bbox.h);
    let inter = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    if inter <= 0.0 {
        return 0.0;
    }
    let ua = a.bbox.w * a.bbox.h + b.bbox.w * b.bbox.h - inter;
    if ua > 0.0 { inter / ua } else { 0.0 }
}

fn nms(mut dets: Vec<FaceDetection>) -> Vec<FaceDetection> {
    dets.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut keep: Vec<FaceDetection> = Vec::new();
    for d in dets {
        if keep.iter().all(|k| iou(k, &d) < NMS_IOU) {
            keep.push(d);
        }
    }
    keep
}

pub fn detect_faces_onnx(img: &RgbaImageBuf) -> Option<OnnxFaceSummary> {
    if !V2_ONNX {
        return None;
    }
    let model = get_model()?;
    let w = img.width as usize;
    let h = img.height as usize;
    if w == 0 || h == 0 {
        return None;
    }

    let plane = IN_W * IN_H;
    let mut chw = vec![0.0f32; 3 * plane];
    let data = &img.data;
    for y in 0..IN_H {
        let sy = ((y as f64 / IN_H as f64) * h as f64).floor().min((h - 1) as f64) as usize;
        let row = sy * w;
        for x in 0..IN_W {
            let sx = ((x as f64 / IN_W as f64) * w as f64).floor().min((w - 1) as f64) as usize;
            let idx = (row + sx) * 4;
            let o = y * IN_W + x;
            chw[o] = (data[idx + 2] as f32 - 127.0) / 128.0; // B
            chw[plane + o] = (data[idx + 1] as f32 - 127.0) / 128.0; // G
            chw[2 * plane + o] = (data[idx] as f32 - 127.0) / 128.0; // R
        }
    }

    let tensor = tract_ndarray::Array4::from_shape_vec((1, 3, IN_H, IN_W), chw)
        .ok()?
        .into_tensor();
    let outputs = model.run(tvec!(tensor.into())).ok()?;
    if outputs.len() < 2 {
        return None;
    }

    let out0 = outputs[0].to_array_view::<f32>().ok()?;
    let out1 = outputs[1].to_array_view::<f32>().ok()?;
    let s0 = out0.as_slice()?;
    let s1 = out1.as_slice()?;
    // UltraFace outputs: scores [1, N, 2] and boxes [1, N, 4]
    let (scores, boxes) = if out0.shape().last() == Some(&2) {
        (s0, s1)
    } else {
        (s1, s0)
    };

    let n = scores.len() / 2;
    let mut raw = Vec::new();
    for i in 0..n {
        let p = scores[i * 2 + 1];
        if p < SCORE_T {
            continue;
        }
        let bx0 = boxes[i * 4].max(0.0) as f64;
        let by0 = boxes[i * 4 + 1].max(0.0) as f64;
        let bx1 = boxes[i * 4 + 2].min(1.0) as f64;
        let by1 = boxes[i * 4 + 3].min(1.0) as f64;
        raw.push(FaceDetection {
            bbox: FaceBox {
                x: bx0,
                y: by0,
                w: (bx1 - bx0).max(0.0),
                h: (by1 - by0).max(0.0),
            },
            score: p as f64,
        });
    }

    let dets = nms(raw);
    let mut max_score = 0.0f64;
    let mut max_area = 0.0f64;
    for d in &dets {
        if d.score > max_score {
            max_score = d.score;
        }
        let a = d.bbox.w * d.bbox.h;
        if a > max_area {
            max_area = a;
        }
    }

    Some(OnnxFaceSummary {
        available: true,
        count: dets.len(),
        max_score: js_round(max_score * 100.0) / 100.0,
        max_area: js_round(max_area * 10000.0) / 10000.0,
        boxes: dets.into_iter().take(10).collect(),
    })
}
