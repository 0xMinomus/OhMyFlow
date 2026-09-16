# PLAN.md — Improve Model Culling OhMyFlow

> Disusun: 2026-09-16. Status: SELESAI 100% (2026-09-16).
> Tiap item diputus dengan bukti — KIRIM: darkReject High, tilt, guarantee
> progress. DITAHAN beralasan: screen, noise-vs-blur, ONNX (detail per seksi).
> Build+pack+smoke lolos. Harness/sheet sementara dihapus.
> Konteks: `MEMORY.md`, `ARCHITECTURE.md`, `PRODUCT.md`.
> Aturan eksekusi mengikuti MEMORY.md §9 (Standar Verifikasi).

## Kondisi awal (ringkas)

Kuat: single-decode 1x per foto, deterministik (hash dirakit searah urutan),
safety assertion (nol foto fokus ≥70 di Rejects), objek-mode 0/231 bocor di foto
manusia, white-background studio exempt.

Lubang: threshold masih manual (risiko overfit ke 3 dataset), belum ada deteksi
layar HP/tablet dan tilt, noise ISO tinggi malam dihukum sebagai blur, wajah
kecil/jauh sering unknown.

## Urutan eksekusi (murah dulu)

### 1. Auto-tune harness (tanpa sentuh runtime)

Tujuan: ganti tuning manual dengan sweep terukur, cegah overfit.

- Buat `scripts/tune.cjs`: bundle `analyzeImageData` via esbuild, decode via
  sharp (kode skoring 100% sama dengan produksi), sweep parameter
  `hardBlurBelow`, `picksAt`, `rejectBelow`, `blownRejectAt`, `eyeThreshold`
  per mode Fast/Balanced/High.
- Output: CSV distribusi Picks/Maybe/Rejects + alasan per kategori di
  DIGICAM (231), FIX KERAMIK (74), bulbah (367).
- Kriteria terima: Maybe DIGICAM tetap 10–25%, safety assertion lolos
  (nol fokus ≥70 di Rejects), dua run byte-identik.
- File yang berubah: `scripts/` baru; `src/lib/ai-engine/culler.ts`
  (hanya tabel `PRESETS` bila angka berubah).
- Plus: reproduksibel, tanpa risiko runtime. Minus: bench lama di 672 foto.

### 2. Deteksi layar + tilt (modul murni, terisolasi)

Tujuan: kurangi Maybe yang sebenarnya bisa divonis tepat.

- `src/lib/ai-engine/screen.ts` (baru): deteksi moire frekuensi tinggi +
  garis lurus tepi frame + temperatur dingin. Output flag `isScreen`.
  Vonis: Maybe + alasan ID/EN, tidak pernah auto-reject.
- `src/lib/ai-engine/tilt.ts` (baru): deteksi horizon miring via Hough
  horizontal murah dari `gray` yang sudah ada. Hanya penalti komposisi ringan
  bila confidence > 0.6, bukan hard-reject (lindungi keramik abstrak).
- Colok di `pipeline.ts` (hitung fitur) + `culler.ts` (gate Maybe).
  Bila confidence rendah, flag off dan hasil bit-identik dengan sebelumnya.
- Plus: kode baru, tidak menyentuh vonis lama. Minus: moire rapuh, tilt bisa
  false-positive di produk abstrak (diamankan via confidence gate).
- HASIL 2026-09-16: tilt KIRIM (`tilt.ts`: penalti −6 +
  alasan `Horizon miring`, tanpa hard-reject; bug gradien-terbalik ketemu via
  uji sintetis dan diperbaiki; verifikasi sintetis miring=ya/datar=tidak +
  true-positive DSCF3786 + spot-check 2 foto; 1 pindah kategori di 1950 foto
  4 dataset). Screen DITAHAN: 37/1278 false-positive di OSIS (tenda/crowd
  periodik), nol sampel layar asli untuk kalibrasi recall — butuh dataset
  positif + FFT 2D. File `screen.ts` dihapus, tak ada kode mati.

### 3. Bedakan noise vs blur (sentuh `blur.ts` saja)

Tujuan: selamatkan foto malam ISO tinggi / malam-bokeh dari false-reject blur.

- Tambah `noiseScore` (variansi chroma vs luma) + `directionalBlur`
  (perbandingan gradien horizontal vs vertikal), reuse `gray` + `ImageData`
  yang sudah ada, tanpa dependensi baru.
- Aturan: bila noise tinggi + edge rendah, turunkan `sh.confidence` dan
  tahan hard-reject (jatuh ke Maybe via `confRejectFloor` yang sudah ada).
- Tandai simplifikasi: `// ponytail: heuristik global, ganti segmentasi
  subjek bila akurasi kurang`.
- Plus: satu file, tanpa dep baru. Minus: menyentuh skor fokus inti,
  wajib bench ulang penuh + contact sheet tiap foto yang pindah kategori.
- HASIL 2026-09-16: DITAHAN. Pengukuran: metrik variansi-blok-terminim ikut
  tekstur (96% foto OSIS tajam ikut kena, skala beda antar dataset) — tak bisa
  pisahkan butir ISO dari tekstur halus secara murah. Proteksi malam yang ada
  (`confRejectFloor` + Maybe) sudah cukup. Kode eksperimen di-revert penuh,
  tak ada sisa.

### 4. Ultraface ONNX DirectML (berat, terakhir)

