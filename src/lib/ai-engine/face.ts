// Face & eyes — DETERMINISTIK, 100% lokal. TANPA Math.random().
// - hasFace butuh skin terklaster di tengah (bukan tembok oranye).
// - Mata dinilai dari DUA bukti: dark cluster simetris (pupil) + energi tepi
//   eye-band vs pipi (kelopak terbuka = bertepi, tertutup = semulus kulit).
// - Probabilitas mentah dikembalikan; culler menerapkan ambang per mode
//   (fast hati-hati, high tegas).

export interface FaceResult {
  hasFace: boolean
  faceCount: number
  faceConfidence: number // 0-1
  skinRatio: number // 0-1, porsi piksel kulit (diagnostik: >0.5 + blur = curiga jari)
  eyesClosedProbability: number // 0-1
  eyesClosed: boolean
  eyesState: 'open' | 'closed' | 'unknown' | 'no-face'
  // GT-2026-09: hit pupil bilateral (dark dikurung sklera). 0 = tak teresolusi.
  pupilHits: number
}

function noFace(skinRatio: number, faceConfidence: number): FaceResult {
  return { hasFace: false, faceCount: 0, faceConfidence, skinRatio, eyesClosedProbability: 0, eyesClosed: false, eyesState: 'no-face', pupilHits: 0 }
}

function skinPixelYCbCr(r: number, g: number, b: number): boolean {
  // Aturan RGB cepat dulu (tolak jelas-bukan-kulit)
  if (r < 85 || g < 35 || b < 15) return false
  if (r <= g || r <= b) return false
  if (r - g < 12) return false
  // YCbCr skin locus (aproksimasi integer, tanpa float mahal)
  // Cb ≈ 128 -0.1687R -0.3313G +0.5B ; Cr ≈ 128 +0.5R -0.4187G -0.0813B
  const cb = 128 + (-0.168736 * r - 0.331264 * g + 0.5 * b)
  const cr = 128 + (0.5 * r - 0.418688 * g - 0.081312 * b)
  return cb >= 76 && cb <= 128 && cr >= 132 && cr <= 174
}

// Statistik skin untuk kalibrasi (dipakai harness debug, murah).
export function skinStats(imageData: ImageData): { skinRatio: number; centerRatio: number; concentration: number } {
  const { data, width: w, height: h } = imageData
  const step = 4
  let skin = 0, total = 0, skinCenter = 0, centerTotal = 0
  const cx0 = Math.floor(w * 0.25), cx1 = Math.floor(w * 0.75)
  const cy0 = Math.floor(h * 0.15), cy1 = Math.floor(h * 0.85)
  for (let y = 0; y < h; y += step) {
    const inY = y >= cy0 && y < cy1
    for (let x = 0; x < w; x += step) {
      const idx = (y * w + x) * 4
      total++
      const isSkin = skinPixelYCbCr(data[idx], data[idx + 1], data[idx + 2])
      if (isSkin) skin++
      if (inY && x >= cx0 && x < cx1) { centerTotal++; if (isSkin) skinCenter++ }
    }
  }
  const skinRatio = total ? skin / total : 0
  const centerRatio = centerTotal ? skinCenter / centerTotal : 0
  return { skinRatio, centerRatio, concentration: skinRatio > 0.005 ? centerRatio / Math.max(skinRatio, 0.01) : 0 }
}

