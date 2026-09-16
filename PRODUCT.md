# PRODUCT.md — OhMyFlow

> Penjelasan umum perangkat lunak: apa itu, untuk siapa, apa yang bisa dilakukan,
> dan bagaimana memakainya. Dokumen teknis ada di `ARCHITECTURE.md`;
> instruksi developer ada di `README.md`.

---

## 1. Apa itu OhMyFlow

OhMyFlow adalah **aplikasi desktop Windows untuk menyeleksi foto (photo culling)**.
Sehabis memotret — wedding 1.500 foto, katalog produk 74 foto, atau burst acara
367 foto — fotografer biasanya menghabiskan waktu berjam-jam hanya untuk memilih
foto mana yang layak diedit dan mana yang dibuang. OhMyFlow mengerjakan
penyortiran awal itu dalam hitungan menit, berjalan sepenuhnya di laptop sendiri.

## 2. Untuk siapa

- **Fotografer wedding/event** yang pulang dengan ribuan frame dan butuh seleksi
  akhir yang tegas (mode High).
- **Pelaku usaha/katalog produk** (keramik, makanan, fashion) yang memotret banyak
  varian dan butuh yang terbaik saja yang lolos.
- **Pengguna kasual** (kamera saku, dokumentasi keluarga) yang ingin sortir cepat
  tanpa belajar software rumit.

Syarat satu-satunya: memakai Windows 10/11 64-bit. Tidak perlu akun, tidak perlu
internet, tidak perlu kartu grafis khusus (GPU hanya mempercepat bila ada).

## 3. Cara kerja (5 langkah)

1. **Pilih folder** — dari hardisk atau langsung dari kartu memori.
2. **Pilih mode** — Fast (sortir awal), Balance (harian), atau High (seleksi akhir).
   Setiap mode menampilkan estimasi waktu sesuai jumlah foto.
3. **Mulai Culling** — kecerdasan buatan lokal menganalisis tiap foto; progres
   tampil real-time dan bisa dibatalkan kapan saja.
4. **Review** — hasil terbagi tiga: **Picks** (terbaik), **Maybe** (meragukan,
   perlu lirik sekilas), **Rejects** (gagal). Setiap foto disertai alasan
   berbahasa Indonesia/Inggris, misalnya *"Blur / tidak fokus"* atau
   *"Duplikat / burst"*. Koreksi cukup sekali klik, atau lewat pratinjau besar
   (lightbox) dengan keyboard yang bisa dikustom (default Q/W/E) atau
   controller (mis. PS: L1/R1 pindah, Kotak/Segitiga/Bulat nilai).
5. **Ekspor** — tulis hasilnya sebagai file XMP agar langsung terbaca di Adobe
   Lightroom, dan/atau pindahkan file Picks ke folder baru.

## 4. Yang dinilai dari tiap foto

| Aspek | Contoh vonis |
|---|---|
| Ketajaman & fokus | Blur, tidak fokus, agak lunak — termasuk versi yang lebih lunak dari kembarannya di burst yang sama |
| Mata | Mata tertutup (hanya bila terbukti kuat, bukan tebakan). Wajah besar yang matanya tak terbaca (mode High) ditahan untuk lirik manual |
| Exposure | Terlalu gelap, highlight pecah, kontras kasar malam hari — termasuk panggung gelap yang exposure-nya hancur (mode High) |
| Komposisi | Subjek menumpuk di sudut, terlalu kecil, terpotong tepi, horizon miring |
| Duplikat | Frame nyaris identik dari burst (yang terbaik dipertahankan) |
| Kebersihan frame | Frame kosong/hitam total |

Khusus foto **non-manusia** (produk, makanan, keramik), aplikasi otomatis memakai
penilaian objek: tekstur tidak dinilai (glasir mulus bukan blur), yang dinilai
adalah pencahayaan, komposisi, dan warna — termasuk toleransi untuk latar putih
studio dan warna pastel yang memang disengaja.

## 5. Mode culling

| Mode | Kegunaan | Karakter |
|---|---|---|
| **Fast** | Sortir awal ribuan foto | Tercepat, paling pemaaf; hanya yang jelas gagal dibuang |
| **Balance** | Pemakaian harian | Seimbang dan objektif untuk semua jenis foto |
| **High** | Seleksi akhir sebelum edit | Paling teliti dan paling berani me-reject; analisis resolusi terbesar |

## 6. Format & kompatibilitas

- Foto: JPEG, PNG, TIFF, WebP, BMP, HEIC/HEIF, dan RAW (CR2/CR3/NEF/ARW/RAF/DNG/
  RW2/ORF/PEF). Pasangan RAW+JPG dikenali sebagai satu foto.
- Hasil: file `.xmp` sidecar standar industri (Rating 5/3/1 + Label
  Green/Yellow/Red) — terbaca Lightroom, Bridge, dan Camera Raw tanpa konversi.
- File asli **tidak pernah** diubah, dipindah, atau dihapus oleh proses culling
  maupun ekspor. Fitur *Pindah file* bersifat eksplisit dan selalu menampilkan
  tujuan serta jumlah file sebelum berjalan.

## 7. Privasi

Privasi adalah fitur, bukan janji manis: tidak ada akun, tidak ada server, tidak
ada unggahan. Foto klien wedding tetap di laptop. Aplikasi tidak butuh koneksi
internet untuk bekerja.

## 8. Batasan yang diketahui

- Foto **layar HP/tablet** dan **subjek-bergerak-dengan-background-tajam** sulit
  dinilai heuristik dan biasanya jatuh di Maybe — perlu lirik manual sekilas.
- Mata pada wajah yang sangat kecil/jauh tidak selalu terbaca; yang tidak terbaca
  tidak divonis (jatuh ke Maybe, bukan Rejects).
- Detail teknis dan batasan tiap algoritma didokumentasikan di `ARCHITECTURE.md`.

## 9. Status & lisensi

- Versi: **1.0.0** — aplikasi desktop Windows portable (`.exe`, tanpa instalasi).
- Lisensi: **MIT** (lihat `LICENSE`) — bebas dipakai, diubah, dan
  didistribusikan, termasuk untuk keperluan komersial.
