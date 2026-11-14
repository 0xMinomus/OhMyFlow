use super::decode::RgbaImageBuf;

#[inline]
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

#[derive(Clone, Debug)]
pub struct SharpnessResult {
    pub variance: f64,
    pub normalized: f64,
    pub sharpness: i32,
    pub subject: i32,
    pub edge: i32,
    pub grad_p50: i32,
    pub grad_p99: i32,
    pub focus: i32,
    pub blur_confidence: f64,
    pub accidental: bool,
    pub mean_lum: f64,
    pub is_flat: bool,
    pub confidence: f64,
}

pub fn gray_from_rgba(img: &RgbaImageBuf) -> (Vec<f32>, usize, usize, f64) {
    let w = img.width as usize;
    let h = img.height as usize;
    let n = w * h;
    let mut gray = Vec::with_capacity(n);
    let mut sum = 0.0f64;
    for px in img.data.chunks_exact(4) {
        let v = 0.299f32 * px[0] as f32 + 0.587f32 * px[1] as f32 + 0.114f32 * px[2] as f32;
        gray.push(v);
        sum += v as f64;
    }
    (gray, w, h, if n > 0 { sum / n as f64 } else { 0.0 })
}

pub fn laplacian_variance_from_gray(gray: &[f32], w: usize, h: usize) -> (f64, f64) {
    if w < 3 || h < 3 {
        return (0.0, 0.0);
    }
    let mut sum = 0.0f64;
    let mut sum_sq = 0.0f64;
    let mut count = 0usize;
    for y in 1..(h - 1) {
        let row = y * w;
        for x in 1..(w - 1) {
            let idx = row + x;
            let v = (-4.0 * gray[idx]
                + gray[idx - 1]
                + gray[idx + 1]
                + gray[idx - w]
                + gray[idx + w]) as f64;
            sum += v;
            sum_sq += v * v;
            count += 1;
        }
    }
    if count == 0 {
        return (0.0, 0.0);
    }
    let mean = sum / count as f64;
    let variance = (sum_sq / count as f64 - mean * mean).max(0.0);
    (variance, mean)
}

pub fn sharpness_detailed(variance: f64, mean_lum: f64) -> (i32, bool, f64, bool) {
    let brightness_factor = if mean_lum < 15.0 {
        4.0
    } else if mean_lum < 40.0 {
        (120.0 / mean_lum.max(20.0)) * 0.6
    } else {
        120.0 / mean_lum.max(60.0)
    };
    let norm = variance * brightness_factor.min(2.5);

    let s = if norm <= 0.0 {
        3.0
    } else {
        (-38.0 + 48.0 * (norm + 1.0).log10()).clamp(3.0, 99.0)
    };

    let accidental = variance < 2.0 && (mean_lum < 12.0 || mean_lum > 243.0);
    let is_flat = !accidental && norm < 12.0 && (mean_lum > 200.0 || mean_lum < 25.0);
    let mut sharpness = js_round(s) as i32;
    if is_flat {
        sharpness = sharpness.max(38);
    }

    let mut confidence: f64 = if mean_lum < 20.0 || mean_lum > 240.0 {
        0.45
    } else if mean_lum < 40.0 || mean_lum > 220.0 {
        0.7
    } else {
        1.0
    };
    if is_flat {
        confidence = confidence.min(0.5);
    }
    (sharpness, is_flat, confidence, accidental)
}

pub fn block_variances_from_gray(gray: &[f32], w: usize, h: usize, grid: usize) -> Vec<f64> {
    let mut out = Vec::with_capacity(grid * grid);
    for by in 0..grid {
        for bx in 0..grid {
            let x0 = (bx * w) / grid;
            let x1 = ((bx + 1) * w) / grid;
            let y0 = (by * h) / grid;
            let y1 = ((by + 1) * h) / grid;
            let mut s = 0.0f64;
            let mut s2 = 0.0f64;
            let mut n = 0usize;
            if y1 > y0 + 2 && x1 > x0 + 2 {
                for y in (y0 + 1)..(y1 - 1) {
                    for x in (x0 + 1)..(x1 - 1) {
                        let i = y * w + x;
                        let v = (-4.0 * gray[i]
                            + gray[i - 1]
                            + gray[i + 1]
                            + gray[i - w]
                            + gray[i + w]) as f64;
                        s += v;
                        s2 += v * v;
                        n += 1;
                    }
                }
            }
            if n > 0 {
                let m = s / n as f64;
                out.push((s2 / n as f64 - m * m).max(0.0));
            } else {
                out.push(0.0);
            }
        }
    }
    out
}

