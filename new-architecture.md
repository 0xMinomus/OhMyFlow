# NEW-ARCHITECTURE.md — OhMyFlow Culling Engine v2

> Proposal arsitektur generasi berikutnya untuk meningkatkan kualitas photo culling OhMyFlow.
>
> Dokumen ini **bukan instruksi untuk langsung menulis ulang seluruh aplikasi**. Tujuannya adalah menjadi spesifikasi evaluasi, migration plan, dan target architecture untuk mengatasi masalah utama yang ditemukan pada engine saat ini:
>
> - terlalu sedikit foto masuk **Reject**,
> - terlalu banyak foto masuk **Maybe**,
> - sebagian foto kurang bagus masih masuk **Pick**,
> - burst/duplicate belum benar-benar memilih frame terbaik,
> - evaluasi ketajaman masih terlalu bergantung pada seluruh frame,
> - resolusi analisis terlalu rendah untuk micro-focus, mata, dan motion blur,
> - calibration metric saat ini lebih banyak mengukur distribusi hasil daripada kebenaran hasil.
>
> Konteks arsitektur lama: `ARCHITECTURE.md`  
> Konteks produk: `PRODUCT.md`
>
> Status dokumen: **proposal evaluasi / arsitektur v2**, bukan source of truth produksi sampai selesai divalidasi.

---

# 0. Ringkasan Eksekutif

Masalah terbesar OhMyFlow saat ini bukan sekadar nilai threshold.

Engine v1 secara desain sangat konservatif: lebih memilih memasukkan foto meragukan ke `Maybe`, atau bahkan tetap `Pick`, daripada berisiko melakukan false reject. Filosofi ini aman, tetapi kurang cocok untuk tujuan mode **High**, yang di produk didefinisikan sebagai seleksi akhir yang tegas.

Pada dataset event yang terdokumentasi sebelumnya, distribusi High sekitar:

```text
968 Pick
303 Maybe
7 Reject
```

dari 1278 foto.

Distribusi seperti ini menunjukkan bahwa mode High saat ini lebih dekat ke:

> “flag foto yang benar-benar rusak”

daripada:

> “pilihkan frame yang benar-benar layak dipertahankan.”

Arsitektur v2 mengubah konsep inti culling dari hanya:

```text
Absolute technical quality
```

menjadi gabungan:

```text
Absolute technical quality
        +
Relative quality dibanding frame sejenis / burst
        +
Confidence / uncertainty
```

Sehingga sebuah foto dapat masuk Reject bukan hanya karena rusak secara teknis, tetapi juga karena:

- kalah tajam dari frame lain pada burst yang sama,
- ekspresi kurang bagus dibanding alternatifnya,
- mata kurang baik dibanding frame tetangga,
- komposisi lebih buruk dari alternatif yang sangat mirip,
- merupakan near-duplicate yang tidak menambah nilai,
- secara keseluruhan technically acceptable tetapi redundant.

Prinsip penting:

> **Reject tidak berarti “foto rusak”. Reject berarti “foto ini tidak layak dipertahankan dalam konteks culling ini.”**

---

# 1. Tujuan Arsitektur v2

Target utama engine baru:

1. Mengurangi foto buruk yang salah masuk `Pick`.
2. Mengurangi jumlah `Maybe` yang sebenarnya cukup jelas dapat diputuskan.
3. Meningkatkan jumlah `Reject` secara **cerdas**, bukan sekadar dengan menaikkan threshold.
4. Memilih frame terbaik dari burst / near-duplicate.
5. Menilai ketajaman berdasarkan **subject-of-interest**, bukan background.
6. Menggunakan resolusi analisis yang cukup untuk mata, wajah, micro-blur, dan motion blur.
7. Menjadikan `Maybe` sebagai kategori uncertainty sungguhan.
8. Mempertahankan seluruh proses secara lokal tanpa API/cloud.
9. Tetap aman terhadap foto bagus: false reject harus diukur, bukan hanya diasumsikan.
10. Memiliki calibration methodology yang berbasis ground truth manusia.
11. Menjaga determinisme sejauh komponen yang digunakan memungkinkan.
12. Tidak mengubah user flow utama aplikasi.

---

# 2. Non-Goal

Proposal ini **tidak** bermaksud:

- mengubah UI utama,
- menambah akun,
- menambah cloud processing,
- menggunakan API AI eksternal,
- menghapus sistem XMP,
- memindahkan atau menghapus foto otomatis,
- mengganti Electron hanya demi arsitektur AI,
- membuat generative AI,
- melakukan editing foto,
- membuat sistem aesthetic scoring subjektif ekstrem,
- menjadikan model ML sebagai satu-satunya sumber keputusan.

Heuristik yang sudah baik tetap dapat dipertahankan jika lulus evaluasi.

---

# 3. User Flow Tetap Dikunci

User flow **tidak boleh berubah**:

```text
Pilih folder
    ↓
Pilih mode
    ↓
Culling
    ↓
Review
    ↓
Export XMP / Move
```

Perubahan hanya terjadi pada engine internal.

State awal tetap sederhana.

Tidak boleh menambah setup AI yang membingungkan user.

---

# 4. Diagnosis Engine Saat Ini

## 4.1 Filosofi false-reject terlalu konservatif

Constraint lama:

```text
tidak ada foto tajam di Rejects
```

tidak cukup tepat untuk photo culling.

Foto tajam belum tentu foto yang layak dipertahankan.

Contoh:

```text
Burst 10 frame
semua cukup tajam
1 frame punya ekspresi + timing terbaik
9 sisanya redundant
```

Arsitektur lama cenderung menahan sebagian besar frame sebagai Maybe.

Arsitektur baru harus memakai prinsip:

```text
Jangan salah Reject foto yang punya nilai unik atau merupakan kandidat terbaik.
```

Bukan:

```text
Jangan Reject foto tajam.
```

---

## 4.2 Duplicate policy terlalu lemah

Policy lama:

```text
duplicate bagus → Maybe
```

menjadikan Maybe sebagai penampung burst.

Masalah:

- fotografer tetap harus mengecek banyak frame,
- tidak ada konsep relative winner,
- tidak ada cluster rank,
- tidak ada redundancy penalty yang cukup tegas,
- technically acceptable duplicate tidak pernah dibuang.

Solusi:

```text
detect cluster
→ compare anggota cluster
→ rank
→ tentukan keeper
→ Maybe hanya bila ranking tidak meyakinkan
→ Reject redundant frame yang jelas kalah
```

---

## 4.3 Weighted score dapat menyembunyikan cacat penting

Weighted average memungkinkan:

```text
wajah bagus
+ exposure bagus
+ warna bagus
```

menutupi:

```text
focus subjek buruk
atau
komposisi sangat buruk
```

Karena itu v2 tidak hanya memakai total score.

Harus ada:

```text
global score
+
critical gates
+
score caps
+
relative rank
+
confidence
```

---

## 4.4 Eye UNKNOWN terlalu positif

Status mata secara konseptual harus:

```text
OPEN    = bukti positif
CLOSED  = bukti negatif
UNKNOWN = tidak ada bukti
```

UNKNOWN tidak seharusnya menerima nilai yang hampir sama dengan OPEN.

Unknown sebaiknya:

- netral terhadap score,
- mengurangi confidence,
- dapat mencegah Pick jika mata merupakan faktor penting,
- tetapi tidak otomatis Reject.

---

## 4.5 Fokus terlalu frame-centric

Kasus klasik:

```text
background tajam
subject bergerak / soft
```

dapat menghasilkan global sharpness cukup tinggi.

Engine perlu menjawab:

> “Apakah subjek yang seharusnya tajam memang tajam?”

bukan hanya:

> “Apakah ada banyak detail tajam pada frame?”

---

## 4.6 Analysis image terlalu kecil

UI thumbnail dan analysis image tidak seharusnya menjadi aset yang sama.

Thumbnail kecil dan highly compressed bagus untuk grid.

Tetapi tidak ideal untuk:

- mata,
- micro-focus,
- eyelashes,
- pupil,
- motion blur ringan,
- focus miss ringan,
- skin detail,
- expression cues.

---

## 4.7 Kalibrasi belum memiliki ground truth formal

Distribusi:

```text
Pick / Maybe / Reject
```

tidak memberitahu apakah prediksi benar.

Arsitektur v2 wajib memiliki manually labeled benchmark.

---

# 5. Filosofi Culling Baru