export function heuristicFaceDetect(imageData: ImageData, opts?: { sharpness?: number }): FaceResult {
  const { data, width: w, height: h } = imageData
  const step = 4
  let skin = 0, total = 0
  let skinCenter = 0, centerTotal = 0
  // center box: tengah 50% x 60%
  const cx0 = Math.floor(w * 0.25), cx1 = Math.floor(w * 0.75)
  const cy0 = Math.floor(h * 0.15), cy1 = Math.floor(h * 0.85)

  for (let y = 0; y < h; y += step) {
    const inY = y >= cy0 && y < cy1
    for (let x = 0; x < w; x += step) {
      const idx = (y * w + x) * 4
      total++
      const isSkin = skinPixelYCbCr(data[idx], data[idx + 1], data[idx + 2])
      if (isSkin) skin++
      if (inY && x >= cx0 && x < cx1) {
        centerTotal++
        if (isSkin) skinCenter++
      }
    }
  }
  const skinRatio = total ? skin / total : 0
  const centerRatio = centerTotal ? skinCenter / centerTotal : 0
  // Konsentrasi tengah: wajah biasanya skin menumpuk di tengah
  const concentration = skinRatio > 0.005 ? centerRatio / Math.max(skinRatio, 0.01) : 0

  // Tiga jalur bukti (hasil kalibrasi foto asli — ambang tajam gagal di selfie/group):
  // - Tier 1 (terpusat, conc ≥ 1.3): jumlah skin menentukan (selfie).
  // - Tier 2 (menyebar, conc 0.9–1.3): butuh MATA untuk konfirmasi (group/duo).
  //   Tanpa mata = tembok kayu/dinding → BUKAN wajah. Ini yang mencegah false positive.
  // - bigSkin (skin raksasa di tengah): hanya sah bila mata ketemu (close-up vs jari).
  const inRange = skinRatio > 0.06 && skinRatio < 0.55
  const amount = Math.min(1, (skinRatio - 0.06) / 0.12) // 0.06→0, 0.18+→1 (landai, tanpa cliff)
  const centered = concentration >= 1.3 ? 1 : concentration >= 0.9 ? 0.65 : 0.3
  const tier1 = inRange && concentration >= 1.3
  const tier2 = inRange && !tier1 && concentration >= 0.9
  const bigCenterSkin = skinRatio > 0.35 && centerRatio > 0.30

  let faceConfidence = 0
  if (tier1) {
    faceConfidence = Math.min(1, (0.35 + 0.65 * amount) * (0.55 + 0.45 * centered))
  }
  // tier2 & bigSkin diputuskan setelah analisis mata di bawah.
  let hasFace = faceConfidence > 0.42
  let faceCount = 0
  if (hasFace) faceCount = skinRatio > 0.3 ? 2 : 1

  if (!hasFace && !tier2 && !bigCenterSkin) {
    return noFace(skinRatio, Math.round(faceConfidence * 100) / 100)
  }

  // --- Eye state: dua bukti independen (tetap deterministik) ---
  // Bukti 1: dark cluster simetris (pupil/bulu mata) → terbuka.
  // Bukti 2: energi tepi horizontal — mata terbuka punya garis kelopak/pupil sehingga
  //          eye-band BERTEPI dibanding pipi; mata tertutup = kulit mulus, nyaris sama.
  const sharp = opts?.sharpness ?? 60
  const bandY0 = Math.floor(h * 0.22), bandY1 = Math.floor(h * 0.52)
  const bandX0 = Math.floor(w * 0.18), bandX1 = Math.floor(w * 0.82)
  const midX = Math.floor((bandX0 + bandX1) / 2)
  const lumAt = (x: number, y: number) => {
    const idx = (y * w + x) * 4
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
  }
  let darkL = 0, darkR = 0, bandPx = 0
  let eyeEdge = 0, eyeN = 0
  // Jejak dark: pupil = gumpalan TINGGI (≥3 baris sampel) di kedua sisi.
  // Ambang 3 (bukan 2): garis bulu mata 2px pun bisa mencakup 2 baris sampel —
  // hanya massa yang benar-benar meninggi yang boleh berarti "terbuka".
  // Konsentrasi baris: bulu mata menumpuk di 1-2 baris teratas; motif tersebar.
  let runL = 0, runR = 0, tallL = 0, tallR = 0
  // GT-2026-09: lebar run dark terpanjang per sisi (tak dipakai vonis; diagnostik).
  let runWL = 0, runWR = 0
  const rowDark: number[] = []
  // GT-2026-09: jejak dark per kolom restricted (simetri centroid, wajah miring).
  const colCount = Math.max(1, Math.ceil((bandX1 - bandX0) / 2))
  // GT-2026-09: centroid vertikal massa dark (alis vs pupil).
  let darkYSum = 0
  // GT-2026-09: masker kulit eye-band + dilasi (rambut di interior tak dihitung
  // sebagai bukti mata). Statistik suffix R = restricted (dekat kulit).
  const gw = colCount
  const gh = Math.max(1, Math.ceil((bandY1 - bandY0) / 2))
  const skinBand = new Uint8Array(gw * gh)
  for (let y = bandY0, gy = 0; y < bandY1; y += 2, gy++) {
    for (let x = bandX0, gx = 0; x < bandX1; x += 2, gx++) {
      const idx = (y * w + x) * 4
      if (skinPixelYCbCr(data[idx], data[idx + 1], data[idx + 2])) skinBand[gy * gw + gx] = 1
    }
  }
  const dilR = 4 // ~8px: kelopak/bulu menempel kulit; interior rambut tidak
  const dilBand = new Uint8Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (!skinBand[gy * gw + gx]) continue
      for (let dy = -dilR; dy <= dilR; dy++) {
        const yy = gy + dy
        if (yy < 0 || yy >= gh) continue
        for (let dx = -dilR; dx <= dilR; dx++) {
          const xx = gx + dx
          if (xx < 0 || xx >= gw) continue
          dilBand[yy * gw + xx] = 1
        }
      }
    }
  }
  let rDarkL = 0, rDarkR = 0, rDarkYSum = 0, rDarkXSum = 0
  const rRowDark: number[] = []
  const rColDark: number[] = new Array(colCount).fill(0)
  // GT-2026-09: hit pupil = dark yang DIKELILINGI sklera (putih mata) di
  // ≥3 arah kardinal dalam 4px. Pupil dikurung sklera; rambut-lawan-langit
  // dan garis bulu (tetangga kulit jenuh) gugur di sini. Kandidat lum<70
  // (pupil kecil ikut kepyur downscale); sklera boleh 1-4px jauhnya.
  const rHitGx: number[] = []
  const scleraAt = (x: number, y: number): boolean => {
    if (x < 0 || x >= w || y < 0 || y >= h) return false
    const idx = (y * w + x) * 4
    const r = data[idx], g = data[idx + 1], b = data[idx + 2]
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    return lum >= 110 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25
  }
  const scleraSide = (x: number, y: number, dx: number, dy: number): boolean => {
    for (let k = 1; k <= 4; k++) if (scleraAt(x + dx * k, y + dy * k)) return true
    return false
  }
  const pupilAt = (x: number, y: number): boolean => {
    let sides = 0
    if (scleraSide(x, y, 0, -1)) sides++
    if (scleraSide(x, y, 0, 1)) sides++
    if (scleraSide(x, y, -1, 0)) sides++
    if (scleraSide(x, y, 1, 0)) sides++
    return sides >= 3
  }
  for (let y = bandY0, gy = 0; y < bandY1; y += 2, gy++) {
    let rowL = 0, rowR = 0, rowD = 0
    let rRowD = 0
    // GT-2026-09: run dark terpanjang per sisi di baris ini (U, diagnostik).
    let curRun = 0, curSide = 0, maxRunL = 0, maxRunR = 0
    const flushRun = () => {
      if (curSide < 0 && curRun > maxRunL) maxRunL = curRun
      else if (curSide > 0 && curRun > maxRunR) maxRunR = curRun
      curRun = 0; curSide = 0
    }
    for (let x = bandX0, gx = 0; x < bandX1; x += 2, gx++) {
      const lum = lumAt(x, y)
      bandPx++
      const near = dilBand[gy * gw + gx] === 1
      // Kandidat pupil diperiksa pada ambang lebih longgar (lum<70).
      if (near && lum < 70 && pupilAt(x, y)) rHitGx.push(gx)
      if (lum < 42) {
        rowD++
        darkYSum += y
        const side = x < midX ? -1 : 1
        if (side === curSide) curRun++
        else { flushRun(); curSide = side; curRun = 1 }
        if (x < midX) { darkL++; rowL++ }
        else { darkR++; rowR++ }
        if (near) {
          rRowD++
          rDarkYSum += y
          rDarkXSum += gx
          rColDark[gx]++
          if (x < midX) { rDarkL++; }
          else { rDarkR++; }
        }
      } else {
        flushRun()
      }
      if (y > bandY0 && x > bandX0) { eyeEdge += Math.abs(lum - lumAt(x, y - 1)); eyeN++ }
    }
    flushRun()
    if (maxRunL > runWL) runWL = maxRunL
    if (maxRunR > runWR) runWR = maxRunR
    rowDark.push(rowD)
    rRowDark.push(rRowD)
    runL = rowL >= 2 ? runL + 1 : 0
    runR = rowR >= 2 ? runR + 1 : 0
    if (runL > tallL) tallL = runL
    if (runR > tallR) tallR = runR
  }
  // Band pipi pembanding (di bawah, lebar sama) — kulit polos sebagai baseline.
  const cheekY0 = Math.floor(h * 0.60), cheekY1 = Math.floor(h * 0.80)
  let cheekEdge = 0, cheekN = 0
  for (let y = cheekY0 + 1; y < cheekY1; y += 2) {
    for (let x = bandX0 + 1; x < bandX1; x += 2) {
      cheekEdge += Math.abs(lumAt(x, y) - lumAt(x, y - 1)); cheekN++
    }
  }
  const total2 = Math.max(1, bandPx)
  const darkRatio = (darkL + darkR) / total2
  const leftRatio = darkL / total2, rightRatio = darkR / total2
  const symmetric = leftRatio > 0.0015 && rightRatio > 0.0015 // kedua mata ada dark spot

  const eyesFound = symmetric && darkRatio > 0.004
  // Validasi tier 2: mata ketemu → wajah sah (skor sedikit di bawah tier 1);
  // tidak → dinding/tembok, tolak.
  if (!hasFace && tier2) {
    if (eyesFound) {
      faceConfidence = Math.min(1, (0.35 + 0.65 * amount) * (0.55 + 0.45 * centered)) * 0.9
      hasFace = faceConfidence > 0.42
      if (hasFace) faceCount = skinRatio > 0.2 ? 2 : 1
    } else {
      return noFace(skinRatio, 0.35)
    }
  }
  // Validasi close-up: mata ketemu → wajah sah; tidak → tembok/jari, tolak.
  if (!hasFace && bigCenterSkin) {
    if (eyesFound) {
      hasFace = true
      faceConfidence = 0.68
      faceCount = skinRatio > 0.55 ? 2 : 1
    } else {
      return noFace(skinRatio, 0.35)
    }
  }
  const edgeRatio = (eyeEdge / Math.max(1, eyeN)) / Math.max((cheekEdge / Math.max(1, cheekN)), 1)
  // Pupil/lensa = gumpalan dark TINGGI dan SEMPIT di kedua sisi;
  // garis bulu mata = tipis. Hanya gumpalan yang meninggi = bukti "terbuka".
  // GT-2026-09: gumpalan di SEPERTIGA ATAS band = alis/bayangan (bukan pupil:
  // pupil selalu di bawah alis). Tanpa guard ini mata merem dibaca terbuka.
  const darkTotal2 = darkL + darkR
  const darkCentroidY = darkTotal2 > 0 ? darkYSum / darkTotal2 : (bandY0 + bandY1) / 2
  const browLine = bandY0 + (bandY1 - bandY0) * 0.35
  // Varian U = semantik lama (tak tersentuh) untuk eyesFound/eyeStructure.
  const blobsU = symmetric && darkRatio > 0.004 && tallL >= 3 && tallR >= 3 && darkCentroidY >= browLine
  // Dark simetris yang BUKAN gumpalan pupil = garis bulu mata / pupil jauh samar.
  const thinLinesU = symmetric && darkRatio > 0.004 && !blobsU
  // Konsentrasi baris: garis bulu mata menumpuk di 1-2 baris teratas;
  // motif titik tersebar ke banyak baris.
  const darkTotal = darkL + darkR
  const rowSorted = [...rowDark].sort((a, b) => b - a)
  const rowConc = darkTotal > 0 ? (rowSorted[0] + (rowSorted[1] ?? 0)) / darkTotal : 0
  // GT-2026-09: statistik R = restricted dekat-kulit (bebas banjir rambut).
  // Simetri dihitung dari centroid massa sendiri (wajah miring/โมเมน).
  const rDarkTotal = rDarkL + rDarkR
  const rDarkRatio = rDarkTotal / total2
  let rColSum = 0, rColXSum = 0
  for (let gx = 0; gx < colCount; gx++) { rColSum += rColDark[gx]; rColXSum += gx * rColDark[gx] }
  const rMidGx = rColSum > 0 ? rColXSum / rColSum : colCount / 2
  let rMassL = 0, rMassR = 0
  for (let gx = 0; gx < colCount; gx++) {
    if (gx < rMidGx) rMassL += rColDark[gx]
    else if (gx > rMidGx) rMassR += rColDark[gx]
  }
  const rSymmetric = rColSum > 0 && rMassL / rColSum > 0.2 && rMassR / rColSum > 0.2
  const rDarkCentroidY = rDarkTotal > 0 ? rDarkYSum / rDarkTotal : (bandY0 + bandY1) / 2
  // GT-2026-09: hit pupil bilateral di sekitar centroid massa sendiri.
  let rHitL = 0, rHitR = 0
  for (const gx of rHitGx) {
    if (gx < rMidGx) rHitL++
    else if (gx > rMidGx) rHitR++
  }
  // Pupil = dark bersebelahan sklera di kedua sisi + di bawah garis alis.
  // Ambang 5/sisi: pupil asli memberi belasan hit; stray (kilau/bokeh) 1-3.
  const rBlobs = rHitL >= 5 && rHitR >= 5 && rDarkCentroidY >= browLine && rDarkRatio > 0.004
  const rThinLines = rSymmetric && rDarkRatio > 0.004 && !rBlobs
  const rRowSorted = [...rRowDark].sort((a, b) => b - a)
  const rRowConc = rDarkTotal > 0 ? (rRowSorted[0] + (rRowSorted[1] ?? 0)) / rDarkTotal : 0
  const rLineConc = rRowConc
  // Struktur wajah minimal: pupil, ATAU eye-band jelas lebih bertepi dari pipi,
  // ATAU garis gelap terkonsentrasi (kelopak). Tanpa ketiganya = objek.
  // (Semantik U lama — stabilitas eksistensi wajah.)
  const eyeStructure = blobsU || edgeRatio > 1.35 || (thinLinesU && rowConc > 0.55)
  if (hasFace && !tier2 && !bigCenterSkin && !eyeStructure) {
    // Jalur tier 1 tanpa struktur mata → tolak sebagai wajah.
    return noFace(skinRatio, Math.min(faceConfidence, 0.38))
  }

  // Aturan tegas tapi berlapis (tanpa random). Prinsip: TERTUTUP butuh BUKTI POSITIF
  // (garis bulu mata yang substansial) — "tidak ada pupil" saja TIDAK cukup, karena
  // permukaan beige mulus (keramik!) juga tidak punya pupil. Dinding bukti:
  // thinLines + darkRatio ≥ 0.01 = garis bulu mata nyata (pupil jauh yang samar
  // berada di bawah 0.01 → jatuh ke unknown = aman).
  // GT-DEBUG sementara: set GT_DEBUG=1 untuk intip statistik kanal mata.
  if (typeof process !== 'undefined' && process.env && process.env.GT_DEBUG && hasFace) {
    try {
      console.error(`[GT_DEBUG] rDark=${rDarkRatio.toFixed(4)} rSym=${rSymmetric} ` +
        `rHit=${rHitL}/${rHitR} ` +
        `rC=${rLineConc.toFixed(2)} rCent=${(rDarkCentroidY - bandY0).toFixed(0)} ` +
        `U(dark=${darkRatio.toFixed(4)} tall=${tallL}/${tallR} runW=${runWL}/${runWR}) ` +
        `sharp=${sharp} skin=${skinRatio.toFixed(3)} fc=${faceConfidence.toFixed(2)}`)
    } catch {}
  }

  let p = 0.3
  let eyesState: FaceResult['eyesState'] = 'unknown'
  if (rBlobs) {
    p = 0.07
    eyesState = 'open'
  } else if (sharp < 30) {
    p = 0.25
    eyesState = 'unknown'
  } else if (rThinLines && rDarkRatio >= 0.01 && rLineConc > 0.55 && sharp >= 40 && skinRatio < 0.6) {
    // Garis bulu mata: gelap + simetris + menumpuk di sedikit baris + tajam.
    // Motif titik (tersebar) dan pupil jauh (terlalu redup) lolos ke unknown = aman.
    p = 0.72
    eyesState = 'closed'
  } else if (rThinLines) {
    p = 0.50
    eyesState = 'unknown'
  } else if (edgeRatio > 1.6 && rDarkRatio >= 0.001) {
    p = 0.10
    eyesState = 'open'
  } else if (rDarkRatio < 0.004) {
    p = 0.45
    eyesState = 'unknown'
  } else {
    // GT-2026-09: tanpa bukti positif = unknown (dulu 'open' p=0.15).
    // "Kelihatan baik" tanpa pupil/garis bukan vonis terbuka — Maybe yang jujur.
    p = 0.35
    eyesState = 'unknown'
  }

  // Skala dengan faceConfidence: wajah tidak yakin → turunkan p
  p = p * (0.5 + 0.5 * faceConfidence)
  p = Math.max(0, Math.min(0.9, p))
  const eyesClosed = eyesState === 'closed' && p > 0.6

  return {
    hasFace, faceCount,
    faceConfidence: Math.round(faceConfidence * 100) / 100,
    skinRatio: Math.round(skinRatio * 1000) / 1000,
    eyesClosedProbability: Math.round(p * 100) / 100,
    eyesClosed, eyesState, pupilHits: rHitGx.length
  }
}

export async function computeFaceFromDataUrl(dataUrl: string, sharpness?: number): Promise<FaceResult> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const maxSide = 256
        let w = img.width, h = img.height
        if (w > maxSide || h > maxSide) { const s = Math.min(maxSide / w, maxSide / h); w = Math.max(2, Math.round(w * s)); h = Math.max(2, Math.round(h * s)) }
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0, w, h)
        resolve(heuristicFaceDetect(ctx.getImageData(0, 0, w, h), { sharpness }))
      } catch {
        resolve({ hasFace: false, faceCount: 0, faceConfidence: 0, skinRatio: 0, eyesClosedProbability: 0, eyesClosed: false, eyesState: 'unknown', pupilHits: 0 })
      }
    }
    img.onerror = () => resolve({ hasFace: false, faceCount: 0, faceConfidence: 0, skinRatio: 0, eyesClosedProbability: 0, eyesClosed: false, eyesState: 'unknown', pupilHits: 0 })
    img.src = dataUrl
  })
}
