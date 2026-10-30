// Copy ONNX wasm runtime ke dist/ort (dipakai face-onnx.ts via wasmPaths './ort/').
// Allowlist ketat: runtime cuma butuh varian threaded (numThreads=1, EP wasm).
// Usage: node scripts/copy-ort.cjs [--dest dir]
const fs = require('fs');
const path = require('path');

const FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];
const src = path.join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');
const i = process.argv.indexOf('--dest');
const dst = i !== -1 && process.argv[i + 1]
  ? path.resolve(process.argv[i + 1])
  : path.join(__dirname, '..', 'dist', 'ort');

if (!fs.existsSync(src)) {
  console.error(`ort source tidak ada: ${src} — jalankan npm ci dulu`);
  process.exit(1);
}
fs.mkdirSync(dst, { recursive: true });
for (const f of FILES) {
  const from = path.join(src, f);
  if (!fs.existsSync(from)) {
    console.error(`ort file tidak ada: ${from}`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(dst, f));
  console.log(`copied ${f}`);
}
console.log(`ort wasm copied: ${FILES.length} files → ${dst}`);
