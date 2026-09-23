const assert = require('assert/strict'), fs = require('fs')
const args = process.argv.slice(2)
const before = JSON.parse(fs.readFileSync(`.engine-eval/${args[0] || 'electron-baseline-valid'}.json`))
const after = JSON.parse(fs.readFileSync(`.engine-eval/${args[1] || 'packaged-final'}.json`))
const manifest = fs.readFileSync('eval/manifest.jsonl', 'utf8').trim().split('\n').map(JSON.parse)
const labels = new Map(manifest.map(g => [g.id, g]))
assert.equal(after.error, null)
assert.equal(after.rows.length, before.rows.length)
assert.equal(new Set(after.rows.map(r => r.id)).size, after.rows.length)
const metric = rows => ({
  falseReject: rows.filter(r => labels.get(r.id).category === 'picks' && r.category === 'rejects').length,
  rejectAsPick: rows.filter(r => labels.get(r.id).category === 'rejects' && r.category === 'picks').length,
})
const b = metric(before.rows), a = metric(after.rows)
assert.ok(a.falseReject <= b.falseReject, 'keeper rejection regressed')
assert.ok(a.rejectAsPick <= b.rejectAsPick, 'Reject to Pick regressed')
for (const row of after.rows) {
  const trace = row.engineTrace
  assert.equal(trace.inputStatus, 'ok', `input failure: ${row.id}`)
  assert.ok(trace.policyRule, `missing policy rule: ${row.id}`)
  assert.ok(trace.reasons.length, `missing reasons: ${row.id}`)
  assert.ok(['ok', 'unknown'].includes(trace.onnx.status), `ONNX failure: ${row.id}`)
  if (args.includes('--model')) assert.equal(trace.provider?.status, 'ok', `provider failure: ${row.id}`)
}
assert.ok(after.rows.some(r => r.engineTrace.onnx.status === 'ok'), 'ONNX never ran')
if (args.includes('--parity')) {
  const prior = new Map(before.rows.map(r => [r.id, r]))
  for (const row of after.rows) {
    assert.equal(row.category, prior.get(row.id)?.category, `shadow altered decision: ${row.id}`)
    assert.equal(row.score, prior.get(row.id)?.score, `shadow altered score: ${row.id}`)
  }
}
console.log(JSON.stringify({ passed: true, before: b, after: a, n: after.rows.length }))