Engine v2 menggunakan tiga lapisan keputusan.

## 5.1 Absolute Quality

Menjawab:

> Seberapa baik foto ini secara mandiri?

Komponen:

- subject sharpness,
- global sharpness,
- face quality,
- eye state,
- exposure,
- clipping,
- color,
- composition,
- accidental frame detection,
- tilt,
- technical anomalies.

---

## 5.2 Relative Quality

Menjawab:

> Jika dibandingkan dengan foto yang sangat mirip, apakah foto ini masih layak dipertahankan?

Komponen:

- duplicate similarity,
- burst membership,
- subject similarity,
- face similarity bila tersedia,
- temporal adjacency,
- relative sharpness,
- relative eye quality,
- relative composition,
- relative exposure,
- total relative score.

---

## 5.3 Confidence

Menjawab:

> Seberapa yakin engine terhadap keputusan ini?

Contoh:

```text
sharpness: high confidence
face detected: medium
eyes: unknown
burst membership: high
composition: medium
```

Engine tidak boleh menyamakan:

```text
nilai bagus
```

dengan:

```text
keyakinan tinggi.
```

---

# 6. Pipeline Tingkat Tinggi

```text
SOURCE IMAGE
    │
    ├────────────────────────────────────────┐
    │                                        │
    ▼                                        ▼
UI THUMBNAIL                           ANALYSIS INPUT
480px / q~60                      768–1280px / quality tinggi
    │                                        │
    │                                        ▼
    │                              PASS 1 — FAST ANALYSIS
    │                                        │
    │                         ┌──────────────┼──────────────┐
    │                         ▼              ▼              ▼
    │                    Whole Frame     Subject/Face    dHash/pHash
    │                         │              │              │
    │                         └──────────────┼──────────────┘
    │                                        ▼
    │                                Preliminary Result
    │                                        │
    │                    ┌───────────────────┴───────────────────┐
    │                    │                                       │
    │               confident                             ambiguous
    │                    │                                       │
    │                    ▼                                       ▼
    │              keep result                     PASS 2 — DETAIL ANALYSIS
    │                                                    1024–1600px crop
    │                                                           │
    │                                           eyes / face / focus / motion
    │                                                           │
    └───────────────────────────────────────────────────────────┤
                                                                ▼
                                                        Absolute Score
                                                                │
                                                                ▼
                                                      Burst Clustering
                                                                │
                                                                ▼
                                                       Relative Ranking
                                                                │
                                                                ▼
                                                       Confidence Engine
                                                                │
                                                                ▼
                                                 Pick / Maybe / Reject
```

---

# 7. Pemisahan UI Thumbnail dan Analysis Preview

## 7.1 UI Thumbnail

Tetap:

- kecil,
- cepat,
- cached,
- lazy,
- cukup untuk grid.

Contoh:

```text
maxSide: 480
JPEG quality: 60–70
```

---

## 7.2 Analysis Preview

Buat pipeline terpisah.

Starting proposal:

### Fast

```text
maxSide: 640
```

### Balanced

```text
maxSide: 896
```

### High

```text
maxSide: 1280
```

Nilai final harus ditentukan lewat benchmark.

Jangan menganggap angka di atas sebagai final threshold.

---

## 7.3 Detail Crop

Jika face/subject terdeteksi dan hasil ambigu:

- decode image lebih besar bila diperlukan,
- crop ROI saja,
- hindari full-frame high-res processing jika tidak perlu.

Contoh:

```text
face ROI → effective 256–512px face crop
```

lebih berguna daripada full frame 1280px jika wajah kecil.

---

# 8. Adaptive Two-Pass Analysis

Tujuan:

- meningkatkan kualitas,
- menjaga performa untuk 1000–5000 foto.

## Pass 1

Analisis murah:

- luminance,
- clipping,
- global focus,
- subject candidates,
- face detector,
- dHash/pHash,
- basic composition,
- accidental detection.

Jika:

```text
sangat jelas bagus
atau
sangat jelas buruk
```

tidak perlu Pass 2.

---

## Pass 2 Trigger

Jalankan detail analysis jika salah satu:

```text
score dekat threshold
face ada tetapi eye unknown
global sharp tetapi subject sharpness meragukan
burst ranking sangat dekat
face kecil
high mode
motion ambiguity
composition ambiguity
```

Pass 2 fokus pada ROI.

---

# 9. Subject Detection Layer

Engine v1 terlalu bergantung pada skin heuristic dan gradient interest.

Engine v2 sebaiknya memiliki abstraksi:

```ts
interface SubjectDetection {
  type: 'face' | 'person' | 'object' | 'unknown'
  box: Rect
  confidence: number
  importance: number
}
```

Urutan prioritas untuk foto manusia:

```text
Face
↓
Person
↓
Visual subject heuristic
↓
Whole frame fallback
```

---

# 10. Face Detection Lokal

Disarankan menggunakan model ONNX lokal yang ringan.

Requirement:

- offline,
- redistributable sesuai lisensi,
- CPU friendly,
- opsional DirectML,
- deterministic inference sebisa mungkin,
- tidak mengirim data ke luar.

Jangan hard-code architecture ke satu model sebelum benchmark.

Buat adapter:

```ts
interface FaceDetector {
  detect(image: ImageTensor): Promise<FaceDetection[]>
}
```

Dengan begitu model dapat diganti tanpa mengubah culler.

---

# 11. Person Detection Opsional

Face detection tidak selalu cukup:

- subjek membelakangi kamera,
- full body,
- wajah terlalu kecil,
- tari / olahraga,
- silhouette.

Person detector dapat menjadi tahap opsional.

Gunakan hanya jika:

- performa masih memenuhi target,
- terbukti memperbaiki ROI focus,
- false positive terkendali.

---

# 12. Subject-Aware Sharpness

Sharpness v2 harus menghasilkan setidaknya:

```ts
interface SharpnessResult {
  global: number
  subject: number | null
  face: number | null
  edge: number
  motionLikelihood: number
  confidence: number
}
```

Prioritas:

```text
face sharpness jika face dominant
↓
subject sharpness jika subject detected
↓
center/interest sharpness
↓
global fallback
```

---

# 13. Critical Focus Gate

Untuk foto manusia:

```text
subject/face focus terlalu rendah
→ tidak boleh Pick
```

Walaupun aesthetic tinggi.

Contoh konsep:

```text
if humanPhoto && subjectFocus < criticalMinimum:
    maxVerdict = MAYBE
```

Jika sangat buruk dan confidence tinggi:

```text
→ REJECT
```

Threshold harus dipelajari melalui dataset.

---

# 14. Motion Blur Detection

Laplacian saja tidak cukup.

Tambahkan feature yang membedakan:

- defocus blur,
- directional motion blur,
- low texture.

Potential features:

- directional gradient imbalance,
- edge spread,
- anisotropy,
- local frequency loss,
- subject-vs-background sharpness delta.

Tidak perlu langsung memakai neural model jika heuristik cukup.

---

# 15. Eye Analysis v2

Gunakan state:

```ts
type EyeState =
  | 'open'
  | 'closed'
  | 'partial'
  | 'unknown'
  | 'not_applicable'
```

Setiap state memiliki:

```ts
confidence: 0..1
```

---

## 15.1 Unknown tidak diberi reward

Jangan:

```text
open = 88
unknown = 78
```

Gunakan:

```text
OPEN    → positive signal
CLOSED  → negative signal
PARTIAL → context-dependent
UNKNOWN → zero evidence
```

---

## 15.2 Multi-face policy

Untuk group photo:

- jangan Reject hanya karena satu wajah sangat kecil unknown,
- prioritaskan wajah besar / dominant,
- cek proporsi wajah bermasalah,
- gunakan confidence.

Contoh:

```text
8 wajah
1 small-face unknown
→ tidak cukup untuk Reject

2 dominant face
1 dominant closed high-confidence
→ strong negative signal
```

---

# 16. Face Quality

Per face:

```ts
interface FaceQuality {
  detectionConfidence: number
  areaRatio: number
  sharpness: number
  exposure: number
  eyeState: EyeState
  eyeConfidence: number
  occlusionLikelihood?: number
}
```

Agregasi berdasarkan importance.

Wajah kecil tidak boleh memiliki influence sebesar close-up.

---

# 17. Exposure v2

Pertahankan aspek baik engine lama:

- global clipping,
- center clipping,
- edge clipping,
- white background handling,
- dark exposure handling.

Tambahkan:

