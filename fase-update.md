# FASE-UPDATE.md — Pelacak Eksekusi Culling Engine v2

> Spesifikasi: `new-architecture.md`. Arsitektur lama: `ARCHITECTURE.md`.
> Kontrak produk: `PRODUCT.md`. Memori sesi: `MEMORY.md`.
>
> Keputusan user (mengikat):
> - Scope = full v2 + ONNX.
> - Ground truth = label manual full 1278 foto OSIS.
> - Perubahan verdict HANYA mode High; Fast/Balanced bit-identik.
>
> Protokol per fase (wajib): `tsc` bersih → bench vs baseline → confusion matrix
> + false reject + Maybe leakage + keeper accuracy → contact sheet pindah kategori
> → determinisme dua run → build + pack + smoke → update dokumen ini +
> MEMORY/ARCHITECTURE → hapus file sementara. Stop bila regression buruk.

## Status ringkas

| Fase | Nama | Status | Catatan |
|---|---|---|---|
| 0 | Baseline + ground truth + evaluator | SELESAI-SEBAGIAN | Label manual dilewati user; gate diganti verifikasi visual + before/after |
| 1 | Pisah analysis image | SELESAI | High pakai 1280 q85; hasil di bawah |
| 2 | Subject-aware focus + motion + eye | SELESAI-SEBAGIAN | unknown netral + fitur subj/motion; gate butuh sampel positif |
| 3 | Confidence + gates + caps + reason code | SELESAI | expo-cap 3 pindah + reason codes |
| 4 | Burst clustering + ranking → verdict | SELESAI | Redundant reject High; keeper aman |
| 5 | ONNX face (+person opsional) | SELESAI | app:// + ort wasm + ultraface jalan |
| 6 | Pass 2 adaptif + performa | SELESAI | Eye ROI via ONNX box; plumbing bukti |

## Fase 0 — Baseline + ground truth + evaluator

Tujuan: angka acuan v1 + label manusia + evaluator confusion matrix.

- [x] Harness `bench-v2.cjs` (esbuild + sharp, pola lama): CSV kolom
  `filename,aiVerdict,absoluteScore,confidence,scene,subjectFocus,globalFocus,
  eyeState,clusterId,clusterRank,reason1,reason2` + waktu + RAM.
