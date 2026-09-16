# ARCHITECTURE.md — Arsitektur OhMyFlow

> Dokumen teknik terkini. Menjelaskan alur sistem, tech stack, proses culling,
> dan model AI lokal secara mendalam. Status: sinkron dengan kode per 2026-09-16.
> Konteks produk: `PRODUCT.md`. Memori sesi: `MEMORY.md`.

---

## 1. Gambaran Sistem

OhMyFlow adalah aplikasi desktop Windows (Electron) untuk photo culling offline.
Satu prinsip menembus semua lapisan: **tidak ada jaringan, tidak ada API, tidak
ada tebakan** — setiap keputusan harus deterministik, beralasan, dan terverifikasi
di foto asli sebelum dikirim.

```
┌─ MAIN PROCESS (Node, electron/main.ts) ──────────────┐
│ dialog · scanFolder · thumbnail (sharp) · XMP · move  │  ← satu-satunya akses disk
└──────────────┬───────────────────────▲───────────────┘
               │ IPC via contextBridge │  (preload.ts, terisolasi)
┌──────────────▼───────────────────────┴───────────────┐
│ RENDERER (React)                                      │
│ FolderPicker → SensitivitySelector → CullingView ──┐  │
│   → AI single-decode (1× decode/foto):              │  │
│     blur · aesthetic · composition · face · dHash   │  │
│   → skor komposit → Picks / Maybe / Rejects         │  │
│   → PhotoGrid (lazy + paginasi) → Lightbox          │  │
│   → Ekspor XMP / Pindah file ───────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

Alur pengguna (terkunci): **pilih folder → pilih mode → culling → review →
ekspor**. State awal hanya menampilkan pilih folder; hasil muncul setelah culling.

## 2. Tech Stack

| Lapisan | Teknologi | Alasan |
|---|---|---|
| Desktop shell | Electron 30 | `.exe` Windows native (taskbar, dialog file, associate), WebView2/Chromium |
| UI | React 18 + TypeScript 5 + Tailwind CSS 3 | Komponen + type-safety; utility styling |
| Build | Vite 5 + vite-plugin-electron | Dev hot-reload; output `dist/` + `dist-electron/` |
| Citra | sharp 0.33 (satu-satunya dependency runtime) | Decode + resize cepat (libvips), dipakai main process |
| State | Store custom `useSyncExternalStore` | Tanpa zustand/redux; cukup untuk app ini |
| Packaging | electron-packager (folder app, TANPA asar) | Modul native sharp tidak bisa dimuat dari dalam asar |
| Font | System stack (Cascadia Mono dkk.) | Tanpa unduhan — cocok untuk app offline-first |

Versi terkunci di `package.json` + `package-lock.json` (di-commit).

## 3. Main Process & IPC (`electron/`)

`main.ts` adalah satu-satunya kode yang menyentuh disk. Renderer memanggilnya
lewat `window.ohmyflow` (preload, `contextIsolation: true`, tanpa
`nodeIntegration`).

| Channel IPC | Fungsi |
|---|---|
| `dialog:openFolder` | Dialog pilih folder (dipakai pilih sumber + tujuan pindah) |
| `fs:scanFolder` | Daftar foto + pairing RAW+JPG (indeks O(n), bukan O(n²)) + `mtimeMs` |
| `fs:getThumbnail` / `fs:getThumbnailsBatch` | Thumbnail 480px JPEG q62 via sharp, cache disk `userData/thumbs` (kunci: path+size+mtime), batch maks 12, konkurensi 4 |
| `fs:clearThumbCache` | Bersihkan cache thumbnail |
| `fs:readImageAsDataUrl` | File resolusi penuh (khusus lightbox; RAW murni → placeholder) |
| `fs:writeXmp` / `fs:writeXmpsBulk` | Sidecar `.xmp` (Rating 5/3/1 + Label Green/Yellow/Red) |
| `fs:movePhotos` | Pindah file (`rename`, fallback salin+hapus lintas drive); pasangan RAW+JPG dan `.xmp` ikut; nama kembar bernomor otomatis; lewati yang sudah di tujuan |
| `shell:showInFolder` / `shell:openPath` | Integrasi Explorer |
| `window:minimize/maximize/close` | Kontrol jendela custom (titlebar frameless) |
| `app:getPath` | Path sistem (mis. `userData`) |

**Kontrak keamanan:** file asli tidak pernah diubah/dihapus oleh culling maupun
ekspor XMP. Penulisan hanya `.xmp` dan (eksplisit via dialog) pemindahan file.

## 4. Alur Data Culling

1. **Scan** — `scanFolder` mengembalikan metadata ringan (nama, path, ukuran,
   `previewPath` untuk pasangan RAW+JPG). Tanpa preload gambar.
2. **Thumbnail malas (lazy)** — grid hanya meminta thumbnail yang terlihat
   (`IntersectionObserver`, rootMargin 400px). Cache dua lapis: memori LRU
   (400 entri, dedup request berjalan) + cache disk. Hasil: folder 367 foto
   14 MB-an tetap ringan dibuka.
3. **Prefetch + analisis** — sebelum culling, thumbnail diambil batch; tiap foto
   di-decode **tepat sekali** (`decodeOnce`, cache ≤60 entri, TTL 30 detik,
   clamp sisi 128–768px), lalu SEMUA modul membaca `ImageData` yang sama.
4. **Skoring & vonis** — `culler.ts` (§5).
5. **Review** — grid terfilter (Semua/Picks/Maybe/Rejects), paginasi 60/halaman,
   koreksi hover, alasan per foto (ID/EN), lightbox resolusi penuh (keyboard
   ←/→/1/2/3/Esc), tombol lihat-di-folder.
6. **Ekspor** — XMP massal dan/atau pindah file; daftar + statistik diperbarui.

## 5. Mesin AI Lokal (`src/lib/ai-engine/`, 0 `fetch`, 0 API key)

### 5.1 `pipeline.ts` — orkestrasi murni
`analyzeImageData(imageData)` bebas DOM (dipakai browser DAN harness Node untuk
kalibrasi dengan kode identik). `analyzeOne(dataUrl, maxSide)` = decode + analisis.
`CullOptions.analyze` memungkinkan injeksi penganalisis (dipakai kalibrasi).

### 5.2 `blur.ts` — ketajaman tiga lapis
- **Laplacian global**: variansi kernel `[-4,1,1,1,1]`, dinormalisasi brightness,
  dipetakan logaritmik `s = −38 + 48·log10(norm+1)`.
- **Subjek**: median variansi 4 blok tengah grid 4×4
  (`30·log10(v+1)`). Menangkap subjek blur dengan background tajam.
- **Tepi**: fraksi piksel berespons kuat dengan ambang relatif kontras
  (`max(12, mean·0.35)`), dipetakan `34·log10(e)+110`. Invarian terhadap
  brightness (foto digelapkan 4× memberi nilai identik — terukur).
- **Skor fokus** = `0.45·subjek + 0.35·global + 0.20·tepi`; `blurConfidence`
  dari kesepakatan ketiganya; `accidental` (variansi <2 di ekstrem gelap/terang
  = tutup lensa); guard `isFlat`; `gradP50/gradP99` (profil gradien untuk
  deteksi objek-mulus).

### 5.3 `aesthetic.ts` — exposure & warna
Kurva exposure bertoleransi lebar + penalti clipping eksplisit; kontras dari
simpangan baku histogram; colorfulness Hasler–Suesstrunk dengan **kurva jenuh**
(abu <8 tetap dihukum, pastel 8–20 diangkat, vivid utuh — terukur zero-impact di
231 foto manusia yang semuanya ≥51); deteksi color-cast; clipping dihitung
**global, tengah, dan bibir tepi** secara terpisah. Aturan penting:
- `whiteBackground` (gosong >8% + tepi >30% + tengah <10% + gelap <15%) = latar
  putih studio → bebas penalti/alasan/gate highlight.
- Latar terang bersih tanpa gosong → kurva lembut (bukan cacat).
- Alasan hanya untuk bukti kuat; skor tanpa bonus arbitrer.

### 5.4 `composition.ts` — framing
Peta ketertarikan (gradien |dx|+|dy|) pada grid 16×12; metrik: `centerBias`,
`maxCellShare` (sel 3×3), `borderShare`, `subjectSize`, `maxEdge`. Penalti hanya
untuk yang jelas buruk: sudut (−28), tepi ramai/terpotong (−20), subjek mungil
(−25), tengah kosong (−12); maks 2 alasan. Netral 55 bila datar. Aturan
"tidak ada subjek" yang lama DIHAPUS setelah terbukti salah sasaran di 183/231
foto (keramaian merata adalah komposisi sah).

### 5.5 `duplicate.ts` — burst
dHash 9×8 (64-bit), Hamming early-exit, guard hash-datar, grouping penuh (<250)
atau jendela geser (±40, karena burst berurutan). Duplikat bagus TIDAK PERNAH
auto-reject — selalu Maybe; hanya penalti skor. Pengecualian satu-satunya:
mode High menolak anggota yang jelas lebih lunak dari kembaran tertajamnya
(gap fokus ≥7 dan <82, terverifikasi visual).

### 5.6 `face.ts` — wajah & mata (deterministik, tanpa random)
- Kulit: lokus YCbCr (Cb 76–128, Cr 132–174) + aturan RGB cepat.
- Tiga jalur: **tier 1** (terpusat) butuh struktur mata; **tier 2** (menyebar:
  grup) butuh dark simetris; **bigSkin** (close-up memenuhi frame) butuh mata.
  Tanpa struktur → bukan wajah (tembok oranye lolos uji).
- Mata: **gumpalan** (dark simetris + TINGGI ≥3 baris = pupil → terbuka) vs
  **garis tipis** (bulu mata). Vonis tertutup butuh BUKTI POSITIF garis bulu
  (simetris + darkRatio ≥0.01 + terkonsentrasi baris + tajam + skin<0.6, p=0.72).
  Tanpa bukti = unknown (aman, tidak divonis). Skala penuh → terbuka/blink
  tidak divonis.
- `skinRatio` diekspos untuk diagnostik.

### 5.7 `culler.ts` — preset, skor, vonis

| Param | Fast | Balanced | High |
|---|---|---|---|
| analysisSize / batch | 256 / 8 | 384 / 6 | 512 / 4 |
| bobot sharp/face/aesth/comp | .37/.27/.26/.10 | .34/.26/.25/.15 | .32/.24/.24/.20 |
| dupThreshold / dupPenalty | 9 / 8 | 7 / 10 | 5 / 14 |
| picksAt / rejectBelow | 75 / 40 | 70 / 45 | 72 / 48 |
| hardBlurBelow / picksFocusMin | 45 / 60 | 55 / 60 | 60 / 60 |
| blownRejectAt / confRejectFloor | 18 / .45 | 14 / .32 | 12 / .28 |
| eyeThreshold / exposureHR / compHR | .70 / ✕ / ✕ | .60 / ✓ / ✕ | .50 / ✓ / ✓ |

Urutan vonis: mata-tertutup → accidental → hardBlur (kecuali objek-mulus /
proteksi-mata) → gelap-total → blown-ekstrem → blownMid → komposisi (high) →
duplikat → picks (+gate fokus/kliping/komposisi; objek −10) → rejectBelow →
jaring pengaman. Aturan pendukung: proteksi mata-terbuka-jelas (pupil teresolusi
+ fokus ≥50, terbukti menyelamatkan selfie bagus tanpa menyelamatkan jari di
lensa), faceScore diskala fokus, mata-unknown 78 vs terbuka 88.

**Mode objek otomatis** (tanpa wajah + permukaan mulus + rim tajam): skor =
aesthetic×0.6 + komposisi×0.4, tanpa vonis blur, alasan "pucat" dibungkam.
Terbukti 0/231 cocok di foto manusia.

**Determinisme**: hash dirakit searah urutan foto (bukan dari callback paralel) —
run yang sama = hasil byte-identik (terverifikasi dua run).

## 6. UI (`src/components/`, `src/App.tsx`)

Bahasa visual: terminal-inspired gelap — monospace sistem, border tipis berlapis
(frame > section > kartu), tombol bracket `[ Label ]`, section bernomor
(`01. FOLDER / 02. MODE CULLING / 03. HASIL` via `<fieldset>`+`<legend>`),
warna hanya untuk status (hijau/kuning/merah), radius 2–6px. Tanpa gradient,
glow, emoji, atau ilustrasi.

Alur dua state: awal = HANYA pilih folder; setelah folder → mode + tombol;
setelah culling → hasil (tab, paginasi, lightbox, ekspor/pindah, footer status
live). Kartu foto: nomor urut + badge + skor, thumbnail malas, nama + dimensi
(dari thumbnail ter-decode) + maks 3 alasan, koreksi hover, ikon folder.
Estimasi waktu per mode dihitung live dari jumlah foto.

## 7. Kalibrasi (metodologi + hasil)

Metode baku: harness Node (bundle esbuild + decode sharp + CSV) memakai **kode
skoring yang 100% sama** dengan produksi → distribusi + alasan per kategori →
contact sheet (montase sharp berlabel) → inspeksi visual per foto yang pindah
kategori → setel ambang → ulangi. Setiap vonis baru wajib lolos uji
"tidak ada foto tajam di Rejects" dan uji determinisme. File harness/sheet
DIHAPUS setiap selesai (folder kerja bersih).

| Dataset | Isi | Fast | Balanced | High |
|---|---|---|---|---|
| DIGICAM | 231 JPG manusia kasual | 209/19/3 | 201/24/6 | 192/26/13 |
| FIX KERAMIK | 74 JPG produk | 23/48/3 | 47/24/3 | 35/22/17 |
| bulbah | 367 JPG burst acara | — | — | 140/224/3 |

(Format Picks/Maybe/Rejects. Maybe DIGICAM 8–11% = dalam target 10–25%.)
Kasus landmark yang diselesaikan via data: mata-hantu di keramik (14→0),
false-reject highlight pada grup backlit, uniform-komposisi spam (183 foto),
wajah close-up tak terdeteksi, grouping nondeterministik antar-run.

Keterbatasan jujur: foto layar, subjek-bergerak-dengan-bg-tajam, malam-bokeh,
kedip-murni-di-burst-statis, dan makro-kulit vs beige memerlukan segmentasi/ML
(di luar heuristik; jatuh ke Maybe, bukan Picks).

## 8. Build, Distribusi & Gotcha

- `npm run dev` (hot-reload) · `npm run build` (tsc + vite) · `npm run pack`
  (exe) · `npm start` (tanpa kemas).
- Output: `release/OhMyFlow-win32-x64/OhMyFlow.exe` (portable, folder app).
- **Gotcha yang sudah terbukti**: (1) `electron-builder` gagal ekstrak winCodeSign
  (butuh symlink admin) → pakai `electron-packager`; (2) `icon.ico` harus ICO
  multi-ukuran valid (png-to-ico; rename PNG→ICO merusak rcedit); (3) TANPA asar
  (modul native sharp); (4) Vite mengosongkan `dist/` → output pack di `release/`;
  (5) EBUSY saat pack = proses app masih jalan → kill dulu.
- Smoke test: jalankan exe ±8 detik, proses hidup + RAM wajar (~80 MB idle).

## 9. Keamanan & Privasi

Nol request jaringan untuk pemrosesan foto; nol API key; tidak ada telemetri.
Penulisan disk terbatas pada: cache thumbnail (`userData/thumbs`), file `.xmp`,
dan pemindahan eksplisit via dialog. Preload mengekspos permukaan minimal.

## 10. Roadmap

ONNX ultraface (DirectML) · decode pratinjau RAW penuh · SQLite histori koreksi ·
auto-update · installer NSIS + code signing · deteksi layar · segmentasi subjek ·
deteksi tilt · kebijakan duplikat-burst→Rejects (**DITAHAN** — agresif, butuh
persetujuan eksplisit user).