```text
subject exposure
face exposure
```

Contoh:

```text
background terang
wajah underexposed
```

global exposure tidak boleh menyembunyikan masalah wajah.

---

# 18. Composition v2

Gradient interest map tetap berguna sebagai fallback.

Tetapi jika subject tersedia, composition harus subject-aware.

Feature:

- subject position,
- face position,
- margin terhadap border,
- headroom,
- crop risk,
- subject scale,
- dominant subject balance,
- multiple face distribution,
- horizon tilt.

---

# 19. Composition Tidak Boleh Terlalu Subjektif

Engine bukan art critic.

Hanya penalize hal dengan evidence kuat:

- kepala terpotong,
- wajah sangat dekat border,
- subjek nyaris keluar frame,
- frame accidental,
- horizon sangat miring jika memang horizon terdeteksi,
- subject terlalu kecil pada konteks portrait/event.

Jangan menghukum:

- intentional centering,
- negative space,
- unusual composition,
- crowd shot,
- asymmetry kreatif,

tanpa confidence kuat.

---

# 20. Duplicate dan Burst Engine v2

Ini merupakan perubahan terbesar.

## 20.1 Detection bukan Verdict

Perceptual hash hanya menentukan:

```text
foto mana yang mungkin berhubungan
```

bukan langsung:

```text
Maybe
```

---

## 20.2 Cluster

Buat:

```ts
interface BurstCluster {
  id: string
  members: PhotoId[]
  confidence: number
}
```

Membership dapat memakai gabungan:

- capture order,
- timestamp jika tersedia,
- filename adjacency,
- dHash,
- pHash opsional,
- visual similarity,
- face/person overlap.

---

## 20.3 Temporal Window

Untuk dataset event, burst biasanya berdekatan.

Gunakan sliding window untuk menghindari O(n²), tetapi cluster tidak boleh bergantung hanya pada urutan callback.

Determinisme harus dipertahankan.

---

# 21. Burst Relative Score

Untuk setiap anggota cluster:

```text
relativeScore =
    subjectSharpness
  + faceQuality
  + eyeQuality
  + exposure
  + composition
  + absoluteScore
```

Gunakan normalization dalam cluster.

Contoh:

```text
IMG_001  88
IMG_002  83
IMG_003  81
IMG_004  68
IMG_005  64
```

---

# 22. Keeper Selection

Mode High dapat menggunakan konsep:

```text
Primary Keeper
Secondary Candidate
Redundant Frames
```

Mapping:

```text
Primary Keeper      → Pick
Secondary Candidate → Maybe atau Pick
Redundant Frames    → Reject
```

Tetapi hanya jika cluster confidence cukup tinggi.

---

# 23. Jangan Memaksa Satu Keeper untuk Semua Cluster

Ada momen yang memang pantas memiliki beberapa keeper.

Contoh:

- sequence gerakan,
- ekspresi berubah nyata,
- subjek berbeda,
- composition berbeda,
- significant pose variation.

Karena itu cluster perlu sub-cluster / diversity guard.

---

# 24. Diversity Guard

Foto tidak boleh dianggap redundant jika memiliki perbedaan bermakna.

Feature potensial:

- face expression change,
- subject position change,
- pose change,
- crop/composition change,
- object arrangement change,
- large perceptual-distance jump.

Tujuan:

```text
similar ≠ redundant
```

---

# 25. Cluster Confidence

Jika cluster confidence rendah:

```text
jangan aggressive Reject
```

Gunakan Maybe.

Ini tempat Maybe yang benar.

---

# 26. Redefinisi Maybe

`Maybe` bukan:

> “foto yang engine takut buang.”

`Maybe` adalah:

> “foto yang engine memiliki evidence konflik atau confidence tidak cukup.”

Contoh valid Maybe:

- mata tidak terbaca,
- cluster ranking selisih sangat tipis,
- wajah sangat kecil,
- subject ambiguity,
- exposure borderline,
- frame punya unique composition tetapi kualitas teknis sedikit lebih rendah.

---

# 27. Critical Gates

Weighted score saja tidak boleh menentukan Pick.

Contoh gate:

```text
GATE 1
accidental frame high confidence
→ Reject

GATE 2
subject focus critically bad + high confidence
→ Reject

GATE 3
closed dominant eye + high confidence
→ Reject / Maybe berdasarkan mode

GATE 4
extreme exposure failure
→ Reject

GATE 5
strong redundant burst loser
→ Reject pada High

GATE 6
critical composition failure
→ max Maybe atau Reject jika sangat jelas
```

---

# 28. Score Caps

Contoh:

```text
subject focus borderline
→ maximum verdict = Maybe

eye unknown pada portrait close-up
→ maximum verdict = Maybe

cluster member tetapi ranking unresolved
→ maximum verdict = Maybe

face detector confidence sangat rendah
→ jangan gunakan face gate
```

---

# 29. Scoring Proposal

Jangan menganggap angka berikut final.

Starting structure:

```text
AbsoluteScore
  = TechnicalScore
  + SubjectScore
  + AestheticScore
  + CompositionScore
```

Contoh conceptual weighting untuk manusia:

```text
subject technical   35%
face/eye            25%
exposure/color      20%
composition         20%
```

Tetapi final verdict tetap melewati gates.

---

# 30. Separate Scoring Profiles

Jangan memakai weighting sama untuk semua scene.

Minimal profile:

```text
HUMAN
OBJECT
LANDSCAPE/SCENE
UNKNOWN
```

---

# 31. Human Profile

Prioritas:

1. face/subject focus,
2. eyes,
3. exposure wajah,
4. absolute exposure,
5. composition,
6. relative burst rank.

---

# 32. Object Profile

Prioritas:

1. exposure,
2. object edge sharpness,
3. color,
4. composition,
5. clipping,
6. duplicate relative rank.

Textureless surface tidak otomatis blur.

---

# 33. Scene Profile

Prioritas:

1. global sharpness,
2. exposure,
3. clipping,
4. horizon,
5. composition.

---

# 34. Unknown Profile

Conservative fallback.

Jika engine tidak yakin terhadap scene type:

- jangan mengambil keputusan agresif berdasarkan face/object heuristic,
- gunakan technical baseline,
- confidence lebih rendah.

---

# 35. Confidence Engine

Setiap module output:

```ts
interface Metric<T> {
  value: T
  confidence: number
  evidence?: string[]
}
```

Contoh:

```ts
eyes: {
  value: 'unknown',
  confidence: 0.22
}
```

bukan:

```text
eyeScore = 78
```

---

# 36. Decision Confidence

Final decision memiliki:

```ts
interface CullDecision {
  verdict: 'pick' | 'maybe' | 'reject'
  score: number
  confidence: number
  reasons: Reason[]
  clusterId?: string
  clusterRank?: number
}
```

---

# 37. Reason System

Reasons sebaiknya dipisahkan dari score.

Contoh reason code:

```text
SUBJECT_SOFT
GLOBAL_BLUR
MOTION_BLUR
EYES_CLOSED
EYES_UNCERTAIN
UNDEREXPOSED_SUBJECT
EXTREME_DARK
BLOWN_HIGHLIGHT
EDGE_CROP
TILT
BURST_REDUNDANT
BURST_SECOND_BEST
ACCIDENTAL_FRAME
```

UI menerjemahkan reason code.

---

# 38. Positive Evidence

Tidak hanya negative reason.

Internal diagnostic dapat menyimpan:

```text
SUBJECT_SHARP
EYES_OPEN
BEST_IN_BURST
GOOD_EXPOSURE
UNIQUE_FRAME
```

Tidak harus ditampilkan semua di UI.

---

# 39. Verdict Policy per Mode

## Fast

Tujuan:

```text
buang hanya obvious failure
```

Characteristics:

- low analysis resolution,
- minimal Pass 2,
- conservative duplicate handling,
- high false-reject protection.

---

## Balanced

Tujuan:

```text
general-purpose culling
```

Characteristics:

- subject-aware,
- moderate burst ranking,
- reasonable Maybe.

---

## High

Tujuan:

```text
final selection
```

Characteristics:

- high-res analysis,
- face/subject ROI,
- Pass 2 lebih sering,
- burst ranking aktif,
- redundant frame dapat Reject,
- strict Pick gate,
- Maybe hanya genuine ambiguity.

---

# 40. High Mode Tidak Boleh Sama dengan Threshold Lebih Tinggi Saja

