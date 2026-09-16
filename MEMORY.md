# MEMORY.md — Memori Lintas Sesi OhMyFlow

> Dokumen hidup. **WAJIB dibaca di awal setiap sesi kerja**, dan **WAJIB diperbarui
> setiap ada perubahan**: fitur baru, perubahan threshold/logika, struktur file baru,
> hasil kalibrasi baru, gotcha build baru, atau keputusan user yang baru.
> Lihat protokolnya di bagian paling bawah.

Terakhir diperbarui: 2026-09-16 (sesi kalibrasi bulbah + dokumentasi).

---

## 1. Identitas Proyek

- **Nama:** OhMyFlow — AI Photo Culler untuk Windows, 100% offline, tanpa API.
- **Direktori kerja:** `C:\Users\Andika\Documents\OhMyFlow`
- **Repo:** https://github.com/0xMinomus/OhMyFlow — branch utama `main` (ada juga
  `master` historis; yang aktif dan di-push adalah `main`).
- **User:** fotografer Indonesia (memotret wedding/event, produk/keramik, digicam kasual).
  Bahasa UI default Indonesia, bisa toggle Inggris. Repo/README berbahasa Inggris.
- **Inspirasi:** MyFlow by DOSS (AI photo culler komersial). OhMyFlow adalah remake
  independen, bukan afiliasi.

## 2. Tech Stack (terkunci, jangan diganti tanpa diskusi)

- **Electron 30** (main + preload `contextBridge`, `contextIsolation:true`,
  `nodeIntegration:false`) + **Vite 5** + **React 18** + **TypeScript 5** +
  **Tailwind CSS 3** + **sharp 0.33** (satu-satunya dependency runtime).
- **Node 24**, Windows 10/11 64-bit. GPU NVIDIA opsional (tidak ada kode GPU khusus
  saat ini; semua AI jalan di CPU).
- State: store custom `useSyncExternalStore` di `src/store/useAppStore.ts`
  (**tanpa zustand/redux** — jangan tambah kecuali perlu).
- **Tidak ada**: test framework, router, i18n lib, remote API, analytics, database
  (SQLite masih roadmap). Jangan tambah dependensi tanpa alasan kuat.

## 3. Status Git (per sesi terakhir)

- Remote `origin` = repo di atas. Yang di-commit: source, config, `build/` (icon),
  `public/logo.png`, `test-photos/` (contoh kecil, disengaja untuk demo), docs, LICENSE.
- **TIDAK PERNAH di-commit** (ada di `.gitignore`, sudah diverifikasi via
  `git check-ignore` + `git status` bersih):
  `node_modules/`, `dist/`, `dist-electron/`, `release/`, `*.log`, `.env*`,
  file OS/editor — dan yang paling penting **folder foto pribadi**:
  `DIGICAM/` (±198 MB), `FIX KERAMIK/` (±264 MB), `bulbah/` (±5,2 GB).
- Aturan keras: folder foto user TIDAK BOLEH masuk repo dalam keadaan apa pun.
  Kalau user menyebut folder foto baru, hal PERTAMA yang dilakukan adalah
  menambahkannya ke `.gitignore` sebelum kerja.

## 4. Arsitektur Singkat (detail penuh: ARCHITECTURE.md)

```
Folder foto → scanFolder (pairing RAW+JPG, O(n)) → thumbnail 480px (sharp,
cache disk userData/thumbs + memori LRU) → AI single-decode per foto
(blur+aesthetic+composition+face+dHash, 1x decode) → skor komposit →
Picks/Maybe/Rejects → review grid (lazy, paginasi 60) → ekspor XMP / pindah file
```

- **Main process** (`electron/main.ts`): semua akses disk via IPC
  (`dialog`, `fs:scanFolder`, `fs:getThumbnail(s)Batch`, `fs:readImageAsDataUrl`
  untuk lightbox resolusi penuh, `fs:writeXmp(s)Bulk`, `fs:movePhotos` dengan
  fallback EXDEV + ikut RAW-pair/XMP + anti-nama-kembar, `shell`, `window:` controls).
- **Renderer tidak pernah menyentuh disk langsung.** Semua lewat `window.ohmyflow`.
- **Flow UI (JANGAN UBAH tanpa persetujuan):** state awal = HANYA pilih folder →
  setelah folder dipilih muncul mode + tombol culling → setelah culling muncul hasil.
  Tidak ada onboarding, tidak ada step tambahan.

## 5. Mesin Culling (snapshot — detail penuh: ARCHITECTURE.md §4-5)

