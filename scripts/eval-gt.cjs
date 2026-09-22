// eval-gt.cjs — engine (High, kode produksi 100%) vs ground truth manusia.
// Usage: node scripts/eval-gt.cjs [--split human|nonhuman|all] [--limit N] [--mode high]
// Output: sample/eval-<mode>.csv + metrik ke stdout + hash determinisme.
// Decode via sharp (bukan browser); skoring/vonis = kode produksi identik.
const { readdirSync, statSync, writeFileSync, existsSync } = require('fs')
const { join, resolve, basename, extname } = require('path')

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/)
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]
  })
)
const ROOT = resolve(args.root || join(__dirname, '..', 'sample'))
const MODE = args.mode || 'high'
const SPLITS = args.split ? [args.split] : ['human', 'nonhuman']
const LIMIT = args.limit ? parseInt(args.limit, 10) : 0
const NO_GT = !!args.nogt // distribusi saja (folder tanpa ground truth, mis. OSIS)
if (NO_GT) SPLITS.splice(0, SPLITS.length, 'osis')
const OUTDIR = NO_GT ? resolve(join(__dirname, '..', 'sample')) : ROOT
const norm = (f) => basename(f).replace(/ \(\d+\)(?=\.[^.]+$)/, '')

async function main() {
  const esbuild = require('esbuild')
  const bundlePath = join(ROOT, '.harness-bundle.cjs')
  await esbuild.build({
    entryPoints: [join(__dirname, 'harness-entry.ts')],
    bundle: true, platform: 'node', format: 'cjs',
    outfile: bundlePath, logLevel: 'error',
  })
  const { cullPhotos, analyzeImageData } = require(bundlePath)
  const sharp = require('sharp')

  // Ground truth (opsional)
  const gt = new Map()
  if (!NO_GT) {
    const gtPath = join(ROOT, 'ground-truth.csv')
    if (!existsSync(gtPath)) throw new Error('ground-truth.csv belum ada — jalan node scripts/read-sample.cjs dulu')
    for (const line of require('fs').readFileSync(gtPath, 'utf-8').trim().split('\n').slice(1)) {
      const [file, humanVerdict, split, eyeClosed, bestInBurst] = line.split(',')
      gt.set(file.toLowerCase(), { file, humanVerdict, split, eyeClosed: +eyeClosed, bestInBurst: +bestInBurst })
    }
  }

  const analyze = async (src, size) => {
    const fp = src.startsWith('harness:') ? src.slice(8) : src
    const s = Math.max(128, Math.min(768, Math.round(size)))
    const { data, info } = await sharp(fp, { failOnError: false }).rotate()
      .resize(s, s, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return analyzeImageData({ data: new Uint8ClampedArray(data), width: info.width, height: info.height })
  }

  const allRows = []
  const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp'])
  for (const split of SPLITS) {
    const files = []
    if (NO_GT) {
      // Folder datar: semua gambar langsung di ROOT.
      const names = readdirSync(ROOT).filter((f) => {
        try { return statSync(join(ROOT, f)).isFile() && IMG_EXT.has(extname(f).toLowerCase()) } catch { return false }
      })
      for (const f of names) files.push(join(ROOT, f))
    } else
    for (const [dir] of [['picks'], ['maybe'], ['rejects']]) {
      const d = join(ROOT, split, dir)
      let names = []
      try { names = readdirSync(d).filter((f) => { try { return statSync(join(d, f)).isFile() } catch { return false } }) } catch {}
      for (const f of names) files.push(join(d, f))
    }
    files.sort((a, b) => norm(a).toLowerCase() < norm(b).toLowerCase() ? -1 : 1)
    const picked = LIMIT > 0 ? files.slice(0, LIMIT) : files
    const items = picked.map((fp, i) => ({
      id: `${split}_${i}_${norm(fp).toLowerCase()}`,
      fileName: norm(fp), filePath: fp, previewPath: fp,
      thumbUrl: 'harness:' + fp, // produksi baca ini dulu; analyze kupas path-nya
      isPaired: false, isRaw: false, ext: extname(fp).toLowerCase(),
      size: 0, baseName: norm(fp),
    }))
    const t0 = Date.now()
    const out = await cullPhotos(items, { mode: MODE, analyze })
    const ms = Date.now() - t0
    console.log(`[${split}] ${out.length} foto, ${(ms / 1000).toFixed(1)}s (${(out.length / Math.max(1, ms / 60000)).toFixed(0)}/mnt)`)
    for (const r of out) {
      const g = gt.get((r.fileName || '').toLowerCase()) || {}
      const q = (k) => r[k] ?? ''
      allRows.push({
        file: r.fileName, split,
        human: g.humanVerdict || '?', ai: r.category || '?',
        score: r.score ?? '', focus: r.sharpness ?? '',
        edge: q('edge'), subj: q('subject'), subjFocus: q('subjFocus'),
        gradP50: q('gradP50'), gradP99: q('gradP99'), meanLum: q('meanLum'),
        expo: r.exposure ?? '', comp: r.composition ?? '', conf: r.confidence ?? '',
        faceConf: q('faceConfidence'), skin: q('skinRatio'),
        eyeClosed: g.eyeClosed || 0, best: g.bestInBurst || 0,
        aiEyes: r.eyesState || '', aiEyeP: r.eyesP ?? '',
        hits: q('pupilHits'),
        eyeProtect: r.eyesOpenProtect ? 1 : 0,
        hasFace: r.hasFace ? 1 : 0, objMode: r.objMode ? 1 : 0, whiteBg: r.whiteBg ? 1 : 0,
        v2cap: q('v2cap'), onnxDom: r.onnxDominantUnknown ? 1 : 0,
        dup: r.isDuplicate ? 1 : 0, soft: r.softestInBurst ? 1 : 0, redun: r.redundantInBurst ? 1 : 0,
        rank: r.clusterRank ?? '', csize: r.clusterSize ?? '',
        reasons: (r.reasons || []).join(' | '),
      })
    }
  }

  const csvPath = join(OUTDIR, NO_GT ? `eval-${MODE}-dist.csv` : `eval-${MODE}.csv`)
  const cols = Object.keys(allRows[0])
  writeFileSync(csvPath, cols.join(',') + '\n' + allRows.map((r) =>
    cols.map((c) => { const v = String(r[c]); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v }).join(',')
  ).join('\n') + '\n', 'utf-8')
  console.log(`→ ${csvPath}`)

  // ---- Safety assertion: nol foto tajam (fokus ≥70) di Rejects untuk
  // vonis blur/cacat-tunggal (vonis mata/duplikat/exposure dikecualikan).
  const sharpInRejects = allRows.filter((r) => r.ai === 'rejects' && +r.focus >= 70 &&
    !/Mata tertutup|Duplikat|Terlunak|Frame serupa|exposure hancur|Terlalu gelap/i.test(r.reasons))
  console.log(`\nSafety (fokus≥70 di Rejects non-mata/dup/expo): ${sharpInRejects.length}` +
    (sharpInRejects.length ? ' — ' + sharpInRejects.slice(0, 10).map((r) => r.file).join(', ') : ' OK'))

  if (NO_GT) {
    const dist = {}
    for (const r of allRows) dist[r.ai] = (dist[r.ai] || 0) + 1
    console.log(`\nDistribusi ${MODE}: picks/maybe/rejects = ${dist.picks || 0}/${dist.maybe || 0}/${dist.rejects || 0} (n=${allRows.length})`)
    const rc = {}
    for (const r of allRows.filter((r) => r.ai === 'rejects'))
      for (const s of (r.reasons || '').split(' | ')) rc[s] = (rc[s] || 0) + 1
    console.log('Alasan rejects:', JSON.stringify(rc))
    return
  }

  // ---- Metrik ----
  const H = ['Pick', 'Maybe', 'Reject'], A = ['picks', 'maybe', 'rejects']
  const m = {}
  for (const h of H) { m[h] = {}; for (const a of A) m[h][a] = 0 }
  for (const r of allRows) if (m[r.human]) m[r.human][r.ai]++
  console.log('\nConfusion (Human × AI):')
  console.log('          AI-picks  AI-maybe  AI-rejects')
  for (const h of H) console.log(`H-${h.padEnd(6)} ${String(m[h].picks).padStart(8)} ${String(m[h].maybe).padStart(9)} ${String(m[h].rejects).padStart(10)}`)

  const danger = allRows.filter((r) => r.human === 'Pick' && r.ai === 'rejects')
  const waste = allRows.filter((r) => r.human === 'Reject' && r.ai === 'picks')
  const leak = allRows.filter((r) => r.human === 'Reject' && r.ai === 'maybe')
  console.log(`\nDANGER Human Pick→AI Reject: ${danger.length} — ${danger.map((r) => r.file).join(', ') || '-'}`)
  console.log(`WASTE  Human Reject→AI Pick: ${waste.length} — ${waste.map((r) => r.file).join(', ') || '-'}`)
  console.log(`LEAK   Human Reject→AI Maybe: ${leak.length}`)
  const rev = allRows.filter((r) => r.ai === 'picks' || r.ai === 'maybe').length
  console.log(`Manual Review Size (AI Pick+Maybe): ${rev}/${allRows.length}`)

  const eyes = allRows.filter((r) => r.eyeClosed)
  const eBy = (h, a) => eyes.filter((r) => r.human === h && r.ai === a).length
  console.log(`\nEye-tagged (n=${eyes.length}): H-Pick→AI ${eBy('Pick', 'picks')}/${eBy('Pick', 'maybe')}/${eBy('Pick', 'rejects')} (p/m/r); H-Maybe→AI ${eBy('Maybe', 'picks')}/${eBy('Maybe', 'maybe')}/${eBy('Maybe', 'rejects')}; H-Reject→AI ${eBy('Reject', 'picks')}/${eBy('Reject', 'maybe')}/${eBy('Reject', 'rejects')}`)
  const eyeNoFace = eyes.filter((r) => !r.hasFace).length
  console.log(`Eye tanpa wajah terdeteksi: ${eyeNoFace}/${eyes.length} (arah aman = unknown, bukan vonis)`)

  const best = allRows.filter((r) => r.best)
  console.log(`\nBest-in-burst (n=${best.length}):`)
  for (const b of best) console.log(`  ${b.file}: human=${b.human} ai=${b.ai} score=${b.score} rank=${b.rank} csize=${b.csize}`)

  // Hash determinisme: file+ai+score urut nama
  let h = 5381
  const s = allRows.map((r) => `${r.file}|${r.ai}|${r.score}`).sort().join(';')
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  console.log(`\nDeterminism hash: ${(h >>> 0).toString(16)} (bandingkan antar-run)`)
}

main().catch((e) => { console.error('EVAL GAGAL:', e.message); process.exit(1) })