High harus mengaktifkan **lebih banyak reasoning**, bukan sekadar:

```text
rejectBelow += 5
```

Perbedaan High:

- larger analysis image,
- detail ROI,
- stricter critical gates,
- relative burst selection,
- confidence-aware ranking,
- more expensive analysis allowed.

---

# 41. Data Model Proposal

```ts
interface PhotoAnalysisV2 {
  photoId: string

  scene: {
    type: 'human' | 'object' | 'scene' | 'unknown'
    confidence: number
  }

  sharpness: SharpnessResult

  exposure: {
    global: number
    subject?: number
    face?: number
    clippedHighlights: number
    clippedShadows: number
    confidence: number
  }

  composition: {
    score: number
    confidence: number
    cropRisk: number
    subjectScale?: number
    tilt?: number
  }

  faces: FaceQuality[]

  duplicate: {
    hash: string
    clusterId?: string
    similarity?: number
  }

  absoluteScore: number

  relative?: {
    clusterRank: number
    clusterSize: number
    relativeScore: number
    marginToBest: number
  }

  confidence: number
}
```

---

# 42. Pipeline Contracts

Pisahkan modules:

```text
decoder
scene-classifier
face-detector
person-detector
sharpness
motion
eyes
exposure
composition
duplicate
clusterer
relative-ranker
confidence
decision-engine
```

Tidak semua module harus ML.

---

# 43. Decoder Architecture

Buat dua decoder path:

```text
getUiThumbnail()
getAnalysisImage()
```

Jangan reuse lossy UI thumbnail untuk High analysis.

---

# 44. Decode Cache

Gunakan cache terpisah:

```text
thumbnail cache
analysis cache
ROI cache
```

Memory harus bounded.

Jangan menyimpan 1200 full analysis image sekaligus.

---

# 45. Streaming Analysis

Untuk folder besar:

```text
scan
→ bounded queue
→ analyze
→ release image memory
→ keep numeric features
→ cluster/rank
```

Jangan menahan raw pixels setelah feature extraction selesai.

---

# 46. Cluster Membutuhkan Dua Tahap

Karena relative ranking membutuhkan beberapa anggota:

### Stage A

Per-photo feature extraction.

### Stage B

Cross-photo clustering dan relative decision.

Sehingga final verdict sebaiknya dilakukan setelah cukup context tersedia.

---

# 47. Progressive UI

Walaupun final relative ranking dilakukan kemudian, progress UI dapat menampilkan:

```text
Analyzing 734 / 1200
```

Tidak perlu menampilkan verdict final sebelum ranking selesai.

Final step:

```text
Comparing similar frames...
```

jika memang dibutuhkan.

Tetapi user flow tidak berubah.

---

# 48. Metadata Capture

Saat scan, jika murah dan tersedia, simpan:

- filename,
- file size,
- mtime,
- EXIF capture time,
- dimensions,
- orientation,
- camera serial/model bila relevan,
- burst metadata jika tersedia.

Jangan bergantung pada metadata yang tidak selalu ada.

---

# 49. RAW Handling

Untuk RAW:

- gunakan embedded preview jika reliable,
- bedakan UI preview dan analysis preview,
- catat resolusi preview,
- jika preview terlalu kecil, confidence quality analysis harus turun,
- jangan berpura-pura memiliki full-res evidence.

---

# 50. Orientation

Normalisasi orientation sebelum:

- face detection,
- composition,
- dHash,
- sharpness.

Hash dari orientation yang salah dapat merusak duplicate grouping.

---

# 51. ONNX Runtime Layer

Buat wrapper generik:

```text
src/lib/ml/
  runtime.ts
  face-detector.ts
  person-detector.ts
  models/
```

Requirement:

- fallback CPU,
- optional DirectML,
- graceful failure,
- warmup,
- model version tracking.

---

# 52. ML Failure Harus Fail-Safe

Jika ONNX gagal:

```text
jangan crash culling
```

Fallback:

```text
heuristic pipeline v1-compatible
```

dan turunkan confidence.

---

# 53. Determinisme

Pertahankan prinsip:

- stable input ordering,
- stable cluster ordering,
- no random thresholds,
- no race-dependent append,
- fixed preprocessing,
- versioned model,
- deterministic tie breaker.

Tie breaker:

```text
score desc
capture order asc
filename asc
```

---

# 54. Reproducibility Metadata

Untuk debug internal, simpan:

```text
engineVersion
modelVersion
preset
thresholdVersion
analysisResolution
```

agar hasil benchmark dapat direproduksi.

---

# 55. Performance Target

Harus diukur, bukan diasumsikan.

Benchmark minimal:

```text
100 photos
500 photos
1200 photos
3000 photos
```

Hardware classes:

```text
low-end CPU
mid-range laptop
DirectML-capable GPU
```

Metrics:

- total culling duration,
- decode time,
- model inference,
- feature extraction,
- clustering,
- peak RAM,
- cache size.

---

# 56. Jangan Mengoptimalkan Kecepatan Sebelum Akurasi Terukur

Urutan:

```text
correctness
→ benchmark
→ optimize
```

Bukan:

```text
optimize heuristic
→ berharap akurat
```

---

# 57. Calibration Dataset v2

Wajib memiliki dataset berlabel manusia.

Minimal kategori:

```text
event daylight
event indoor/stage
burst
group photo
portrait
night
product
landscape
motion
difficult backlight
```

---

# 58. Human Ground Truth

Label secara manual:

```text
PICK
MAYBE
REJECT
```

Tambahkan bila memungkinkan:

```text
reason
burst group
keeper rank
```

Contoh CSV:

```text
file,humanVerdict,reason,cluster,humanRank
IMG_001.jpg,pick,best expression,12,1
IMG_002.jpg,reject,duplicate weaker,12,3
IMG_003.jpg,maybe,similar expression,12,2
```

---

# 59. Double Review

Untuk benchmark penting:

- lakukan review kedua beberapa hari kemudian, atau
- minta fotografer lain review subset.

Tujuan:

mengukur apakah ground truth sendiri konsisten.

Karena culling memang memiliki unsur subjektif.

---

# 60. Confusion Matrix

Wajib dihitung.

```text
                Human
             P     M     R
AI Pick
AI Maybe
AI Reject
```

---

# 61. Error yang Paling Berbahaya

Prioritas evaluasi:

```text
Human Pick → AI Reject
```

Ini false reject kritis.

Berikutnya:

```text
Human Reject → AI Pick
```

Ini menyebabkan software terasa tidak membantu.

---

# 62. Maybe Leakage

Metric baru:

```text
Maybe Leakage Rate
```

Berapa banyak Human Reject yang hanya dipindahkan AI ke Maybe.

Karena masalah saat ini bukan hanya false Pick, tetapi terlalu banyak pekerjaan dialihkan ke Maybe.

---

# 63. Useful Reduction Metric

Metric produk:

```text
Manual Review Reduction
```

Contoh:

```text
1200 source
AI menghasilkan:
240 Pick
90 Maybe
870 Reject

user hanya perlu fokus 330 foto
```

Ini lebih bermakna daripada hanya “akurasi”.

---

# 64. Burst Keeper Accuracy

Untuk cluster berlabel:

```text
Top-1 keeper accuracy
Top-2 keeper recall
```

Apakah frame terbaik menurut manusia berada di rank 1/2 engine.

---

# 65. False Reject Guard

Jangan lagi guard:

```text
0 foto tajam di Reject
```

Gunakan:

```text
Human Pick → AI Reject rate <= target
```

Target final ditentukan setelah baseline tersedia.

---

# 66. Evaluation Report

Setiap perubahan threshold/model menghasilkan:

```text
engine version
dataset
mode
confusion matrix
Pick/Maybe/Reject distribution
false reject
reject-to-pick error
maybe leakage
burst keeper accuracy
processing time
peak RAM
```

---

# 67. Contact Sheet Tetap Dipertahankan

Contact sheet masih sangat berguna.

Buat otomatis untuk:

- false rejects,
- false picks,
- Maybe leakage,
- burst disagreements,
- largest score changes.

---

# 68. Golden Regression Set

Setelah bug diperbaiki, foto kasus tersebut masuk golden set.

Contoh:

```text
background sharp / subject blur
white studio ceramic
orange wall false face
closed eyes
night bokeh
screen photo
backlit group
```

Jangan hapus test case penting.

---

# 69. Threshold Tuning

Jangan tuning hanya berdasarkan jumlah Reject yang diinginkan.

