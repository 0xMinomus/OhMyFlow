<div align="center">
  <img src="public/logo.png" width="128" alt="OhMyFlow logo" />
  <h1>OhMyFlow</h1>
  <p><strong>AI Photo Culler untuk Windows — pilih foto terbaik 10× lebih cepat, 100% offline.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="version" />
    <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4" alt="platform" />
    <img src="https://img.shields.io/badge/runtime-Electron-47848F" alt="electron" />
    <img src="https://img.shields.io/badge/AI-100%25%20on--device-success" alt="on-device AI" />
    <img src="https://img.shields.io/badge/license-MIT-green" alt="license" />
  </p>
</div>

---

## Tentang

OhMyFlow adalah aplikasi desktop Windows untuk **menyeleksi (culling) ribuan foto hasil pemotretan dalam hitungan menit**. Cukup arahkan ke folder foto — OhMyFlow memilahnya menjadi tiga kategori:

| Kategori | Arti |
|----------|------|
| 🟢 **Picks** | Foto terbaik: tajam, eksposur bagus, komposisi layak |
| 🟡 **Maybe** | Meragukan: perlu keputusan manual sekilas |
| 🔴 **Rejects** | Gagal: blur, mata tertutup, gelap total, duplikat burst, frame kosong |

Hasil seleksi dapat **diekspor sebagai file XMP sidecar** (Rating 5/3/1 + Label Green/Yellow/Red) sehingga langsung terbaca di **Adobe Lightroom / Bridge / Camera Raw** — tanpa langkah tambahan. File asli tidak pernah dipindah, diubah, atau dihapus; yang ditulis hanya file `.xmp` di sampingnya.

Seluruh analisis kecerdasan buatan berjalan **di perangkat sendiri (on-device)** memakai ONNX Runtime + heuristik visi komputer klasik. Tidak ada foto yang diunggah ke internet, tidak ada API key, tidak ada biaya langganan.

## Fitur Utama

- **Culling otomatis 3 mode** — Fast (sortir awal), Balance (harian), High (seleksi akhir paling teliti), masing-masing dengan estimasi waktu live.
- **Deteksi konten otomatis** — foto manusia dinilai dengan logika wajah & mata; foto produk/objek (mulus, tanpa wajah) dinilai dengan logika exposure–komposisi–warna tanpa false-positive "mata tertutup".
- **Penilaian multi-sinyal** — ketajaman fokus (Laplacian + ketajaman subjek + kerapatan tepi), exposure & clipping highlight/shadow, keseimbangan putih, komposisi/framing, duplikat perceptual-hash, dan status mata.
- **Alasan per foto** — setiap keputusan disertai alasan dalam Bahasa Indonesia & Inggris (mis. *"Blur / tidak fokus"*, *"Duplikat / burst"*).
- **RAW+JPG pairing** — pasangan `IMG_1234.CR3` + `IMG_1234.JPG` dikenali sebagai satu foto dengan rating kompak.
- **Pindah file hasil seleksi** — pindahkan foto Picks (opsional: sertakan Maybe) ke folder baru; pasangan RAW+JPG dan file `.xmp` ikut terbawa, nama kembar diberi nomor otomatis.
- **Lightbox review** — klik foto untuk pratinjau resolusi penuh, navigasi keyboard (←/→, 1/2/3 untuk menilai, Esc tutup).
- **Thumbnail lazy + cache disk** — folder ribuan foto tetap ringan dibuka.
- **Bilingual** — Bahasa Indonesia & Inggris.

## Cara Kerja

1. **Pilih folder** — dari disk lokal atau langsung dari kartu memori.
2. **Pilih mode** — Fast / Balance / High (ada estimasi waktu per jumlah foto).
3. **Mulai Culling** — AI bekerja lokal; progres tampil real-time dan bisa dibatalkan.
4. **Review** — filter Picks / Maybe / Rejects, koreksi dengan sekali klik atau via lightbox.
5. **Ekspor** — tulis XMP untuk Lightroom, dan/atau pindahkan file Picks ke folder baru.

