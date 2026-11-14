use super::aesthetic::{analyze_aesthetic, AestheticResult};
use super::blur::{analyze_sharpness_from_gray, gray_from_rgba, SharpnessResult};
use super::composition::{analyze_composition_from_gray, CompositionResult};
use super::decode::RgbaImageBuf;
use super::duplicate::dhash_from_gray;
use super::face::{heuristic_face_detect, FaceResult};
use super::motion::{analyze_motion_from_gray, MotionResult};
use super::subject::{analyze_subject_focus, SubjectFocus};
use super::tilt::{analyze_tilt_from_gray, TiltResult};

pub const V2_SUBJECT: bool = true;
pub const V2_BURST_RANK: bool = true;
pub const V2_HIEYE: bool = true;

pub struct PipelineFeatures {
    pub sharpness: SharpnessResult,
    pub aesthetic: AestheticResult,
    pub composition: CompositionResult,
    pub face: FaceResult,
    pub tilt: TiltResult,
    pub subject: SubjectFocus,
    pub motion: MotionResult,
    pub dhash: String,
}

pub fn analyze_rgba(img: &RgbaImageBuf) -> Option<PipelineFeatures> {
    if img.width == 0 || img.height == 0 {
        return None;
    }
    let (gray, w, h, mean) = gray_from_rgba(img);
    if gray.len() != w * h {
        return None;
    }
    let sharpness = analyze_sharpness_from_gray(&gray, w, h, mean);
    let aesthetic = analyze_aesthetic(img);
    let composition = analyze_composition_from_gray(&gray, w, h, mean);
    let face = heuristic_face_detect(img, Some(sharpness.sharpness));
    let tilt = analyze_tilt_from_gray(&gray, w, h);
    let subject = analyze_subject_focus(&gray, w, h, face.has_face, face.face_confidence);
    let motion = analyze_motion_from_gray(&gray, w, h);
    let dhash = dhash_from_gray(&gray, w, h);
    Some(PipelineFeatures {
        sharpness,
        aesthetic,
        composition,
        face,
        tilt,
        subject,
        motion,
        dhash,
    })
}
