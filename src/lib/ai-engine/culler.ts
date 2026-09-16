import type { PhotoItem, Sensitivity, CullCategory } from '@/types'
import { analyzeOne, clearPipelineCache, decodeOnce, V2_SUBJECT, V2_BURST_RANK, type PipelineFeatures } from './pipeline'
import { groupDuplicates, hammingDistanceLimited } from './duplicate'
import { codesFor } from './reasons'
import { V2_ONNX, V2_PASS2, detectFacesONNX } from '../ml/face-onnx'
import { refineEyesWithROI } from '../ml/eye-roi'

export interface CullOptions {
  mode: Sensitivity
  onProgress?: (done: number, total: number, current: PhotoItem) => void
  shouldCancel?: () => boolean
  // Suntikan penganalisis (default: decode browser). Harness Node menyuntik versi sharp
  // agar KALIBRASI memakai kode scoring/kategorisasi yang 100% sama dengan produksi.
  analyze?: (src: string, size: number) => Promise<PipelineFeatures | null>
}

interface ModePreset {
  analysisSize: number
  batchSize: number
  sharpWeight: number
  faceWeight: number
  aestheticWeight: number
  compWeight: number
  duplicateThreshold: number
  dupPenalty: number
  picksAt: number
  rejectBelow: number
  hardBlurBelow: number
  picksFocusMin: number
  blownRejectAt: number
  confRejectFloor: number
  darkRejectAt: number // exposure ≤ ini + lum rendah = rejects (0 = mati; high saja)
  eyeThreshold: number
  exposureHardReject: boolean
  compositionHardReject: boolean
}

// Fast = sortir awal (hanya yang jelas gagal dibuang, sisanya Maybe).
// Balanced = harian, objektif. High = seleksi akhir (paling berani me-reject).
export const PRESETS: Record<Sensitivity, ModePreset> = {
  fast:     { analysisSize: 256, batchSize: 8, sharpWeight: 0.37, faceWeight: 0.27, aestheticWeight: 0.26, compWeight: 0.10, duplicateThreshold: 9, dupPenalty: 8,  picksAt: 75, rejectBelow: 40, hardBlurBelow: 45, picksFocusMin: 60, blownRejectAt: 18, confRejectFloor: 0.45, darkRejectAt: 0, eyeThreshold: 0.70, exposureHardReject: false, compositionHardReject: false },
  balanced: { analysisSize: 384, batchSize: 6, sharpWeight: 0.34, faceWeight: 0.26, aestheticWeight: 0.25, compWeight: 0.15, duplicateThreshold: 7, dupPenalty: 10, picksAt: 70, rejectBelow: 45, hardBlurBelow: 55, picksFocusMin: 60, blownRejectAt: 14, confRejectFloor: 0.32, darkRejectAt: 0, eyeThreshold: 0.60, exposureHardReject: true,  compositionHardReject: false },
  high:     { analysisSize: 512, batchSize: 4, sharpWeight: 0.32, faceWeight: 0.24, aestheticWeight: 0.24, compWeight: 0.20, duplicateThreshold: 5, dupPenalty: 14, picksAt: 72, rejectBelow: 48, hardBlurBelow: 60, picksFocusMin: 60, blownRejectAt: 12, confRejectFloor: 0.28, darkRejectAt: 15, eyeThreshold: 0.50, exposureHardReject: true,  compositionHardReject: true },
}