## Instalasi & Menjalankan

### Prasyarat

- Windows 10/11 64-bit
- [Node.js](https://nodejs.org/) 24+ (hanya untuk development / build dari source)
- GPU NVIDIA opsional (akselerasi otomatis bila tersedia; CPU tetap jalan)

### Menjalankan versi rilis (tanpa install tools)

Unduh `OhMyFlow.exe` dari halaman [Releases](../../releases), lalu jalankan langsung (portable, tanpa instalasi).

### Development dari source

```bash
git clone https://github.com/0xMinomus/OhMyFlow.git
cd OhMyFlow
npm install

# mode development (hot-reload)
npm run dev

# build aplikasi Windows (.exe portable di release/)
npm run pack
```

| Perintah | Fungsi |
|----------|--------|
| `npm run dev` | Vite dev server + Electron hot-reload |
| `npm run build` | Type-check + build renderer & main process |
| `npm run pack` | Build penuh + kemas `release/OhMyFlow-win32-x64/OhMyFlow.exe` |
| `npm start` | Jalankan hasil build (`dist/`) tanpa mengemas |

> 💡 **Coba cepat:** setelah `npm run dev`, arahkan aplikasi ke folder `test-photos/` (berisi foto contoh) untuk melihat alur kerja end-to-end.

## Format File Didukung

| Kategori | Ekstensi |
|----------|----------|
| Standar | `.jpg` `.jpeg` `.png` `.tiff` `.tif` `.webp` `.bmp` |
| Apple | `.heic` `.heif` |
| RAW | `.cr2` `.cr3` `.nef` `.arw` `.raf` `.dng` `.rw2` `.orf` `.pef` |

RAW tanpa pratinjau JPEG bawaan tetap diproses dan ditandai jelas; rating-nya ditulis ke XMP seperti biasa.

## Struktur Proyek

```
OhMyFlow/
├── electron/            # Main process: IPC, scan folder, thumbnail, XMP, pindah file
│   ├── main.ts
│   └── preload.ts       # Jembatan aman renderer ↔ main (contextBridge)
├── src/
│   ├── components/      # UI: folder picker, mode, grid, lightbox, modal, header
│   ├── lib/ai-engine/   # Mesin culling: blur, aesthetic, composition,
│   │                    #   duplicate, face, culler (orkestrasi + preset per mode)
│   ├── lib/thumbCache.ts
│   ├── store/           # State aplikasi
│   └── types/
├── public/logo.png      # Logo aplikasi
├── build/               # icon.ico + asset packaging Windows
└── test-photos/         # Foto contoh untuk uji coba cepat
```

## Privasi & Keamanan

- **100% offline** — tidak ada request jaringan untuk pemrosesan foto; internet hanya dibutuhkan sesekali untuk download tooling development, bukan oleh aplikasinya.
- **Tanpa API key / tanpa cloud** — semua model dan heuristik berjalan di CPU/GPU lokal.
- **Non-destruktif** — file foto asli tidak pernah diubah, dipindah, atau dihapus oleh proses culling maupun ekspor XMP. (Fitur *Pindah file* bersifat eksplisit, selalu menampilkan tujuan + jumlah file, dan memberi nomor otomatis pada nama kembar.)

## Roadmap

- [ ] Deteksi kedip tier-lanjut (lash-line modeling) untuk wedding candid
- [ ] Decode pratinjau RAW penuh (embedded JPEG extraction)
- [ ] Database SQLite untuk histori koreksi & pembelajaran preferensi
- [ ] Auto-update via electron-updater
- [ ] Installer NSIS + penandatanganan kode (code signing)

## Kontribusi

Kontribusi dipersilakan — fork, buat branch fitur (`git checkout -b fitur/nama-fitur`), commit dengan pesan yang jelas, lalu buka Pull Request. Untuk perubahan perilaku culling, sertakan hasil benchmark sebelum/sesudah pada folder uji agar bisa direview objektif.

## Lisensi

Dirilis di bawah lisensi [MIT](LICENSE).
