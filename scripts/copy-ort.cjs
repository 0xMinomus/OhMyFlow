// Copy ONNX wasm runtime ke dist/ort (dipakai face-onnx.ts via wasmPaths './ort/').
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');
const dst = path.join(__dirname, '..', 'dist', 'ort');
fs.mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(src)) {
  if (!f.endsWith('.wasm') && !f.endsWith('.mjs')) continue;
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
  n++;
}
console.log(`ort wasm copied: ${n} files`);
