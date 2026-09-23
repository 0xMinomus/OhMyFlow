const fs = require('fs'), path = require('path'), crypto = require('crypto')
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'eval')
const manifest = path.join(dir, 'manifest.jsonl')
if (fs.existsSync(manifest)) throw new Error('Frozen manifest exists; refuse to overwrite')
fs.mkdirSync(dir, { recursive: true })
const rows = []
for (const split of ['human', 'nonhuman']) for (const category of ['picks', 'maybe', 'rejects']) {
  const folder = path.join(root, 'sample', split, category)
  for (const name of fs.readdirSync(folder).sort()) {
    if (!/\.(jpe?g|png|webp|tiff?|bmp)$/i.test(name)) continue
    const filePath = path.join(folder, name), bytes = fs.readFileSync(filePath)
    const hash = crypto.createHash('sha256').update(bytes).digest('hex')
    const eyeFolder = path.join(root, 'sample', split, '_eye')
    const eyeTagged = fs.existsSync(eyeFolder) && fs.readdirSync(eyeFolder).some(n => n.replace(/ \(\d+\)(?=\.)/, '').toLowerCase() === name.replace(/ \(\d+\)(?=\.)/, '').toLowerCase())
    rows.push({ id: `${split}/${name}`, filePath, hash, split, category, eyeTagged,
      // Existing data was used for legacy tuning: this is a regression set, not an unbiased test.
      partition: 'legacy-regression', leftEye: null, rightEye: null, facePresent: null, burstId: null,
      criticalKeeper: category === 'picks', provenance: 'user-folder-label' })
  }
}
rows.sort((a, b) => a.id.localeCompare(b.id))
fs.writeFileSync(manifest, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
console.log(`Frozen ${rows.length} labels; left/right eye and burst labels remain unknown.`)
