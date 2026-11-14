use super::blur::js_round;

#[derive(Clone, Debug)]
pub struct TiltResult {
    pub tilted: bool,
    pub confidence: f64,
    pub slope: f64,
}

pub fn analyze_tilt_from_gray(gray: &[f32], w: usize, h: usize) -> TiltResult {
    const BANDS: usize = 24;
    let mut left = [0.0f64; BANDS];
    let mut right = [0.0f64; BANDS];
    let mut horiz = 0.0f64;
    let mut vert = 0.0f64;
    let mut y = 1usize;
    while y + 1 < h {
        let band = (((y as f64 / h as f64) * BANDS as f64).floor() as usize).min(BANDS - 1);
        let row = y * w;
        let mut x = 1usize;
        while x + 1 < w {
            let i = row + x;
            let dx = (gray[i] - gray[i - 1]).abs() as f64;
            let dy = (gray[i] - gray[i - w]).abs() as f64;
            horiz += dy;
            vert += dx;
            if dy > dx * 1.5 {
                if (x as f64) < (w as f64) / 2.0 {
                    left[band] += dy;
                } else {
                    right[band] += dy;
                }
            }
            x += 2;
        }
        y += 2;
    }
    if horiz < vert * 1.2 || horiz <= 0.0 {
        return TiltResult {
            tilted: false,
            confidence: 0.0,
            slope: 0.0,
        };
    }
    let mut bl = 0usize;
    let mut br = 0usize;
    for b in 0..BANDS {
        if left[b] > left[bl] {
            bl = b;
        }
        if right[b] > right[br] {
            br = b;
        }
    }
    let denom = (horiz / 2.0).max(1.0);
    if left[bl] / denom < 0.08 || right[br] / denom < 0.08 {
        return TiltResult {
            tilted: false,
            confidence: 0.0,
            slope: 0.0,
        };
    }
    let slope = (br as f64 - bl as f64) / BANDS as f64;
    let tilted = slope.abs() > 0.06;
    TiltResult {
        tilted,
        confidence: if tilted { 0.7 } else { 0.0 },
        slope: js_round(slope * 100.0) / 100.0,
    }
}
