use super::blur::js_round;
use super::decode::RgbaImageBuf;

#[derive(Clone, Debug)]
pub struct AestheticResult {
    pub score: i32,
    pub exposure: i32,
    pub contrast: i32,
    pub colorfulness: i32,
    pub mean_lum: i32,
    pub clipped_hi_pct: f64,
    pub clipped_hi_center_pct: f64,
    pub clipped_hi_border_pct: f64,
    pub clipped_lo_pct: f64,
    pub white_background: bool,
    pub white_balance_cast: i32,
    pub is_flat: bool,
    pub confidence: f64,
    pub reasons: Vec<String>,
    pub reasons_en: Vec<String>,
}

pub fn analyze_aesthetic(img: &RgbaImageBuf) -> AestheticResult {
    let w = img.width as usize;
    let h = img.height as usize;
    let pixel_count = w * h;
    let mut hist = [0usize; 256];
    let mut lum_sum = 0.0f64;
    let mut r_sum = 0.0f64;
    let mut g_sum = 0.0f64;
    let mut b_sum = 0.0f64;
    let mut hi = 0usize;
    let mut lo = 0usize;
    let mut hi_center = 0usize;
    let mut center_n = 0usize;
    let mut hi_border = 0usize;
    let mut border_n = 0usize;

    let mut rg_sum = 0.0f64;
    let mut yb_sum = 0.0f64;
    let mut rg_sq = 0.0f64;
    let mut yb_sq = 0.0f64;

    let wf = w as f64;
    let hf = h as f64;
    for y in 0..h {
        let yf = y as f64;
        let in_center_y = yf >= hf * 0.2 && yf < hf * 0.8;
        let in_border_y = yf < hf * 0.06 || yf >= hf * 0.94;
        let row = y * w;
        for x in 0..w {
            let i = (row + x) * 4;
            let r = img.data[i] as f64;
            let g = img.data[i + 1] as f64;
            let b = img.data[i + 2] as f64;
            r_sum += r;
            g_sum += g;
            b_sum += b;

            let lum = 0.299 * r + 0.587 * g + 0.114 * b;
            lum_sum += lum;
            let li = if lum < 0.0 {
                0
            } else if lum > 255.0 {
                255
            } else {
                js_round(lum) as usize
            };
            hist[li] += 1;
            if lum > 250.0 {
                hi += 1;
            } else if lum < 6.0 {
                lo += 1;
            }

            let xf = x as f64;
            if in_center_y && xf >= wf * 0.25 && xf < wf * 0.75 {
                center_n += 1;
                if lum > 250.0 {
                    hi_center += 1;
                }
            }
            if xf < wf * 0.06 || xf >= wf * 0.94 || in_border_y {
                border_n += 1;
                if lum > 250.0 {
                    hi_border += 1;
                }
            }

            let rg = r - g;
            let yb = 0.5 * (r + g) - b;
            rg_sum += rg;
            yb_sum += yb;
            rg_sq += rg * rg;
            yb_sq += yb * yb;
        }
    }

    let n = pixel_count.max(1) as f64;
    let lum_mean = lum_sum / n;
    let r_mean = r_sum / n;
    let g_mean = g_sum / n;
    let b_mean = b_sum / n;
    let hi_pct = (hi as f64 / n) * 100.0;
    let lo_pct = (lo as f64 / n) * 100.0;
    let hi_center_pct = (hi_center as f64 / center_n.max(1) as f64) * 100.0;
    let hi_border_pct = (hi_border as f64 / border_n.max(1) as f64) * 100.0;

    let mut exposure = if lum_mean < 30.0 {
        8.0
    } else if lum_mean < 55.0 {
        25.0 + (lum_mean - 30.0) * 1.4
    } else if lum_mean < 85.0 {
        60.0 + (lum_mean - 55.0) * 1.0
    } else if lum_mean < 105.0 {
        90.0 + (lum_mean - 85.0) * 0.5
    } else if lum_mean < 150.0 {
        100.0
    } else if lum_mean < 185.0 {
        100.0 - (lum_mean - 150.0) * 0.7
    } else if lum_mean < 220.0 {
        75.0 - (lum_mean - 185.0) * 1.1
    } else {
        (36.0 - (lum_mean - 220.0) * 0.8).max(5.0)
    }
    .clamp(0.0, 100.0);

    if hi_pct < 3.0 && lum_mean > 185.0 {
        exposure = (105.0 - (lum_mean - 150.0) * 0.45).max(60.0);
    }

    let white_bg = hi_pct > 8.0 && hi_border_pct > 30.0 && hi_center_pct < 10.0 && lo_pct < 15.0;
    if white_bg {
        exposure = exposure.max(70.0);
    }

    if !white_bg && hi_pct > 5.0 {
        exposure = (exposure - (hi_pct - 5.0) * 2.2).max(5.0);
    }
    if lo_pct > 22.0 {
        exposure = (exposure - (lo_pct - 22.0) * 0.9).max(5.0);
    }

    let mut lum_var = 0.0f64;
    for (i, &cnt) in hist.iter().enumerate() {
        let d = i as f64 - lum_mean;
        lum_var += cnt as f64 * d * d;
    }
    let std = (lum_var / n).sqrt();
    let mut contrast = ((std / 52.0) * 100.0).min(100.0);
    if std < 10.0 {
        contrast *= std / 10.0;
    }
    if hi_pct < 3.0 && lum_mean > 190.0 {
        contrast = contrast.max(65.0);
    }

    let rg_mean = rg_sum / n;
    let yb_mean = yb_sum / n;
    let rg_std = (rg_sq / n - rg_mean * rg_mean).max(0.0).sqrt();
    let yb_std = (yb_sq / n - yb_mean * yb_mean).max(0.0).sqrt();
    let std_root = (rg_std * rg_std + yb_std * yb_std).sqrt();
    let mean_root = (rg_mean * rg_mean + yb_mean * yb_mean).sqrt();
    let raw_color = (std_root * std_root + 0.3 * mean_root * mean_root).sqrt();
    let colorfulness = (raw_color / 2.1).clamp(0.0, 100.0);

    let max_c = r_mean.max(g_mean).max(b_mean);
    let min_c = r_mean.min(g_mean).min(b_mean);
    let cast = if lum_mean > 15.0 {
        ((max_c - min_c) / lum_mean.max(1.0)) * 100.0
    } else {
        0.0
    };

    let is_flat = std < 11.0;

    let mut clip_penalty = 0.0;
    if !white_bg && hi_pct > 6.0 {
        clip_penalty += ((hi_pct - 6.0) * 1.6).min(22.0);
    }
    if lo_pct > 28.0 {
        clip_penalty += ((lo_pct - 28.0) * 0.5).min(12.0);
    }

    let color_for_score = if colorfulness < 8.0 {
        colorfulness * 3.75
    } else if colorfulness < 20.0 {
        30.0 + (colorfulness - 8.0) * 3.33
    } else {
        (70.0 + (colorfulness - 20.0) * 1.2).min(100.0)
    };
    let mut score = exposure * 0.42 + contrast * 0.3 + color_for_score * 0.28 - clip_penalty;
    if is_flat {
        score = score.min(58.0);
    }
    score = score.clamp(4.0, 98.0);

    let mut reasons = Vec::new();
    let mut reasons_en = Vec::new();
    if !white_bg && hi_pct > 6.0 {
        reasons.push(format!("Highlight pecah ({:.1}%)", hi_pct));
        reasons_en.push(format!("Blown highlights ({:.1}%)", hi_pct));
    } else if !white_bg && lum_mean > 218.0 && hi_pct > 5.0 {
        reasons.push("Terlalu terang / overexposed".to_string());
        reasons_en.push("Overexposed".to_string());
    }
    if lo_pct > 30.0 && lum_mean < 60.0 {
        reasons.push("Terlalu gelap".to_string());
        reasons_en.push("Too dark".to_string());
    } else if exposure < 32.0 {
        reasons.push("Pencahayaan buruk".to_string());
        reasons_en.push("Poor exposure".to_string());
    }
    if contrast < 18.0 && !is_flat {
        reasons.push("Kontras rendah".to_string());
        reasons_en.push("Low contrast".to_string());
    }
    if colorfulness < 10.0 && lum_mean > 40.0 && lum_mean < 210.0 {
        reasons.push("Warna pucat".to_string());
        reasons_en.push("Washed out colors".to_string());
    }
    if cast > 42.0 && colorfulness > 12.0 {
        reasons.push("White balance melenceng".to_string());
        reasons_en.push("Color cast".to_string());
    }

    let mut confidence: f64 = if is_flat { 0.6 } else { 1.0 };
    if pixel_count < 60 * 60 {
        confidence = confidence.min(0.7);
    }

    AestheticResult {
        score: js_round(score) as i32,
        exposure: js_round(exposure) as i32,
        contrast: js_round(contrast) as i32,
        colorfulness: js_round(colorfulness) as i32,
        mean_lum: js_round(lum_mean) as i32,
        clipped_hi_pct: js_round(hi_pct * 10.0) / 10.0,
        clipped_hi_center_pct: js_round(hi_center_pct * 10.0) / 10.0,
        clipped_hi_border_pct: js_round(hi_border_pct * 10.0) / 10.0,
        clipped_lo_pct: js_round(lo_pct * 10.0) / 10.0,
        white_background: white_bg,
        white_balance_cast: js_round(cast) as i32,
        is_flat,
        confidence,
        reasons,
        reasons_en,
    }
}
