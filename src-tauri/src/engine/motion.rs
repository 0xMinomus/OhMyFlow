use super::blur::js_round;

#[derive(Clone, Debug)]
pub struct MotionResult {
    pub motion_likelihood: f64,
}

pub fn analyze_motion_from_gray(gray: &[f32], w: usize, h: usize) -> MotionResult {
    let mut ex = 0.0f64;
    let mut ey = 0.0f64;
    let mut n = 0usize;
    let mut y = 1usize;
    while y + 1 < h {
        let row = y * w;
        let mut x = 1usize;
        while x + 1 < w {
            let i = row + x;
            let dx = (gray[i] - gray[i - 1]).abs() as f64;
            let dy = (gray[i] - gray[i - w]).abs() as f64;
            if dx + dy > 12.0 {
                ex += dx;
                ey += dy;
                n += 1;
            }
            x += 2;
        }
        y += 2;
    }
    let mut motion_likelihood = 0.0f64;
    if n > 200 {
        let ratio = ex.min(ey) / ex.max(ey).max(1.0);
        if ratio < 0.45 {
            motion_likelihood = ((0.45 - ratio) * 3.0).min(1.0);
        }
    }
    MotionResult {
        motion_likelihood: js_round(motion_likelihood * 100.0) / 100.0,
    }
}
