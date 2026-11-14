import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

import { ALLOWED_APP_PATHS, isSafeLocalPath, resolveBundlePath } from '../electron/security'
import { buildXmp } from '../electron/xmp'
import { scanFolder } from '../electron/scan'
import { movePhotos, writeXmpsBulk } from '../electron/fs-ops'
import { pruneCacheDir } from '../electron/cache'
import { groupDuplicates, hammingDistanceLimited } from '../src/lib/ai-engine/duplicate'
import { analyzeImageData, downsampleImageData } from '../src/lib/ai-engine/pipeline'
import { cullPhotos } from '../src/lib/ai-engine/culler'
import { refineEyesWithROI } from '../src/lib/ml/eye-roi'
import type { PhotoItem } from '../src/types'

test('resolveBundlePath blocks traversal and sibling prefix bypass', () => {
  const root = resolve('/tmp/app/dist')
  assert.equal(resolveBundlePath(root, '/'), join(root, 'index.html'))
  assert.equal(resolveBundlePath(root, '/assets/app.js'), join(root, 'assets', 'app.js'))
  assert.equal(resolveBundlePath(root, '/../dist-electron/main.js'), null)
  assert.equal(resolveBundlePath(root, '/%2e%2e/package.json'), null)
  assert.equal(resolveBundlePath(root, '/bad\0path'), null)
})

test('isSafeLocalPath and ALLOWED_APP_PATHS enforce strict bounds', () => {
  assert.equal(isSafeLocalPath(resolve('/tmp/photo.jpg')), true)
  assert.equal(isSafeLocalPath('relative/path.jpg'), false)
  assert.equal(isSafeLocalPath('/tmp/bad\0.jpg'), false)
  assert.equal(isSafeLocalPath(''), false)
  assert.equal(ALLOWED_APP_PATHS.userData, true)
  assert.equal(ALLOWED_APP_PATHS.exe, undefined)
})

test('buildXmp emits valid Lightroom XML and escapes special chars', () => {
  const xml = buildXmp({ rating: 5, label: 'Green' })
  assert.match(xml, /<xmp:Rating>5<\/xmp:Rating>/)
  assert.match(xml, /<xmp:Label>Green<\/xmp:Label>/)
  assert.match(xml, /<rdf:li>OhMyFlow\/Green<\/rdf:li>/)

  const escaped = buildXmp(3, 'Yellow&<>"\'' as never)
  assert.match(escaped, /&amp;&lt;&gt;&quot;&apos;/)
})

