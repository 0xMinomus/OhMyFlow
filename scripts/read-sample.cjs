// read-sample.cjs — folder sample/ → ground-truth.csv (stdlib only).
// Verdict kanonik = lokasi file: human|nonhuman/{picks,maybe,rejects}/<nama>
// Tag duplikat: _b/ = best-in-burst, _eye/ = mata tertutup (copy, bukan pindah).
// Output: file,humanVerdict,split,eyeClosed,bestInBurst,reason (sorted, deterministik).
// Engine diff (vs culler High) = langkah berikutnya, bukan di sini.
const { readdirSync, statSync, writeFileSync } = require('fs')
const { join, basename, resolve } = require('path')

const root = resolve(process.argv[2] || join(__dirname, '..', 'sample'))
const out = resolve(process.argv[3] || join(root, 'ground-truth.csv'))

const VERDICTS = [
  ['human', 'picks', 'Pick'],
  ['human', 'maybe', 'Maybe'],
  ['human', 'rejects', 'Reject'],
  ['nonhuman', 'picks', 'Pick'],
  ['nonhuman', 'maybe', 'Maybe'],
  ['nonhuman', 'rejects', 'Reject'],
]
const TAGS = [
  ['human', '_b', 'best'],
  ['human', '_eye', 'eye'],
  ['nonhuman', '_b', 'best'],
  ['nonhuman', '_eye', 'eye'], // dibaca bila ada, tak wajib diisi
]

function listFiles(dir) {
  try {
    return readdirSync(dir).filter((f) => {
      try { return statSync(join(dir, f)).isFile() } catch { return false }
    })
  } catch { return [] } // folder kosong/belum diisi = sah
}

const rows = new Map() // key: basename.toLowerCase() -> row
// Copy dari app (Explorer) dapat akhiran duplikat Windows " (1)" — normalisasi.
const norm = (f) => basename(f).replace(/ \(\d+\)(?=\.[^.]+$)/, '')
for (const [split, dir, verdict] of VERDICTS) {
  for (const f of listFiles(join(root, split, dir))) {
    const key = norm(f).toLowerCase()
    if (rows.has(key)) {
      console.error(`WARN duplikat: ${f} sudah ada di ${rows.get(key).split}/${rows.get(key).dir} — ditimpa oleh ${split}/${dir}`)
    }
    rows.set(key, { file: norm(f), humanVerdict: verdict, split, dir, eyeClosed: 0, bestInBurst: 0 })
  }
}
for (const [split, dir, kind] of TAGS) {
  for (const f of listFiles(join(root, split, dir))) {
    const r = rows.get(norm(f).toLowerCase())
    if (!r) { console.error(`WARN tag yatim: ${split}/${dir}/${f} tak ada di picks/maybe/rejects — dilewati`); continue }
    if (kind === 'eye') r.eyeClosed = 1
    else r.bestInBurst = 1
  }
}

const sorted = [...rows.values()].sort((a, b) => a.file.toLowerCase() < b.file.toLowerCase() ? -1 : 1)
const esc = (s) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
const lines = ['file,humanVerdict,split,eyeClosed,bestInBurst,reason']
for (const r of sorted) {
  lines.push([r.file, r.humanVerdict, r.split, r.eyeClosed, r.bestInBurst, r.eyeClosed ? 'mata tertutup' : ''].map(esc).join(','))
}
writeFileSync(out, lines.join('\n') + '\n', 'utf-8')

const c = (v, s) => sorted.filter((r) => r.humanVerdict === v && (!s || r.split === s)).length
console.log(`GT: ${sorted.length} foto (human ${sorted.filter((r) => r.split === 'human').length}, nonhuman ${sorted.filter((r) => r.split === 'nonhuman').length})`)
console.log(`Pick/Maybe/Reject: ${c('Pick')}/${c('Maybe')}/${c('Reject')} | _b: ${sorted.filter((r) => r.bestInBurst).length} | _eye: ${sorted.filter((r) => r.eyeClosed).length}`)
console.log(`→ ${out}`)
