import { newTrace, type EngineTrace } from '../ai-engine-v2/diagnostics/trace'
import { technicalEvidence } from '../ai-engine-v2/technical/evidence'
import type { PhotoItem, Sensitivity, CullCategory } from '@/types'
import { analyzeOne, clearPipelineCache, decodeOnce, V2_SUBJECT, V2_BURST_RANK, V2_HIEYE, type PipelineFeatures } from './pipeline'
import { groupDuplicates, hammingDistanceLimited } from './duplicate'
import { codesFor } from './reasons'
import { V2_ONNX, V2_PASS2, detectFacesONNX } from '../ml/face-onnx'
import { refineEyesWithROI } from '../ml/eye-roi'

export interface CullOptions {
  onTrace?: (trace: EngineTrace) => void
  mode: Sensitivity
  onProgress?: (done: number, total: number, current: PhotoItem) => void
  shouldCancel?: () => boolean
  // Suntikan penganalisis (default: decode browser). Harness Node menyuntik versi sharp
  // agar KALIBRASI memakai kode scoring/kategorisasi yang 100% sama dengan produksi.
  analyze?: (src: string, size: number) => Promise<PipelineFeatures | null>
}

import { PRESETS } from './presets'
import { classifyLegacy } from './legacy-policy'
export { PRESETS } from './presets'

export async function cullPhotos(items: PhotoItem[], opts: CullOptions): Promise<PhotoItem[]> {
  const preset = PRESETS[opts.mode] || PRESETS.balanced
  // Reanalysis starts from photo input, never from cached engine evidence.
  const results: PhotoItem[] = items.map(i => ({
    id: i.id, fileName: i.fileName, filePath: i.filePath, pairedPath: i.pairedPath,
    previewPath: i.previewPath, isPaired: i.isPaired, isRaw: i.isRaw, ext: i.ext,
    size: i.size, mtimeMs: i.mtimeMs, baseName: i.baseName,
    dataUrl: i.dataUrl, thumbUrl: i.thumbUrl, analysisUrl: i.analysisUrl,
  }))
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
      const started = performance.now()
      const trace = newTrace(item.id)
      ;(item as any).engineTrace = trace
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
        trace.inputError = 'PREVIEW_UNAVAILABLE'
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
        trace.inputStatus = 'error'
        trace.inputError = 'ANALYSIS_FAILED'
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

      trace.inputStatus = 'ok'
      trace.technical = technicalEvidence(feat)
      trace.timingMs.technical = performance.now() - started
      trace.eyeBefore = feat.face.eyesState
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
          trace.onnx = sum ?? { status: 'unavailable', available: false, count: 0, maxScore: 0, maxArea: 0, boxes: [], durationMs: 0, errorCode: 'DECODE_FAILED' }
          ;(item as any).onnxFace = sum
          if (sum && sum.available && sum.maxArea > 0.12) {
            ;(item as any).onnxDominantUnknown = true
          }
        } catch (e) {
          trace.onnx = { status: 'error', available: false, count: 0, maxScore: 0, maxArea: 0, boxes: [], durationMs: 0, errorCode: String((e as Error)?.message || e) }
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
            trace.pass2 = { status: roi ? 'ok' : 'unknown', result: roi }
            ;(item as any).pass2 = roi
            if (roi && roi.eyesState === 'open' && roi.eyesClosedProbability <= 0.2) {
              face.eyesState = 'open'
              face.eyesClosedProbability = roi.eyesClosedProbability
            } else if (roi && roi.eyesState === 'closed' && roi.eyesClosedProbability > 0.6) {
              face.eyesState = 'closed'
              face.eyesClosedProbability = roi.eyesClosedProbability
            }
          }
        } catch (e) {
          trace.pass2 = { status: 'error', errorCode: String((e as Error)?.message || e) }
          ;(item as any).pass2 = null
        }
      }
      // GT-2026-09: eye second-pass resolusi tinggi (High + wajah + unknown).
      // Pupil kecil tak teresolusi di 512 (merem = unknown) vs teresolusi di 768
      // (terbuka, hits≥5). Upgrade-only + catat pupilHits; gagal = diam.
      // Harness: lewat opts.analyze (sharp) — terukur identik dengan produksi.
      if (V2_HIEYE && opts.mode === 'high' && face.hasFace && face.eyesState === 'unknown') {
        try {
          const hi = opts.analyze
            ? await opts.analyze(src, 768)
            : await analyzeOne(src, 768)
          trace.hiEye = { status: hi ? 'ok' : 'unknown' }
          const hf = hi?.face
          if (hf && hf.hasFace) {
            face.pupilHits = hf.pupilHits ?? face.pupilHits
            if (hf.eyesState === 'open' && hf.eyesClosedProbability <= 0.2) {
              face.eyesState = 'open'
              face.eyesClosedProbability = hf.eyesClosedProbability
            } else if (hf.eyesState === 'closed' && hf.eyesClosedProbability > 0.6) {
              face.eyesState = 'closed'
              face.eyesClosedProbability = hf.eyesClosedProbability
            }
          }
        } catch (e) {
          trace.hiEye = { status: 'error', errorCode: String((e as Error)?.message || e) }
          ;(item as any).eyeHi = null
        }
      }
      trace.eyeAfter = face.eyesState
      trace.eyeProbability = face.eyesClosedProbability
      trace.onnxDominantUnknown = !!(item as any).onnxDominantUnknown
      trace.timingMs.face = performance.now() - started - trace.timingMs.technical
      ;(item as any).pupilHits = face.pupilHits ?? 0

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
      // GT-2026-09: mata tak-terbukti-terbuka (unknown) = ragu → plafon Maybe,
      // bukan vonis keras. Selisih 4 di bawah ambang blur = zona ragu.
      const blurDoubt = face.hasFace && face.eyesState === 'unknown'
      const blurFloor = preset.hardBlurBelow - (blurDoubt ? 4 : 0)
      ;(item as any).blurFloor = blurFloor
      const blurWillReject = focus < blurFloor && !smoothObject && !eyesClearlyOpen
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
      // GT-2026-09: plafon Maybe untuk unknown-tanpa-pupil DITAHAN (bleed 35
      // H-Pick vs gain 13; Maybe 41% > target 10–25%). Lihat MEMORY §6b.
      ;(item as any).v2cap = v2cap
      // confidence keseluruhan untuk UI (mis. tampilkan "perlu cek manual" jika rendah)
      item.confidence = Math.round(((sh.confidence + ae.confidence + (face.hasFace ? face.faceConfidence : 0.7)) / 3) * 100) / 100
      trace.focusScore = item.sharpness
      trace.timingMs.total = performance.now() - started
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
    for (const member of groupItems) (member as any).burstId = ids[0]
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

  for (const item of results) {
    classifyLegacy(item, opts.mode)
    const trace = (item as any).engineTrace as EngineTrace | undefined
    if (trace) {
      trace.decision = item.category
      trace.reasons = (item as any).reasonCodes || codesFor(item.reasons)
      trace.burstId = (item as any).burstId
      opts.onTrace?.(trace)
    }
  }

  clearPipelineCache()
  ;(results as any).cullDebug = { noSrc: noSrcCount, featNull: featNullCount, cancelled: cancelledEarly, total: results.length }
  return results
}
