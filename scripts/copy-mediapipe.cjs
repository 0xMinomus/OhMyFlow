const fs = require('fs'), path = require('path')
const source = 'node_modules/@mediapipe/tasks-vision/wasm', destination = 'dist/mediapipe'
fs.mkdirSync(destination, { recursive: true })
for (const name of fs.readdirSync(source)) if (/\.(js|wasm)$/.test(name)) fs.copyFileSync(path.join(source, name), path.join(destination, name))
console.log('MediaPipe runtime copied for offline use')
