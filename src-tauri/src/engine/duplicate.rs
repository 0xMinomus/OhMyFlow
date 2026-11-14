use std::collections::{HashMap, HashSet};

pub fn dhash_from_gray(gray: &[f32], w: usize, h: usize) -> String {
    let mut small = [0.0f32; 72];
    let x_step = w as f64 / 9.0;
    let y_step = h as f64 / 8.0;
    for sy in 0..8usize {
        for sx in 0..9usize {
            let x0 = (sx as f64 * x_step).floor() as usize;
            let x1 = ((sx as f64 + 1.0) * x_step).floor().max(x0 as f64 + 1.0) as usize;
            let y0 = (sy as f64 * y_step).floor() as usize;
            let y1 = ((sy as f64 + 1.0) * y_step).floor().max(y0 as f64 + 1.0) as usize;
            let mut sum = 0.0f64;
            let mut n = 0usize;
            for y in y0..y1.min(h) {
                for x in x0..x1.min(w) {
                    sum += gray[y * w + x] as f64;
                    n += 1;
                }
            }
            small[sy * 9 + sx] = if n > 0 { (sum / n as f64) as f32 } else { 0.0 };
        }
    }
    let mut hash = String::with_capacity(64);
    for y in 0..8usize {
        for x in 0..8usize {
            hash.push(if small[y * 9 + x] < small[y * 9 + x + 1] { '1' } else { '0' });
        }
    }
    hash
}

pub fn hamming_distance_limited(a: &str, b: &str, limit: usize) -> usize {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    let n = ab.len().min(bb.len());
    let mut d = 0usize;
    for i in 0..n {
        if ab[i] != bb[i] {
            d += 1;
            if d > limit {
                return d;
            }
        }
    }
    d + ab.len().abs_diff(bb.len())
}

pub fn is_flat_hash(hash: &str) -> bool {
    let ones = hash.bytes().filter(|&b| b == b'1').count();
    !(6..=58).contains(&ones)
}

pub fn group_duplicates(hashes: &[(String, String)], threshold: usize) -> Vec<(String, Vec<String>)> {
    if hashes.len() > 250 {
        group_duplicates_windowed(hashes, threshold, 40)
    } else {
        group_duplicates_windowed(hashes, threshold, hashes.len())
    }
}

pub fn group_duplicates_windowed(
    hashes: &[(String, String)],
    threshold: usize,
    window: usize,
) -> Vec<(String, Vec<String>)> {
    let mut groups = Vec::new();
    let mut visited = HashSet::<String>::new();
    let flat: HashSet<&str> = hashes
        .iter()
        .filter(|(_, h)| is_flat_hash(h))
        .map(|(id, _)| id.as_str())
        .collect();

    let mut by_key: HashMap<&str, usize> = HashMap::new();
    for (idx, (id, _)) in hashes.iter().enumerate() {
        by_key.insert(id.as_str(), idx);
    }

    for i in 0..hashes.len() {
        let id_i = &hashes[i].0;
        if visited.contains(id_i) || flat.contains(id_i.as_str()) {
            continue;
        }
        let mut group = vec![id_i.clone()];
        let j_max = hashes.len().min(i + 1 + window);
        for j in (i + 1)..j_max {
            let id_j = &hashes[j].0;
            if visited.contains(id_j) || flat.contains(id_j.as_str()) {
                continue;
            }
            if hamming_distance_limited(&hashes[i].1, &hashes[j].1, threshold) <= threshold {
                group.push(id_j.clone());
                visited.insert(id_j.clone());
            }
        }
        if group.len() > 1 {
            for g in &group {
                visited.insert(g.clone());
            }
            groups.push((id_i.clone(), group));
        }
    }
    groups
}
