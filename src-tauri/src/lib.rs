pub mod cache;
pub mod engine;
pub mod fs_ops;
pub mod session;

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};
use tauri::http::{header, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, State};

use cache::{md5_hex, prune_cache_dir};
use engine::culler::{cull_photos, CullOutput, PhotoItem, Sensitivity};
use engine::decode::{decode_oriented_dynamic, encode_jpeg_thumbnail, is_raw_ext};
use engine::raw_preview::extract_raw_preview;
use fs_ops::{is_path_inside_roots, move_photos, scan_folder, MovePhotoItem, MovePhotosResult};
use session::{load_folder_session, save_folder_session, FolderSession};

const THUMB_CACHE_MAX_BYTES: u64 = 250 * 1024 * 1024;
const SESSION_CACHE_MAX_BYTES: u64 = 50 * 1024 * 1024;
const THUMB_MAX_AGE: Duration = Duration::from_secs(14 * 24 * 3600);
const SESSION_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 3600);

struct AppState {
    allowed_roots: Mutex<Vec<PathBuf>>,
    cull_cancel: Arc<AtomicBool>,
    raw_cache: Mutex<Vec<(String, Vec<u8>)>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    done: usize,
    total: usize,
}

fn dirs(app: &AppHandle) -> (PathBuf, PathBuf) {
    let cache = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("ohmyflow-cache"));
    let data = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("ohmyflow-data"));
    (cache.join("thumbs"), data.join("sessions"))
}

#[tauri::command]
fn scan_folder_cmd(folder_path: String, state: State<'_, AppState>) -> Result<Vec<PhotoItem>, String> {
    let p = Path::new(&folder_path);
    if !p.is_absolute() {
        return Err("invalid-folder-path".into());
    }
    let items = scan_folder(p)?;
    if let Ok(mut roots) = state.allowed_roots.lock() {
        let pb = p.to_path_buf();
        if !roots.contains(&pb) {
            roots.push(pb);
        }
    }
    Ok(items)
}

#[tauri::command]
async fn cull_photos_cmd(
    app: AppHandle,
    items: Vec<PhotoItem>,
    mode: Sensitivity,
    state: State<'_, AppState>,
) -> Result<CullOutput, String> {
    state.cull_cancel.store(false, Ordering::SeqCst);
    let cancel = Arc::clone(&state.cull_cancel);
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        cull_photos(items, mode, &cancel, |done, total| {
            let _ = app_handle.emit("cull:progress", ProgressPayload { done, total });
        })
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn cancel_cull_cmd(state: State<'_, AppState>) {
    state.cull_cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn clear_thumb_cache_cmd(app: AppHandle) -> serde_json::Value {
    let (thumbs_dir, _) = dirs(&app);
    let mut cleared = 0usize;
    if let Ok(rd) = fs::read_dir(&thumbs_dir) {
        for e in rd.filter_map(|x| x.ok()) {
            if e.path().is_file() && fs::remove_file(e.path()).is_ok() {
                cleared += 1;
            }
        }
    }
    serde_json::json!({ "ok": true, "cleared": { "thumbs": cleared, "analysis": 0 } })
}

#[tauri::command]
async fn move_photos_cmd(items: Vec<MovePhotoItem>, dest_dir: String) -> Result<MovePhotosResult, String> {
    tauri::async_runtime::spawn_blocking(move || move_photos(&items, &dest_dir))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_session_cmd(app: AppHandle, folder_path: String) -> Option<FolderSession> {
    let (_, sessions_dir) = dirs(&app);
    load_folder_session(&sessions_dir, &folder_path)
}

#[tauri::command]
fn save_session_cmd(app: AppHandle, session: FolderSession) -> bool {
    let (_, sessions_dir) = dirs(&app);
    save_folder_session(&sessions_dir, &session)
}

#[tauri::command]
fn show_in_folder_cmd(file_path: String) {
    let p = Path::new(&file_path);
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("explorer").arg("/select,").arg(p).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let target = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
        let _ = Command::new("xdg-open").arg(target).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").args(["-R", &file_path]).spawn();
    }
}

#[tauri::command]
fn open_path_cmd(file_path: String) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmd").args(["/C", "start", "", &file_path]).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("xdg-open").arg(&file_path).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(&file_path).spawn();
    }
}