Salah:

```text
ingin reject 40%
→ naikkan rejectBelow
```

Benar:

```text
minimize weighted classification error
+
control false reject
+
reduce Maybe leakage
```

---

# 70. Threshold Versioning

Simpan:

```text
thresholdProfile: v2.1
```

agar benchmark bisa dibandingkan.

---

# 71. Calibration Jangan Dilakukan Hanya pada Dataset yang Sama

Pisahkan:

```text
training/tuning dataset
validation dataset
holdout test dataset
```

Walaupun tidak ada training neural network.

Ini mencegah threshold overfit.

---

# 72. Recommended Dataset Split

Contoh:

```text
60% tuning
20% validation
20% holdout
```

Atau split berdasarkan shoot, bukan foto acak.

Penting:

foto satu burst jangan tersebar ke train/test karena data leakage.

---

# 73. Decision Engine Pseudocode

```ts
function decide(photo, context, mode): CullDecision {
  const a = photo.analysis

  if (highConfidenceAccidental(a))
    return reject('ACCIDENTAL_FRAME')

  if (criticalExposureFailure(a, mode))
    return reject('EXTREME_EXPOSURE')

  if (criticalSubjectFocusFailure(a, mode))
    return reject('SUBJECT_SOFT')

  if (dominantClosedEyes(a, mode))
    return mode === 'fast'
      ? maybe('EYES_CLOSED')
      : reject('EYES_CLOSED')

  const absolute = calculateAbsoluteScore(a, mode)
  const relative = calculateRelativeScore(photo, context, mode)

  if (strongRedundantLoser(relative, mode))
    return reject('BURST_REDUNDANT')

  const cap = determineVerdictCap(a, relative, mode)

  const candidate = scoreToCandidate(
    combineScores(absolute, relative, mode)
  )

  const verdict = applyCap(candidate, cap)

  return {
    verdict,
    score: ...,
    confidence: calculateDecisionConfidence(...),
    reasons: ...
  }
}
```

Pseudocode hanya menggambarkan struktur, bukan threshold final.

---

# 74. Burst Ranking Pseudocode

```ts
function rankCluster(cluster) {
  const ranked = cluster.members
    .map(photo => ({
      photo,
      score: calculateKeeperScore(photo)
    }))
    .sort(stableRanking)

  const best = ranked[0]

  for (const item of ranked) {
    item.marginToBest = best.score - item.score
    item.diversityFromBest = measureDiversity(best.photo, item.photo)
  }

  return ranked
}
```

Kemudian:

```text
small margin + meaningful diversity
→ keep / maybe

large margin + low diversity
→ reject
```

---

# 75. UX Reasons untuk Burst

User-facing examples:

```text
"Frame serupa — versi lain lebih tajam"
"Frame serupa — ekspresi lain lebih baik"
"Duplikat / burst"
```

Jangan memberi klaim spesifik jika module tidak punya evidence.

---

# 76. Explainability

Setiap Reject harus memiliki minimal satu strong reason.

Internal:

```ts
reason.evidenceStrength
```

Jika evidenceStrength terlalu rendah:

```text
Reject → Maybe
```

---

# 77. Avoid Fake Precision

UI tidak harus menunjukkan:

```text
87.432%
```

Score internal boleh detail.

UI cukup:

```text
82
```

atau tidak ditampilkan jika tidak berguna.

---

# 78. Manual Override Tetap First-Class

User correction tidak boleh dianggap error.

Simpan koreksi untuk:

- review session,
- optional local calibration,
- future personalization.

Tetapi jangan otomatis belajar tanpa desain yang jelas.

---

# 79. Future Local Personalization

Opsional setelah v2 stabil:

```text
user consistently moves certain Maybe → Pick
user rejects certain composition patterns
```

Local preference profile dapat dibuat.

Namun jangan masuk fase awal.

---

# 80. SQLite History

Roadmap SQLite dapat digunakan untuk menyimpan:

```text
session
analysis result
manual correction
engine version
```

Dengan ini dapat dihitung:

```text
correction rate per mode
```

tanpa mengirim data keluar.

---

# 81. Privacy

Tetap:

- zero network processing,
- no telemetry default,
- no upload,
- no remote AI API.

Jika suatu hari telemetry ditambahkan:

```text
harus opt-in eksplisit
```

tetapi bukan bagian proposal ini.

---

# 82. Security

Model files:

- packaged locally,
- checksum/version validation,
- no runtime arbitrary download.

Renderer tetap tidak memiliki unrestricted filesystem access.

---

# 83. Proposed Folder Structure

Contoh target:

```text
src/lib/culling/
  pipeline/
    pass1.ts
    pass2.ts
    analysis-pipeline.ts

  vision/
    sharpness.ts
    motion.ts
    exposure.ts
    composition.ts
    subject.ts

  ml/
    runtime.ts
    face-detector.ts
    person-detector.ts

  face/
    face-quality.ts
    eyes.ts

  duplicate/
    hash.ts
    cluster.ts
    diversity.ts
    rank.ts

  decision/
    scoring.ts
    confidence.ts
    gates.ts
    verdict.ts
    reasons.ts
    presets.ts

  calibration/
    metrics.ts
    confusion.ts
    benchmark.ts

  types.ts
```

Sesuaikan dengan struktur repo aktual.

Jangan melakukan rename besar tanpa alasan.

---

# 84. Migration Strategy

Jangan rewrite sekaligus.

## Phase 0 — Baseline

Sebelum perubahan:

- jalankan current engine,
- simpan hasil benchmark,
- simpan runtime,
- simpan distribusi,
- buat manually labeled dataset.

**Tidak boleh lanjut jika baseline belum ada.**

---

## Phase 1 — Evaluation Harness

Bangun evaluator:

```text
AI result
vs
human labels
```

Output:

- confusion matrix,
- false reject,
- false pick,
- Maybe leakage,
- correction rate,
- burst keeper metrics.

---

## Phase 2 — Separate Analysis Decode

Pisahkan:

```text
UI thumbnail
analysis image
```

Jangan ubah verdict dulu.

Ukur dampak.

---

## Phase 3 — Subject-Aware Focus

Tambahkan:

- face ROI,
- subject ROI,
- subject focus.

Bandingkan dengan baseline.

---

## Phase 4 — Confidence Refactor

Hilangkan konsep seperti:

```text
unknown eye = positive score
```

Ganti evidence + confidence.

---

## Phase 5 — Burst Cluster + Ranking

Implementasikan relative culling.

Awalnya jangan Reject otomatis.

Hanya:

```text
rank + diagnostics
```

Bandingkan dengan human burst labels.

Setelah akurat:

aktifkan Reject pada High.

---

## Phase 6 — High Decision Policy

Aktifkan:

- strict Pick gates,
- burst redundant reject,
- confidence caps.

---

## Phase 7 — Performance Optimization

Setelah quality stabil:

- batching,
- worker threads,
- DirectML,
- cache tuning,
- adaptive Pass 2.

---

# 85. Feature Flags

Gunakan flag internal:

```text
V2_ANALYSIS_IMAGE
V2_FACE_ROI
V2_CONFIDENCE
V2_BURST_RANK
V2_HIGH_VERDICT
```

Agar perubahan dapat diuji satu per satu.

---

# 86. Shadow Mode

Sebelum mengganti engine:

```text
v1 verdict digunakan UI
v2 berjalan internal
```

Bandingkan output.

Jika terlalu mahal, gunakan hanya calibration harness.

---

# 87. Acceptance Criteria

V2 tidak boleh dinyatakan berhasil hanya karena Reject bertambah.

Minimal harus terbukti:

1. `Human Reject → AI Pick` turun.
2. `Human Pick → AI Reject` tetap di bawah safety target.
3. Maybe leakage turun.
4. Burst keeper accuracy naik.
5. Manual review set mengecil.
6. Runtime masih layak.
7. Determinism regression test lolos.
8. Tidak merusak product/object photo.
9. Tidak merusak white background logic.
10. Tidak meningkatkan false face detection signifikan.

---

# 88. Jangan Mengejar Distribusi Tetap

Tidak ada aturan:

```text
20% Pick
10% Maybe
70% Reject
```

Shoot berbeda memiliki kualitas berbeda.

Target engine adalah keputusan benar.

Distribusi hanya diagnostic.

---

# 89. Namun Distribusi Ekstrem Adalah Warning

Contoh:

```text
1200 event images
6 Reject
```

