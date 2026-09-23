const fs = require('fs'), path = require('path')
const dir = path.resolve('.engine-eval')
const args = process.argv.slice(2)
const before = JSON.parse(fs.readFileSync(path.join(dir, `${args[0] || 'electron-baseline-valid'}.json`)))
const after = JSON.parse(fs.readFileSync(path.join(dir, `${args[1] || 'mediapipe-shadow'}.json`)))
const labels = fs.readFileSync('eval/manifest.jsonl', 'utf8').trim().split('\n').map(JSON.parse)
const gt = new Map(labels.map(g => [g.id, g]))
function measure(rows, shadow = false) {
  const confusion = Object.fromEntries(['picks', 'maybe', 'rejects'].map(c => [c, { picks: 0, maybe: 0, rejects: 0 }]))
  const dist = { picks: 0, maybe: 0, rejects: 0 }, providers = {}, onnx = {}, failures = []
  let eyeTaggedFaces = 0, eyeTagged = 0, eyeUnknown = 0, modelMs = 0, faces = 0, survivorFailures = 0
  const groups = new Map()
  for (const r of rows) {
    const g = gt.get(r.id); if (!g) throw new Error(`Missing label ${r.id}`)
    const t = r.engineTrace, category = shadow ? t.shadowDecision : r.category
    confusion[g.category][category]++; dist[category]++
    onnx[t.onnx.status] = (onnx[t.onnx.status] || 0) + 1
    if (t.provider) {
      const p = t.provider
      providers[p.status] = (providers[p.status] || 0) + 1
      if (p.status !== 'ok') failures.push({ id: r.id, error: p.errorCode })
      modelMs += p.durationMs
      faces += p.faces.length
      eyeUnknown += p.faces.filter(f => f.eyes.left.status !== 'ok' || f.eyes.right.status !== 'ok').length
      if (g.eyeTagged && p.faces.length) eyeTaggedFaces++
    }
    if (g.eyeTagged) eyeTagged++
    if (t.burstId) { const values = groups.get(t.burstId) || []; values.push(category); groups.set(t.burstId, values) }
  }
  for (const values of groups.values()) if (values.length > 1 && values.every(c => c === 'rejects')) survivorFailures++
  return { n: rows.length, confusion, distribution: dist,
    falseRejectKeeper: confusion.picks.rejects, rejectAsPick: confusion.rejects.picks,
    pickPrecision: dist.picks ? confusion.picks.picks / dist.picks : null,
    rejectPrecision: dist.rejects ? confusion.rejects.rejects / dist.rejects : null,
    maybeLeakage: confusion.rejects.maybe, maybeRate: dist.maybe / rows.length,
    survivorFailures: rows.some(r => r.clusterSize > 1 && !r.engineTrace.burstId) ? null : survivorFailures,
    onnx, providers, failures, modelMs, meanModelMs: modelMs / rows.length,
    faceCount: faces, eyeTaggedFaces, eyeTagged, eyeUnknown,
    closedPrecision: null, closedRecall: null,
    limitation: 'No complete per-eye/face/burst labels; missing tags are not negative labels. Existing GT was used for legacy tuning.' }
}
const afterById = new Map(after.rows.map(r => [r.id, r]))
if (before.rows.length !== after.rows.length) throw new Error('Dataset sizes differ')
const changes = before.rows.flatMap(b => {
  const a = afterById.get(b.id); if (!a) throw new Error(`Missing result ${b.id}`)
  const candidate = a.engineTrace.shadowDecision || a.category
  return b.category === candidate ? [] : [{ id: b.id, truth: gt.get(b.id).category, before: b.category, after: candidate,
    reasons: a.engineTrace.shadowReasons || a.engineTrace.reasons }]
})
const b = measure(before.rows), a = measure(after.rows, !!after.rows[0]?.engineTrace.shadowDecision)
const report = { before: b, after: a, delta: { falseRejectKeeper: a.falseRejectKeeper - b.falseRejectKeeper, rejectAsPick: a.rejectAsPick - b.rejectAsPick, maybeLeakage: a.maybeLeakage - b.maybeLeakage },
  legacyParity: before.rows.every(b => { const a = afterById.get(b.id); return a.category === b.category && a.score === b.score }),
  regressions: changes.filter(c => c.truth === 'picks' && c.after === 'rejects'), changes,
  activation: 'BLOCKED: independent frozen test and per-eye labels unavailable; keep model diagnostic-only' }
fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2))
fs.writeFileSync(path.join(dir, `${args[0] || 'electron-baseline-valid'}--${args[1] || 'mediapipe-shadow'}.report.json`), JSON.stringify(report, null, 2))
fs.writeFileSync(path.join(dir, 'traces.jsonl'), after.rows.map(r => JSON.stringify(r.engineTrace)).join('\n') + '\n')
console.log(JSON.stringify(report, null, 2))
