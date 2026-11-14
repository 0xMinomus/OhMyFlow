use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::engine::culler::PhotoItem;
use crate::engine::decode::is_raw_ext;

const SUPPORTED_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "tiff", "tif", "webp", "bmp", "heic", "heif", "cr2", "cr3", "nef", "arw",
    "raf", "dng", "rw2", "orf", "pef", "xmp",
];

#[inline]
fn is_supported_ext(ext: &str) -> bool {
    SUPPORTED_EXTS.contains(&ext)
}

pub fn is_path_inside_roots(file_path: &Path, roots: &[PathBuf]) -> bool {
    let Ok(target) = file_path.canonicalize() else {
        return false;
    };
    for r in roots {
        if let Ok(root_can) = r.canonicalize() {
            if target.starts_with(&root_can) {
                return true;
            }
        }
    }
    false
}

pub fn scan_folder(folder: &Path) -> Result<Vec<PhotoItem>, String> {
    let entries_rd = fs::read_dir(folder).map_err(|e| e.to_string())?;
    let mut entries: Vec<String> = entries_rd
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    entries.sort_by_key(|a| a.to_lowercase());

    let mut jpg_by_base: HashMap<String, String> = HashMap::new();
    for entry in &entries {
        let p = Path::new(entry);
        let ext = p
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        if ext != "jpg" && ext != "jpeg" {
            continue;
        }
        let stem_len = entry.len().saturating_sub(ext.len() + 1);
        let key = entry[..stem_len].to_lowercase();
        jpg_by_base.entry(key).or_insert_with(|| entry.clone());
    }

    let mut map: HashMap<String, PhotoItem> = HashMap::new();
    for entry in &entries {
        let full = folder.join(entry);
        let ext = full
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        if ext == "xmp" || !is_supported_ext(&ext) {
            continue;
        }
        let Ok(st) = fs::metadata(&full) else {
            continue;
        };
        if st.is_dir() {
            continue;
        }
        let mtime_ms = st
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let stem_len = entry.len().saturating_sub(ext.len() + 1);
        let base = entry[..stem_len].to_string();
        let key = base.to_lowercase();
        let dot_ext = format!(".{}", ext);
        let full_str = full.to_string_lossy().to_string();

        if is_raw_ext(&ext) {
            if let Some(jpg) = jpg_by_base.get(&key) {
                let paired = folder.join(jpg).to_string_lossy().to_string();
                map.insert(
                    key.clone(),
                    PhotoItem {
                        id: format!("{}_rawjpg", key),
                        file_name: entry.clone(),
                        file_path: full_str,
                        paired_path: Some(paired.clone()),
                        preview_path: Some(paired),
                        is_paired: true,
                        is_raw: true,
                        ext: dot_ext,
                        size: st.len(),
                        mtime_ms: Some(mtime_ms),
                        base_name: base,
                        score: None,
                        confidence: None,
                        category: None,
                        reasons: None,
                        reasons_en: None,
                        sharpness: None,
                        exposure: None,
                        eyes_closed: None,
                        is_duplicate: None,
                        duplicate_group: None,
                        aesthetic: None,
                        composition: None,
                        dhash: None,
                        reason_codes: None,
                        subj_focus: None,
                        motion: None,
                        onnx_face: None,
                        onnx_dominant_unknown: None,
                        pass2: None,
                        pupil_hits: None,
                        obj_mode: None,
                        white_bg: None,
                        has_face: None,
                        face_confidence: None,
                        clipped_hi: None,
                        clipped_lo: None,
                        center_hi: None,
                        mean_lum: None,
                        hi_pct: None,
                        border_hi: None,
                        lo_pct: None,
                        max_edge: None,
                        comp_confidence: None,
                        subject: None,
                        edge: None,
                        grad_p50: None,
                        grad_p99: None,
                        color: None,
                        accidental: None,
                        eyes_state: None,
                        eyes_p: None,
                        eyes_open_protect: None,
                        skin_ratio: None,
                        blur_floor: None,
                        blur_reject: None,
                        v2cap: None,
                        cluster_rank: None,
                        cluster_size: None,
                        margin_to_best: None,
                        softest_in_burst: None,
                        redundant_diverse: None,
                        redundant_in_burst: None,
                    },
                );
            } else if !map.contains_key(&key) {
                map.insert(
                    key.clone(),
                    PhotoItem {
                        id: key,
                        file_name: entry.clone(),
                        file_path: full_str,
                        paired_path: None,
                        preview_path: None,
                        is_paired: false,
                        is_raw: true,
                        ext: dot_ext,
                        size: st.len(),
                        mtime_ms: Some(mtime_ms),
                        base_name: base,
                        score: None,
                        confidence: None,
                        category: None,
                        reasons: None,
                        reasons_en: None,
                        sharpness: None,
                        exposure: None,
                        eyes_closed: None,
                        is_duplicate: None,
                        duplicate_group: None,
                        aesthetic: None,
                        composition: None,
                        dhash: None,
                        reason_codes: None,
                        subj_focus: None,
                        motion: None,
                        onnx_face: None,
                        onnx_dominant_unknown: None,
                        pass2: None,
                        pupil_hits: None,
                        obj_mode: None,
                        white_bg: None,
                        has_face: None,
                        face_confidence: None,
                        clipped_hi: None,
                        clipped_lo: None,
                        center_hi: None,
                        mean_lum: None,
                        hi_pct: None,
                        border_hi: None,
                        lo_pct: None,
                        max_edge: None,
                        comp_confidence: None,
                        subject: None,
                        edge: None,
                        grad_p50: None,
                        grad_p99: None,
                        color: None,
                        accidental: None,
                        eyes_state: None,
                        eyes_p: None,
                        eyes_open_protect: None,
                        skin_ratio: None,
                        blur_floor: None,
                        blur_reject: None,
                        v2cap: None,
                        cluster_rank: None,
                        cluster_size: None,
                        margin_to_best: None,
                        softest_in_burst: None,
                        redundant_diverse: None,
                        redundant_in_burst: None,
                    },
                );
            }
        } else {
            if map.get(&key).is_some_and(|existing| existing.is_paired) {
                continue;
            }
            let id = if map.contains_key(&key) {
                format!("{}_{}", key, dot_ext)
            } else {
                key.clone()
            };
            let insert_key = if map.contains_key(&key) { id.clone() } else { key };
            map.insert(
                insert_key,
                PhotoItem {
                    id,
                    file_name: entry.clone(),
                    file_path: full_str.clone(),
                    paired_path: None,
                    preview_path: Some(full_str),
                    is_paired: false,
                    is_raw: false,
                    ext: dot_ext,
                    size: st.len(),
                    mtime_ms: Some(mtime_ms),
                    base_name: base,
                    score: None,
                    confidence: None,
                    category: None,
                    reasons: None,
                    reasons_en: None,
                    sharpness: None,
                    exposure: None,
                    eyes_closed: None,
                    is_duplicate: None,
                    duplicate_group: None,
                    aesthetic: None,
                    composition: None,
                    dhash: None,
                    reason_codes: None,
                    subj_focus: None,
                    motion: None,
                    onnx_face: None,
                    onnx_dominant_unknown: None,
                    pass2: None,
                    pupil_hits: None,
                    obj_mode: None,
                    white_bg: None,
                    has_face: None,
                    face_confidence: None,
                    clipped_hi: None,
                    clipped_lo: None,
                    center_hi: None,
                    mean_lum: None,
                    hi_pct: None,
                    border_hi: None,
                    lo_pct: None,
                    max_edge: None,
                    comp_confidence: None,
                    subject: None,
                    edge: None,
                    grad_p50: None,
                    grad_p99: None,
                    color: None,
                    accidental: None,
                    eyes_state: None,
                    eyes_p: None,
                    eyes_open_protect: None,
                    skin_ratio: None,
                    blur_floor: None,
                    blur_reject: None,
                    v2cap: None,
                    cluster_rank: None,
                    cluster_size: None,
                    margin_to_best: None,
                    softest_in_burst: None,
                    redundant_diverse: None,
                    redundant_in_burst: None,
                },
            );
        }
    }

    let mut out: Vec<PhotoItem> = map.into_values().collect();
    out.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
    Ok(out)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePhotoItem {
    pub file_path: String,
    pub paired_path: Option<String>,
    pub sub: Option<String>,
}

#[derive(Serialize)]
pub struct MoveFail {
    pub file: String,
    pub error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePhotosResult {
    pub ok: bool,
    pub moved: usize,
    pub skipped: usize,
    pub moved_paths: Vec<String>,
    pub failed: Vec<MoveFail>,
    pub total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => {
            if cfg!(windows) {
                a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
            } else {
                a == b
            }
        }
    }
}

fn safe_sub_name(sub: &str) -> Option<String> {
    let p = Path::new(sub);
    let mut comps = p.components();
    match (comps.next(), comps.next()) {
        (Some(Component::Normal(name)), None) => name.to_str().map(|s| s.to_string()),
        _ => None,
    }
}

fn move_one(src: &Path, dest: &Path) -> Result<(), String> {
    match fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(src, dest).map_err(|e| e.to_string())?;
            fs::remove_file(src).map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

pub fn move_photos(items: &[MovePhotoItem], dest_dir: &str) -> MovePhotosResult {
    let total = items.len();
    if dest_dir.is_empty() {
        return MovePhotosResult {
            ok: false,
            moved: 0,
            skipped: 0,
            moved_paths: Vec::new(),
            failed: Vec::new(),
            total,
            error: Some("no-dest".into()),
        };
    }
    let dest_root = Path::new(dest_dir);
    if let Err(e) = fs::create_dir_all(dest_root) {
        return MovePhotosResult {
            ok: false,
            moved: 0,
            skipped: 0,
            moved_paths: Vec::new(),
            failed: Vec::new(),
            total,
            error: Some(e.to_string()),
        };
    }

    let mut reserved = HashSet::<PathBuf>::new();
    let mut unique_dest = |dir: &Path, name: &str| -> PathBuf {
        let p = Path::new(name);
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
        let mut candidate = dir.join(name);
        let mut n = 1usize;
        while reserved.contains(&candidate) || candidate.exists() {
            let file_name = if ext.is_empty() {
                format!("{} ({})", stem, n)
            } else {
                format!("{} ({}).{}", stem, n, ext)
            };
            candidate = dir.join(file_name);
            n += 1;
        }
        reserved.insert(candidate.clone());
        candidate
    };

    let mut moved_paths = Vec::new();
    let mut failed: Vec<MoveFail> = Vec::new();
    let mut skipped = 0usize;

    for it in items {
        let main_p = Path::new(&it.file_path);
        if !main_p.exists() {
            failed.push(MoveFail {
                file: main_p
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string(),
                error: "file-tidak-ditemukan".into(),
            });
            continue;
        }
        let dir = match it.sub.as_deref().and_then(safe_sub_name) {
            Some(s) => dest_root.join(s),
            None => dest_root.to_path_buf(),
        };
        let _ = fs::create_dir_all(&dir);

        let mut pair_files = vec![main_p];
        if let Some(pp) = it.paired_path.as_deref() {
            pair_files.push(Path::new(pp));
        }

        if pair_files
            .iter()
            .all(|f| f.parent().is_some_and(|par| same_dir(par, &dir)))
        {
            skipped += 1;
            continue;
        }

        let mut jobs: Vec<(PathBuf, PathBuf)> = Vec::new();
        let main_name = main_p.file_name().and_then(|s| s.to_str()).unwrap_or("file");
        let dest_main = unique_dest(&dir, main_name);
        jobs.push((main_p.to_path_buf(), dest_main));

        if let Some(pp) = it.paired_path.as_deref() {
            let p_path = Path::new(pp);
            if p_path.exists() && !p_path.parent().is_some_and(|par| same_dir(par, &dir)) {
                let p_name = p_path.file_name().and_then(|s| s.to_str()).unwrap_or("pair");
                jobs.push((p_path.to_path_buf(), unique_dest(&dir, p_name)));
            }
        }

        // Carry existing .xmp sidecar if present
        let mut seen_xmp = HashSet::<String>::new();
        for src in &pair_files {
            if src.parent().is_some_and(|par| same_dir(par, &dir)) {
                continue;
            }
            let Some(par) = src.parent() else { continue };
            let Some(stem) = src.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let xmp_src = par.join(format!("{}.xmp", stem));
            let xmp_key = xmp_src.to_string_lossy().to_lowercase();
            if !xmp_src.exists() || !seen_xmp.insert(xmp_key) {
                continue;
            }
            let dest_base = jobs
                .iter()
                .find(|(s, _)| s == *src)
                .and_then(|(_, d)| d.file_stem().and_then(|s| s.to_str()))
                .unwrap_or(stem)
                .to_string();
            jobs.push((xmp_src, unique_dest(&dir, &format!("{}.xmp", dest_base))));
        }

        let mut item_failed = false;
        for (s, d) in &jobs {
            if let Err(e) = move_one(s, d) {
                failed.push(MoveFail {
                    file: s
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .to_string(),
                    error: e,
                });
                item_failed = true;
            }
        }
        if item_failed {
            continue;
        }
        moved_paths.push(it.file_path.clone());
    }

    MovePhotosResult {
        ok: true,
        moved: moved_paths.len(),
        skipped,
        moved_paths,
        failed,
        total,
        error: None,
    }
}