pub fn subject_score(center_median_var: f64) -> i32 {
    let s = 30.0 * (center_median_var + 1.0).log10();
    js_round(s.clamp(5.0, 95.0)) as i32
}

pub fn edge_density_from_gray(gray: &[f32], w: usize, h: usize, mean_lum: f64) -> f64 {
    if w < 3 || h < 3 {
        return 0.0;
    }
    let thr = (mean_lum * 0.35).max(12.0) as f32;
    let mut strong = 0usize;
    let mut n = 0usize;
    for y in 1..(h - 1) {
        let row = y * w;
        for x in 1..(w - 1) {
            let i = row + x;
            let resp = (-4.0 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w]).abs();
            if resp > thr {
                strong += 1;
            }
            n += 1;
        }
    }
    if n > 0 { strong as f64 / n as f64 } else { 0.0 }
}

pub fn edge_score(density: f64) -> i32 {
    if density <= 0.0 {
        return 5;
    }
    let s = 34.0 * density.log10() + 110.0;
    js_round(s.clamp(5.0, 95.0)) as i32
}

pub fn gradient_profile_from_gray(gray: &[f32], w: usize, h: usize) -> (i32, i32) {
    if w < 3 || h < 3 {
        return (0, 0);
    }
    const BINS: usize = 256;
    let mut hist = [0u32; BINS];
    let mut n = 0usize;
    for y in 1..(h - 1) {
        let row = y * w;
        for x in 1..(w - 1) {
            let i = row + x;
            let g = (gray[i] - gray[i - 1]).abs() + (gray[i] - gray[i - w]).abs();
            let bin = ((g / 2.0).floor() as usize).min(BINS - 1);
            hist[bin] += 1;
            n += 1;
        }
    }
    let at = |p: f64| -> i32 {
        let target = p * n.max(1) as f64;
        let mut acc = 0.0f64;
        for (b, &cnt) in hist.iter().enumerate() {
            acc += cnt as f64;
            if acc >= target {
                return (b * 2 + 1) as i32;
            }
        }
        (BINS * 2) as i32
    };
    (at(0.5), at(0.99))
}

pub fn analyze_sharpness_from_gray(gray: &[f32], w: usize, h: usize, mean_lum: f64) -> SharpnessResult {
    let (variance, _) = laplacian_variance_from_gray(gray, w, h);
    let (sharpness, is_flat, confidence, accidental) = sharpness_detailed(variance, mean_lum);
    let normalized = variance * (120.0 / mean_lum.max(20.0));
    let (grad_p50, grad_p99) = gradient_profile_from_gray(gray, w, h);
    let blocks = block_variances_from_gray(gray, w, h, 4);
    let mut mid = [blocks[5], blocks[6], blocks[9], blocks[10]];
    mid.sort_by(|a, b| a.total_cmp(b));
    let subject = subject_score(((mid[1] + mid[2]) / 2.0).max(0.0));
    let edge = edge_score(edge_density_from_gray(gray, w, h, mean_lum));
    let focus_f = (0.45 * subject as f64 + 0.35 * sharpness as f64 + 0.2 * edge as f64).clamp(3.0, 99.0);
    let focus = js_round(focus_f) as i32;
    let spread = sharpness.max(subject).max(edge) - sharpness.min(subject).min(edge);
    let blur_confidence = if spread < 18 {
        0.9
    } else if spread < 32 {
        0.7
    } else if spread < 48 {
        0.5
    } else {
        0.35
    };
    SharpnessResult {
        variance,
        normalized,
        sharpness,
        subject,
        edge,
        grad_p50,
        grad_p99,
        focus,
        blur_confidence,
        accidental,
        mean_lum,
        is_flat,
        confidence,
    }
}
