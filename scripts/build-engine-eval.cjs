const fs = require('fs')
require('esbuild').buildSync({ entryPoints: ['scripts/electron-eval.ts'], bundle: true, format: 'esm', platform: 'browser', outfile: 'dist/engine-eval.js', logLevel: 'error' })
fs.writeFileSync('dist/engine-eval.html', '<!doctype html><html><head><meta charset="utf-8"><title>Engine evaluation</title></head><body><script type="module" src="./engine-eval.js"></script></body></html>')
