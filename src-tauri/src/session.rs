use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::cache::md5_hex;
use crate::engine::culler::Sensitivity;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedPhotoPatch {
    pub file_name: String,
    pub size: u64,
    pub mtime_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sharpness: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aesthetic: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exposure: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub composition: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eyes_closed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasons: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasons_en: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_codes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_duplicate: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duplicate_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_rank: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_size: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub margin_to_best: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subj_focus: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_face: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obj_mode: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub white_bg: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eyes_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eyes_p: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSession {
    pub version: u32,
    pub folder_path: String,
    pub sensitivity: Sensitivity,
    pub saved_at: u64,
    pub stats: serde_json::Value,
    pub items: Vec<PersistedPhotoPatch>,
}

fn session_file_path(sessions_dir: &Path, folder_path: &str) -> PathBuf {
    let abs = Path::new(folder_path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| folder_path.to_string());
    sessions_dir.join(format!("{}.json", md5_hex(&abs)))
}

pub fn save_folder_session(sessions_dir: &Path, session: &FolderSession) -> bool {
    if fs::create_dir_all(sessions_dir).is_err() {
        return false;
    }
    let dest = session_file_path(sessions_dir, &session.folder_path);
    let tmp = dest.with_extension("json.tmp");
    let Ok(json) = serde_json::to_vec(session) else {
        return false;
    };
    if fs::write(&tmp, json).is_err() {
        let _ = fs::remove_file(&tmp);
        return false;
    }
    if fs::rename(&tmp, &dest).is_err() {
        let _ = fs::remove_file(&tmp);
        return false;
    }
    true
}

pub fn load_folder_session(sessions_dir: &Path, folder_path: &str) -> Option<FolderSession> {
    let path = session_file_path(sessions_dir, folder_path);
    let data = fs::read(path).ok()?;
    let parsed: FolderSession = serde_json::from_slice(&data).ok()?;
    if parsed.version != 1 {
        return None;
    }
    Some(parsed)
}
