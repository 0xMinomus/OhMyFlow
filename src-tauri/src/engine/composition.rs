use super::blur::js_round;

const COLS: usize = 16;
const ROWS: usize = 12;

#[derive(Clone, Debug)]
pub struct CompositionResult {
    pub score: i32,
    pub center_bias: f64,
    pub max_cell_share: f64,
    pub border_share: f64,
    pub subject_size: f64,
    pub max_edge: f64,
    pub is_flat: bool,
    pub confidence: f64,
    pub reasons: Vec<String>,
    pub reasons_en: Vec<String>,
}

pub fn analyze_composition_from_gray(gray: &[f32], w: usize, h: usize, mean_lum: f64) -> CompositionResult {
    let n_blocks = COLS * ROWS;
    let mut block_sum = vec![0.0f32; n_blocks];
    let mut total = 0.0f64;

    if w >= 3 && h >= 3 {
        for y in 1..(h - 1) {
            let row = y * w;
            let by = ((y as f64 / h as f64) * ROWS as f64).floor().min((ROWS - 1) as f64) as usize;
            for x in 1..(w - 1) {
                let i = row + x;
                let g = (gray[i] - gray[i - 1]).abs() + (gray[i] - gray[i - w]).abs();
                let bx = ((x as f64 / w as f64) * COLS as f64).floor().min((COLS - 1) as f64) as usize;
                block_sum[by * COLS + bx] += g;
                total += g as f64;
            }
        }
    }

    let px_per_block = ((w.saturating_sub(2) * h.saturating_sub(2)) as f64 / n_blocks as f64).max(1.0);
    let mut max_mean = 0.0f64;
    let mut means = vec![0.0f64; n_blocks];
    for b in 0..n_blocks {
        means[b] = block_sum[b] as f64 / px_per_block;
        if means[b] > max_mean {
            max_mean = means[b];
        }
    }

    let is_flat = max_mean < 2.5;
    if is_flat || total <= 0.0 {
        return CompositionResult {
            score: 55,
            center_bias: 0.3,
            max_cell_share: 0.2,
            border_share: 0.2,
            subject_size: 0.0,
            max_edge: max_mean,
            is_flat: true,
            confidence: 0.4,
            reasons: Vec::new(),
            reasons_en: Vec::new(),
        };
    }

    let mut cells = [0.0f64; 9];
    let mut center = 0.0f64;
    let mut border = 0.0f64;
    let mut busy = 0usize;
    let busy_thr = max_mean * 0.4;
    for by in 0..ROWS {
        for bx in 0..COLS {
            let b = by * COLS + bx;
            let v = block_sum[b] as f64;
            let cx = ((bx as f64 / COLS as f64) * 3.0).floor().min(2.0) as usize;
            let cy = ((by as f64 / ROWS as f64) * 3.0).floor().min(2.0) as usize;
            cells[cy * 3 + cx] += v;
            if (bx as f64) >= COLS as f64 * 0.25
                && (bx as f64) < COLS as f64 * 0.75
                && (by as f64) >= ROWS as f64 * 0.2
                && (by as f64) < ROWS as f64 * 0.8
            {
                center += v;
            }
            if bx == 0 || by == 0 || bx == COLS - 1 || by == ROWS - 1 {
                border += v;
            }
            if means[b] > busy_thr {
                busy += 1;
            }
        }
    }
    let max_cell = cells.into_iter().fold(0.0f64, f64::max);
    let center_bias = center / total;
    let max_cell_share = max_cell / total;
    let border_share = border / total;
    let subject_size = busy as f64 / n_blocks as f64;

    let mut score = 78.0f64;
    let mut reasons = Vec::new();
    let mut reasons_en = Vec::new();
    let confident = (35.0..=225.0).contains(&mean_lum);

    if max_cell_share > 0.6 {
        score -= 28.0;
        if confident {
            reasons.push("Subjek menumpuk di satu sudut".to_string());
            reasons_en.push("Subject cramped in one corner".to_string());
        }
    }
    if border_share > 0.5 {
        score -= 20.0;
        if confident {
            reasons.push("Subjek terpotong / tepi ramai".to_string());
            reasons_en.push("Subject cut off / busy edges".to_string());
        }
    }
    if subject_size < 0.06 {
        score -= 25.0;
        if confident {
            reasons.push("Subjek terlalu kecil".to_string());
            reasons_en.push("Subject too small".to_string());
        }
    }
    if center_bias < 0.15 && max_cell_share < 0.45 {
        score -= 12.0;
        if confident && reasons.len() < 2 {
            reasons.push("Tengah frame kosong".to_string());
            reasons_en.push("Empty center".to_string());
        }
    }

    let score = js_round(score).clamp(5.0, 95.0) as i32;
    reasons.truncate(2);
    reasons_en.truncate(2);

    let confidence = if !confident {
        0.5
    } else if mean_lum < 55.0 || mean_lum > 205.0 {
        0.75
    } else {
        1.0
    };

    CompositionResult {
        score,
        center_bias,
        max_cell_share,
        border_share,
        subject_size,
        max_edge: max_mean,
        is_flat: false,
        confidence,
        reasons,
        reasons_en,
    }
}