- File: `src/lib/ai-engine/` — `pipeline.ts` (single-decode, murni tanpa DOM di
  `analyzeImageData`), `blur.ts`, `aesthetic.ts`, `composition.ts`,
  `duplicate.ts` (dHash 9×8, Hamming early-exit, flat-hash guard, windowed),
  `face.ts` (YCbCr deterministik, TANPA random), `culler.ts` (orkestrasi + preset).
- **Mode = sensitivitas, BUKAN jenis foto** (jenis pemotretan wedding/portrait/...
  sudah DIHAPUS atas permintaan user). Preset per mode (`PRESETS` di `culler.ts`):

| Param | Fast | Balanced | High |
|---|---|---|---|
| analysisSize / batch | 256 / 8 | 384 / 6 | 512 / 4 |
| bobot sharp/face/aesth/comp | .37/.27/.26/.10 | .34/.26/.25/.15 | .32/.24/.24/.20 |
| dupThreshold / dupPenalty | 9 / 8 | 7 / 10 | 5 / 14 |
| picksAt / rejectBelow | 75 / 40 | 70 / 45 | 72 / 48 |
| hardBlurBelow / picksFocusMin | 45 / 60 | 55 / 60 | 60 / 60 |
| blownRejectAt / confRejectFloor | 18 / .45 | 14 / .32 | 12 / .28 |
| eyeThreshold / exposureHR / compHR | .70 / F / F | .60 / T / F | .50 / T / T |

- Urutan vonis di `culler.ts`: mata-tertutup → accidental → hardBlur
  (kecuali objek-mulus/proteksi-mata) → gelap-total → blown-ekstrem → blownMid →
  komposisi (high) → duplikat (s<35 reject, else Maybe; high: +softestInBurst) →
  picks (+gate fokus/kliping/komposisi; objek −10) → rejectBelow → jaring pengaman.
- **Mode objek otomatis** (tanpa wajah + permukaan mulus p50<2 + rim tajam p99>18):
  skor = aesthetic×0.6 + komposisi×0.4, tanpa vonis blur, palang picks −10.
  Dibuktikan 0/231 cocok di foto manusia (tidak bocor).
- **White-bg**: highlight tepi gosong + tengah bersih = studio, bukan cacat
  (bebas penalti/reason/gate highlight). Bright-unclipped pakai kurva lembut.
- **Determinisme dijamin**: hash dirakit searah urutan foto (bukan push dari callback
  paralel) — run yang sama = hasil byte-identik (terverifikasi).
- **Mata**: vonis tertutup butuh BUKTI POSITIF garis bulu (simetris + darkRatio ≥0.01
  + terkonsentrasi baris + tajam + skin<0.6, p=0.72). Pupil butuh gumpalan TINGGI
  (tall≥3) — garis tipis/buram/pupil-jauh = unknown (aman). Mata-terbuka-jelas
  melindungi dari vonis blur (syarat fokus ≥50). Tidak ada `Math.random()` di
  mana pun — bila ketemu, itu bug.

## 6. Hasil Kalibrasi Terukur (jangan klaim tanpa data baru)

| Dataset | Isi | Fast | Balanced | High |
|---|---|---|---|---|
| DIGICAM | 231 JPG manusia kasual | 209/19/3 | 201/24/6 | 192/26/13 |
| FIX KERAMIK | 74 JPG produk | 23/48/3 | 47/24/3 | 35/22/17 |
| bulbah | 367 JPG burst acara (14 MB/foto) | — | — | 140/224/3 |

(Format: Picks/Maybe/Rejects. Maybe DIGICAM 8–11% = dalam target 10–25% user.)
- Safety assertion: **nol foto tajam (fokus ≥70) di Rejects** di semua mode/folder.
- Setiap reject modes HIGH di DIGICAM + semua reject keramik/bulbah DIVERIFIKASI
  VISUAL per foto via contact sheet sebelum diterima.
- Keterbatasan jujur (jangan dijanjikan selesai tanpa ML): foto layar HP,
  subjek-bergerak-dengan-bg-tajam, malam-bokeh, kedip-murni-di-burst-statis,
  makro-kulit vs beige (kasus langka, arah aman = unknown).

## 7. UI (jangan ubah flow)

- Gaya: terminal-inspired gelap — monospace (Cascadia Mono stack sistem, tanpa font
  unduhan), border tipis berlapis (frame > section > kartu), bracket `[ Label ]`,
  section bernomor `01. FOLDER / 02. MODE CULLING / 03. HASIL`, warna HANYA untuk
  status (hijau/kuning/merah), radius 2–6px, tanpa gradient/glow/emoji.