test('scanFolder pairs uppercase RAW+JPG, skips .xmp, and sorts deterministically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omf-scan-'))
  try {
    await writeFile(join(dir, 'IMG_0002.CR3'), 'raw')
    await writeFile(join(dir, 'IMG_0002.JPG'), 'jpg')
    await writeFile(join(dir, 'IMG_0002.xmp'), 'xmp')
    await writeFile(join(dir, 'IMG_0001.NEF'), 'raw-only')
    await writeFile(join(dir, 'IMG_0003.jpg'), 'jpg-only')

    const items = await scanFolder(dir)
    assert.equal(items.length, 3)
    assert.deepEqual(items.map((i) => i.fileName), ['IMG_0001.NEF', 'IMG_0002.CR3', 'IMG_0003.jpg'])

    const paired = items[1]
    assert.equal(paired.isPaired, true)
    assert.equal(paired.isRaw, true)
    assert.equal(paired.previewPath, join(dir, 'IMG_0002.JPG'))
    assert.equal(items[0].isPaired, false)
    assert.equal(items[0].previewPath, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('writeXmpsBulk deduplicates RAW+JPG pairs and respects overwrite flag', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omf-xmp-'))
  try {
    const raw = join(dir, 'A.CR3')
    const jpg = join(dir, 'A.JPG')
    const xmp = join(dir, 'A.xmp')
    await writeFile(raw, 'r')
    await writeFile(jpg, 'j')

    const first = await writeXmpsBulk([{ filePath: raw, pairedPath: jpg, rating: 5, label: 'Green' }])
    assert.deepEqual(first, { ok: 1, skipped: 0, total: 1, errors: [] })
    assert.match(await readFile(xmp, 'utf-8'), /<xmp:Rating>5<\/xmp:Rating>/)

    const skipped = await writeXmpsBulk([{ filePath: raw, pairedPath: jpg, rating: 1, label: 'Red' }], { overwrite: false })
    assert.deepEqual(skipped, { ok: 0, skipped: 1, total: 1, errors: [] })
    assert.match(await readFile(xmp, 'utf-8'), /<xmp:Rating>5<\/xmp:Rating>/)

    const overwritten = await writeXmpsBulk([{ filePath: raw, pairedPath: jpg, rating: 1, label: 'Red' }], { overwrite: true })
    assert.deepEqual(overwritten, { ok: 1, skipped: 0, total: 1, errors: [] })
    assert.match(await readFile(xmp, 'utf-8'), /<xmp:Rating>1<\/xmp:Rating>/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('movePhotos carries RAW+JPG+XMP and auto-numbers collisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omf-move-'))
  const src = join(root, 'src')
  const dest = join(root, 'dest')
  try {
    await mkdir(src, { recursive: true })
    await mkdir(join(dest, 'Picks'), { recursive: true })
    await writeFile(join(dest, 'Picks', 'SHOT.JPG'), 'existing')
    await writeFile(join(src, 'SHOT.CR3'), 'raw')
    await writeFile(join(src, 'SHOT.JPG'), 'jpg')
    await writeFile(join(src, 'SHOT.xmp'), 'xmp')

    const res = await movePhotos({
      destDir: dest,
      items: [{ filePath: join(src, 'SHOT.CR3'), pairedPath: join(src, 'SHOT.JPG'), sub: 'Picks' }],
    })
    assert.equal(res.ok, true)
    assert.equal(res.moved, 1)
    assert.equal(res.failed.length, 0)
    assert.equal((await stat(join(dest, 'Picks', 'SHOT.CR3'))).isFile(), true)
    assert.equal((await stat(join(dest, 'Picks', 'SHOT (1).JPG'))).isFile(), true)
    assert.equal((await stat(join(dest, 'Picks', 'SHOT.xmp'))).isFile(), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pruneCacheDir removes expired and oldest files past maxBytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omf-cache-'))
  try {
    const oldFile = join(dir, 'old.jpg')
    const a = join(dir, 'a.jpg')
    const b = join(dir, 'b.jpg')
    const c = join(dir, 'c.jpg')
    await writeFile(oldFile, Buffer.alloc(100))
    await writeFile(a, Buffer.alloc(100))
    await writeFile(b, Buffer.alloc(100))
    await writeFile(c, Buffer.alloc(100))

    const now = Date.now()
    await utimes(oldFile, new Date(now - 20_000), new Date(now - 20_000))
    await utimes(a, new Date(now - 3_000), new Date(now - 3_000))
    await utimes(b, new Date(now - 2_000), new Date(now - 2_000))
    await utimes(c, new Date(now - 1_000), new Date(now - 1_000))

    const res = await pruneCacheDir(dir, 220, 10_000, now)
    assert.equal(res.removed, 3) // oldFile expired + a,b trimmed to <= 187 (0.85 * 220)
    assert.equal(res.remainingBytes, 100)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('duplicate grouping and downsampleImageData + refineEyesWithROI work pure JS', async () => {
  const h1 = '01'.repeat(32)
  const h2 = '01'.repeat(31) + '00'
  const h3 = '10'.repeat(32)
  assert.equal(hammingDistanceLimited(h1, h2, 7), 1)
  const groups = groupDuplicates([
    { id: '1', hash: h1 },
    { id: '2', hash: h2 },
    { id: '3', hash: h3 },
  ], 5)
  assert.equal(groups.size, 1)

  const data = new Uint8ClampedArray(64 * 64 * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 180; data[i + 1] = 140; data[i + 2] = 110; data[i + 3] = 255
  }
  const img = { data, width: 64, height: 64 } as ImageData
  const down = downsampleImageData(img, 32)
  assert.equal(down.width, 32)
  assert.equal(down.height, 32)

  const roi = await refineEyesWithROI(img, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
  assert.ok(roi === null || typeof roi.eyesClosedProbability === 'number')
})

test('cullPhotos High mode is deterministic on test-photos and clears transient base64 payloads', async () => {
  const dir = resolve(process.cwd(), 'test-photos')
  const scanned = await scanFolder(dir)
  const items: PhotoItem[] = scanned.map((s) => ({ ...s }))

  const analyzeSharp = async (src: string, size: number) => {
    const fp = src.startsWith('test:') ? src.slice(5) : src
    const s = Math.max(128, Math.min(768, Math.round(size)))
    const { data, info } = await sharp(fp, { failOn: 'none' })
      .rotate()
      .resize(s, s, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return analyzeImageData({ data: new Uint8ClampedArray(data), width: info.width, height: info.height } as ImageData)
  }

  const run1 = await cullPhotos(items, {
    mode: 'high',
    useWorker: false,
    prepareBatch: async (batch) => {
      for (const b of batch) {
        b.thumbUrl = 'test:' + b.filePath
        b.analysisUrl = 'test:' + b.filePath
      }
    },
    analyze: analyzeSharp,
  })
  const run2 = await cullPhotos(items, {
    mode: 'high',
    useWorker: false,
    prepareBatch: async (batch) => {
      for (const b of batch) {
        b.thumbUrl = 'test:' + b.filePath
        b.analysisUrl = 'test:' + b.filePath
      }
    },
    analyze: analyzeSharp,
  })

  assert.equal(run1.length, items.length)
  assert.deepEqual(
    run1.map((r) => [r.fileName, r.category, r.score]),
    run2.map((r) => [r.fileName, r.category, r.score]),
  )
  // Transient base64 strings must be stripped after culling
  for (const r of run1) {
    assert.equal(r.analysisUrl, undefined)
    assert.equal(r.thumbUrl, undefined)
    assert.ok(r.reasons && r.reasons.length > 0)
  }
})
