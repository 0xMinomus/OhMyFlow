// Persistent evaluation artifact, generated only from frozen local manifest.
const fs = require('fs'), path = require('path'), sharp = require('sharp')
async function main() {
  const report = JSON.parse(fs.readFileSync('.engine-eval/report.json'))
  const manifest = fs.readFileSync('eval/manifest.jsonl', 'utf8').trim().split('\n').map(JSON.parse)
  const files = new Map(manifest.map(r => [r.id, r.filePath]))
  const dir = path.resolve('.engine-eval/contact-review'); fs.mkdirSync(dir, { recursive: true })
  const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  for (let page = 0; page * 8 < report.changes.length; page++) {
    const changes = report.changes.slice(page * 8, page * 8 + 8), layers = []
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i], x = i % 2 * 520, y = Math.floor(i / 2) * 390
      layers.push({ input: await sharp(files.get(c.id)).rotate().resize(520, 335, { fit: 'contain', background: '#202020' }).png().toBuffer(), left: x, top: y })
      const label = `<svg width="520" height="55"><rect width="520" height="55" fill="white"/><text x="8" y="20" font-family="Arial" font-size="15">${escape(c.id)}</text><text x="8" y="43" font-family="Arial" font-size="15">GT: ${c.truth} | ${c.before} → ${c.after}</text></svg>`
      layers.push({ input: Buffer.from(label), left: x, top: y + 335 })
    }
    const output = path.join(dir, `page-${page + 1}.jpg`)
    await sharp({ create: { width: 1040, height: Math.ceil(changes.length / 2) * 390, channels: 3, background: 'white' } }).composite(layers).jpeg({ quality: 88 }).toFile(output)
    console.log(output)
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
