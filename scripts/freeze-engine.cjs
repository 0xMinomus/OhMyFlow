// Private, immutable local snapshot; no photographs are copied.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process')
const root = path.resolve(__dirname, '..')
const out = path.join(root, '.engine-eval', 'baseline')
if (fs.existsSync(out)) throw new Error('Baseline already exists; refuse to overwrite')
fs.mkdirSync(out, { recursive: true })
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const files = ['package.json', 'package-lock.json', 'src/lib/ai-engine/culler.ts', 'src/lib/ml/face-onnx.ts', 'public/models/ultraface-320.onnx', 'release/OhMyFlow-win32-x64/OhMyFlow.exe', 'sample/ground-truth.csv', 'sample/eval-high.csv']
fs.writeFileSync(path.join(out, 'snapshot.json'), JSON.stringify({ date: new Date().toISOString(), commit: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), files: Object.fromEntries(files.map(p => [p, fs.existsSync(path.join(root, p)) ? hash(path.join(root, p)) : null])), node: process.version, legacyHash: 'a492b57d', caveat: 'Node baseline excludes ONNX and browser JPEG decode. Electron baseline required separately.' }, null, 2))
fs.writeFileSync(path.join(out, 'working-tree.patch'), cp.execFileSync('git', ['diff', '--binary'], { maxBuffer: 20 * 1024 * 1024 }))
fs.copyFileSync(path.join(root, 'sample/eval-high.csv'), path.join(out, 'eval-high.csv'))
console.log('Baseline frozen:', out)
