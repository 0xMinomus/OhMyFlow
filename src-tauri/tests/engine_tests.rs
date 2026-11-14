use ohmyflow_lib::cache::prune_cache_dir;
use ohmyflow_lib::engine::culler::{cull_photos, Sensitivity};
use ohmyflow_lib::engine::decode::RgbaImageBuf;
use ohmyflow_lib::engine::onnx::detect_faces_onnx;
use ohmyflow_lib::engine::raw_preview::{extract_embedded_jpeg_from_buffer, extract_raw_preview};
use ohmyflow_lib::fs_ops::{is_path_inside_roots, move_photos, scan_folder, MovePhotoItem};
use ohmyflow_lib::session::{load_folder_session, save_folder_session, FolderSession, PersistedPhotoPatch};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn temp_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let d = std::env::temp_dir().join(format!("omf_rs_{}_{}", name, nanos));
    fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn test_scan_folder_pairs_uppercase_raw_jpg_and_ignores_xmp() {
    let dir = temp_dir("scan");
    fs::write(dir.join("IMG_0002.CR3"), b"raw").unwrap();
    fs::write(dir.join("IMG_0002.JPG"), b"jpg").unwrap();
    fs::write(dir.join("IMG_0002.xmp"), b"xmp").unwrap();
    fs::write(dir.join("IMG_0001.NEF"), b"raw-only").unwrap();
    fs::write(dir.join("IMG_0003.jpg"), b"jpg-only").unwrap();

    let items = scan_folder(&dir).unwrap();
    assert_eq!(items.len(), 3);
    assert_eq!(
        items.iter().map(|i| i.file_name.as_str()).collect::<Vec<_>>(),
        vec!["IMG_0001.NEF", "IMG_0002.CR3", "IMG_0003.jpg"]
    );
    assert!(items[1].is_paired);
    assert!(items[1].is_raw);
    assert!(items[1].preview_path.is_some());
    assert!(!items[0].is_paired);
    assert!(items[0].preview_path.is_none());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_move_photos_carries_pairs_and_numbers_collisions() {
    let root = temp_dir("move");
    let src = root.join("src");
    let dest = root.join("dest");
    fs::create_dir_all(&src).unwrap();
    fs::create_dir_all(dest.join("Picks")).unwrap();
    fs::write(dest.join("Picks").join("SHOT.JPG"), b"existing").unwrap();
    fs::write(src.join("SHOT.CR3"), b"raw").unwrap();
    fs::write(src.join("SHOT.JPG"), b"jpg").unwrap();
    fs::write(src.join("SHOT.xmp"), b"xmp").unwrap();

    let res = move_photos(
        &[MovePhotoItem {
            file_path: src.join("SHOT.CR3").to_string_lossy().to_string(),
            paired_path: Some(src.join("SHOT.JPG").to_string_lossy().to_string()),
            sub: Some("Picks".into()),
        }],
        &dest.to_string_lossy(),
    );
    assert!(res.ok);
    assert_eq!(res.moved, 1);
    assert!(res.failed.is_empty());
    assert!(dest.join("Picks").join("SHOT.CR3").is_file());
    assert!(dest.join("Picks").join("SHOT (1).JPG").is_file());
    assert!(dest.join("Picks").join("SHOT.xmp").is_file());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn test_path_inside_roots_blocks_traversal_and_sibling_prefix() {
    let root = temp_dir("roots");
    let a = root.join("shoot");
    let b = root.join("shoot-other");
    fs::create_dir_all(&a).unwrap();
    fs::create_dir_all(&b).unwrap();
    fs::write(a.join("a.jpg"), b"1").unwrap();
    fs::write(b.join("b.jpg"), b"2").unwrap();

    assert!(is_path_inside_roots(&a.join("a.jpg"), &[a.clone()]));
    assert!(!is_path_inside_roots(&b.join("b.jpg"), &[a.clone()]));
    assert!(!is_path_inside_roots(&a.join("..").join("shoot-other").join("b.jpg"), &[a]));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn test_raw_preview_raf_and_largest_jpeg() {
    let sample_jpg = fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test-photos/001_sharp_picks.jpg")).unwrap();
    let mut raf = vec![0u8; 128];
    raf[..16].copy_from_slice(b"FUJIFILMCCD-RAW ");
    raf[0x54..0x58].copy_from_slice(&128u32.to_be_bytes());
    raf[0x58..0x5c].copy_from_slice(&(sample_jpg.len() as u32).to_be_bytes());
    raf.extend_from_slice(&sample_jpg);

    let extracted = extract_embedded_jpeg_from_buffer(&raf).unwrap();
    assert_eq!(extracted.len(), sample_jpg.len());

    let dir = temp_dir("raw");
    let p = dir.join("SMOKE.RAF");
    fs::write(&p, &raf).unwrap();
    assert_eq!(extract_raw_preview(&p).unwrap().len(), sample_jpg.len());
    let empty = dir.join("EMPTY.CR3");
    fs::write(&empty, vec![0u8; 256]).unwrap();
    assert!(extract_raw_preview(&empty).is_none());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_session_roundtrip_and_cache_prune() {
    let dir = temp_dir("sess");
    let ok = save_folder_session(
        &dir,
        &FolderSession {
            version: 1,
            folder_path: dir.to_string_lossy().to_string(),
            sensitivity: Sensitivity::High,
            saved_at: 12345,
            stats: serde_json::json!({"total": 1, "picks": 1, "maybe": 0, "rejects": 0}),
            items: vec![PersistedPhotoPatch {
                file_name: "A.JPG".into(),
                size: 10,
                mtime_ms: 1,
                category: Some("picks".into()),
                score: Some(85),
                sharpness: None,
                aesthetic: None,
                exposure: None,
                composition: None,
                confidence: None,
                eyes_closed: None,
                reasons: None,
                reasons_en: None,
                reason_codes: None,
                is_duplicate: None,
                duplicate_group: None,
                cluster_rank: None,
                cluster_size: None,
                margin_to_best: None,
                subj_focus: None,
                has_face: None,
                obj_mode: None,
                white_bg: None,
                eyes_state: None,
                eyes_p: None,
            }],
        },
    );
    assert!(ok);
    let loaded = load_folder_session(&dir, &dir.to_string_lossy()).unwrap();
    assert_eq!(loaded.items[0].category.as_deref(), Some("picks"));

    let f1 = dir.join("a.jpg");
    let f2 = dir.join("b.jpg");
    fs::write(&f1, vec![0u8; 200]).unwrap();
    fs::write(&f2, vec![0u8; 200]).unwrap();
    let (removed, _) = prune_cache_dir(&dir, 250, Duration::from_secs(3600));
    assert!(removed >= 1);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_onnx_model_loads_and_cull_high_deterministic() {
    let dummy = RgbaImageBuf {
        data: vec![128u8; 320 * 240 * 4],
        width: 320,
        height: 240,
    };
    let sum = detect_faces_onnx(&dummy).expect("ONNX model must verify SHA-256 and run");
    assert!(sum.available);

    let tp = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test-photos");
    let items = scan_folder(&tp).unwrap();
    let cancel = AtomicBool::new(false);
    let out1 = cull_photos(items.clone(), Sensitivity::High, &cancel, |_, _| {});
    let out2 = cull_photos(items, Sensitivity::High, &cancel, |_, _| {});
    assert!(!out1.cancelled);
    assert_eq!(out1.photos.len(), 8);
    let sig1: Vec<_> = out1
        .photos
        .iter()
        .map(|p| (&p.file_name, &p.category, p.score))
        .collect();
    let sig2: Vec<_> = out2
        .photos
        .iter()
        .map(|p| (&p.file_name, &p.category, p.score))
        .collect();
    assert_eq!(sig1, sig2);
}