- [x] Baseline v1 tersimpan (`C:\Users\Andika\AppData\Local\Temp\opencode\v2\`):
  OSIS high 968/303/7 (40s, 571MB) · balanced 918/360/0 (36s) ·
  fast 871/407/0 (30s) · DIGICAM high 193/29/9 · bulbah high 139/225/3 ·
  KERAMIK high 38/15/21. Split: OSIS tuning, DIGICAM validasi,
  bulbah + KERAMIK holdout. sharpRejectNonBlur = 0 semua.
- [x] Template label `labels-osis.csv` (1278 baris, di temp dir, tinggal isi).
- [x] Evaluator `eval-v2.cjs`: confusion matrix, falseReject, rejectPicked,
  maybeLeakage, reviewSize, keeperTop-1 — smoke test 10 label lolos.
- [ ] Double review subset 100 (selang hari) + catat konsistensi label.
- [ ] Label user 1278 selesai → jalan `eval-v2.cjs` → gate Fase 1 terbuka.
- KEPUTUSAN 2026-09-16: label manual DILEWATI (user). Pengganti: tiap fase
  wajib before/after + contact sheet semua pindah kategori + safety assertion.
  Evaluator tetap siap bila label ada suatu hari.

## Fase 1 — Pisah analysis image (High saja) — SELESAI 2026-09-16

- [x] `electron/main.ts`: channel `fs:getAnalysisBatch` (640/896/1280, q85,
  cache `userData/analysis`, key termasuk ukuran) + `preload.ts` expose.
  Path thumbnail 480 q62 TAK tersentuh.
- [x] `thumbCache.ts`: `prefetchAnalysisBatch` (mem 60, batch 12).
  `types`: `PhotoItem.analysisUrl`. `pipeline.ts`: `V2_ANALYSIS_IMAGE` +
  `ANALYSIS_IMAGE_SIZE`. `culler.ts`: `analysisUrl || thumbUrl || dataUrl`.
  `CullingView`: High prefetch 2 tahap, progress 3 label (30/30/40).
- [x] Dampak ukur (OSIS high, harness thumb 480q62 vs analysis 1280q85):
  982/290/6 → 969/302/7; 481 skor geser (±1–2); 74 pindah kategori
  (30 maybe→picks, 43 picks→maybe, 1 maybe→rejects darkReject).
  Mayoritas = keeper duplikat bertukar dalam burst sama (netral, visual OK) +
  ambang highlight 8% (netral) + 1 arah aman (6601). Waktu +84% (38s→70s).
- [x] Catatan Fase 4: dHash sensitif resolusi (6168 keluar grup → picks via
  objek). `tsc` + build + pack + smoke (~82MB) lolos.
- Rollback: flag `V2_ANALYSIS_IMAGE` mati = path thumbnail lama.

## Fase 2 — Subject-aware focus + motion + eye (High saja) — SELESAI-SEBAGIAN 2026-09-16

- [x] `subject.ts`: SubjectDetection + subject-focus zona wajah/tengah (tanpa
  detector baru). `motion.ts`: imbalance sumbu + delta subjek-bg.
  Wire `pipeline.ts` (flag `V2_SUBJECT`) + expose diagnostik.
- [x] Eye unknown 78→72 netral (tanpa reward). Critical gate + cap terdefinisi
  tapi AMBANG PROVISIONAL (tak tersentuh 1950 foto).
- [x] Hasil 4 dataset high + fast/bal OSIS: BIT-IDENTIK baseline semua.
  Motion flag 1 foto (0170, benar visual, hanya reason). Cap unknown-skin
  DITARIK: regresi ghost-skin produk DSCF3951 (visual OK).
- [ ] AKTIFKAN gate bila ada sampel positif (foto subjek-gerak-bg-tajam /
  malam + wajah dominan unknown). Butuh dataset, bukan tebak ambang.

## Fase 3 — Confidence + gates + caps + reason code (High saja) — SELESAI 2026-09-16

- [x] Ukur kandidat caps di 1950 foto: conf<0.4/comp<30/lum<30/closed di picks =
  NOL semua (gate existing cukup — tak tambah kode mati).
- [x] Expo-cap: exposure<32 + bukan objek/whiteBg = max Maybe (High).
  3 pindah tepat sasaran (6601/7321/7322 panggung gelap, visual OK);
  nol di 3 dataset lain. KERAMIK focus<60 di picks = objMode (benar, exempt).
- [x] `reasons.ts`: reason codes post-hoc (22 kode, UI tak berubah).
- [x] `tsc` + build + pack + smoke (~84MB) lolos.
- Ditahan sadar: `Metric<T>` penuh + kamus UI (churn besar, untung tak terukur
  tanpa label). Dilanjut bila ground truth ada.

## Fase 4 — Burst clustering + ranking (High saja) — SELESAI 2026-09-16

- [x] Ranking per cluster (skor desc, stabil) + `clusterRank`/`marginToBest`/
  `clusterSize` diagnostik + diversity guard (hamming≥3 / focus≥10 / expo≥15
  = Maybe). Flag `V2_BURST_RANK`.
- [x] `BURST_REDUNDANT` Reject High: margin≥12 + tak divers + alasan
  `Frame serupa — versi lain lebih baik` (kode `BURST_REDUNDANT`).
- [x] Hasil: OSIS high 965/306→965/226/87 (+80 redundant); bulbah high
  139/225/3 → 139/154/74 (+71); DIGICAM/KERAMIK identik; fast/balanced identik.
- [x] Verifikasi: sheet 12 OSIS + 8 bulbah (momen sama, keeper picks di
  tetangga); 0 grup berisiko (tiap redundant ada frame terbaik Maybe/Picks);
  safety-blur 0; determinisme verdict identik dua run.
- [x] `tsc` + build + pack + smoke (~86MB) lolos.
- Struktur `duplicate/` terpisah DITAHAN (fungsi setara di `culler.ts` cukup;
  pecah file tanpa kebutuhan = boilerplate).

## Fase 5 — ONNX lokal (fail-safe) — SELESAI 2026-09-16 (revisi: user setuju migrasi)

- [x] Migrasi renderer `file://` → `app://` + COOP/COEP (`credentialless`) di
  `electron/main.ts` (anti-traversal, hanya dist/) + header dev di
  `vite.config.ts`. Terbukti: `crossOriginIsolated=true` di exe pack.
- [x] `onnxruntime-web` (devDep, bundle) + wasm (26 file, `scripts/copy-ort.cjs`)
  + model UltraFace RFB-320 (MIT, 1.27MB, `public/models`, sha256 tercatat).
  Terbukti di exe pack: session load, `inputs=input`.
- [x] `src/lib/ml/face-onnx.ts`: adapter FaceDetector, NMS, serial run,
  fail-safe null (fallback heuristik). Wire High + unknown saja.
  Wajah dominan (area>0.12) + unknown = cap Maybe + alasan.
- [x] Sampingan: pack 10GB → 385MB (ignore foto+src+public+electron+scripts).
  Final 402MB (+17MB). Smoke 89MB idle.
- [x] Harness (fallback Node) bit-identik 4 dataset + fast/balanced.

- [x] Spike sukses: ultraface RFB-320 (MIT, 1.27MB) via onnxruntime-node:
  load 240ms, inferensi CPU 6–12ms/foto, wajah crowd+selfie ketemu.
- Blokir lama (jalur buntu) SELESAI via migrasi `app://` di atas.
- Checklist integrasi awal tergantikan implementasi di atas (adapter di
  `ml/face-onnx.ts`, bukan `ml/runtime.ts` terpisah — cukup untuk 1 model).

## Fase 6 — Pass 2 adaptif + performa — SELESAI 2026-09-16 (revisi: box ONNX ada)

- [x] Benchmark ukur (harness, High): 100 foto 3s/144MB · 500 foto 14s/392MB ·
  1278 foto ~36s/571MB. Linear, bounded cache (decode 60/TTL, analysis 60).
- [x] `src/lib/ml/eye-roi.ts`: crop box ONNX (expand 1.3x, upscale ≤2x/512px) +
  heuristik mata yang sama. Trigger High + unknown + box<0.12; upgrade hanya
  open p≤0.2 / closed p>0.6; renderer-only (Node skip → harness bit-identik).
- [x] Plumbing terbukti di exe pack (crop path jalan tanpa error, no-face→null
  benar). Harness 4 dataset + fast/bal bit-identik.
- [x] `tsc` + build + pack + smoke (~89MB) lolos.
- Checklist awal tergantikan hasil di atas (box tersedia via ONNX; skala
  linear 100/500/1278 terbukti; DirectML/worker tak perlu).

## Kriteria DONE (§130 new-architecture) — status jujur 2026-09-16

- [x] Runtime layak + determinisme + pack/smoke + UI sama + nol network.
- [x] Quality naik terukur vs v1 (redundant reject, expo-cap; visual per pindah).
- [ ] Ground truth / leakage / keeper accuracy: TUNGGU label (evaluator siap).

- [ ] Ground truth tersedia; quality terukur naik; false reject aman;
  leakage turun; keeper accuracy naik; review set mengecil; runtime layak;
  determinisme lolos; pack + smoke lolos; UI flow sama; nol network.

## Log eksekusi

| Tanggal | Fase | Hasil |
|---|---|---|
| 2026-09-16 | — | Dokumen pelacak dibuat. Belum ada kode diubah. |
| 2026-09-16 | 0 | Harness + baseline 6 run + evaluator + template 1278. Tunggu label user. |
| 2026-09-16 | 1 | Analysis image High 1280q85 kirim. Dampak ukur + visual OK. |
| 2026-09-16 | 2 | unknown netral + subj/motion instrument. Bit-identik semua dataset. |
| 2026-09-16 | 3 | Expo-cap 3 pindah tepat + reason codes. Bit-identik di 3 dataset lain. |
| 2026-09-16 | 4 | Burst redundant High kirim. Keeper aman, safety 0, deterministik. |
| 2026-09-16 | 5 | Spike ONNX sukses; integrasi ditahan (bukti runtime). Dep dibersihkan. |
| 2026-09-16 | 5r | Migrasi app:// + ONNX kirim, bukti di exe pack. Temp bersih. |
| 2026-09-16 | 6 | Eye ROI kirim + plumbing bukti. TUNTAS (kecuali label). |
| 2026-09-16 | 6 | Benchmark linear 100/500/1278; ROI hold. Temp bersih. |
