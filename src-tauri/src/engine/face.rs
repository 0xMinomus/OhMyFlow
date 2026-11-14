use super::blur::js_round;
use super::decode::RgbaImageBuf;

#[derive(Clone, Debug)]
pub struct FaceResult {
    pub has_face: bool,
    pub face_count: i32,
    pub face_confidence: f64,
    pub skin_ratio: f64,
    pub eyes_closed_probability: f64,
    pub eyes_closed: bool,
    pub eyes_state: String, // "open" | "closed" | "unknown" | "no-face"
    pub pupil_hits: usize,
}

fn no_face(skin_ratio: f64, face_confidence: f64) -> FaceResult {
    FaceResult {
        has_face: false,
        face_count: 0,
        face_confidence,
        skin_ratio,
        eyes_closed_probability: 0.0,
        eyes_closed: false,
        eyes_state: "no-face".to_string(),
        pupil_hits: 0,
    }
}

#[inline]
fn skin_pixel_ycbcr(r: u8, g: u8, b: u8) -> bool {
    if r < 85 || g < 35 || b < 15 {
        return false;
    }
    if r <= g || r <= b {
        return false;
    }
    if r - g < 12 {
        return false;
    }
    let (rf, gf, bf) = (r as f64, g as f64, b as f64);
    let cb = 128.0 + (-0.168736 * rf - 0.331264 * gf + 0.5 * bf);
    let cr = 128.0 + (0.5 * rf - 0.418688 * gf - 0.081312 * bf);
    (76.0..=128.0).contains(&cb) && (132.0..=174.0).contains(&cr)
}

