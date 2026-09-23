import type { PhotoItem, Sensitivity } from '@/types'
import { PRESETS } from './presets'
import { V2_SUBJECT } from './pipeline'
import { codesFor } from './reasons'
import type { CullCategory } from '@/types'

/** Frozen legacy policy, extracted without threshold changes. */
export function classifyLegacy(item: PhotoItem, mode: Sensitivity): void {
  const preset = PRESETS[mode]
  const v2sCap = V2_SUBJECT && mode === 'high'
  // Failed measurement is not evidence of blur. Keep original failure reasons.
  const trace = (item as any).engineTrace
  if (trace && trace.inputStatus !== 'ok') {
    item.category = 'maybe'
    ;(item as any).reasonCodes = ['ANALYSIS_UNAVAILABLE']
    trace.policyRule = 'ANALYSIS_UNAVAILABLE'
    return
  }

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
    let rule = 'SCORE_BELOW_REJECT'
    const decision = (category: CullCategory, code: string): CullCategory => { rule = code; return category }
    if (item.eyesClosed) {
      // GT/exe exposed a false closed-eye Reject. No calibrated eye precision.
      cat = decision('maybe', 'EYE_REVIEW_ONLY')
    } else if ((item as any).accidental) {
      cat = decision(mode === 'fast' ? 'maybe' : 'rejects', 'ACCIDENTAL_FRAME') // frame kosong total
    } else if (focus < ((item as any).blurFloor ?? preset.hardBlurBelow) && !smoothObject && !(item as any).eyesOpenProtect
      && !(v2sCap && preset.hardBlurBelow - focus <= 2 && (item.exposure ?? 0) >= 90 && (item as any).meanLum >= 100)) {
      cat = decision('rejects', 'GLOBAL_BLUR') // fokus hancur pada konten bertekstur (objek mulus dinilai tanpa blur).
      ;(item as any).blurReject = true // GT-2026-09: penanda vonis-blur (proteksi best-of-burst)
      // Lunak-ringkas tapi TERANG (expo≥90, lum≥100, mis. IMG_6175 f59) = ambiguitas
      // ringan → jatuh ke threshold (biasanya Maybe), bukan vonis keras.
    } else if (preset.exposureHardReject && (item as any).meanLum !== undefined && (item as any).meanLum < 22 && clippedLo > 35) {
      cat = decision('rejects', 'EXTREME_DARK') // nyaris gelap total
    } else if (preset.darkRejectAt > 0 && !whiteBg && (item.exposure ?? 100) <= preset.darkRejectAt && (item as any).meanLum < 35 && clippedHi < 5) {
      cat = decision('rejects', 'RUINED_EXPOSURE') // exposure hancur panggung gelap (high saja; fokus tinggi tak menyelamatkan)
    } else if ((item as any).v2cap === 'reject') {
      cat = decision('rejects', 'CRITICAL_SUBJECT') // v2: subjek wajah kritis lunak + yakin (high saja)
    } else if (blownExtreme && preset.exposureHardReject && focus < 65) {
      cat = decision('rejects', 'BLOWN_AND_SOFT') // gosong parah + tak tajam = sampah
    } else if (blownMid) {
      cat = decision('maybe', 'HIGHLIGHT_REVIEW') // highlight pecah tapi subjek selamat → jangan picks, jangan reject
    } else if (preset.compositionHardReject && comp < 20 && (item as any).compConfidence > 0.5) {
      cat = decision('rejects', 'COMPOSITION_FAILURE') // komposisi hancur (high saja)
    } else if (item.isDuplicate) {
      // Kembaran yang jelas lebih lunak dari yang tertajam = versi gagal → Rejects.
      // Kembaran yang setara = Maybe (bisa dipilih manual).
      cat = decision((s < 35 || (item as any).softestInBurst === true || (item as any).redundantInBurst === true) ? 'rejects' : 'maybe', 'LEGACY_DUPLICATE')
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
      const gated = clipGate || comp < 30 || focusGate || expoCap || dimSoftCap || bgSharpCap || (item as any).v2cap === 'maybe'
      cat = decision(gated ? 'maybe' : 'picks', gated ? 'PICK_GATE_REVIEW' : 'PICK_GATES_PASSED')
    }
    else if (s >= preset.rejectBelow) cat = decision('maybe', 'SCORE_REVIEW')
    else cat = 'rejects'

    // GT-2026-09 (High): terbaik di burst-nya (clusterRank 0, grup >1) yang gugur
    // HANYA karena blur = momen terbaik yang lunak → Maybe (bisa direview),
    // bukan Rejects. Tak berlaku bila ada vonis subjek-kritis (v2cap reject).
    if (v2sCap && (item as any).clusterRank === 0 && (item as any).clusterSize > 1 &&
      cat === 'rejects' && (item as any).blurReject === true && (item as any).v2cap !== 'reject') {
      cat = decision('maybe', 'BURST_BEST_SOFT')
      item.reasons = [...(item.reasons || []).filter((r) => r !== 'Blur / tidak fokus'), 'Terbaik di burst-nya tapi lunak']
      item.reasonsEn = [...(item.reasonsEn || []).filter((r) => r !== 'Blurry / out of focus'), 'Best in burst but soft']
    }

    // Pengaman terakhir: confidence sangat rendah → jangan reject, taruh Maybe.
    // Lantainya diturunkan per mode agar yang berani (high) jarang disoin.
    if (cat === 'rejects' && conf < preset.confRejectFloor && !item.eyesClosed) cat = decision('maybe', 'LOW_CONFIDENCE_REVIEW')

    // LARANGAN KERAS (user): tak ada vonis tanpa keterangan. Bila reasons kosong:
    // picks/maybe dapat ringkasan eviden jujur; rejects TANPA bukti = turun Maybe.
    if (!item.reasons || item.reasons.length === 0) {
      const expo = item.exposure ?? 0
      if (cat === 'rejects') {
        cat = decision('maybe', 'NO_REJECT_EVIDENCE')
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
    if (trace) trace.policyRule = rule
    ;(item as any).reasonCodes = [...codesFor(item.reasons), rule]

}
