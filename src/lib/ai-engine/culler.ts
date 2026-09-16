import type { PhotoItem, Sensitivity, CullCategory } from '@/types'
import { analyzeOne, clearPipelineCache, type PipelineFeatures } from './pipeline'
import { groupDuplicates } from './duplicate'

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
  eyeThreshold: number
  exposureHardReject: boolean
  compositionHardReject: boolean
}

// Fast = sortir awal (hanya yang jelas gagal dibuang, sisanya Maybe).
// Balanced = harian, objektif. High = seleksi akhir (paling berani me-reject).
export const PRESETS: Record<Sensitivity, ModePreset> = {
  fast:     { analysisSize: 256, batchSize: 8, sharpWeight: 0.37, faceWeight: 0.27, aestheticWeight: 0.26, compWeight: 0.10, duplicateThreshold: 9, dupPenalty: 8,  picksAt: 75, rejectBelow: 40, hardBlurBelow: 45, picksFocusMin: 60, blownRejectAt: 18, confRejectFloor: 0.45, eyeThreshold: 0.70, exposureHardReject: false, compositionHardReject: false },
  balanced: { analysisSize: 384, batchSize: 6, sharpWeight: 0.34, faceWeight: 0.26, aestheticWeight: 0.25, compWeight: 0.15, duplicateThreshold: 7, dupPenalty: 10, picksAt: 70, rejectBelow: 45, hardBlurBelow: 55, picksFocusMin: 60, blownRejectAt: 14, confRejectFloor: 0.32, eyeThreshold: 0.60, exposureHardReject: true,  compositionHardReject: false },
  high:     { analysisSize: 512, batchSize: 4, sharpWeight: 0.32, faceWeight: 0.24, aestheticWeight: 0.24, compWeight: 0.20, duplicateThreshold: 5, dupPenalty: 14, picksAt: 72, rejectBelow: 48, hardBlurBelow: 60, picksFocusMin: 60, blownRejectAt: 12, confRejectFloor: 0.28, eyeThreshold: 0.50, exposureHardReject: true,  compositionHardReject: true },
}

