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
import { extractEmbeddedJpegFromBuffer, extractRawPreview } from '../electron/raw-preview'
import { loadFolderSession, saveFolderSession } from '../electron/session'
import { appStore } from '../src/store/useAppStore'
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

test('extractEmbeddedJpegFromBuffer and extractRawPreview pick largest preview and handle RAF/missing', async () => {
  const smallJpg = await sharp({ create: { width: 160, height: 120, channels: 3, background: { r: 20, g: 30, b: 40 } } })
    .jpeg({ quality: 70 })
    .toBuffer()
  const largeJpg = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 120, g: 180, b: 220 } } })
    .jpeg({ quality: 80 })
    .toBuffer()

  // Simulate TIFF/NEF container with small thumbnail + larger preview
  const tiffLike = Buffer.concat([
    Buffer.from('II*\0\x08\0\0\0', 'latin1'),
    Buffer.alloc(64, 0),
    smallJpg,
    Buffer.alloc(128, 0xaa),
    largeJpg,
  ])
  const extracted = extractEmbeddedJpegFromBuffer(tiffLike)
  assert.ok(extracted)
  const meta = await sharp(extracted).metadata()
  assert.equal(meta.width, 640)
  assert.equal(meta.height, 480)

  // Simulate Fujifilm RAF header
  const rafHeader = Buffer.alloc(128, 0)
  rafHeader.write('FUJIFILMCCD-RAW ', 0, 'ascii')
  rafHeader.writeUInt32BE(128, 0x54)
  rafHeader.writeUInt32BE(largeJpg.length, 0x58)
  const rafBuf = Buffer.concat([rafHeader, largeJpg])
  const dir = await mkdtemp(join(tmpdir(), 'omf-raw-'))
  try {
    const rafPath = join(dir, 'TEST.RAF')
    const emptyPath = join(dir, 'EMPTY.CR3')
    await writeFile(rafPath, rafBuf)
    await writeFile(emptyPath, Buffer.alloc(256, 0))
    const fromFile = await extractRawPreview(rafPath)
    assert.ok(fromFile && fromFile.length === largeJpg.length)
    assert.equal(await extractRawPreview(emptyPath), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('saveFolderSession and loadFolderSession round-trip persisted culling verdicts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omf-sess-'))
  try {
    const folder = resolve('/tmp/shoot-01')
    const ok = await saveFolderSession(dir, {
      version: 1,
      folderPath: folder,
      sensitivity: 'high',
      savedAt: 123456,
      stats: { total: 1, picks: 1, maybe: 0, rejects: 0, durationMs: 500, throughputPerMin: 120 },
      items: [{ fileName: 'A.JPG', size: 100, mtimeMs: 10, category: 'picks', score: 85 }],
    })
    assert.equal(ok, true)
    const loaded = await loadFolderSession(dir, folder)
    assert.ok(loaded)
    assert.equal(loaded.sensitivity, 'high')
    assert.equal(loaded.items[0].category, 'picks')
    assert.equal(await loadFolderSession(dir, resolve('/tmp/missing')), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('appStore updatePhotoCategory and undoCategory restore previous category and stats', () => {
  appStore.resetSession()
  appStore.setPhotos([
    { id: '1', fileName: 'A.JPG', filePath: '/tmp/A.JPG', isPaired: false, isRaw: false, ext: '.jpg', size: 10, baseName: 'A', category: 'maybe' },
  ])
  appStore.setStats({ total: 1, picks: 0, maybe: 1, rejects: 0, durationMs: 10, throughputPerMin: 600 })
  appStore.updatePhotoCategory('1', 'picks')
  assert.equal(appStore.photos[0].category, 'picks')
  assert.equal(appStore.stats?.picks, 1)
  assert.equal(appStore.undoCategory(), true)
  assert.equal(appStore.photos[0].category, 'maybe')
  assert.equal(appStore.stats?.picks, 0)
  assert.equal(appStore.undoCategory(), false)
  appStore.resetSession()
})
