const CODE_MAP: &[(&str, &str)] = &[
    ("Blur / tidak fokus", "GLOBAL_BLUR"),
    ("Agak blur", "SUBJECT_SOFT"),
    ("Frame kosong", "ACCIDENTAL_FRAME"),
    ("Mata tertutup", "EYES_CLOSED"),
    ("Wajah besar tak terbaca", "EYES_UNCERTAIN"),
    ("Terlalu gelap (exposure hancur)", "EXTREME_DARK"),
    ("Terlalu gelap", "UNDEREXPOSED"),
    ("Pencahayaan buruk", "UNDEREXPOSED"),
    ("Highlight pecah", "BLOWN_HIGHLIGHT"),
    ("Terlalu terang", "OVEREXPOSED"),
    ("Kontras kasar", "HARSH_CONTRAST"),
    ("Kontras rendah", "LOW_CONTRAST"),
    ("Warna pucat", "WASHED_OUT"),
    ("White balance melenceng", "COLOR_CAST"),
    ("Subjek menumpuk", "EDGE_CROP"),
    ("Subjek terpotong", "EDGE_CROP"),
    ("Subjek terlalu kecil", "TINY_SUBJECT"),
    ("Tengah frame kosong", "EMPTY_CENTER"),
    ("Horizon miring", "TILT"),
    ("Gerak / motion blur?", "MOTION_BLUR"),
    ("Duplikat / burst", "BURST_DUPLICATE"),
    ("Terlunak di burst-nya", "BURST_SOFTEST"),
    ("Frame serupa", "BURST_REDUNDANT"),
    ("Tajam & eksposur bagus", "SHARP_GOOD_EXPO"),
    ("Fokus baik", "GOOD_FOCUS"),
    ("Eksposur baik", "GOOD_EXPOSURE"),
    ("Komposisi baik", "GOOD_COMPOSITION"),
    ("Mata terbuka", "EYES_OPEN"),
    ("Lolos semua gate", "PASSED_GATES"),
    ("Belum meyakinkan", "UNCERTAIN"),
    ("Perlu review manual", "NEEDS_REVIEW"),
];

pub fn codes_for(reasons: &[String]) -> Vec<String> {
    reasons
        .iter()
        .map(|r| {
            CODE_MAP
                .iter()
                .find(|(prefix, _)| r.starts_with(prefix))
                .map(|(_, code)| (*code).to_string())
                .unwrap_or_else(|| "OTHER".to_string())
        })
        .collect()
}