fn web_mime_for(ext: &str) -> Option<&'static str> {
    match ext {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn media_error(status: StatusCode, msg: &'static str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

fn handle_media_request(app: &AppHandle, uri_str: &str) -> Response<Vec<u8>> {
    let Ok(url) = url::Url::parse(uri_str) else {
        return media_error(StatusCode::BAD_REQUEST, "bad-url");
    };
    let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let Some(target_str) = params.get("path") else {
        return media_error(StatusCode::BAD_REQUEST, "missing-path");
    };
    let kind = params.get("kind").map(|s| s.as_str()).unwrap_or("full");
    let target = Path::new(target_str);

    let state = app.state::<AppState>();
    let allowed = state
        .allowed_roots
        .lock()
        .map(|roots| is_path_inside_roots(target, &roots))
        .unwrap_or(false);
    if !allowed {
        return media_error(StatusCode::FORBIDDEN, "forbidden");
    }

    let Ok(st) = fs::metadata(target) else {
        return media_error(StatusCode::NOT_FOUND, "not-found");
    };
    if !st.is_file() {
        return media_error(StatusCode::NOT_FOUND, "not-found");
    }

    let mtime_ms = st
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    if kind == "thumb" {
        let (thumbs_dir, _) = dirs(app);
        let _ = fs::create_dir_all(&thumbs_dir);
        let key = md5_hex(&format!("{}|{}|{}", target_str, st.len(), mtime_ms));
        let cache_path = thumbs_dir.join(format!("{}.jpg", key));
        if let Ok(cached) = fs::read(&cache_path) {
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "image/jpeg")
                .header(header::CACHE_CONTROL, "private, max-age=300")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(cached)
                .unwrap();
        }
        let Some(buf) = encode_jpeg_thumbnail(target, 480, 62) else {
            return media_error(StatusCode::NOT_FOUND, "no-preview");
        };
        let _ = fs::write(&cache_path, &buf);
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/jpeg")
            .header(header::CACHE_CONTROL, "private, max-age=300")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(buf)
            .unwrap();
    }

    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    if let Some(mime) = web_mime_for(&ext) {
        let Ok(bytes) = fs::read(target) else {
            return media_error(StatusCode::NOT_FOUND, "read-failed");
        };
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "private, max-age=300")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(bytes)
            .unwrap();
    }

    if is_raw_ext(&ext) {
        let rkey = format!("{}|{}|{}", target_str, st.len(), mtime_ms);
        if let Ok(mut cache) = state.raw_cache.lock() {
            if let Some(pos) = cache.iter().position(|(k, _)| k == &rkey) {
                let (_, buf) = cache.remove(pos);
                cache.push((rkey, buf.clone()));
                return Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "image/jpeg")
                    .header(header::CACHE_CONTROL, "private, max-age=300")
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(buf)
                    .unwrap();
            }
        }
        let Some(buf) = extract_raw_preview(target) else {
            return media_error(StatusCode::NOT_FOUND, "no-raw-preview");
        };
        if let Ok(mut cache) = state.raw_cache.lock() {
            if cache.len() >= 8 {
                cache.remove(0);
            }
            cache.push((rkey, buf.clone()));
        }
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/jpeg")
            .header(header::CACHE_CONTROL, "private, max-age=300")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(buf)
            .unwrap();
    }

    let Ok(bytes) = fs::read(target) else {
        return media_error(StatusCode::NOT_FOUND, "read-failed");
    };
    let Some(dyn_img) = decode_oriented_dynamic(&bytes) else {
        return media_error(StatusCode::UNPROCESSABLE_ENTITY, "decode-failed");
    };
    let mut out = Vec::new();
    let is_lossless = ext == "tif" || ext == "tiff";
    let ok = if is_lossless {
        dyn_img
            .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
            .is_ok()
    } else {
        dyn_img
            .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Jpeg)
            .is_ok()
    };
    if !ok {
        return media_error(StatusCode::UNPROCESSABLE_ENTITY, "encode-failed");
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            if is_lossless { "image/png" } else { "image/jpeg" },
        )
        .header(header::CACHE_CONTROL, "private, max-age=300")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(out)
        .unwrap()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            allowed_roots: Mutex::new(Vec::new()),
            cull_cancel: Arc::new(AtomicBool::new(false)),
            raw_cache: Mutex::new(Vec::new()),
        })
        .register_asynchronous_uri_scheme_protocol("media", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            let uri = req.uri().to_string();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(handle_media_request(&app, &uri));
            });
        })
        .setup(|app| {
            let (thumbs_dir, sessions_dir) = dirs(app.handle());
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(4));
                let _ = prune_cache_dir(&thumbs_dir, THUMB_CACHE_MAX_BYTES, THUMB_MAX_AGE);
                let _ = prune_cache_dir(&sessions_dir, SESSION_CACHE_MAX_BYTES, SESSION_MAX_AGE);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_folder_cmd,
            cull_photos_cmd,
            cancel_cull_cmd,
            clear_thumb_cache_cmd,
            move_photos_cmd,
            load_session_cmd,
            save_session_cmd,
            show_in_folder_cmd,
            open_path_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OhMyFlow");
}
