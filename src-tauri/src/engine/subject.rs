use super::blur::js_round;

#[derive(Clone, Debug)]
pub struct SubjectFocus {
    pub focus: Option<i32>,
    pub confidence: f64,
}

fn block_var(gray: &[f32], w: usize, h: usize, x0: f64, y0: f64, x1: f64, y1: f64) -> f64 {
    let mut s = 0.0f64;
    let mut s2 = 0.0f64;
    let mut n = 0usize;
    let ax0 = (x0 * w as f64).floor().max(1.0) as usize;
    let ax1 = (x1 * w as f64).ceil().min((w.saturating_sub(1)) as f64) as usize;
    let ay0 = (y0 * h as f64).floor().max(1.0) as usize;
    let ay1 = (y1 * h as f64).ceil().min((h.saturating_sub(1)) as f64) as usize;
    for y in ay0..ay1 {
        let row = y * w;
        for x in ax0..ax1 {
            let i = row + x;
            let v = (-4.0 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w]) as f64;
            s += v;
            s2 += v * v;
            n += 1;
        }
    }
    if n == 0 {
        return 0.0;
    }
    let m = s / n as f64;
    (s2 / n as f64 - m * m).max(0.0)
}

fn to_score(v: f64) -> i32 {
    let s = 30.0 * (v + 1.0).log10();
    js_round(s.clamp(5.0, 95.0)) as i32
}

pub fn analyze_subject_focus(gray: &[f32], w: usize, h: usize, has_face: bool, face_confidence: f64) -> SubjectFocus {
    if has_face {
        let v = block_var(gray, w, h, 0.25, 0.1, 0.75, 0.55);
        return SubjectFocus {
            focus: Some(to_score(v)),
            confidence: face_confidence,
        };
    }
    let center = block_var(gray, w, h, 0.3, 0.3, 0.7, 0.7);
    let whole = block_var(gray, w, h, 0.0, 0.0, 1.0, 1.0);
    if center > whole * 1.5 && center > 30.0 {
        return SubjectFocus {
            focus: Some(to_score(center)),
            confidence: 0.55,
        };
    }
    SubjectFocus {
        focus: None,
        confidence: 0.3,
    }
}
