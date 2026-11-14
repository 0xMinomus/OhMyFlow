use md5::{Digest, Md5};
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

pub fn md5_hex(input: &str) -> String {
    let digest = Md5::digest(input.as_bytes());
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn prune_cache_dir(dir: &Path, max_bytes: u64, max_age: Duration) -> (usize, u64) {
    let Ok(rd) = fs::read_dir(dir) else {
        return (0, 0);
    };
    let now = SystemTime::now();
    let mut kept = Vec::new();
    let mut removed = 0usize;
    let mut freed = 0u64;
    let mut total_bytes = 0u64;

    for entry in rd.filter_map(|e| e.ok()) {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let size = meta.len();
        let mtime = meta.modified().unwrap_or(now);
        let expired = now
            .duration_since(mtime)
            .map(|age| age > max_age)
            .unwrap_or(false);
        if expired && fs::remove_file(&path).is_ok() {
            removed += 1;
            freed += size;
            continue;
        }
        total_bytes += size;
        kept.push((path, size, mtime));
    }

    if max_bytes > 0 && total_bytes > max_bytes {
        kept.sort_by_key(|(_, _, mtime)| *mtime);
        let target = (max_bytes as f64 * 0.85) as u64;
        for (path, size, _) in kept {
            if total_bytes <= target {
                break;
            }
            if fs::remove_file(&path).is_ok() {
                removed += 1;
                freed += size;
                total_bytes = total_bytes.saturating_sub(size);
            }
        }
    }

    (removed, freed)
}