bukan otomatis bug,

tetapi layak dicurigai jika human ground truth menunjukkan jauh lebih banyak frame redundant/buruk.

---

# 90. Mode Semantics yang Disarankan

### Fast

> Temukan foto yang jelas gagal.

### Balanced

> Pilih foto teknis yang layak dan kurangi redundancy ringan.

### High

> Pilih frame terbaik dan singkirkan foto yang kalah atau redundant.

Ini lebih jelas daripada sekadar “sensitivity”.

---

# 91. Product Copy Future

Jika dibutuhkan nanti:

```text
FAST
Safe first pass

BALANCED
Everyday selection

HIGH
Final keeper selection
```

Tidak wajib mengubah UI sekarang.

---

# 92. Edge Cases Wajib Diuji

- crowd,
- group photo,
- close-up,
- portrait shallow DOF,
- backlight,
- stage lighting,
- nightclub,
- silhouette,
- product white background,
- pastel ceramic,
- smooth glossy surface,
- moving dancer,
- panning shot,
- intentional motion blur,
- landscape,
- architecture,
- photo of screen,
- phone screenshot,
- accidental black frame,
- lens cap,
- flash misfire,
- duplicate export,
- RAW+JPG pair,
- rotated EXIF,
- corrupt image.

---

# 93. Intentional Blur

Tidak semua blur buruk.

Contoh:

- panning,
- creative motion,
- background bokeh.

Engine harus membedakan:

```text
subject blur
vs
background blur
```

sebisa mungkin.

Jika tidak yakin:

```text
Maybe
```

bukan aggressive Reject.

---

# 94. Background Bokeh

Bokeh tidak boleh menurunkan sharpness jika wajah/subjek tajam.

Subject ROI menyelesaikan sebagian besar masalah ini.

---

# 95. Product Smooth Surface

Pertahankan proteksi object-mode.

Tetapi object detection harus dinilai ulang setelah subject detector baru tersedia.

---

# 96. Composition untuk Group

Jangan memakai single-subject assumptions.

Jika multiple face tersebar:

- group bounding box,
- edge crop,
- face clipping,
- overall distribution.

---

# 97. Exposure untuk Stage

Stage photography sering memiliki:

- dark background,
- bright spotlight.

Jangan menilai mean luminance saja.

Gunakan subject exposure dan clipping.

---

# 98. Night Photo

Night bukan otomatis underexposed.

Bedakan:

```text
intentional dark scene
vs
subject technically unreadable
```

---

# 99. Diagnostics Mode

Buat internal/debug-only output:

```text
photo
scene
face boxes
subject focus
global focus
eye states
absolute score
cluster id
cluster rank
confidence
verdict
reasons
```

Sangat penting untuk calibration.

---

# 100. Visual Overlay Debug

Optional dev tool:

- subject box,
- face box,
- eye ROI,
- composition interest,
- focus heatmap.

Tidak perlu masuk production UI.

---

# 101. Calibration CSV

Contoh:

```text
filename,
humanVerdict,
aiVerdict,
absoluteScore,
confidence,
scene,
subjectFocus,
globalFocus,
eyeState,
clusterId,
clusterRank,
reason1,
reason2
```

---

# 102. Change Review

Setiap algorithm change harus menghasilkan:

```text
before
after
moved photos
```

Lalu inspect hanya changed set + regression set.

---

# 103. Do Not Tune Blindly

Jika AI coding agent menemukan hasil:

```text
Reject naik dari 7 ke 300
```

itu **bukan** bukti berhasil.

Harus ditunjukkan:

```text
berapa dari 300 memang Human Reject?
```

---

# 104. Model Evaluation Rules

Setiap model lokal baru harus dievaluasi:

- accuracy relevan pada dataset OhMyFlow,
- latency,
- RAM,
- package size,
- license,
- CPU fallback,
- DirectML compatibility,
- deterministic behavior.

Jangan memilih model hanya karena populer.

---

# 105. Dependency Policy

Tambahkan dependency hanya jika:

- memberi measurable gain,
- license compatible,
- maintenance reasonable,
- package impact diterima.

Hindari dependency besar untuk gain kecil.

---

# 106. Architecture Rule: Evidence Before Verdict

Semua hard reject baru harus menjawab:

```text
Apa evidence-nya?
Seberapa kuat?
Apa false-positive case-nya?
Apa regression test-nya?
```

Jika tidak bisa dijawab:

```text
jangan jadikan hard reject.
```

---

# 107. Architecture Rule: Uncertainty Is Explicit

Jangan menyamarkan uncertainty sebagai angka bagus.

Contoh buruk:

```text
eye unknown → 78
```

Contoh benar:

```text
eyeState = unknown
confidence = 0.18
```

---

# 108. Architecture Rule: Relative Culling Is First-Class

Photo culling bukan image quality assessment saja.

Engine harus memahami:

```text
“Foto B bagus”
```

dan sekaligus:

```text
“tetapi Foto A dari momen yang sama lebih baik.”
```

---

# 109. Architecture Rule: Pick Harus Sulit Didapat di High

Untuk High:

```text
Pick = positive keeper evidence
```

bukan hanya:

```text
tidak menemukan masalah.
```

Ini perbedaan penting.

---

# 110. Negative Evidence vs Positive Keeper Evidence

Foto dapat tidak memiliki defect besar, tetapi juga tidak punya alasan kuat menjadi keeper.

High Mode:

```text
no defect + mediocre relative rank
→ Maybe / Reject
```

bukan otomatis Pick.

---

# 111. Keeper Confidence

High Pick idealnya membutuhkan:

- quality threshold,
- critical gates pass,
- adequate confidence,
- relative standing jika punya cluster.

---

# 112. Standalone Photo

Jika tidak punya cluster:

relative component netral.

Jangan penalize karena tidak ada burst.

---

# 113. Cluster Size

Large burst dapat memakai lebih dari satu keeper.

Contoh:

```text
3 images  → 1 keeper typical
20 images → mungkin 2–4 keeper jika sequence berubah
```

Jangan pakai quota rigid.

---

# 114. Burst Segmentation

Satu rangkaian 30 file tidak selalu satu burst.

Break cluster jika:

- similarity drop,
- timestamp gap,
- subject change,
- framing change.

---

# 115. Sequence Photography

Untuk dance/sports:

jangan Reject semua kecuali satu.

Gunakan diversity signal.

Tujuan:

menghapus redundant micro-variations,

bukan seluruh sequence.

---

# 116. Ranking Margin

Contoh:

```text
best 82
second 81
```

confidence rendah untuk membuang second.

Tetapi:

```text
best 88
second 71
```

dan similarity tinggi:

strong reject candidate.

---

# 117. Human Correction Analytics

Local-only metric:

```text
AI Pick → user Reject
AI Maybe → user Pick
AI Reject → user Pick
```

Ini dapat membantu mengukur engine real-world.

Tidak perlu dikirim ke server.

---

# 118. Mode-Specific Correction Rate

Track:

```text
Fast correction rate
Balanced correction rate
High correction rate
```

High seharusnya membutuhkan lebih sedikit manual cleanup.

---

# 119. Backward Compatibility

Tetap support:

- XMP,
- existing labels,
- manual override,
- move workflow,
- RAW pairing,
- current UI.

Internal analysis result schema boleh berubah.

---

# 120. Migration of Stored State

Jika app belum menyimpan analysis persistence, tidak perlu migration berat.

Jika mulai memakai SQLite:

version schema.

---

# 121. Error Handling

Per-photo failure:

```text
analysisError
→ Maybe
→ reason "Tidak dapat dianalisis sepenuhnya"
```

Jangan crash seluruh batch.

---

# 122. Corrupt Image

Corrupt/unreadable file:

- explicit diagnostic,
- jangan dianggap quality reject biasa,
- preserve file.

---

# 123. Cancellation

Pipeline baru tetap harus cancellable.

Check cancellation di:

- decode queue,
- model inference queue,
- Pass 2,
- clustering loops.

---

# 124. Worker Strategy

Potential:

- decode workers,
- analysis workers,
- ONNX queue.

Tetapi hindari oversubscription.

Benchmark jumlah worker.

---

# 125. GPU Optional

GPU hanya accelerator.

App tetap harus usable CPU-only sesuai product principle.

---

# 126. Packaging

Model ONNX packaged bersama app jika dipakai.

Pertimbangkan:

- binary size,
- path resolving packaged/unpacked,
- checksum,
- asar/native compatibility.