Tujuan: wajah kecil/jauh terbaca, membuka eye-crop-zoom.

- Tambah `src/lib/ai-engine/face-onnx.ts`: heuristik existing jalan dulu;
  bila `eyesState === 'unknown'` + wajah tak yakin, fallback ke ultraface
  320px via `onnxruntime-node` (DirectML di Windows, CPU fallback).
- Ambang vonis mata (`eyeThreshold`) tetap memakai yang ada; hanya
  lokalisasi wajah yang diganti.
- Catatan: menambah runtime ~puluhan MB, memperlambat CPU, menyentuh stack
  terkunci (butuh persetujuan eksplisit sebelum merge).
- Plus: akurasi wajah kecil naik signifikan. Minus: packaging berat,
  perlu uji determinisme ulang + smoke test exe.
- HASIL 2026-09-16: DITAHAN. Biaya: `onnxruntime-node` native (±100 MB,
  butuh electron-rebuild untuk ABI Electron — risiko pack pecah) + unduh model
  + inferensi CPU per foto. Untung: kecil (mata-unknown hanya 9/1278 OSIS,
  wajah jauh = no-face aman by design). Pemicu kirim: bila dataset user
  menunjukkan unknown-rate tinggi + wajah-kecil-terlewat. Tanpa kode mati.

## Hasil eksekusi 2026-09-16 (dataset Foto OSIS skvela, 1278 JPG, 4,8 GB)

- Baseline harness (sharp full-res, bukan thumbnail 480px — distribusi
  comparable, skor bisa geser ±1): fast 871/407/0, balanced 918/360/0,
  high 968/309/1. Keluhan user valid: nyaris nol rejects.
- Akar masalah: skor komposit selamat oleh fokus tinggi (1274/1278 fokus ≥80)
  + kontras lampu; tidak ada gate exposure di vonis maupun picks. Dua foto
  exposure 5–8 (`IMG_6286`, `IMG_7512`) lolos **Picks** beralasan
  `Pencahayaan buruk` (kontak sheet `sheet-extreme.jpg`, verifikasi visual).
- Fix: `darkRejectAt` high=15 (fast/balanced 0=mati) — exposure ≤15 +
  lum<35 + clipHi<5 + bukan whiteBg → Rejects + alasan
  `Terlalu gelap (exposure hancur)`. Guard clipHi lindungi panggung
  laser/neon; crowd gelap tapi konten hidup (expo 39) tetap boleh Picks.
- Sesudah: OSIS high 968/303/7 (tepat 6 foto pindah Maybe→Rejects, skor
  identik); DIGICAM/KERAMIK/bulbah high identik baseline; fast/balanced OSIS
  bit-identik; dua run 1278 byte-identik (hash CSV sama).
- Safety: 6 rejects fokus 83–96 = vonis exposure-hancur (bukan blur),
  disetujui user + visual — pengecualian dicatat di MEMORY §6.
- `npm run build` + `pack` + smoke exe 8 dtk (~84 MB) lolos.

### 5. Jaminan semua foto diproses (laporan: lambat 0–20% lalu melesat)

Temuan (belum implementasi): `CullingView.tsx:49` prefetch berat (sharp+IPC
1200 foto) bobot 15%, analisis ringan bobot 85% — melesat = ilusi bobot,
kemungkinan bukan skip. Jalur cepat asli: `culler.ts` thumb null/decode gagal
= Maybe instan; cancel `break` tinggalkan ekor tanpa kategori tapi UI tetap
ke review.
- Syarat terima: `picks+maybe+rejects = total` selalu; nol item tanpa
  `category`; `thumbNull`+`featNull` dilaporkan di stats; cancel parsial balik
  ke select. Rebalance bobot prefetch 50–60% + label dua fase.
  `thumbCache.ts` `MAX_MEM 400` vs 1200: naikkan/bypass.
- HASIL 2026-09-16: KIRIM (bobot 60/40 + label fase + guard cancel-parsial +
  counter `thumbNull`/`featNull` di stats). `MAX_MEM` dievaluasi TAK PERLU
  diubah: objek culling bawa `thumbUrl` sendiri, LRU 400 cukup untuk grid
  (lazy 60/halaman). `tsc` + build + smoke lolos.

## Verifikasi (wajib tiap tahap, per MEMORY.md §9)

1. `npx tsc --noEmit` bersih.
2. Harness Node (esbuild + sharp + CSV) + asersi + bench di folder foto asli.
3. Contact sheet (montase sharp berlabel) + inspeksi visual tiap foto yang
   pindah kategori; safety assertion nol foto tajam di Rejects.
4. Perubahan reason user-visible dicek via
   `node .agents/skills/impeccable/scripts/detect.mjs --json <file>`
   (catatan 2026-09-16: script belum ada di repo — dilewati, gaya reason
   disamakan manual dengan baris sekitarnya).
5. `npm run build` + `npm run pack` + smoke test exe ±8 detik.
6. Hapus semua file harness/sheet sementara sebelum selesai.

## Dokumentasi penutup

- Update `MEMORY.md` (§5 snapshot engine, §6 angka kalibrasi) di sesi yang sama.
- Update `ARCHITECTURE.md` (§5 modul baru, §7 metodologi/hasil) bila alur berubah.
- Update `PRODUCT.md` bila alasan/ perilaku terlihat-user berubah.
- `git status` bersih; folder foto pribadi tidak pernah masuk repo.
