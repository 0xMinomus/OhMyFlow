use ohmyflow_lib::engine::culler::{cull_photos, Sensitivity};
use ohmyflow_lib::fs_ops::scan_folder;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

#[test]
fn test_train_dataset_high_mode_parity_and_speed() {
    let target = Path::new("/run/media/andikaputra/NEW VOLUME/Grisel/Train Dataset");
    if !target.exists() {
        eprintln!("Train dataset not available, skipping");
        return;
    }
    let items = scan_folder(target).expect("scan train dataset");
    assert_eq!(items.len(), 223);
    let sample24: Vec<_> = items.into_iter().take(24).collect();

    let cancel = AtomicBool::new(false);
    let t0 = Instant::now();
    let out = cull_photos(sample24, Sensitivity::High, &cancel, |done, total| {
        if done % 8 == 0 || done == total {
            eprintln!("[Rust Engine] Culled {}/{}", done, total);
        }
    });
    let elapsed = t0.elapsed();
    eprintln!(
        "[Rust Engine] Completed 24 photos in {:.2}s ({:.0} photos/min)! Picks: {}, Maybe: {}, Rejects: {}",
        elapsed.as_secs_f64(),
        24.0 / (elapsed.as_secs_f64() / 60.0),
        out.stats.picks,
        out.stats.maybe,
        out.stats.rejects
    );
    assert_eq!(out.photos.len(), 24);
    assert!(out.stats.picks > 0);
}