---

# 127. No Network Guarantee

Tambahkan automated test:

- grep/static check `fetch`,
- no remote model download,
- no CDN model path.

---

# 128. Suggested Benchmark Commands

Buat script seperti:

```text
npm run benchmark:culling
npm run benchmark:culling -- --dataset OSIS --mode high
npm run evaluate:culling
npm run regression:culling
```

Nama final menyesuaikan repo.

---

# 129. Benchmark Output Example

```text
Dataset: OSIS-HUMAN-LABELED
Mode: HIGH
Engine: v2.0-alpha3

Human:
Pick   245
Maybe   91
Reject 942

AI:
Pick   270
Maybe  128
Reject 880

Critical false reject:
4 / 245

Reject incorrectly picked:
31 / 942

Maybe leakage:
74 / 942

Burst Top-1:
87.2%

Time:
1200 photos / 4m31s

Peak RAM:
1.3 GB
```

Angka hanya contoh format.

---

# 130. Definition of Done v2

Arsitektur v2 dianggap siap menggantikan v1 setelah:

- benchmark ground truth tersedia,
- quality improvement terukur,
- false reject acceptable,
- Maybe leakage turun,
- burst ranking useful,
- runtime acceptable,
- regression suite stabil,
- determinism tested,
- package berhasil,
- UI flow tidak berubah,
- no network guarantee tetap berlaku.

---

# 131. Prioritas Implementasi

Jika resource terbatas, urutan ROI tertinggi:

```text
1. Ground-truth evaluation harness
2. Separate analysis image
3. Subject/face ROI sharpness
4. Confidence refactor
5. Burst clustering + relative ranking
6. High-mode decision gates
7. Adaptive Pass 2
8. Performance optimization
9. Optional person detector
10. Personalization
```

---

# 132. Hal yang Jangan Dilakukan

Jangan:

- hanya menaikkan `rejectBelow`,
- memaksa persentase Reject tertentu,
- membuat duplicate selalu Reject,
- membuat satu keeper rigid per cluster,
- menjadikan UNKNOWN sebagai score positif,
- menjalankan full-res neural inference untuk semua foto tanpa benchmark,
- mengganti seluruh engine sekaligus,
- menghapus heuristik yang sudah teruji tanpa A/B,
- menyebut peningkatan hanya dari distribusi output,
- mengorbankan offline/privacy.

---

# 133. Kesimpulan

Masalah utama OhMyFlow v1 adalah **decision philosophy**, bukan hanya angka threshold.

Engine saat ini sudah memiliki fondasi penting:

- deterministic pipeline,
- blur analysis,
- exposure logic,
- composition,
- duplicate hash,
- face heuristic,
- local processing,
- calibration harness.

Yang perlu ditambahkan adalah pemahaman bahwa photo culling memiliki dua jenis kualitas:

```text
absolute quality
+
relative keeper quality
```

Arsitektur v2 harus membuat High Mode mampu berkata:

> “Foto ini sebenarnya tidak rusak, tetapi ada frame lain dari momen yang sama yang jelas lebih layak disimpan.”

Dengan tambahan:

- subject-aware analysis,
- higher-quality analysis input,
- explicit confidence,
- relative burst ranking,
- critical decision gates,
- human-labeled benchmark,

OhMyFlow dapat berkembang dari **technical defect detector** menjadi **photo culling engine yang benar-benar membantu mengurangi beban review fotografer**.

---

# APPENDIX A — Audit Checklist untuk Repository Saat Ini

Sebelum coding, evaluasi repository nyata terhadap pertanyaan berikut.

## Input / Decode

- Apakah High benar-benar menganalisis source 512px atau hanya thumbnail 480px?
- Apakah JPEG q62 dipakai sebagai source analysis?
- Apakah RAW menggunakan embedded preview dengan resolusi cukup?
- Apakah EXIF orientation sudah dinormalisasi sebelum analisis?

## Sharpness

- Dari mana subject blocks ditentukan?
- Apakah center bias membuat off-center subject salah dinilai?
- Apakah background tajam dapat menutupi subject blur?
- Berapa korelasi current focus score terhadap manual focus label?

## Face / Eyes

- Berapa face detection recall pada dataset event?
- Berapa false face detection?
- Berapa banyak Pick yang memiliki eye state unknown?
- Apakah unknown berkontribusi positif pada score?
- Apakah wajah kecil memengaruhi verdict secara tidak proporsional?

## Exposure

- Apakah wajah underexposed bisa lolos karena global exposure bagus?
- Apakah stage lighting salah dinilai?
- Apakah white background logic masih robust?

## Composition

- Berapa banyak gradient interest berasal dari background?
- Apakah face/subject position pernah digunakan?
- Berapa false positive crop/edge penalty?

## Duplicate

- Berapa cluster yang terbentuk dari actual burst?
- Berapa false grouping?
- Berapa missed grouping?
- Berapa anggota cluster yang masuk Maybe?
- Apakah ranking antar duplicate sudah ada?

## Scoring

- Berapa banyak Pick memiliki satu metric kritis yang buruk?
- Berapa Pick yang lolos hanya karena weighted average?
- Apa sebenarnya fungsi `rejectBelow` dibanding hard gates?
- Apakah Pick berarti “bagus” atau hanya “tidak buruk”?

## Calibration

- Apakah ada manual ground truth?
- Apakah ada confusion matrix?
- Apakah benchmark menggunakan shoot yang berbeda?
- Apakah test set terpisah dari tuning set?
- Apakah cluster dari satu burst bocor ke dua split?

---

# APPENDIX B — Prompt Audit dan Eksekusi untuk AI Coding Agent

Gunakan prompt berikut bersama file:

- `ARCHITECTURE.md`
- `PRODUCT.md`
- `NEW-ARCHITECTURE.md`
- source code repository OhMyFlow.