pub fn heuristic_face_detect(img: &RgbaImageBuf, sharpness_opt: Option<i32>) -> FaceResult {
    let w = img.width as usize;
    let h = img.height as usize;
    if w < 8 || h < 8 {
        return no_face(0.0, 0.0);
    }
    let data = &img.data;
    let step = 4usize;
    let mut skin = 0usize;
    let mut total = 0usize;
    let mut skin_center = 0usize;
    let mut center_total = 0usize;

    let cx0 = (w as f64 * 0.25).floor() as usize;
    let cx1 = (w as f64 * 0.75).floor() as usize;
    let cy0 = (h as f64 * 0.15).floor() as usize;
    let cy1 = (h as f64 * 0.85).floor() as usize;

    let mut y = 0usize;
    while y < h {
        let in_y = y >= cy0 && y < cy1;
        let row = y * w;
        let mut x = 0usize;
        while x < w {
            let idx = (row + x) * 4;
            total += 1;
            let is_skin = skin_pixel_ycbcr(data[idx], data[idx + 1], data[idx + 2]);
            if is_skin {
                skin += 1;
            }
            if in_y && x >= cx0 && x < cx1 {
                center_total += 1;
                if is_skin {
                    skin_center += 1;
                }
            }
            x += step;
        }
        y += step;
    }

    let skin_ratio = if total > 0 { skin as f64 / total as f64 } else { 0.0 };
    let center_ratio = if center_total > 0 {
        skin_center as f64 / center_total as f64
    } else {
        0.0
    };
    let concentration = if skin_ratio > 0.005 {
        center_ratio / skin_ratio.max(0.01)
    } else {
        0.0
    };

    let in_range = skin_ratio > 0.06 && skin_ratio < 0.55;
    let amount = ((skin_ratio - 0.06) / 0.12).min(1.0);
    let centered = if concentration >= 1.3 {
        1.0
    } else if concentration >= 0.9 {
        0.65
    } else {
        0.3
    };
    let tier1 = in_range && concentration >= 1.3;
    let tier2 = in_range && !tier1 && concentration >= 0.9;
    let big_center_skin = skin_ratio > 0.35 && center_ratio > 0.30;

    let mut face_confidence = if tier1 {
        ((0.35 + 0.65 * amount) * (0.55 + 0.45 * centered)).min(1.0)
    } else {
        0.0
    };
    let mut has_face = face_confidence > 0.42;
    let mut face_count = if has_face {
        if skin_ratio > 0.3 { 2 } else { 1 }
    } else {
        0
    };

    if !has_face && !tier2 && !big_center_skin {
        return no_face(skin_ratio, js_round(face_confidence * 100.0) / 100.0);
    }

    let sharp = sharpness_opt.unwrap_or(60);
    let band_y0 = (h as f64 * 0.22).floor() as usize;
    let band_y1 = (h as f64 * 0.52).floor() as usize;
    let band_x0 = (w as f64 * 0.18).floor() as usize;
    let band_x1 = (w as f64 * 0.82).floor() as usize;
    let mid_x = (band_x0 + band_x1) / 2;

    let lum_at = |px: usize, py: usize| -> f64 {
        let idx = (py * w + px) * 4;
        0.299 * data[idx] as f64 + 0.587 * data[idx + 1] as f64 + 0.114 * data[idx + 2] as f64
    };

    let mut dark_l = 0usize;
    let mut dark_r = 0usize;
    let mut band_px = 0usize;
    let mut eye_edge = 0.0f64;
    let mut eye_n = 0usize;
    let mut run_l = 0usize;
    let mut run_r = 0usize;
    let mut tall_l = 0usize;
    let mut tall_r = 0usize;
    let mut row_dark: Vec<usize> = Vec::new();
    let col_count = ((band_x1.saturating_sub(band_x0)) as f64 / 2.0).ceil().max(1.0) as usize;
    let mut dark_y_sum = 0usize;

    let gw = col_count;
    let gh = ((band_y1.saturating_sub(band_y0)) as f64 / 2.0).ceil().max(1.0) as usize;
    let mut skin_band = vec![0u8; gw * gh];
    {
        let mut gy = 0usize;
        let mut yy = band_y0;
        while yy < band_y1 {
            let mut gx = 0usize;
            let mut xx = band_x0;
            while xx < band_x1 {
                let idx = (yy * w + xx) * 4;
                if skin_pixel_ycbcr(data[idx], data[idx + 1], data[idx + 2]) {
                    skin_band[gy * gw + gx] = 1;
                }
                xx += 2;
                gx += 1;
            }
            yy += 2;
            gy += 1;
        }
    }
    let dil_r = 4isize;
    let mut dil_band = vec![0u8; gw * gh];
    for gy in 0..gh {
        for gx in 0..gw {
            if skin_band[gy * gw + gx] == 0 {
                continue;
            }
            for dy in -dil_r..=dil_r {
                let yy = gy as isize + dy;
                if yy < 0 || yy >= gh as isize {
                    continue;
                }
                for dx in -dil_r..=dil_r {
                    let xx = gx as isize + dx;
                    if xx < 0 || xx >= gw as isize {
                        continue;
                    }
                    dil_band[yy as usize * gw + xx as usize] = 1;
                }
            }
        }
    }

    let mut r_dark_l = 0usize;
    let mut r_dark_r = 0usize;
    let mut r_dark_y_sum = 0usize;
    let mut r_row_dark: Vec<usize> = Vec::new();
    let mut r_col_dark = vec![0usize; col_count];
    let mut r_hit_gx: Vec<usize> = Vec::new();

    let sclera_at = |px: isize, py: isize| -> bool {
        if px < 0 || px >= w as isize || py < 0 || py >= h as isize {
            return false;
        }
        let idx = (py as usize * w + px as usize) * 4;
        let (r, g, b) = (data[idx] as i32, data[idx + 1] as i32, data[idx + 2] as i32);
        let lum = 0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64;
        lum >= 110.0 && (r - g).abs() < 25 && (g - b).abs() < 25
    };
    let sclera_side = |px: usize, py: usize, dx: isize, dy: isize| -> bool {
        for k in 1..=4isize {
            if sclera_at(px as isize + dx * k, py as isize + dy * k) {
                return true;
            }
        }
        false
    };
    let pupil_at = |px: usize, py: usize| -> bool {
        let mut sides = 0;
        if sclera_side(px, py, 0, -1) {
            sides += 1;
        }
        if sclera_side(px, py, 0, 1) {
            sides += 1;
        }
        if sclera_side(px, py, -1, 0) {
            sides += 1;
        }
        if sclera_side(px, py, 1, 0) {
            sides += 1;
        }
        sides >= 3
    };

    let mut gy = 0usize;
    let mut yy = band_y0;
    while yy < band_y1 {
        let mut row_l = 0usize;
        let mut row_r = 0usize;
        let mut row_d = 0usize;
        let mut r_row_d = 0usize;
        let mut gx = 0usize;
        let mut xx = band_x0;
        while xx < band_x1 {
            let lum = lum_at(xx, yy);
            band_px += 1;
            let near = dil_band[gy * gw + gx] == 1;
            if near && lum < 70.0 && pupil_at(xx, yy) {
                r_hit_gx.push(gx);
            }
            if lum < 42.0 {
                row_d += 1;
                dark_y_sum += yy;
                if xx < mid_x {
                    dark_l += 1;
                    row_l += 1;
                } else {
                    dark_r += 1;
                    row_r += 1;
                }
                if near {
                    r_row_d += 1;
                    r_dark_y_sum += yy;
                    r_col_dark[gx] += 1;
                    if xx < mid_x {
                        r_dark_l += 1;
                    } else {
                        r_dark_r += 1;
                    }
                }
            }
            if yy > band_y0 && xx > band_x0 {
                eye_edge += (lum - lum_at(xx, yy - 1)).abs();
                eye_n += 1;
            }
            xx += 2;
            gx += 1;
        }
        row_dark.push(row_d);
        r_row_dark.push(r_row_d);
        run_l = if row_l >= 2 { run_l + 1 } else { 0 };
        run_r = if row_r >= 2 { run_r + 1 } else { 0 };
        if run_l > tall_l {
            tall_l = run_l;
        }
        if run_r > tall_r {
            tall_r = run_r;
        }
        yy += 2;
        gy += 1;
    }

    let cheek_y0 = (h as f64 * 0.60).floor() as usize;
    let cheek_y1 = (h as f64 * 0.80).floor() as usize;
    let mut cheek_edge = 0.0f64;
    let mut cheek_n = 0usize;
    let mut cy = cheek_y0 + 1;
    while cy < cheek_y1 {
        let mut cx = band_x0 + 1;
        while cx < band_x1 {
            cheek_edge += (lum_at(cx, cy) - lum_at(cx, cy - 1)).abs();
            cheek_n += 1;
            cx += 2;
        }
        cy += 2;
    }

    let total2 = band_px.max(1) as f64;
    let dark_ratio = (dark_l + dark_r) as f64 / total2;
    let left_ratio = dark_l as f64 / total2;
    let right_ratio = dark_r as f64 / total2;
    let symmetric = left_ratio > 0.0015 && right_ratio > 0.0015;
    let eyes_found = symmetric && dark_ratio > 0.004;

    if !has_face && tier2 {
        if eyes_found {
            face_confidence = ((0.35 + 0.65 * amount) * (0.55 + 0.45 * centered)).min(1.0) * 0.9;
            has_face = face_confidence > 0.42;
            if has_face {
                face_count = if skin_ratio > 0.2 { 2 } else { 1 };
            }
        } else {
            return no_face(skin_ratio, 0.35);
        }
    }
    if !has_face && big_center_skin {
        if eyes_found {
            has_face = true;
            face_confidence = 0.68;
            face_count = if skin_ratio > 0.55 { 2 } else { 1 };
        } else {
            return no_face(skin_ratio, 0.35);
        }
    }

    let edge_ratio = (eye_edge / eye_n.max(1) as f64) / (cheek_edge / cheek_n.max(1) as f64).max(1.0);
    let dark_total = dark_l + dark_r;
    let dark_centroid_y = if dark_total > 0 {
        dark_y_sum as f64 / dark_total as f64
    } else {
        (band_y0 + band_y1) as f64 / 2.0
    };
    let brow_line = band_y0 as f64 + (band_y1 as f64 - band_y0 as f64) * 0.35;
    let blobs_u = symmetric && dark_ratio > 0.004 && tall_l >= 3 && tall_r >= 3 && dark_centroid_y >= brow_line;
    let thin_lines_u = symmetric && dark_ratio > 0.004 && !blobs_u;
    let mut row_sorted = row_dark;
    row_sorted.sort_unstable_by(|a, b| b.cmp(a));
    let row_conc = if dark_total > 0 {
        (row_sorted.first().copied().unwrap_or(0) + row_sorted.get(1).copied().unwrap_or(0)) as f64
            / dark_total as f64
    } else {
        0.0
    };

    let r_dark_total = r_dark_l + r_dark_r;
    let r_dark_ratio = r_dark_total as f64 / total2;
    let mut r_col_sum = 0usize;
    let mut r_col_x_sum = 0usize;
    for (gx, &v) in r_col_dark.iter().enumerate() {
        r_col_sum += v;
        r_col_x_sum += gx * v;
    }
    let r_mid_gx = if r_col_sum > 0 {
        r_col_x_sum as f64 / r_col_sum as f64
    } else {
        col_count as f64 / 2.0
    };
    let mut r_mass_l = 0usize;
    let mut r_mass_r = 0usize;
    for (gx, &v) in r_col_dark.iter().enumerate() {
        if (gx as f64) < r_mid_gx {
            r_mass_l += v;
        } else if (gx as f64) > r_mid_gx {
            r_mass_r += v;
        }
    }
    let r_symmetric = r_col_sum > 0
        && (r_mass_l as f64 / r_col_sum as f64) > 0.2
        && (r_mass_r as f64 / r_col_sum as f64) > 0.2;
    let r_dark_centroid_y = if r_dark_total > 0 {
        r_dark_y_sum as f64 / r_dark_total as f64
    } else {
        (band_y0 + band_y1) as f64 / 2.0
    };
    let mut r_hit_l = 0usize;
    let mut r_hit_r = 0usize;
    for &gx in &r_hit_gx {
        if (gx as f64) < r_mid_gx {
            r_hit_l += 1;
        } else {
            r_hit_r += 1;
        }
    }
    let r_blobs = r_hit_l >= 5 && r_hit_r >= 5 && r_dark_centroid_y >= brow_line && r_dark_ratio > 0.004;
    let r_thin_lines = r_symmetric && r_dark_ratio > 0.004 && !r_blobs;
    let mut r_row_sorted = r_row_dark;
    r_row_sorted.sort_unstable_by(|a, b| b.cmp(a));
    let r_line_conc = if r_dark_total > 0 {
        (r_row_sorted.first().copied().unwrap_or(0) + r_row_sorted.get(1).copied().unwrap_or(0)) as f64
            / r_dark_total as f64
    } else {
        0.0
    };

    let eye_structure = blobs_u || edge_ratio > 1.35 || (thin_lines_u && row_conc > 0.55);
    if has_face && !tier2 && !big_center_skin && !eye_structure {
        return no_face(skin_ratio, face_confidence.min(0.38));
    }

    let (mut p, eyes_state) = if r_blobs {
        (0.07, "open")
    } else if sharp < 30 {
        (0.25, "unknown")
    } else if r_thin_lines && r_dark_ratio >= 0.01 && r_line_conc > 0.55 && sharp >= 40 && skin_ratio < 0.6 {
        (0.72, "closed")
    } else if r_thin_lines {
        (0.50, "unknown")
    } else if edge_ratio > 1.6 && r_dark_ratio >= 0.001 {
        (0.10, "open")
    } else if r_dark_ratio < 0.004 {
        (0.45, "unknown")
    } else {
        (0.35, "unknown")
    };

    p *= 0.5 + 0.5 * face_confidence;
    p = p.clamp(0.0, 0.9);
    let eyes_closed = eyes_state == "closed" && p > 0.6;

    FaceResult {
        has_face,
        face_count,
        face_confidence: js_round(face_confidence * 100.0) / 100.0,
        skin_ratio: js_round(skin_ratio * 1000.0) / 1000.0,
        eyes_closed_probability: js_round(p * 100.0) / 100.0,
        eyes_closed,
        eyes_state: eyes_state.to_string(),
        pupil_hits: r_hit_gx.len(),
    }
}
