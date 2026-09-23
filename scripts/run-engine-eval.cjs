const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawn } = require('child_process')
const root = path.resolve(__dirname, '..')
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')))
const manifest = fs.readFileSync(path.join(root, 'eval/manifest.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
for (const s of manifest) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(s.filePath)).digest('hex')
  if (hash !== s.hash) throw new Error(`Frozen sample changed: ${s.id}`)
}
const samples = args.limit ? manifest.slice(0, Number(args.limit)) : manifest
const dir = path.join(root, '.engine-eval'); fs.mkdirSync(dir, { recursive: true })
const output = path.join(dir, `${args.name || 'electron-current'}.json`)
if (fs.existsSync(output)) throw new Error(`Run already exists: ${output}`)
const jobPath = path.join(dir, 'job.json')
if (args.fault && !['onnx', 'mediapipe'].includes(args.fault)) throw new Error('Unknown model fault')
fs.writeFileSync(jobPath, JSON.stringify({ samples, mode: args.mode || 'high', engine: args.engine || 'legacy', fault: args.fault, output }))
const exe = args.exe || require('electron')
const started = Date.now()
const launchArgs = args.exe ? [] : ['dist-electron/main.js']
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const child = spawn(exe, [...launchArgs, `--engine-eval=${jobPath}`], { cwd: root, env, windowsHide: true, stdio: 'pipe' })
child.stderr.on('data', b => { if (/Error|error|failed/i.test(String(b))) process.stderr.write(b) })
const timeout = setTimeout(() => { child.kill(); console.error('Evaluation timeout'); process.exitCode = 1 }, 20 * 60 * 1000)
child.on('error', e => { clearTimeout(timeout); console.error(e); process.exitCode = 1 })
child.on('exit', code => {
  clearTimeout(timeout)
  if (!fs.existsSync(output)) { console.error('No evaluation output; exit', code); process.exitCode = 1; return }
  const report = JSON.parse(fs.readFileSync(output, 'utf8'))
  if (report.error) { console.error(report.error); process.exitCode = 1; return }
  report.provenance = { elapsedMs: Date.now() - started, mode: args.mode || 'high', engine: args.engine || 'legacy',
    packaged: !!args.exe, executableSha256: crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),
    manifestSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'eval/manifest.jsonl'))).digest('hex'),
    models: Object.fromEntries(['ultraface-320.onnx', 'face_landmarker.task'].map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'public/models', name))).digest('hex')])) }
  fs.writeFileSync(output, JSON.stringify(report))
  const counts = {}, status = {}
  for (const row of report.rows) {
    counts[row.category] = (counts[row.category] || 0) + 1
    const s = row.engineTrace?.onnx?.status || 'no-trace'; status[s] = (status[s] || 0) + 1
  }
  console.log(JSON.stringify({ output, photos: report.rows.length, counts, onnx: status, runtime: report.runtime }, null, 2))
})