```text
Anda adalah senior computer vision engineer, desktop software engineer, dan code auditor.

Tugas Anda adalah mengevaluasi implementasi OhMyFlow yang sekarang terhadap proposal NEW-ARCHITECTURE.md.

PENTING:
- Jangan langsung melakukan rewrite besar.
- Jangan langsung mengubah threshold hanya agar Reject bertambah.
- Jangan mengubah UI/UX atau alur aplikasi.
- Jangan mengubah prinsip offline/local processing.
- Jangan menambah API/cloud.
- Jangan menghapus fitur yang sudah bekerja tanpa bukti benchmark.
- Perlakukan ARCHITECTURE.md sebagai dokumentasi current architecture.
- Perlakukan PRODUCT.md sebagai kontrak produk.
- Perlakukan NEW-ARCHITECTURE.md sebagai target evaluasi/proposal, BUKAN instruksi bahwa semua bagian wajib diimplementasikan tanpa validasi.
- Source code aktual adalah source of truth tertinggi jika dokumentasi berbeda dengan implementasi.

TUJUAN UTAMA:
Cari penyebab kenapa pada sekitar 1200 foto:
- Reject sangat sedikit,
- Maybe sangat banyak,
- sebagian foto buruk masih menjadi Pick.

Fokus pada kualitas keputusan culling, bukan perubahan tampilan.

LANGKAH 1 — AUDIT CURRENT IMPLEMENTATION

Baca repository secara menyeluruh dan petakan:

1. flow scan → decode → analysis → score → duplicate → verdict;
2. source image yang benar-benar digunakan oleh tiap mode;
3. resolution + JPEG quality analysis;
4. sharpness implementation;
5. face + eye implementation;
6. exposure;
7. composition;
8. duplicate grouping;
9. scoring formula;
10. hard reject gates;
11. Pick gates;
12. Maybe fallback;
13. preset Fast/Balanced/High;
14. concurrency dan ordering;
15. benchmark/calibration scripts yang sudah ada.

Untuk setiap area:
- sebutkan file dan function yang bertanggung jawab,
- jelaskan behavior aktual,
- bandingkan dengan dokumentasi,
- tandai mismatch dokumentasi vs code,
- tandai potensi penyebab false Pick / excessive Maybe / insufficient Reject.

JANGAN ubah kode dulu.

LANGKAH 2 — VALIDASI HIPOTESIS

Validasi secara khusus hipotesis berikut berdasarkan source code:

A. Apakah analysis benar-benar berasal dari thumbnail 480px q62 sehingga High 512 tidak memperoleh informasi tambahan?

B. Apakah policy duplicate memang membuat near-duplicate bagus selalu Maybe?

C. Apakah eye UNKNOWN mendapat nilai positif tinggi dan ikut menaikkan final score?

D. Apakah weighted average memungkinkan subject blur / composition buruk ditutupi metric lain?

E. Apakah focus terlalu global/center-based sehingga background tajam bisa menyelamatkan subject blur?

F. Apakah constraint calibration terlalu berorientasi “jangan ada foto tajam di Reject”?

G. Apakah current High mode hanya berbeda melalui threshold/resolution, tetapi belum melakukan relative keeper selection?

Untuk setiap hipotesis beri status:
- CONFIRMED
- PARTIALLY CONFIRMED
- NOT CONFIRMED

Sertakan bukti file/function/code path.

LANGKAH 3 — BUAT BASELINE SEBELUM MODIFIKASI

Sebelum implementasi v2, buat atau perbaiki evaluation harness.

Evaluation harness harus mampu membaca dataset manual dengan format minimal:

file,humanVerdict

dan idealnya:

file,humanVerdict,reason,cluster,humanRank

Output minimal:

- total per class,
- confusion matrix,
- Human Pick → AI Reject,
- Human Reject → AI Pick,
- Human Reject → AI Maybe / Maybe Leakage,
- accuracy per class,
- Pick precision,
- Reject precision,
- Reject recall,
- manual review size = Pick + Maybe,
- processing time,
- peak memory jika mudah diukur.

Untuk dataset burst berlabel tambahkan:
- Top-1 keeper accuracy,
- Top-2 keeper recall.

Jangan menyimpulkan engine membaik hanya dari jumlah Reject.

LANGKAH 4 — BUAT IMPLEMENTATION PLAN BERTAHAP

Setelah audit, buat implementation plan dengan urutan prioritas berikut:

Phase 0:
Baseline + human ground truth + evaluator.

Phase 1:
Pisahkan UI thumbnail dan analysis image.

Phase 2:
Subject-aware / face-aware sharpness.

Phase 3:
Confidence model: unknown bukan positive score.

Phase 4:
Burst clustering dan relative ranking tanpa langsung mengubah verdict.

Phase 5:
Aktifkan relative verdict untuk High setelah benchmark membuktikan aman.

Phase 6:
Adaptive Pass 2 untuk foto ambiguous.

Phase 7:
Performance optimization.

Untuk setiap phase jelaskan:
- file yang harus diubah,
- file baru bila diperlukan,
- dependency baru bila diperlukan,
- risk,
- regression test,
- acceptance metric,
- rollback strategy.

LANGKAH 5 — IMPLEMENTASI SECARA ITERATIF

Jika diminta melanjutkan coding:

- kerjakan SATU phase pada satu waktu;
- build + typecheck setelah setiap phase;
- jalankan regression;
- jalankan benchmark;
- bandingkan before/after;
- tampilkan foto/record yang pindah kategori jika harness mendukung;
- jangan lanjut ke phase berikutnya jika regression buruk.

LANGKAH 6 — RULES UNTUK DECISION ENGINE BARU

Arsitektur target:

Photo Decision =
Absolute Quality
+ Relative Burst Quality
+ Confidence
+ Critical Gates

Jangan gunakan weighted score tunggal sebagai satu-satunya verdict.

Critical gate candidate:
- accidental frame,
- extreme exposure failure,
- high-confidence subject blur,
- high-confidence dominant closed eyes,
- strong redundant burst loser.

Unknown evidence:
- tidak boleh diberi positive reward,
- harus menurunkan confidence,
- dapat membatasi maximum verdict ke Maybe bila faktor tersebut kritis.

High mode:
- Pick harus memerlukan positive keeper evidence;
- frame technically acceptable tetapi redundant boleh Reject;
- Maybe hanya untuk genuine uncertainty;
- jangan membuat quota jumlah Reject.

LANGKAH 7 — BURST

Implementasi burst jangan sekadar duplicate = Reject.

Gunakan:
- similarity,
- temporal/file adjacency,
- visual diversity,
- per-photo quality,
- stable deterministic ordering.

Setiap cluster:
- rank member,
- hitung margin terhadap best,
- ukur diversity,
- pilih primary keeper,
- optional secondary candidate,
- reject hanya strong redundant loser.

Jangan paksa satu keeper jika sequence memiliki perubahan bermakna.

LANGKAH 8 — SUBJECT-AWARE ANALYSIS

Jika face detector lokal dibutuhkan:
- gunakan abstraction interface,
- model ONNX lokal,
- CPU fallback,
- optional DirectML,
- tidak ada network download runtime,
- model/version harus reproducible.

Jangan memilih model hanya karena populer.
Benchmark di dataset OhMyFlow.

Subject-aware focus harus lebih prioritas daripada global sharpness untuk foto manusia.

LANGKAH 9 — PERFORMANCE

Jangan decode seluruh foto full-res jika tidak perlu.

Target:
- UI thumbnail tetap ringan,
- analysis preview terpisah,
- Pass 2 hanya ambiguous,
- ROI crop untuk detail,
- bounded memory,
- release ImageData setelah features diambil,
- batching/concurrency yang deterministik.

LANGKAH 10 — OUTPUT AUDIT

Sebelum melakukan coding besar, hasil audit harus diberikan dengan struktur:

# Executive Summary

# Current Architecture Map

# Confirmed Root Causes

# Unconfirmed Hypotheses

# Documentation vs Code Mismatches

# Highest-Impact Fixes

# Risks

# Baseline Evaluation Plan

# Proposed File-Level Migration Plan

# Acceptance Criteria

# Recommended First Implementation Phase

Terakhir, jawab secara eksplisit:

1. Apa penyebab paling besar Reject terlalu sedikit?
2. Apa penyebab paling besar Maybe terlalu banyak?
3. Apa penyebab foto buruk masih masuk Pick?
4. Apakah perubahan threshold saja cukup?
5. Bagian arsitektur mana yang memberi ROI peningkatan terbesar?
6. Apa perubahan terkecil yang layak dilakukan lebih dulu tanpa rewrite?

Jangan melakukan perubahan kode sampai audit selesai dan root cause sudah dibuktikan dari source code.
```

---

# APPENDIX C — Prompt Implementasi Setelah Audit Disetujui

```text
Gunakan hasil audit repository OhMyFlow yang sudah dibuat sebelumnya dan NEW-ARCHITECTURE.md sebagai target architecture.

Sekarang implementasikan hanya phase yang secara eksplisit saya minta.

Rules:
- jangan mengubah UI,
- jangan mengubah user flow,
- jangan mengubah export/XMP behavior kecuali phase memang membutuhkannya,
- jangan menambah network/API,
- jangan rewrite file yang tidak relevan,
- jangan melakukan threshold tuning tanpa benchmark,
- jangan menghapus fallback lama sebelum replacement terbukti,
- pertahankan determinisme,
- pertahankan source photo safety.

Sebelum coding:
1. sebutkan file yang akan disentuh;
2. jelaskan perubahan minimum;
3. sebutkan regression risk.

Setelah coding:
1. jalankan typecheck;
2. jalankan build;
3. jalankan unit/regression test;
4. jalankan benchmark/evaluation yang relevan;
5. tampilkan before vs after;
6. laporkan perubahan Pick/Maybe/Reject;
7. yang paling penting, laporkan perubahan confusion matrix / false reject / Maybe leakage;
8. jangan menyebut improvement jika hanya distribusi berubah.

Jika benchmark memburuk:
- jangan memoles hasil;
- jelaskan regression;
- rollback atau usulkan adjustment berbasis evidence.
```

---

# APPENDIX D — Prinsip Singkat untuk Disimpan di Context AI Agent

```text
OhMyFlow is a local-first photo culling application, not merely an image quality scorer.

A good frame can still be a Reject when a clearly better near-identical frame exists.

High mode should select keepers, not only detect broken photos.

Pick requires positive keeper evidence.
Reject requires strong negative or redundancy evidence.
Maybe represents genuine uncertainty.

Unknown is not good.
Unknown is uncertainty.

Global sharpness is not subject sharpness.

Duplicate detection and duplicate verdict are separate problems.

Never tune for a target Reject percentage.
Tune against human-labeled ground truth.

Measure:
- false rejects,
- false picks,
- Maybe leakage,
- burst keeper accuracy,
- manual review reduction,
- runtime.

Keep:
- offline processing,
- deterministic behavior,
- original-file safety,
- existing user flow.
```
