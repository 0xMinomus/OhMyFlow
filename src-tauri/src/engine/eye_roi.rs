use serde::{Deserialize, Serialize};

use super::decode::RgbaImageBuf;
use super::face::heuristic_face_detect;
use super::onnx::FaceBox;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyeRoiResult {
    pub eyes_state: String,
    pub eyes_closed_probability: f64,
    pub box_area: f64,
}

pub fn refine_eyes_with_roi(image: &RgbaImageBuf, bbox: &FaceBox) -> Option<EyeRoiResult> {
    let w = image.width as f64;
    let h = image.height as f64;
    if image.width < 4 || image.height < 4 {
        return None;
    }
    let cx = (bbox.x + bbox.w / 2.0) * w;
    let cy = (bbox.y + bbox.h / 2.0) * h;
    let raw_cw = bbox.w * w * 1.3;
    let raw_ch = bbox.h * h * 1.3;
    let scale = (512.0 / raw_cw.max(raw_ch).max(1.0)).min(2.0);
    let cw = (raw_cw * scale).round().max(8.0) as u32;
    let ch = (raw_ch * scale).round().max(8.0) as u32;
    let sx = (cx - (cw as f64 / scale) / 2.0)
        .round()
        .clamp(0.0, w - 1.0) as u32;
    let sy = (cy - (ch as f64 / scale) / 2.0)
        .round()
        .clamp(0.0, h - 1.0) as u32;
    let sw = ((cw as f64 / scale).round().max(1.0) as u32).min(image.width - sx);
    let sh = ((ch as f64 / scale).round().max(1.0) as u32).min(image.height - sy);

    let sd = &image.data;
    let iw = image.width;
    let ih = image.height;
    let mut out = vec![0u8; (cw * ch * 4) as usize];
    let x_ratio = (sw as f64 - 1.0) / cw.saturating_sub(1).max(1) as f64;
    let y_ratio = (sh as f64 - 1.0) / ch.saturating_sub(1).max(1) as f64;

    for y in 0..ch {
        let gy = sy as f64 + y as f64 * y_ratio;
        let y0 = (gy.floor() as u32).min(ih - 1);
        let y1 = (y0 + 1).min(ih - 1);
        let fy = gy - y0 as f64;
        let iy = 1.0 - fy;
        for x in 0..cw {
            let gx = sx as f64 + x as f64 * x_ratio;
            let x0 = (gx.floor() as u32).min(iw - 1);
            let x1 = (x0 + 1).min(iw - 1);
            let fx = gx - x0 as f64;
            let ix = 1.0 - fx;
            let w00 = ix * iy;
            let w10 = fx * iy;
            let w01 = ix * fy;
            let w11 = fx * fy;
            let i00 = ((y0 * iw + x0) * 4) as usize;
            let i10 = ((y0 * iw + x1) * 4) as usize;
            let i01 = ((y1 * iw + x0) * 4) as usize;
            let i11 = ((y1 * iw + x1) * 4) as usize;
            let o = ((y * cw + x) * 4) as usize;
            for c in 0..3 {
                let v = sd[i00 + c] as f64 * w00
                    + sd[i10 + c] as f64 * w10
                    + sd[i01 + c] as f64 * w01
                    + sd[i11 + c] as f64 * w11;
                out[o + c] = v.round().clamp(0.0, 255.0) as u8;
            }
            out[o + 3] = 255;
        }
    }

    let crop = RgbaImageBuf {
        data: out,
        width: cw,
        height: ch,
    };
    let r = heuristic_face_detect(&crop, None);
    if r.eyes_state == "no-face" {
        return None;
    }
    Some(EyeRoiResult {
        eyes_state: r.eyes_state,
        eyes_closed_probability: r.eyes_closed_probability,
        box_area: bbox.w * bbox.h,
    })
}
