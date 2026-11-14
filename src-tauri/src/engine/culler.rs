use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Instant;

use super::blur::js_round;
use super::decode::{decode_oriented_dynamic, downsample_rgba, load_image_bytes, resize_dynamic_to_rgba};
use super::duplicate::{group_duplicates, hamming_distance_limited};
use super::eye_roi::{refine_eyes_with_roi, EyeRoiResult};
use super::onnx::{detect_faces_onnx, OnnxFaceSummary, V2_ONNX, V2_PASS2};
use super::pipeline::{analyze_rgba, V2_BURST_RANK, V2_HIEYE, V2_SUBJECT};
use super::reasons::codes_for;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sensitivity {
    Fast,
    Balanced,
    High,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoItem {
    pub id: String,
    pub file_name: String,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paired_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_path: Option<String>,
    pub is_paired: bool,
    pub is_raw: bool,
    pub ext: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtime_ms: Option<u64>,
    pub base_name: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasons: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasons_en: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sharpness: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exposure: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eyes_closed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_duplicate: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duplicate_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aesthetic: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub composition: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub dhash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_codes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subj_focus: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub onnx_face: Option<OnnxFaceSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub onnx_dominant_unknown: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pass2: Option<EyeRoiResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pupil_hits: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obj_mode: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub white_bg: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_face: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub face_confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clipped_hi: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clipped_lo: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub center_hi: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mean_lum: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hi_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_hi: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lo_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_edge: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comp_confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edge: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grad_p50: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grad_p99: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accidental: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eyes_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eyes_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eyes_open_protect: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skin_ratio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blur_floor: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blur_reject: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub v2cap: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_rank: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_size: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub margin_to_best: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub softest_in_burst: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redundant_diverse: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redundant_in_burst: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CullStats {
    pub total: usize,
    pub picks: usize,
    pub maybe: usize,
    pub rejects: usize,
    pub duration_ms: f64,
    pub throughput_per_min: u64,
    pub feat_null: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CullOutput {
    pub photos: Vec<PhotoItem>,
    pub stats: CullStats,
    pub cancelled: bool,
}

struct ModePreset {
    analysis_size: u32,
    sharp_weight: f64,
    face_weight: f64,
    aesthetic_weight: f64,
    comp_weight: f64,
    duplicate_threshold: usize,
    dup_penalty: i32,
    picks_at: i32,
    reject_below: i32,
    hard_blur_below: i32,
    picks_focus_min: i32,
    blown_reject_at: f64,
    conf_reject_floor: f64,
    dark_reject_at: i32,
    eye_threshold: f64,
    exposure_hard_reject: bool,
    composition_hard_reject: bool,
}

fn preset_for(mode: Sensitivity) -> ModePreset {
    match mode {
        Sensitivity::Fast => ModePreset {
            analysis_size: 256,
            sharp_weight: 0.37,
            face_weight: 0.27,
            aesthetic_weight: 0.26,
            comp_weight: 0.10,
            duplicate_threshold: 9,
            dup_penalty: 8,
            picks_at: 75,
            reject_below: 40,
            hard_blur_below: 45,
            picks_focus_min: 60,
            blown_reject_at: 18.0,
            conf_reject_floor: 0.45,
            dark_reject_at: 0,
            eye_threshold: 0.70,
            exposure_hard_reject: false,
            composition_hard_reject: false,
        },
        Sensitivity::Balanced => ModePreset {
            analysis_size: 384,
            sharp_weight: 0.34,
            face_weight: 0.26,
            aesthetic_weight: 0.25,
            comp_weight: 0.15,
            duplicate_threshold: 7,
            dup_penalty: 10,
            picks_at: 70,
            reject_below: 45,
            hard_blur_below: 55,
            picks_focus_min: 60,
            blown_reject_at: 14.0,
            conf_reject_floor: 0.32,
            dark_reject_at: 0,
            eye_threshold: 0.60,
            exposure_hard_reject: true,
            composition_hard_reject: false,
        },
        Sensitivity::High => ModePreset {
            analysis_size: 512,
            sharp_weight: 0.32,
            face_weight: 0.24,
            aesthetic_weight: 0.24,
            comp_weight: 0.20,
            duplicate_threshold: 5,
            dup_penalty: 14,
            picks_at: 72,
            reject_below: 48,
            hard_blur_below: 60,
            picks_focus_min: 60,
            blown_reject_at: 12.0,
            conf_reject_floor: 0.28,
            dark_reject_at: 15,
            eye_threshold: 0.50,
            exposure_hard_reject: true,
            composition_hard_reject: true,
        },
    }
}

fn score_one(
    item: &mut PhotoItem,
    mode: Sensitivity,
    preset: &ModePreset,
) -> bool {
    let src_path = item.preview_path.as_deref().unwrap_or(&item.file_path);
    let raw_bytes = load_image_bytes(Path::new(src_path));
    if item.is_raw && raw_bytes.is_none() {
        item.sharpness = Some(55);
        item.aesthetic = Some(55);
        item.exposure = Some(55);
        item.score = Some(52);
        item.confidence = Some(0.4);
        item.reasons = Some(vec!["RAW — pratinjau tidak tersedia, perlu cek manual".into()]);
        item.reasons_en = Some(vec!["RAW — no preview, needs manual check".into()]);
        item.dhash = Some("0".repeat(64));
        return true;
    }

    let dyn_img = raw_bytes.as_deref().and_then(decode_oriented_dynamic);
    let feat_opt = dyn_img
        .as_ref()
        .and_then(|d| resize_dynamic_to_rgba(d, preset.analysis_size))
        .and_then(|rgba| analyze_rgba(&rgba).map(|f| (rgba, f)));

    let Some((img_base, mut feat)) = feat_opt else {
        item.sharpness = Some(40);
        item.aesthetic = Some(45);
        item.score = Some(42);
        item.confidence = Some(0.3);
        item.reasons = Some(vec!["Gagal dianalisis — masuk Maybe agar tidak hilang".into()]);
        item.reasons_en = Some(vec!["Analysis failed — kept in Maybe to be safe".into()]);
        item.dhash = Some("0".repeat(64));
        return false;
    };

    item.dhash = Some(feat.dhash.clone());
    let v2s = V2_SUBJECT && mode == Sensitivity::High;
    let subj_focus = if v2s { feat.subject.focus } else { None };
    item.subj_focus = subj_focus;
    item.motion = Some(if v2s { feat.motion.motion_likelihood } else { 0.0 });

    if mode == Sensitivity::High && feat.face.has_face && feat.face.eyes_state == "unknown" {
        let img768 = if V2_PASS2 || V2_HIEYE {
            dyn_img.as_ref().and_then(|d| resize_dynamic_to_rgba(d, 768))
        } else {
            None
        };

        if V2_ONNX {
            if let Some(sum) = detect_faces_onnx(&img_base) {
                if sum.available && sum.max_area > 0.12 {
                    item.onnx_dominant_unknown = Some(true);
                }
                item.onnx_face = Some(sum);
            }
        }

        if V2_PASS2 {
            if let Some(sum) = item.onnx_face.as_ref() {
                let mut cands: Vec<_> = sum
                    .boxes
                    .iter()
                    .filter(|b| b.score >= 0.7 && (b.bbox.w * b.bbox.h) < 0.12)
                    .collect();
                cands.sort_by(|a, b| b.score.total_cmp(&a.score));
                if let Some(best_box) = cands.first() {
                    let roi_src = img768
                        .as_ref()
                        .map(|i7| downsample_rgba(i7, 640))
                        .unwrap_or_else(|| img_base.clone());
                    if let Some(roi) = refine_eyes_with_roi(&roi_src, &best_box.bbox) {
                        if roi.eyes_state == "open" && roi.eyes_closed_probability <= 0.2 {
                            feat.face.eyes_state = "open".into();
                            feat.face.eyes_closed_probability = roi.eyes_closed_probability;
                        } else if roi.eyes_state == "closed" && roi.eyes_closed_probability > 0.6 {
                            feat.face.eyes_state = "closed".into();
                            feat.face.eyes_closed_probability = roi.eyes_closed_probability;
                        }
                        item.pass2 = Some(roi);
                    }
                }
            }
        }

        if V2_HIEYE {
            if let Some(i7) = img768.as_ref() {
                if let Some(hi) = analyze_rgba(i7) {
                    if hi.face.has_face {
                        feat.face.pupil_hits = hi.face.pupil_hits;
                        if hi.face.eyes_state == "open" && hi.face.eyes_closed_probability <= 0.2 {
                            feat.face.eyes_state = "open".into();
                            feat.face.eyes_closed_probability = hi.face.eyes_closed_probability;
                        } else if hi.face.eyes_state == "closed" && hi.face.eyes_closed_probability > 0.6 {
                            feat.face.eyes_state = "closed".into();
                            feat.face.eyes_closed_probability = hi.face.eyes_closed_probability;
                        }
                    }
                }
            }
        }
    }

    item.pupil_hits = Some(feat.face.pupil_hits);
    let eyes_closed = feat.face.has_face
        && feat.face.eyes_state == "closed"
        && feat.face.eyes_closed_probability >= preset.eye_threshold;

    let focus = feat.sharpness.focus;
    let center_hi = feat.aesthetic.clipped_hi_center_pct;
    let mean_lum = feat.aesthetic.mean_lum;
    let white_bg = feat.aesthetic.white_background;
    let smooth_object = !feat.face.has_face
        && feat.sharpness.grad_p50 < 2
        && feat.sharpness.grad_p99 > 18
        && mean_lum >= 120;

    item.white_bg = Some(white_bg);
    item.obj_mode = Some(smooth_object);
    item.has_face = Some(feat.face.has_face);

    let eyes_clearly_open = feat.face.has_face
        && feat.face.eyes_state == "open"
        && feat.face.eyes_closed_probability <= 0.15
        && feat.face.skin_ratio <= 0.5
        && focus >= 50;

    item.sharpness = Some(focus);
    item.aesthetic = Some(feat.aesthetic.score);
    item.exposure = Some(feat.aesthetic.exposure);
    item.composition = Some(feat.composition.score);
    item.eyes_closed = Some(eyes_closed);
    item.face_confidence = Some(feat.face.face_confidence);
    item.clipped_hi = Some(feat.aesthetic.clipped_hi_pct);
    item.clipped_lo = Some(feat.aesthetic.clipped_lo_pct);
    item.center_hi = Some(center_hi);
    item.mean_lum = Some(mean_lum);
    item.hi_pct = Some(feat.aesthetic.clipped_hi_pct);
    item.border_hi = Some(feat.aesthetic.clipped_hi_border_pct);
    item.lo_pct = Some(feat.aesthetic.clipped_lo_pct);
    item.max_edge = Some(feat.composition.max_edge);
    item.comp_confidence = Some(feat.composition.confidence);
    item.subject = Some(feat.sharpness.subject);
    item.edge = Some(feat.sharpness.edge);
    item.grad_p50 = Some(feat.sharpness.grad_p50);
    item.grad_p99 = Some(feat.sharpness.grad_p99);
    item.color = Some(feat.aesthetic.colorfulness);
    item.accidental = Some(feat.sharpness.accidental);
    item.eyes_state = Some(feat.face.eyes_state.clone());
    item.eyes_p = Some(feat.face.eyes_closed_probability);
    item.eyes_open_protect = Some(eyes_clearly_open);
    item.skin_ratio = Some(feat.face.skin_ratio);
    item.is_duplicate = Some(false);

    let mut reasons = Vec::new();
    let mut reasons_en = Vec::new();
    let blur_proven = feat.sharpness.confidence > 0.5 || feat.sharpness.edge < 45;
    let blur_doubt = feat.face.has_face && feat.face.eyes_state == "unknown";
    let blur_floor = preset.hard_blur_below - if blur_doubt { 4 } else { 0 };
    item.blur_floor = Some(blur_floor);
    let blur_will_reject = focus < blur_floor && !smooth_object && !eyes_clearly_open;
    if blur_will_reject {
        reasons.push("Blur / tidak fokus".to_string());
        reasons_en.push("Blurry / out of focus".to_string());
    } else if !smooth_object
        && blur_proven
        && !feat.sharpness.is_flat
        && focus < 65
        && (mode != Sensitivity::High
            || focus < preset.picks_focus_min
            || subj_focus.is_some_and(|sf| sf < 62))
    {
        reasons.push("Agak blur".to_string());
        reasons_en.push("Slightly soft".to_string());
    }
    if feat.sharpness.accidental {
        reasons.push("Frame kosong (hitam/putih total)".to_string());
        reasons_en.push("Blank frame (fully black/white)".to_string());
    }
    let dark_ruined = preset.dark_reject_at > 0
        && !white_bg
        && feat.aesthetic.exposure <= preset.dark_reject_at
        && mean_lum < 35
        && feat.aesthetic.clipped_hi_pct < 5.0;
    if dark_ruined {
        reasons.push("Terlalu gelap (exposure hancur)".to_string());
        reasons_en.push("Too dark (exposure ruined)".to_string());
    }
    if eyes_closed {
        reasons.push("Mata tertutup".to_string());
        reasons_en.push("Eyes closed".to_string());
    }
    if feat.tilt.tilted {
        reasons.push("Horizon miring".to_string());
        reasons_en.push("Tilted horizon".to_string());
    }
    if v2s && feat.motion.motion_likelihood > 0.6 {
        reasons.push("Gerak / motion blur?".to_string());
        reasons_en.push("Motion blur?".to_string());
    }
    if item.onnx_dominant_unknown == Some(true) {
        reasons.push("Wajah besar tak terbaca".to_string());
        reasons_en.push("Large face unreadable".to_string());
    }
    for (i, r) in feat.aesthetic.reasons.iter().enumerate() {
        if smooth_object && r == "Warna pucat" {
            continue;
        }
        reasons.push(r.clone());
        if let Some(re) = feat.aesthetic.reasons_en.get(i) {
            reasons_en.push(re.clone());
        }
    }
    if !feat.composition.reasons.is_empty() && feat.composition.confidence > 0.45 {
        reasons.extend(feat.composition.reasons.iter().cloned());
        reasons_en.extend(feat.composition.reasons_en.iter().cloned());
    }
    if focus > 75
        && feat.aesthetic.score > 72
        && !eyes_closed
        && feat.aesthetic.clipped_hi_pct < 4.0
        && feat.composition.score > 55
    {
        reasons.push("Tajam & eksposur bagus".to_string());
        reasons_en.push("Sharp & well exposed".to_string());
    }
    reasons.truncate(4);
    reasons_en.truncate(4);
    item.reasons = Some(reasons.clone());
    item.reasons_en = Some(reasons_en.clone());

    let mut face_score = 72.0;
    if feat.face.has_face {
        let base_fs = if eyes_closed {
            12.0
        } else if feat.face.eyes_state == "unknown" {
            if v2s { 72.0 } else { 78.0 }
        } else {
            88.0
        };
        let fc = feat.face.face_confidence;
        face_score = js_round(base_fs * (0.45 + 0.55 * fc) + 72.0 * (0.55 - 0.55 * fc));
        if feat.face.face_count > 1 && !eyes_closed {
            face_score = (face_score + 4.0).min(96.0);
        }
    }
    if focus < 60 {
        face_score = js_round(face_score * (0.55 + 0.45 * (focus as f64 / 60.0)));
    }

    let sh_w = preset.sharp_weight * (0.6 + 0.4 * feat.sharpness.confidence);
    let ae_w = preset.aesthetic_weight * (0.7 + 0.3 * feat.aesthetic.confidence);
    let f_w = preset.face_weight;
    let co_w = preset.comp_weight * (0.5 + 0.5 * feat.composition.confidence);
    let w_sum = (sh_w + ae_w + f_w + co_w).max(1e-9);
    let mut score = if smooth_object {
        js_round(feat.aesthetic.score as f64 * 0.6 + feat.composition.score as f64 * 0.4) as i32
    } else {
        js_round(
            (focus as f64 * sh_w
                + feat.aesthetic.score as f64 * ae_w
                + face_score * f_w
                + feat.composition.score as f64 * co_w)
                / w_sum,
        ) as i32
    };

    if !white_bg && feat.aesthetic.clipped_hi_pct > 9.0 {
        score -= (js_round((feat.aesthetic.clipped_hi_pct - 9.0) * 1.2) as i32).min(18);
    }
    if feat.aesthetic.clipped_lo_pct > 45.0 && feat.aesthetic.clipped_hi_pct > 4.0 && mean_lum < 95 {
        score -= 10;
        let mut r = item.reasons.take().unwrap_or_default();
        let mut re = item.reasons_en.take().unwrap_or_default();
        r.push("Kontras kasar (gelap + silau)".to_string());
        re.push("Harsh contrast (dark + glare)".to_string());
        r.truncate(4);
        re.truncate(4);
        item.reasons = Some(r);
        item.reasons_en = Some(re);
    }
    if feat.sharpness.is_flat || feat.aesthetic.is_flat {
        score = score.min(62);
    }
    if feat.tilt.tilted {
        score -= 6;
    }

    item.score = Some(score.clamp(0, 99));
    let mut v2cap = String::new();
    if v2s && item.onnx_dominant_unknown == Some(true) {
        v2cap = "maybe".to_string();
    }
    if v2s && feat.face.has_face && subj_focus.is_some_and(|sf| sf < 55) && !smooth_object {
        v2cap = "maybe".to_string();
    }
    if v2s
        && feat.face.has_face
        && subj_focus.is_some_and(|sf| sf < 35)
        && feat.face.face_confidence > 0.6
        && !smooth_object
    {
        v2cap = "reject".to_string();
    }
    item.v2cap = Some(v2cap);

    let face_conf_for_ui = if feat.face.has_face {
        feat.face.face_confidence
    } else {
        0.7
    };
    let conf = (feat.sharpness.confidence + feat.aesthetic.confidence + face_conf_for_ui) / 3.0;
    item.confidence = Some(js_round(conf * 100.0) / 100.0);
    true
}

pub fn cull_photos<F>(
    items: Vec<PhotoItem>,
    mode: Sensitivity,
    cancel: &AtomicBool,
    on_progress: F,
) -> CullOutput
where
    F: Fn(usize, usize) + Sync + Send,
{
    let t0 = Instant::now();
    let total = items.len();
    let preset = preset_for(mode);
    let mut results = items;
    let done_count = AtomicUsize::new(0);
    let feat_null_count = AtomicUsize::new(0);

    results.par_iter_mut().for_each(|item| {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let ok = score_one(item, mode, &preset);
        if !ok {
            feat_null_count.fetch_add(1, Ordering::Relaxed);
        }
        let d = done_count.fetch_add(1, Ordering::Relaxed) + 1;
        if d % 4 == 0 || d == total {
            on_progress(d, total);
        }
    });

    if cancel.load(Ordering::Relaxed) {
        let dt = t0.elapsed().as_secs_f64() * 1000.0;
        return CullOutput {
            photos: results,
            stats: CullStats {
                total,
                picks: 0,
                maybe: 0,
                rejects: 0,
                duration_ms: dt,
                throughput_per_min: 0,
                feat_null: feat_null_count.load(Ordering::Relaxed),
            },
            cancelled: true,
        };
    }

    let hashes: Vec<(String, String)> = results
        .iter()
        .map(|r| {
            (
                r.id.clone(),
                r.dhash.clone().unwrap_or_else(|| "0".repeat(64)),
            )
        })
        .collect();
    let groups = group_duplicates(&hashes, preset.duplicate_threshold);
    let mut idx_by_id: HashMap<String, usize> = HashMap::with_capacity(results.len());
    for (idx, r) in results.iter().enumerate() {
        idx_by_id.insert(r.id.clone(), idx);
    }

    let v2rank = V2_BURST_RANK && mode == Sensitivity::High;
    for (_key, ids) in groups {
        let mut group_indices: Vec<usize> = ids
            .iter()
            .filter_map(|id| idx_by_id.get(id).copied())
            .collect();
        if group_indices.is_empty() {
            continue;
        }
        group_indices.sort_by(|&a, &b| {
            results[b]
                .score
                .unwrap_or(0)
                .cmp(&results[a].score.unwrap_or(0))
        });

        let max_focus = group_indices
            .iter()
            .map(|&i| results[i].sharpness.unwrap_or(0))
            .max()
            .unwrap_or(0);
        let best_idx = group_indices[0];
        let best_id = results[best_idx].id.clone();
        let best_score = results[best_idx].score.unwrap_or(0);
        let best_dhash = results[best_idx].dhash.clone().unwrap_or_default();
        let best_sharp = results[best_idx].sharpness.unwrap_or(0);
        let best_expo = results[best_idx].exposure.unwrap_or(0);
        let csize = group_indices.len();

        results[best_idx].cluster_rank = Some(0);
        results[best_idx].cluster_size = Some(csize);

        for (k, &gi) in group_indices.iter().enumerate().skip(1) {
            let g = &mut results[gi];
            g.is_duplicate = Some(true);
            g.duplicate_group = Some(best_id.clone());
            let mut r = g.reasons.take().unwrap_or_default();
            let mut re = g.reasons_en.take().unwrap_or_default();
            r.push("Duplikat / burst".into());
            re.push("Duplicate / burst".into());
            let new_score = (g.score.unwrap_or(50) - preset.dup_penalty).max(0);
            g.score = Some(new_score);
            g.cluster_rank = Some(k);
            g.cluster_size = Some(csize);
            g.margin_to_best = Some(best_score - new_score);

            if mode == Sensitivity::High {
                let f = g.sharpness.unwrap_or(100);
                if max_focus - f >= 7 && f < 82 {
                    g.softest_in_burst = Some(true);
                    r.retain(|x| x != "Tajam & eksposur bagus");
                    re.retain(|x| x != "Sharp & well exposed");
                    r.push("Terlunak di burst-nya".into());
                    re.push("Softest in its burst".into());
                }
                if v2rank && g.softest_in_burst != Some(true) {
                    let h_dist = hamming_distance_limited(&best_dhash, g.dhash.as_deref().unwrap_or(""), 64);
                    let focus_diff = (best_sharp - g.sharpness.unwrap_or(0)).abs();
                    let expo_diff = (best_expo - g.exposure.unwrap_or(0)).abs();
                    let diverse = h_dist >= 3 || focus_diff >= 10 || expo_diff >= 15;
                    g.redundant_diverse = Some(diverse);
                    let margin = g.margin_to_best.unwrap_or(0);
                    if !diverse && margin >= 12 {
                        g.redundant_in_burst = Some(true);
                        r.retain(|x| x != "Tajam & eksposur bagus");
                        re.retain(|x| x != "Sharp & well exposed");
                        r.push("Frame serupa — versi lain lebih baik".into());
                        re.push("Similar frame — another version is better".into());
                    }
                }
            }
            g.reasons = Some(r);
            g.reasons_en = Some(re);
        }
    }

    let v2s_cap = V2_SUBJECT && mode == Sensitivity::High;
    let mut picks = 0usize;
    let mut maybe = 0usize;
    let mut rejects = 0usize;

    for item in &mut results {
        let s = item.score.unwrap_or(50);
        let clipped_hi = item.clipped_hi.unwrap_or(0.0);
        let clipped_lo = item.clipped_lo.unwrap_or(0.0);
        let center_hi = item.center_hi.unwrap_or(0.0);
        let comp = item.composition.unwrap_or(55);
        let conf = item.confidence.unwrap_or(1.0);
        let focus = item.sharpness.unwrap_or(100);
        let white_bg = item.white_bg == Some(true);
        let smooth_object = item.obj_mode == Some(true);
        let blown_extreme = !white_bg && (clipped_hi > 25.0 || center_hi > 18.0);
        let blown_mid = !white_bg && (clipped_hi > preset.blown_reject_at || center_hi > 12.0);
        let blur_floor = item.blur_floor.unwrap_or(preset.hard_blur_below);

        let mut cat = if item.eyes_closed == Some(true) {
            "rejects"
        } else if item.accidental == Some(true) {
            if mode == Sensitivity::Fast { "maybe" } else { "rejects" }
        } else if focus < blur_floor
            && !smooth_object
            && item.eyes_open_protect != Some(true)
            && !(v2s_cap
                && preset.hard_blur_below - focus <= 2
                && item.exposure.unwrap_or(0) >= 90
                && item.mean_lum.unwrap_or(0) >= 100)
        {
            item.blur_reject = Some(true);
            "rejects"
        } else if preset.exposure_hard_reject
            && item.mean_lum.is_some_and(|ml| ml < 22)
            && clipped_lo > 35.0
        {
            "rejects"
        } else if preset.dark_reject_at > 0
            && !white_bg
            && item.exposure.unwrap_or(100) <= preset.dark_reject_at
            && item.mean_lum.is_some_and(|ml| ml < 35)
            && clipped_hi < 5.0
        {
            "rejects"
        } else if item.v2cap.as_deref() == Some("reject") {
            "rejects"
        } else if blown_extreme && preset.exposure_hard_reject && focus < 65 {
            "rejects"
        } else if blown_mid {
            "maybe"
        } else if preset.composition_hard_reject
            && comp < 20
            && item.comp_confidence.unwrap_or(0.0) > 0.5
        {
            "rejects"
        } else if item.is_duplicate == Some(true) {
            if s < 35 || item.softest_in_burst == Some(true) || item.redundant_in_burst == Some(true) {
                "rejects"
            } else {
                "maybe"
            }
        } else if s >= if smooth_object && comp >= 55 {
            preset.picks_at - 10
        } else {
            preset.picks_at
        } {
            let focus_gate = !smooth_object
                && (focus < preset.picks_focus_min
                    || (v2s_cap && focus < 65 && item.subj_focus.is_some_and(|sf| sf < 62)));
            let clip_gate = !white_bg && (clipped_hi > 8.0 || center_hi > 6.0);
            let expo_cap = v2s_cap && !smooth_object && !white_bg && item.exposure.unwrap_or(100) < 32;
            let dim_soft_cap = v2s_cap
                && !smooth_object
                && !white_bg
                && item.has_face != Some(true)
                && item.mean_lum.is_some_and(|ml| ml < 70)
                && focus < 75;
            let bg_sharp_cap = v2s_cap
                && !smooth_object
                && !white_bg
                && item.has_face != Some(true)
                && item.mean_lum.is_some_and(|ml| ml < 90)
                && item.subj_focus.is_some_and(|sf| sf - focus >= 5);
            if clip_gate
                || comp < 30
                || focus_gate
                || expo_cap
                || dim_soft_cap
                || bg_sharp_cap
                || item.v2cap.as_deref() == Some("maybe")
            {
                "maybe"
            } else {
                "picks"
            }
        } else if s >= preset.reject_below {
            "maybe"
        } else {
            "rejects"
        };

        if v2s_cap
            && item.cluster_rank == Some(0)
            && item.cluster_size.unwrap_or(0) > 1
            && cat == "rejects"
            && item.blur_reject == Some(true)
            && item.v2cap.as_deref() != Some("reject")
        {
            cat = "maybe";
            let mut r = item.reasons.take().unwrap_or_default();
            let mut re = item.reasons_en.take().unwrap_or_default();
            r.retain(|x| x != "Blur / tidak fokus");
            re.retain(|x| x != "Blurry / out of focus");
            r.push("Terbaik di burst-nya tapi lunak".into());
            re.push("Best in burst but soft".into());
            item.reasons = Some(r);
            item.reasons_en = Some(re);
        }

        if cat == "rejects" && conf < preset.conf_reject_floor && item.eyes_closed != Some(true) {
            cat = "maybe";
        }

        let reasons_empty = item.reasons.as_ref().is_none_or(|r| r.is_empty());
        if reasons_empty {
            let expo = item.exposure.unwrap_or(0);
            if cat == "rejects" {
                cat = "maybe";
                item.reasons = Some(vec!["Perlu review manual".into()]);
                item.reasons_en = Some(vec!["Needs manual review".into()]);
            } else if cat == "picks" {
                let mut pos_id = Vec::new();
                let mut pos_en = Vec::new();
                if !smooth_object && focus >= 70 {
                    pos_id.push("Fokus baik".to_string());
                    pos_en.push("Good focus".to_string());
                }
                if expo >= 60 {
                    pos_id.push("Eksposur baik".to_string());
                    pos_en.push("Good exposure".to_string());
                }
                if comp >= 60 {
                    pos_id.push("Komposisi baik".to_string());
                    pos_en.push("Good composition".to_string());
                }
                if item.eyes_state.as_deref() == Some("open") {
                    pos_id.push("Mata terbuka".to_string());
                    pos_en.push("Eyes open".to_string());
                }
                if pos_id.is_empty() {
                    pos_id.push("Lolos semua gate".to_string());
                    pos_en.push("Passed all gates".to_string());
                }
                pos_id.truncate(2);
                pos_en.truncate(2);
                item.reasons = Some(pos_id);
                item.reasons_en = Some(pos_en);
            } else {
                item.reasons = Some(vec![format!("Belum meyakinkan (skor {})", s)]);
                item.reasons_en = Some(vec![format!("Uncertain (score {})", s)]);
            }
        }

        item.reason_codes = Some(codes_for(item.reasons.as_deref().unwrap_or(&[])));
        item.category = Some(cat.to_string());
        match cat {
            "picks" => picks += 1,
            "maybe" => maybe += 1,
            _ => rejects += 1,
        }
    }

    let dt = t0.elapsed().as_secs_f64() * 1000.0;
    let throughput = if total == 0 {
        0
    } else {
        ((total as f64) / (dt / 60000.0).max(1.0)).round() as u64
    };

    CullOutput {
        photos: results,
        stats: CullStats {
            total,
            picks,
            maybe,
            rejects,
            duration_ms: dt,
            throughput_per_min: throughput,
            feat_null: feat_null_count.load(Ordering::Relaxed),
        },
        cancelled: false,
    }
}