export async function cullPhotos(items: PhotoItem[], opts: CullOptions): Promise<PhotoItem[]> {
  const preset = PRESETS[opts.mode] || PRESETS.balanced
  const results: PhotoItem[] = items.map((i) => ({ ...i }))
  const hashes: { id: string; hash: string }[] = []

  const batchSize = preset.batchSize
  let done = 0

  for (let i = 0; i < results.length; i += batchSize) {
    if (opts.shouldCancel?.()) break
    const batch = results.slice(i, i + batchSize)
    await Promise.all(batch.map(async (item) => {
      const src = item.thumbUrl || item.dataUrl
      if (item.isRaw && !src) {
        item.sharpness = 55
        item.aesthetic = 55
        item.exposure = 55
        item.score = 52
        item.confidence = 0.4
        item.reasons = ['RAW — pratinjau tidak tersedia, perlu cek manual']
        item.reasonsEn = ['RAW — no preview, needs manual check']
        hashes.push({ id: item.id, hash: '0'.repeat(64) })
        return
      }
      // Foto tanpa gambar sama sekali (thumbnail gagal & bukan RAW) → aman: Maybe, JANGAN throw.
      if (!src) {
        item.sharpness = 40
        item.aesthetic = 45
        item.exposure = 45
        item.score = 46
        item.confidence = 0.3
        item.reasons = ['Pratinjau gagal dimuat — masuk Maybe agar tidak hilang']
        item.reasonsEn = ['Preview failed to load — kept in Maybe to be safe']
        hashes.push({ id: item.id, hash: '0'.repeat(64) })
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
        item.sharpness = 40
        item.aesthetic = 45
        item.score = 42
        item.confidence = 0.3
        item.reasons = ['Gagal dianalisis — masuk Maybe agar tidak hilang']
        item.reasonsEn = ['Analysis failed — kept in Maybe to be safe']
        hashes.push({ id: item.id, hash: '0'.repeat(64) })
        return
      }

      const { sharpness: sh, aesthetic: ae, composition: co, face, dhash } = feat
      hashes.push({ id: item.id, hash: dhash })

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

      // Mode objek (produk/makanan/keramik): tanpa wajah + permukaan mulus (p50
      // rendah) + ada tepi tajam di rim (p99 tinggi). Tekstur dinilai TIDAK RELEVAN
      // di sini — yang dinilai: exposure, komposisi, warna. Tanpa mode ini, glasir
      // bersih selalu divonis "blur" (terbukti di 30+ foto keramik).
      const smoothObject = !face.hasFace && sh.gradP50 < 2 && sh.gradP99 > 18
      ;(item as any).whiteBg = whiteBg
      ;(item as any).objMode = smoothObject

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
      if (eyesClosed) { reasons.push('Mata tertutup'); reasonsEn.push('Eyes closed') }
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
        // Mata tak terbaca (unknown) = nilai potret lebih rendah dari mata terbuka jelas.
        faceScore = eyesClosed ? 12 : (face.eyesState === 'unknown' ? 78 : 88)
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

      item.score = Math.max(0, Math.min(99, score))
      // confidence keseluruhan untuk UI (mis. tampilkan "perlu cek manual" jika rendah)
      item.confidence = Math.round(((sh.confidence + ae.confidence + (face.hasFace ? face.faceConfidence : 0.7)) / 3) * 100) / 100
    }))
    done += batch.length
    if (opts.onProgress) batch.forEach((b) => opts.onProgress!(done, results.length, b))
    await new Promise((r) => setTimeout(r, 0)) // yield agar UI tidak freeze
  }

  // Duplikat: hanya penalti, bukan auto-reject (kecuali skor memang rendah)
  const groups = groupDuplicates(hashes, preset.duplicateThreshold)
  groups.forEach((ids) => {
    const groupItems = ids.map((id) => results.find((r) => r.id === id)!).filter(Boolean)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
    for (let k = 1; k < groupItems.length; k++) {
      const g = groupItems[k]
      g.isDuplicate = true
      g.duplicateGroup = ids[0]
      g.reasons = [...(g.reasons || []), 'Duplikat / burst']
      g.reasonsEn = [...(g.reasonsEn || []), 'Duplicate / burst']
      g.score = Math.max(0, (g.score || 50) - preset.dupPenalty)
    }
  })

  // Kategorisasi — hard rule dulu (objektif, berani), baru threshold skor per mode.
  // item.sharpness di sini = skor FOKUS (global + subjek + tepi), bukan Laplacian mentah.
  for (const item of results) {
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
    } else if (focus < preset.hardBlurBelow && !smoothObject && !(item as any).eyesOpenProtect) {
      cat = 'rejects' // fokus hancur pada konten bertekstur (objek mulus dinilai tanpa blur)
    } else if (preset.exposureHardReject && (item as any).meanLum !== undefined && (item as any).meanLum < 22 && clippedLo > 35) {
      cat = 'rejects' // nyaris gelap total
    } else if (blownExtreme && preset.exposureHardReject && focus < 65) {
      cat = 'rejects' // gosong parah + tak tajam = sampah
    } else if (blownMid) {
      cat = 'maybe' // highlight pecah tapi subjek selamat → jangan picks, jangan reject
    } else if (preset.compositionHardReject && comp < 20 && (item as any).compConfidence > 0.5) {
      cat = 'rejects' // komposisi hancur (high saja)
    } else if (item.isDuplicate) {
      cat = s < 35 ? 'rejects' : 'maybe'
    } else if (s >= (smoothObject ? preset.picksAt - 10 : preset.picksAt)) {
      // Picks harus bersih: tajam (kecuali objek mulus: fokus tak bermakna),
      // tidak clipped, komposisi layak. Palang objek 10 poin lebih rendah karena
      // langit-langit skornya memang lebih rendah (tekstur tak dinilai).
      // Terkalibrasi di 74 foto produk: yang bersih lewat, bercacat tertahan gate lain.
      const focusGate = !smoothObject && focus < preset.picksFocusMin
      const clipGate = !whiteBg && (clippedHi > 8 || centerHi > 6)
      cat = clipGate || comp < 30 || focusGate ? 'maybe' : 'picks'
    }
    else if (s >= preset.rejectBelow) cat = 'maybe'
    else cat = 'rejects'

    // Pengaman terakhir: confidence sangat rendah → jangan reject, taruh Maybe.
    // Lantainya diturunkan per mode agar yang berani (high) jarang disoin.
    if (cat === 'rejects' && conf < preset.confRejectFloor && !item.eyesClosed) cat = 'maybe'

    item.category = cat
  }

  clearPipelineCache()
  return results
}