export async function cullPhotos(items: PhotoItem[], opts: CullOptions): Promise<PhotoItem[]> {
  const preset = PRESETS[opts.mode] || PRESETS.balanced
  const results: PhotoItem[] = items.map((i) => ({ ...i }))
  // Hash disimpan per-item (bukan push saat callback paralel selesai) agar urutan
  // grouping deterministik: run yang sama, folder yang sama = hasil yang sama.

  const batchSize = preset.batchSize
  let done = 0
  // Diagnostik jaminan-proses (dibaca CullingView → stats): berapa foto yang
  // lolos tanpa AI (thumb null / decode gagal) + apakah loop batal di tengah.
  let noSrcCount = 0
  let featNullCount = 0
  let cancelledEarly = false

  for (let i = 0; i < results.length; i += batchSize) {
    if (opts.shouldCancel?.()) { cancelledEarly = true; break }
    const batch = results.slice(i, i + batchSize)
    await Promise.all(batch.map(async (item) => {
      // v2: analysis image (High) didahulukan; thumb untuk grid + mode lain.
      const src = (item as any).analysisUrl || item.thumbUrl || item.dataUrl
      if (item.isRaw && !src) {
        item.sharpness = 55
        item.aesthetic = 55
        item.exposure = 55
        item.score = 52
        item.confidence = 0.4
        item.reasons = ['RAW — pratinjau tidak tersedia, perlu cek manual']
        item.reasonsEn = ['RAW — no preview, needs manual check']
        ;(item as any).dhash = '0'.repeat(64)
        return
      }
      // Foto tanpa gambar sama sekali (thumbnail gagal & bukan RAW) → aman: Maybe, JANGAN throw.
      if (!src) {
        noSrcCount++
        item.sharpness = 40
        item.aesthetic = 45
        item.exposure = 45
        item.score = 46
        item.confidence = 0.3
        item.reasons = ['Pratinjau gagal dimuat — masuk Maybe agar tidak hilang']
        item.reasonsEn = ['Preview failed to load — kept in Maybe to be safe']
        ;(item as any).dhash = '0'.repeat(64)
        return
      }
      let feat: PipelineFeatures | null = null
      try {
        feat = opts.analyze
          ? await opts.analyze(src, preset.analysisSize)
          : await analyzeOne(src, preset.analysisSize)
      } catch {
        feat = null
      }
      if (!feat) {
        featNullCount++
        item.sharpness = 40
        item.aesthetic = 45
        item.score = 42
        item.confidence = 0.3
        item.reasons = ['Gagal dianalisis — masuk Maybe agar tidak hilang']
        item.reasonsEn = ['Analysis failed — kept in Maybe to be safe']
        ;(item as any).dhash = '0'.repeat(64)
        return
      }

      const { sharpness: sh, aesthetic: ae, composition: co, face, tilt, subject, motion, dhash } = feat
      ;(item as any).dhash = dhash
      // v2 subject (High saja; mode lain tak tersentuh).
      const v2s = V2_SUBJECT && opts.mode === 'high'
      const subjFocus = v2s ? subject.focus : null
      ;(item as any).subjFocus = subjFocus
      ;(item as any).motion = v2s ? motion.motionLikelihood : 0
      // v2 ONNX (High + wajah + mata unknown saja): lokalisasi nyata untuk cap
      // wajah-dominan. Gagal/load-gagal = diam (fallback heuristik). Ghost-skin
      // produk tak dapat box → tak kena cap (kasus DSCF3951).
      if (V2_ONNX && opts.mode === 'high' && face.hasFace && face.eyesState === 'unknown') {
        try {
          const img = await decodeOnce(src, 320)
          const sum = img ? await detectFacesONNX(img) : null
          ;(item as any).onnxFace = sum
          if (sum && sum.available && sum.maxArea > 0.12) {
            ;(item as any).onnxDominantUnknown = true
          }
        } catch {
          ;(item as any).onnxFace = null
        }
      }
      // Pass-2 eye ROI (Fase 6, High + unknown + box kecil): crop wajah ONNX
      // lalu heuristik mata yang sama. Upgrade hanya bila yakin
      // (open p≤0.2 / closed p>0.6); Node = skip → harness bit-identik.
      if (V2_PASS2 && opts.mode === 'high' && face.hasFace && face.eyesState === 'unknown') {
        try {
          const sum = (item as any).onnxFace
          const cands = (sum?.boxes ?? []).filter((b: any) => b.score >= 0.7 && (b.box.w * b.box.h) < 0.12)
            .sort((a: any, b: any) => b.score - a.score)
          if (cands.length) {
            const img640 = await decodeOnce(src, 640)
            const roi = img640 ? await refineEyesWithROI(img640, cands[0].box) : null
            ;(item as any).pass2 = roi
            if (roi && roi.eyesState === 'open' && roi.eyesClosedProbability <= 0.2) {
              face.eyesState = 'open'
              face.eyesClosedProbability = roi.eyesClosedProbability
            } else if (roi && roi.eyesState === 'closed' && roi.eyesClosedProbability > 0.6) {
              face.eyesState = 'closed'
              face.eyesClosedProbability = roi.eyesClosedProbability
            }
          }
        } catch {
          ;(item as any).pass2 = null
        }
      }

      // Keputusan mata tertutup memakai ambang probabilitas per mode (high paling tegas).
      // WAJIB state 'closed': 'unknown' (pupil tak terbaca) tidak boleh vonis mata —
      // terbukti salah menuduh 8 foto (tangan di depan wajah, mata sipit senyum).
      const eyesClosed = face.hasFace
        && face.eyesState === 'closed'
        && face.eyesClosedProbability >= preset.eyeThreshold

      // Skor fokus = gabungan Laplacian global + ketajaman subjek + kerapatan tepi.
      // Inilah angka "ketajaman" yang dipakai di semua vonis di bawah.
      const focus = sh.focus
      const centerHi = ae.clippedHiCenterPct ?? 0
      const meanLum = ae.meanLum
      const whiteBg = ae.whiteBackground === true

      // Mode objek = PRODUK studio: permukaan mulus + rim tajam + TERANG merata.
      // Syarat lum≥120 (keramik terukur 176-241): foto manusia remang (lum 55-83,
      // area gelap mendominasi → p50 rendah + kusen tajam) tak boleh menyamar
      // jadi produk — terbukti IMG_6168/69/70 lolos Picks (user report).
      const smoothObject = !face.hasFace && sh.gradP50 < 2 && sh.gradP99 > 18 && meanLum >= 120
      ;(item as any).whiteBg = whiteBg
      ;(item as any).objMode = smoothObject
      ;(item as any).hasFace = face.hasFace === true

      // Mata yang JELAS terbuka (pupil teresolusi, bukan blob kulit raksasa seperti
      // jari menutupi lensa) = bukti foto tidak hancur → lindungi dari vonis blur
      // (tetap bisa Maybe, tak bisa Picks bila lunak). Syarat fokus ≥50: di bawah itu
      // bahkan pupil "terlihat" pun tak cukup (terukur: selfie bagus ≥61, finger 46-48).
      const eyesClearlyOpen = face.hasFace
        && face.eyesState === 'open'
        && face.eyesClosedProbability <= 0.15
        && face.skinRatio <= 0.5
        && focus >= 50

      item.sharpness = focus
      item.aesthetic = ae.score
      item.exposure = ae.exposure
      item.composition = co.score
      item.eyesClosed = eyesClosed
      ;(item as any).faceConfidence = face.faceConfidence
      ;(item as any).clippedHi = ae.clippedHiPct
      ;(item as any).clippedLo = ae.clippedLoPct
      ;(item as any).centerHi = centerHi
      ;(item as any).meanLum = meanLum
      ;(item as any).hiPct = ae.clippedHiPct
      ;(item as any).borderHi = ae.clippedHiBorderPct
      ;(item as any).loPct = ae.clippedLoPct
      ;(item as any).maxEdge = co.maxEdge
      ;(item as any).compConfidence = co.confidence
      ;(item as any).subject = sh.subject
      ;(item as any).edge = sh.edge
      ;(item as any).gradP50 = sh.gradP50
      ;(item as any).gradP99 = sh.gradP99
      ;(item as any).color = ae.colorfulness
      ;(item as any).accidental = sh.accidental
      ;(item as any).eyesState = face.eyesState
      ;(item as any).eyesP = face.eyesClosedProbability
      ;(item as any).eyesOpenProtect = eyesClearlyOpen
      ;(item as any).skinRatio = face.skinRatio
      item.isDuplicate = false

      const reasons: string[] = []
      const reasonsEn: string[] = []

      // Vonis blur keluar bila TERBUKTI: Laplacian yakin, atau kerapatan tepi rendah
      // (foto gelap: Laplacian diboost normalisasi, tapi tepi tak bisa bohong).
      // Pita 'Blur' = PERSIS syarat hard-rule di bawah: yang di-reject pasti beralasan.
      // Mode objek dikecualikan: kemulusan di sana = fitur, bukan cacat.
      const blurProven = sh.confidence > 0.5 || sh.edge < 45
      const blurWillReject = focus < preset.hardBlurBelow && !smoothObject && !eyesClearlyOpen
      if (blurWillReject) {
        reasons.push('Blur / tidak fokus'); reasonsEn.push('Blurry / out of focus')
      } else if (!smoothObject && blurProven && !sh.isFlat && focus < 65) {
        reasons.push('Agak blur'); reasonsEn.push('Slightly soft')
      }
      if (sh.accidental) { reasons.push('Frame kosong (hitam/putih total)'); reasonsEn.push('Blank frame (fully black/white)') }
      // Panggung gelap exposure hancur (high saja): skor komposit selamat karena
      // fokus tinggi + kontras lampu, tapi foto tak bisa diedit → rejects.
      // Guard clippedHi: panggung laser/neon (ada highlight hidup) tidak kena.
      // Terkalibrasi: 6/1278 foto OSIS, verifikasi visual (semua remang tak terbaca).
      const darkRuined = preset.darkRejectAt > 0 && !whiteBg && ae.exposure <= preset.darkRejectAt && meanLum < 35 && ae.clippedHiPct < 5
      if (darkRuined) { reasons.push('Terlalu gelap (exposure hancur)'); reasonsEn.push('Too dark (exposure ruined)') }
      if (eyesClosed) { reasons.push('Mata tertutup'); reasonsEn.push('Eyes closed') }
      if (tilt.tilted) { reasons.push('Horizon miring'); reasonsEn.push('Tilted horizon') }
      if (v2s && motion.motionLikelihood > 0.6) { reasons.push('Gerak / motion blur?'); reasonsEn.push('Motion blur?') }
      if ((item as any).onnxDominantUnknown) { reasons.push('Wajah besar tak terbaca'); reasonsEn.push('Large face unreadable') }
      for (let i = 0; i < ae.reasons.length; i++) {
        // Pastel pada produk = pilihan artistik, bukan cacat yang perlu dilaporkan.
        if (smoothObject && ae.reasons[i] === 'Warna pucat') continue
        reasons.push(ae.reasons[i]); reasonsEn.push(ae.reasonsEn[i])
      }
      if (co.reasons.length && co.confidence > 0.45) { reasons.push(...co.reasons); reasonsEn.push(...co.reasonsEn) }
      if (focus > 75 && ae.score > 72 && !eyesClosed && ae.clippedHiPct < 4 && co.score > 55) {
        reasons.push('Tajam & eksposur bagus'); reasonsEn.push('Sharp & well exposed')
      }
      item.reasons = reasons.slice(0, 4)
      item.reasonsEn = reasonsEn.slice(0, 4)

      // --- Skor komposit dengan confidence gating ---
      let faceScore = 72 // netral bila tak ada wajah terdeteksi
      if (face.hasFace) {
        // v2: unknown = zero evidence = netral 72 (bukan 78 nyaris-open).
        // Mata tak terbaca (unknown) = nilai potret lebih rendah dari mata terbuka jelas.
        faceScore = eyesClosed ? 12 : (face.eyesState === 'unknown' ? (v2s ? 72 : 78) : 88)
        // confidence rendah → tarik ke netral agar tidak ngawur
        faceScore = Math.round(faceScore * (0.45 + 0.55 * face.faceConfidence) + 72 * (0.55 - 0.55 * face.faceConfidence))
        if (face.faceCount > 1 && !eyesClosed) faceScore = Math.min(96, faceScore + 4)
      }
      // Wajah terbuka tak boleh menyelamatkan foto blur: skala ke bawah bila fokus rendah.
      if (focus < 60) faceScore = Math.round(faceScore * (0.55 + 0.45 * (focus / 60)))

      // Bobot sharp dikurangi jika confidence rendah (foto gelap/flat)
      const shW = preset.sharpWeight * (0.6 + 0.4 * sh.confidence)
      const aeW = preset.aestheticWeight * (0.7 + 0.3 * ae.confidence)
      const fW = preset.faceWeight
      const coW = preset.compWeight * (0.5 + 0.5 * co.confidence)
      const wSum = shW + aeW + fW + coW || 1
      let score: number
      if (smoothObject) {
        // Tanpa wajah + permukaan mulus + rim tajam: nilai exposure & komposisi saja.
        score = Math.round(ae.score * 0.6 + co.score * 0.4)
      } else {
        score = Math.round((focus * shW + ae.score * aeW + faceScore * fW + co.score * coW) / wSum)
      }

      // Penalti clipping keras (gaun blown tidak boleh jadi Picks walau tajam).
      // Latar putih studio dikecualikan (bukan cacat).
      if (!whiteBg && ae.clippedHiPct > 9) score -= Math.min(18, Math.round((ae.clippedHiPct - 9) * 1.2))
      // Malam kontras kasar: bayangan hancur + lampu pecah sekaligus.
      if (ae.clippedLoPct > 45 && ae.clippedHiPct > 4 && meanLum < 95) {
        score -= 10
        reasons.push('Kontras kasar (gelap + silau)'); reasonsEn.push('Harsh contrast (dark + glare)')
        item.reasons = reasons.slice(0, 4); item.reasonsEn = reasonsEn.slice(0, 4)
      }
      if (sh.isFlat || ae.isFlat) score = Math.min(score, 62)
      // Horizon miring = cacat ringan: penalti kecil, tak pernah vonis.
      if (tilt.tilted) score -= 6

      item.score = Math.max(0, Math.min(99, score))
      // v2 cap (High saja): unknown di wajah dominan + subjek kritis lunak.
      // Ambang provisional, kalibrasi via bench (lihat fase-update Fase 2).
      let v2cap: '' | 'maybe' | 'reject' = ''
      if (v2s && (item as any).onnxDominantUnknown) v2cap = 'maybe'
      // Cap unknown-skin DITAHAN (2026-09-16): tanpa label manusia, unknown saja
      // bukan eviden cukup untuk demosi — ghost-skin produk (DSCF3951) ikut kena.
      // Yang aktif: netral 72 (tanpa reward) + critical subject gate di bawah.
      if (v2s && face.hasFace && subjFocus !== null && subjFocus < 55 && !smoothObject) v2cap = 'maybe'
      if (v2s && face.hasFace && subjFocus !== null && subjFocus < 35 && face.faceConfidence > 0.6 && !smoothObject) v2cap = 'reject'
      ;(item as any).v2cap = v2cap
      // confidence keseluruhan untuk UI (mis. tampilkan "perlu cek manual" jika rendah)
      item.confidence = Math.round(((sh.confidence + ae.confidence + (face.hasFace ? face.faceConfidence : 0.7)) / 3) * 100) / 100
    }))
    done += batch.length
    if (opts.onProgress) batch.forEach((b) => opts.onProgress!(done, results.length, b))
    await new Promise((r) => setTimeout(r, 0)) // yield agar UI tidak freeze
  }

  // Duplikat/burst yang bagus BUKAN sampah — selalu Maybe (bisa direview), tak pernah
  // auto-reject. Rejects hanya untuk foto yang benar-benar cacat (blur, mata
  // tertutup, exposure hancur). Skor tetap dipenalti agar yang terbaik menonjol.
  // HIGH saja: anggota yang JELAS lebih lunak dari kembaran tertajamnya (gap fokus
  // ≥7 DAN di bawah 82) = versi gagal dari momen yang sama → Rejects. Terkalibrasi:
  // noise antar-frame identik hanya 0-1 (p90), jadi gap 7 = perbedaan nyata,
  // terverifikasi visual (kasus 8012 vs 8015). Mode lain tidak berubah.
  const hashes: { id: string; hash: string }[] = results.map((r) => ({
    id: r.id,
    hash: (r as any).dhash ?? '0'.repeat(64),
  }))
  const groups = groupDuplicates(hashes, preset.duplicateThreshold)
  const v2rank = V2_BURST_RANK && opts.mode === 'high'
  groups.forEach((ids) => {
    const groupItems = ids.map((id) => results.find((r) => r.id === id)!).filter(Boolean)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
    const maxFocus = Math.max(...groupItems.map((g) => g.sharpness ?? 0))
    const best = groupItems[0]
    ;(best as any).clusterRank = 0
    ;(best as any).clusterSize = groupItems.length
    for (let k = 1; k < groupItems.length; k++) {
      const g = groupItems[k]
      g.isDuplicate = true
      g.duplicateGroup = ids[0]
      g.reasons = [...(g.reasons || []), 'Duplikat / burst']
      g.reasonsEn = [...(g.reasonsEn || []), 'Duplicate / burst']
      g.score = Math.max(0, (g.score || 50) - preset.dupPenalty)
      // Diagnostik ranking (stabil: skor desc; input order stabil → deterministik).
      const margin = (best.score || 0) - (g.score || 0)
      ;(g as any).clusterRank = k
      ;(g as any).clusterSize = groupItems.length
      ;(g as any).marginToBest = margin
      if (opts.mode === 'high') {
        const f = g.sharpness ?? 100
        if (maxFocus - f >= 7 && f < 82) {
          ;(g as any).softestInBurst = true
          g.reasons = [...g.reasons.filter((r) => r !== 'Tajam & eksposur bagus'), 'Terlunak di burst-nya']
          g.reasonsEn = [...g.reasonsEn.filter((r) => r !== 'Sharp & well exposed'), 'Softest in its burst']
        }
        // v2 redundant loser (High): margin besar + nyaris identik + tak divers.
        // Diversity guard: beda makna (framing/exposure/fokus) = Maybe, bukan Reject.
        if (v2rank && !(g as any).softestInBurst) {
          const hDist = hammingDistanceLimited((best as any).dhash ?? '', (g as any).dhash ?? '', 64)
          const focusDiff = Math.abs((best.sharpness ?? 0) - (g.sharpness ?? 0))
          const expoDiff = Math.abs((best.exposure ?? 0) - (g.exposure ?? 0))
          const diverse = hDist >= 3 || focusDiff >= 10 || expoDiff >= 15
          ;(g as any).redundantDiverse = diverse
          if (!diverse && margin >= 12) {
            ;(g as any).redundantInBurst = true
            g.reasons = [...g.reasons.filter((r) => r !== 'Tajam & eksposur bagus'), 'Frame serupa — versi lain lebih baik']
            g.reasonsEn = [...g.reasonsEn.filter((r) => r !== 'Sharp & well exposed'), 'Similar frame — another version is better']
          }
        }
      }
    }
  })

  // Kategorisasi — hard rule dulu (objektif, berani), baru threshold skor per mode.
  // item.sharpness di sini = skor FOKUS (global + subjek + tepi), bukan Laplacian mentah.
  const v2sCap = V2_SUBJECT && opts.mode === 'high'
  for (const item of results) {
    // Reason codes final (setelah push duplikat) untuk diagnostik/evaluator.
    ;(item as any).reasonCodes = codesFor(item.reasons)
    const s = item.score ?? 50
    const clippedHi = (item as any).clippedHi ?? 0
    const clippedLo = (item as any).clippedLo ?? 0
    const centerHi = (item as any).centerHi ?? 0
    const comp = item.composition ?? 55
    const conf = item.confidence ?? 1
    const focus = item.sharpness ?? 100
    // Highlight gosong: background gosong pada foto tajam = masalah editing, BUKAN
    // alasan culling (terbukti menolak foto grup bagus). Tolak hanya bila gosong
    // EKSTREM dan foto juga tak tajam; selebihnya Maybe (tak bisa Picks).
    // Latar putih studio dikecualikan total (bukan cacat).
    const whiteBg = (item as any).whiteBg === true
    const smoothObject = (item as any).objMode === true
    const blownExtreme = !whiteBg && (clippedHi > 25 || centerHi > 18)
    const blownMid = !whiteBg && (clippedHi > preset.blownRejectAt || centerHi > 12)
    let cat: CullCategory
    if (item.eyesClosed) {
      cat = 'rejects'
    } else if ((item as any).accidental) {
      cat = opts.mode === 'fast' ? 'maybe' : 'rejects' // frame kosong total
    } else if (focus < preset.hardBlurBelow && !smoothObject && !(item as any).eyesOpenProtect
      && !(v2sCap && preset.hardBlurBelow - focus <= 2 && (item.exposure ?? 0) >= 90 && (item as any).meanLum >= 100)) {
      cat = 'rejects' // fokus hancur pada konten bertekstur (objek mulus dinilai tanpa blur).
      // Lunak-ringkas tapi TERANG (expo≥90, lum≥100, mis. IMG_6175 f59) = ambiguitas
      // ringan → jatuh ke threshold (biasanya Maybe), bukan vonis keras.
    } else if (preset.exposureHardReject && (item as any).meanLum !== undefined && (item as any).meanLum < 22 && clippedLo > 35) {
      cat = 'rejects' // nyaris gelap total
    } else if (preset.darkRejectAt > 0 && !whiteBg && (item.exposure ?? 100) <= preset.darkRejectAt && (item as any).meanLum < 35 && clippedHi < 5) {
      cat = 'rejects' // exposure hancur panggung gelap (high saja; fokus tinggi tak menyelamatkan)
    } else if ((item as any).v2cap === 'reject') {
      cat = 'rejects' // v2: subjek wajah kritis lunak + yakin (high saja)
    } else if (blownExtreme && preset.exposureHardReject && focus < 65) {
      cat = 'rejects' // gosong parah + tak tajam = sampah
    } else if (blownMid) {
      cat = 'maybe' // highlight pecah tapi subjek selamat → jangan picks, jangan reject
    } else if (preset.compositionHardReject && comp < 20 && (item as any).compConfidence > 0.5) {
      cat = 'rejects' // komposisi hancur (high saja)
    } else if (item.isDuplicate) {
      // Kembaran yang jelas lebih lunak dari yang tertajam = versi gagal → Rejects.
      // Kembaran yang setara = Maybe (bisa dipilih manual).
      cat = (s < 35 || (item as any).softestInBurst === true || (item as any).redundantInBurst === true) ? 'rejects' : 'maybe'
    } else if (s >= (smoothObject ? preset.picksAt - 10 : preset.picksAt)) {
      // Picks harus bersih: tajam (kecuali objek mulus: fokus tak bermakna),
      // tidak clipped, komposisi layak. Palang objek 10 poin lebih rendah karena
      // langit-langit skornya memang lebih rendah (tekstur tak dinilai).
      // Terkalibrasi di 74 foto produk: yang bersih lewat, bercacat tertahan gate lain.
      const focusGate = !smoothObject && focus < preset.picksFocusMin
      const clipGate = !whiteBg && (clippedHi > 8 || centerHi > 6)
      // v2 cap (High saja): exposure hancur (bukan whiteBg/objek) = max Maybe.
      // Terukur: 3 foto panggung OSIS (expo 26-28, f94-95); nol di dataset lain.
      const expoCap = v2sCap && !smoothObject && !whiteBg && (item.exposure ?? 100) < 32
      // Remang-blur (High): tanpa wajah + bukan produk + REMANG + lunak = max Maybe.
      // Ambang lum<70 (bukan 95): foto kasual terang-biasa (lum 76-93, DIGICAM
      // 0046/56/70/72) terbukti bagus → jangan sentuh. Yang kena: remang nyata.
      const dimSoftCap = v2sCap && !smoothObject && !whiteBg && !(item as any).hasFace
        && (item as any).meanLum < 70 && focus < 75
      // Ketajaman milik background (High): zona tengah jauh lebih tajam +
      // tanpa wajah + remang = subjek (orang) lunak, background tajam.
      // Terukur: IMG_6191 (subj78, pintu tajam, orang blur).
      const bgSharpCap = v2sCap && !smoothObject && !whiteBg && !(item as any).hasFace
        && (item as any).meanLum < 90 && (item as any).subjFocus != null && (item as any).subjFocus - focus >= 5
      cat = clipGate || comp < 30 || focusGate || expoCap || dimSoftCap || bgSharpCap || (item as any).v2cap === 'maybe' ? 'maybe' : 'picks'
    }
    else if (s >= preset.rejectBelow) cat = 'maybe'
    else cat = 'rejects'

    // Pengaman terakhir: confidence sangat rendah → jangan reject, taruh Maybe.
    // Lantainya diturunkan per mode agar yang berani (high) jarang disoin.
    if (cat === 'rejects' && conf < preset.confRejectFloor && !item.eyesClosed) cat = 'maybe'

    // LARANGAN KERAS (user): tak ada vonis tanpa keterangan. Bila reasons kosong:
    // picks/maybe dapat ringkasan eviden jujur; rejects TANPA bukti = turun Maybe.
    if (!item.reasons || item.reasons.length === 0) {
      const expo = item.exposure ?? 0
      if (cat === 'rejects') {
        cat = 'maybe'
        item.reasons = ['Perlu review manual']
        item.reasonsEn = ['Needs manual review']
      } else if (cat === 'picks') {
        const pos: [string, string][] = []
        if (!smoothObject && focus >= 70) pos.push(['Fokus baik', 'Good focus'])
        if (expo >= 60) pos.push(['Eksposur baik', 'Good exposure'])
        if (comp >= 60) pos.push(['Komposisi baik', 'Good composition'])
        if ((item as any).eyesState === 'open') pos.push(['Mata terbuka', 'Eyes open'])
        if (!pos.length) pos.push(['Lolos semua gate', 'Passed all gates'])
        item.reasons = pos.slice(0, 2).map(([id]) => id)
        item.reasonsEn = pos.slice(0, 2).map(([, en]) => en)
      } else {
        item.reasons = [`Belum meyakinkan (skor ${s})`]
        item.reasonsEn = [`Uncertain (score ${s})`]
      }
      ;(item as any).reasonCodes = codesFor(item.reasons)
    }

    item.category = cat
  }

  clearPipelineCache()
  ;(results as any).cullDebug = { noSrc: noSrcCount, featNull: featNullCount, cancelled: cancelledEarly, total: results.length }
  return results
}