- Komponen: `Header` (logo kucing pixel-art + kontrol window custom ─ □ ✕),
  `FolderPicker`, `SensitivitySelector` (estimasi waktu live), `CullingView`
  (progress/cancel/error), `PhotoGrid` (tab, paginasi, hover-koreksi, dimensi
  dari thumbnail ter-decode), `LazyThumb` (IntersectionObserver), `Lightbox`
  (full-res on-demand, keyboard ←/→/1/2/3/Esc), `MoveModal` (Picks + opsional Maybe),
  `Fieldset`, footer status bar live. Logo: `public/logo.png`, `build/icon.ico`
  (ICO multi-ukuran valid via png-to-ico; JANGAN rename PNG jadi .ico — rcedit gagal).

## 8. Build, Pack & Gotcha (baca sebelum pack!)

- `npm run dev` (hot-reload) · `npm run build` (tsc+vite) · `npm run pack` (exe) ·
  `npm start` (jalan tanpa kemas).
- Output: `release/OhMyFlow-win32-x64/OhMyFlow.exe` (portable, TANPA asar — modul
  native sharp tidak bisa dimuat dari dalam asar!). Jangan kemas dengan asar.
- `electron-builder` RUSAK di env ini (gagal ekstrak winCodeSign: butuh symlink
  admin) → pakai `electron-packager` (sudah terkonfigurasi di script `pack`).
- **Vite mengosongkan `dist/`** setiap build → output pack HARUS di `release/`,
  jangan di dalam `dist/`.
- **EBUSY saat pack** = proses OhMyFlow masih jalan → kill dulu, baru pack ulang.
- Smoke test standar: jalankan exe ±8 detik, cek proses hidup + RAM wajar (~80MB
  idle), kill, bukakan folder di Explorer.

## 9. Standar Verifikasi (tidak boleh dilewati)

1. `npx tsc --noEmit` bersih.
2. Perubahan engine → harness Node: bundle via esbuild + decode sharp + CSV +
   asersi (unit) + bench di folder foto asli (distribusi + alasan per kategori).
3. Perubahan vonis → contact sheet (montase sharp + label) + inspeksi visual
   per foto yang pindah kategori; safety assertion (nol foto tajam di Rejects).
4. Perubahan UI → `node .agents/skills/impeccable/scripts/detect.mjs --json <file>`.
5. `npm run build` + `npm run pack` + smoke test exe.
6. Hapus SEMUA file harness/sheet sementara (`bench*`, `*sheet*.jpg`, `*test*.cjs`,
   `crop-*`, `face-*`) sebelum selesai — folder kerja harus bersih.

## 10. Keputusan User (mengikat, jangan dilanggar diam-diam)

- Fokus Picks + Rejects; Maybe 10–25% (bukan tong sampah, bukan police-box).
- Saat ragu → cenderung Reject (Rejects bisa direview; tidak ada hapus file).
- Duplikat/burst bagus = Maybe, TIDAK PERNAH auto-reject.
- Rejects hanya untuk cacat nyata: blur, tidak fokus, mata tertutup, subjek tak siap,
  exposure hancur, frame kosong.
- Mode = Fast/Balance/High; utak-atik HANYA mode yang diminta (lainnya bit-identik).
- Konten non-manusia = deteksi OTOMATIS (tanpa toggle manual).
- Waktu proses boleh lama asal maksimal (tapi tetap jaga STD verifikasi di atas).
- Bahasa: UI Indonesia default; dokumen repo Inggris; MEMORY/ARCHITECTURE Indonesia.

## 11. Roadmap Terbuka

ONNX ultraface (DirectML) · decode pratinjau RAW penuh · SQLite histori koreksi ·
auto-update · installer NSIS + code signing · deteksi layar · segmentasi subjek ·
deteksi tilt · kebijakan duplikat-burst→Rejects (DITAHAN — butuh persetujuan user
karena agresif) · eye-crop-zoom untuk wajah kecil (butuh lokalisasi wajah dulu).

## 12. PROTOKOL AUTO-UPDATE (untuk sesi berikutnya)

1. Baca file ini DULU sebelum mulai kerja apa pun.
2. Setiap selesai perubahan (kode, threshold, preset, struktur, hasil bench,
   gotcha, keputusan user): perbarui bagian yang relevan DI SESI YANG SAMA —
   jangan tunda.
3. Format entri baru: apa → kenapa (data/bukti) → dampak terukur → file terkait.
4. Perbarui juga `ARCHITECTURE.md` bila arsitektur/alur berubah, dan `PRODUCT.md`
   bila perilaku terlihat-user berubah.
5. Jaga bagian 6 (angka kalibrasi) selalu sinkron dengan kode terkini. Angka tanpa
   tanggal/verifikasi = hapus atau tandai usang.
