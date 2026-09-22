// analyze-eval.cjs — bedah eval-<mode>.csv: detail danger/waste/eye/best.
// Usage: node scripts/analyze-eval.cjs [--eval sample/eval-high.csv]
const { readFileSync } = require('fs')
const { join, resolve } = require('path')
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]
}))
function parseCsv(text) {
  const rows = []; let cur = [''], q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++ } else q = false }
      else cur[cur.length - 1] += c
    } else if (c === '"') q = true
    else if (c === ',') cur.push('')
    else if (c === '\n') { rows.push(cur); cur = [''] }
    else if (c !== '\r') cur[cur.length - 1] += c
  }
  if (cur.length > 1 || cur[0] !== '') rows.push(cur)
  return rows
}
const [header, ...lines] = parseCsv(readFileSync(resolve(args.eval || join('sample', 'eval-high.csv')), 'utf-8'))
const rows = lines.filter((l) => l.length > 1).map((l) => Object.fromEntries(header.map((h, i) => [h, l[i] ?? ''])))
const show = (r) => `${r.file} H=${r.human} AI=${r.ai} s=${r.score} f=${r.focus} face=${r.hasFace}${+r.objMode ? ' OBJ' : ''} eyes=${r.aiEyes || '-'}(${r.aiEyeP}) eyeTag=${r.eyeClosed} best=${r.best} [${r.reasons}]`
const sec = (t, list) => { console.log(`\n=== ${t} (n=${list.length}) ===`); list.forEach((r) => console.log(show(r))) }
sec('DANGER Pick→Reject', rows.filter((r) => r.human === 'Pick' && r.ai === 'rejects'))
sec('WASTE Reject→Pick', rows.filter((r) => r.human === 'Reject' && r.ai === 'picks'))
sec('Eye-tagged: H-Reject→AI-Pick', rows.filter((r) => +r.eyeClosed && r.human === 'Reject' && r.ai === 'picks'))
sec('Eye-tagged: H-Pick (semua)', rows.filter((r) => +r.eyeClosed && r.human === 'Pick'))
sec('Best yang BUKAN picks', rows.filter((r) => +r.best && r.ai !== 'picks'))
// Distribusi alasan pada WASTE
const rc = {}
for (const r of rows.filter((r) => r.human === 'Reject' && r.ai !== 'rejects')) {
  for (const s of (r.reasons || '').split(' | ')) rc[s] = (rc[s] || 0) + 1
}
console.log('\n=== Alasan top pada Human-Reject yang lolos (AI picks/maybe) ===')
Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log(`${v}x ${k}`))
// Skor WASTE vs DANGER
const w = rows.filter((r) => r.human === 'Reject' && r.ai === 'picks').map((r) => +r.score).sort((a, b) => a - b)
console.log(`\nWASTE score min/med/max: ${w[0]}/${w[Math.floor(w.length / 2)]}/${w[w.length - 1]}`)
const d = rows.filter((r) => r.human === 'Pick' && r.ai === 'rejects').map((r) => +r.score).sort((a, b) => a - b)
console.log(`DANGER score min/med/max: ${d[0]}/${d[Math.floor(d.length / 2)]}/${d[d.length - 1]}`)
