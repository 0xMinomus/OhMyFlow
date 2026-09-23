const assert = require('assert/strict'), fs = require('fs')
const [name, fault] = process.argv.slice(2)
const result = JSON.parse(fs.readFileSync(`.engine-eval/${name}.json`))
assert.equal(result.error, null, 'model failure must not abort the run')
assert.ok(result.rows.length > 0)
let observed = 0
for (const row of result.rows) {
  const trace = row.engineTrace
  assert.equal(trace.inputStatus, 'ok')
  const signal = fault === 'onnx' ? trace.onnx : trace.provider
  if (fault === 'onnx' && signal.status === 'unknown') continue
  assert.equal(signal.status, 'unavailable')
  assert.match(signal.errorCode, /404/)
  assert.ok(row.category, 'fallback must retain a decision')
  observed++
}
assert.ok(observed > 0, 'fault did not reach the requested model path')
console.log(`PASS ${fault}: ${observed} explicit unavailable results; ${result.rows.length} photos completed`)
