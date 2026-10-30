import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron'
import { join, normalize, resolve, extname, basename, dirname } from 'path'
import { existsSync, readdirSync, statSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, renameSync, copyFileSync } from 'fs'
import { createHash } from 'crypto'
import { scanFolder, RAW_EXTS } from './scan'
import { buildXmp, type XmpMeta } from './xmp'

let mainWindow: BrowserWindow | null = null

// Skema privileged untuk renderer (standard + fetchable). Wajib sebelum ready.
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

function createWindow() {
  // icon per platform: Linux butuh .png, Windows .ico. Jangan set bila file tidak ada.
  const iconPath = process.platform === 'linux'
    ? join(__dirname, '../build/icon.png')
    : join(__dirname, '../build/icon.ico')
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#0a0a0b',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    show: false,
    ...(existsSync(iconPath) ? { icon: iconPath } : {})
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadURL('app://app/index.html')
  }

  // devtools in dev
  if (!app.isPackaged) {
    // mainWindow.webContents.openDevTools()
  }
}

app.whenReady().then(() => {
  // Renderer via `app://` (bukan file://) agar bisa pasang COOP/COEP →
  // crossOriginIsolated = true → SharedArrayBuffer untuk ONNX wasm.
  // Hanya layani GET di dalam dist/ (anti traversal). UI flow tak berubah.
  protocol.handle('app', async (req) => {
    try {
      if (req.method !== 'GET') return new Response('method not allowed', { status: 405 })
      const u = new URL(req.url)
      let rel = decodeURIComponent(u.pathname)
      if (rel === '/' || rel === '') rel = '/index.html'
      const root = join(__dirname, '../dist')
      const filePath = normalize(join(root, rel))
      if (!filePath.startsWith(root)) return new Response('forbidden', { status: 403 })
      if (!existsSync(filePath)) return new Response('not found', { status: 404 })
      const res = await net.fetch('file:///' + filePath.replace(/\\/g, '/'))
      const headers = new Headers(res.headers)
      headers.set('Cross-Origin-Opener-Policy', 'same-origin')
      headers.set('Cross-Origin-Embedder-Policy', 'credentialless')
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
    } catch (e: any) {
      return new Response(String(e?.message || e), { status: 500 })
    }
  })
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ---- IPC ----

ipcMain.handle('dialog:openFolder', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('fs:scanFolder', async (_e, folderPath: string) => {
  // Logika scan + pairing RAW/JPG ada di electron/scan.ts (fs/promises, key lowercase).
  // Error folder (ENOENT/EACCES) dibiarkan reject agar renderer tahu, bukan array kosong.
  return scanFolder(folderPath)
})

// ---- Thumbnail pipeline: ringan, cached, async ----
// Kenapa berat sebelumnya: readImageAsDataUrl baca file FULL-RES (5-30MB) → base64 (+33%) →
// renderer decode 4x (blur, aesthetic, face, dHash masing-masing decode ulang).
// Sekarang: sharp resize ke max 480px JPEG q60 (~20-50KB, 100x lebih ringan) + cache di userData.

function thumbCacheDir(): string {
  const d = join(app.getPath('userData'), 'thumbs')
  try { mkdirSync(d, { recursive: true }) } catch {}
  return d
}

function thumbKey(filePath: string, size: number, mtimeMs: number): string {
  return createHash('md5').update(`${filePath}|${size}|${Math.round(mtimeMs)}`).digest('hex')
}

async function makeThumbnail(sourcePath: string, cachePath: string): Promise<Buffer | null> {
  try {
    // lazy-load sharp agar startup tetap ringan
    const sharp = (await import('sharp')).default
    const buf = await sharp(sourcePath, { failOnError: false })
      .rotate() // auto-orient EXIF
      .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 62, mozjpeg: false })
      .toBuffer()
    try { writeFileSync(cachePath, buf) } catch {}
    return buf
  } catch {
    return null
  }
}

// ---- Analysis image pipeline (v2, High saja): terpisah dari UI thumbnail ----
// UI thumbnail kecil (480px q62) bagus untuk grid, tapi High 512 upscale tanpa
// info tambah. Analysis image 1280px q85 + cache terpisah `userData/analysis`.
function analysisCacheDir(): string {
  const d = join(app.getPath('userData'), 'analysis')
  try { mkdirSync(d, { recursive: true }) } catch {}
  return d
}

async function makeAnalysisImage(sourcePath: string, cachePath: string, maxSide: number): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default
    const size = Math.max(320, Math.min(1600, Math.round(maxSide)))
    const buf = await sharp(sourcePath, { failOnError: false })
      .rotate()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: false })
      .toBuffer()
    try { writeFileSync(cachePath, buf) } catch {}
    return buf
  } catch {
    return null
  }
}

ipcMain.handle('fs:getAnalysisBatch', async (_e, items: { filePath: string, previewPath?: string }[], maxSide?: number) => {
  const size = Math.max(320, Math.min(1600, Math.round(maxSide || 1280)))
  const sliced = (items || []).slice(0, 12)
  const out: Record<string, { dataUrl: string | null, isRaw?: boolean, error?: string }> = {}
  const queue = [...sliced]
  const cacheDir = analysisCacheDir() // hoist: jangan mkdir per item
  async function worker() {
    while (queue.length) {
      const it = queue.shift()!
      const src = it.previewPath || it.filePath
      try {
        const ext = extname(src).toLowerCase()
        if (RAW_EXTS.has(ext) && !it.previewPath) { out[it.filePath] = { dataUrl: null, isRaw: true }; continue }
        let stat: any
        try { stat = statSync(src) } catch { out[it.filePath] = { dataUrl: null, error: 'not-found' }; continue }
        const key = thumbKey(`${src}|a${size}`, stat.size, stat.mtimeMs)
        const cachePath = join(cacheDir, key + '.jpg')
        if (existsSync(cachePath)) {
          try {
            const cached = readFileSync(cachePath)
            out[it.filePath] = { dataUrl: `data:image/jpeg;base64,${cached.toString('base64')}` }
            continue
          } catch {}
        }
        const buf = await makeAnalysisImage(src, cachePath, size)
        out[it.filePath] = buf ? { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` } : { dataUrl: null, error: 'decode-failed' }
      } catch (err:any) {
        out[it.filePath] = { dataUrl: null, error: String(err?.message || err) }
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return out
})

ipcMain.handle('fs:getThumbnail', async (_e, filePath: string, previewPath?: string) => {
  try {
    const src = previewPath || filePath
    const ext = extname(src).toLowerCase()
    // RAW murni tanpa JPG pair → tidak ada preview
    if (RAW_EXTS.has(ext) && !previewPath) {
      return { dataUrl: null, isRaw: true, ext }
    }
    let stat: any
    try { stat = statSync(src) } catch { return { dataUrl: null, error: 'not-found' } }
    const key = thumbKey(src, stat.size, stat.mtimeMs)
    const cachePath = join(thumbCacheDir(), key + '.jpg')
    if (existsSync(cachePath)) {
      try {
        const cached = readFileSync(cachePath)
        return { dataUrl: `data:image/jpeg;base64,${cached.toString('base64')}`, isRaw: false, cached: true }
      } catch {}
    }
    const buf = await makeThumbnail(src, cachePath)
    if (!buf) return { dataUrl: null, error: 'decode-failed' }
    return { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`, isRaw: false, cached: false }
  } catch (e:any) {
    return { dataUrl: null, error: String(e?.message || e) }
  }
})

ipcMain.handle('fs:getThumbnailsBatch', async (_e, items: { filePath: string, previewPath?: string }[]) => {
  // Batch max 12 per panggilan agar IPC tidak jumbo; dipanggil lazy dari grid/AI
  const sliced = (items || []).slice(0, 12)
  const out: Record<string, { dataUrl: string | null, isRaw?: boolean, error?: string }> = {}
  // concurrency 4 agar disk tidak thrashing
  const queue = [...sliced]
  const cacheDir = thumbCacheDir() // hoist: jangan mkdir per item
  async function worker() {
    while (queue.length) {
      const it = queue.shift()!
      const src = it.previewPath || it.filePath
      try {
        const ext = extname(src).toLowerCase()
        if (RAW_EXTS.has(ext) && !it.previewPath) { out[it.filePath] = { dataUrl: null, isRaw: true }; continue }
        let stat: any
        try { stat = statSync(src) } catch { out[it.filePath] = { dataUrl: null, error: 'not-found' }; continue }
        const key = thumbKey(src, stat.size, stat.mtimeMs)
        const cachePath = join(cacheDir, key + '.jpg')
        if (existsSync(cachePath)) {
          try {
            const cached = readFileSync(cachePath)
            out[it.filePath] = { dataUrl: `data:image/jpeg;base64,${cached.toString('base64')}` }
            continue
          } catch {}
        }
        const buf = await makeThumbnail(src, cachePath)
        out[it.filePath] = buf ? { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` } : { dataUrl: null, error: 'decode-failed' }
      } catch (err:any) {
        out[it.filePath] = { dataUrl: null, error: String(err?.message || err) }
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return out
})

ipcMain.handle('fs:clearThumbCache', async () => {
  try {
    // kosongkan isi kedua cache (folder tetap ada)
    const cleared = { thumbs: 0, analysis: 0 }
    for (const [name, dir] of [['thumbs', thumbCacheDir()], ['analysis', analysisCacheDir()]] as const) {
      for (const f of readdirSync(dir)) {
        try { unlinkSync(join(dir, f)); cleared[name]++ } catch {}
      }
    }
    return { ok: true, cleared }
  } catch (e) {
    return { ok: false, cleared: { thumbs: 0, analysis: 0 }, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('fs:readImageAsDataUrl', async (_e, filePath: string) => {
  const ext = extname(filePath).toLowerCase()
  try {
    // RAW tidak bisa didecode Chromium → renderer menampilkan placeholder
    if (RAW_EXTS.has(ext)) return { dataUrl: null, isRaw: true, ext }

    // format yang langsung dirender Chromium: baca apa adanya
    const webMime: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    }
    const mime = webMime[ext]
    if (mime) {
      const buf = readFileSync(filePath)
      return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, isRaw: false, ext }
    }

    // tiff/bmp/heic/heif/… tidak dirender Chromium → decode via sharp ke JPEG.
    // Import dinamis: sharp berat, jangan dibebankan saat startup main process.
    const sharp = (await import('sharp')).default
    const buf = await sharp(filePath, { failOnError: false })
      .rotate()
      .jpeg({ quality: 90 })
      .toBuffer()
    return { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`, isRaw: false, ext }
  } catch {
    return { dataUrl: null, isRaw: false, error: 'decode-failed', ext }
  }
})

ipcMain.handle('fs:writeXmp', async (_e, filePath: string, xmpContent: string) => {
  try {
    const dir = dirname(filePath)
    const base = basename(filePath, extname(filePath))
    const xmpPath = join(dir, base + '.xmp')
    writeFileSync(xmpPath, xmpContent, 'utf-8')
    return { ok: true, xmpPath }
  } catch (e:any) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('fs:writeXmpsBulk', async (_e, items: { filePath: string, rating: number, label: string, pairedPath?: string }[], opts?: { overwrite?: boolean }) => {
  const list = Array.isArray(items) ? items : []
  const overwrite = opts?.overwrite === true
  const handled = new Set<string>() // path xmp yang sudah ditulis/di-skip → jangan tulis dua kali
  const errors: { file: string, error: string }[] = []
  let ok = 0
  let skipped = 0

  for (const it of list) {
    // RAW+JPG berbagi basename → sidecar yang sama; Set mencegah tulis ganda
    const srcs = [it.filePath, it.pairedPath].filter((p): p is string => !!p)
    for (const src of srcs) {
      const xmpPath = join(dirname(src), basename(src, extname(src)) + '.xmp')
      if (handled.has(xmpPath)) continue
      handled.add(xmpPath)
      try {
        // default: jangan timpa sidecar yang sudah ada (bisa berisi edit Lightroom)
        if (existsSync(xmpPath) && !overwrite) { skipped++; continue }
        const tmp = xmpPath + '.tmp'
        writeFileSync(tmp, buildXmp({ rating: it.rating, label: it.label as XmpMeta['label'] }), 'utf-8')
        renameSync(tmp, xmpPath) // atomik dalam direktori yang sama
        ok++
      } catch (e) {
        errors.push({ file: src, error: e instanceof Error ? e.message : String(e) })
        try { unlinkSync(xmpPath + '.tmp') } catch {}
      }
    }
  }
  // total = jumlah sidecar unik yang diproses (ok + skipped + gagal)
  return { ok, skipped, total: ok + skipped + errors.length, errors }
})

// resolve() dulu; Windows case-insensitive
function sameDir(a: string, b: string): boolean {
  const ra = resolve(a)
  const rb = resolve(b)
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb
}

ipcMain.handle('fs:movePhotos', async (_e, payload: { items: { filePath: string, pairedPath?: string, sub?: string }[], destDir: string }) => {
  const items = payload?.items ?? []
  const destDir = payload?.destDir
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
  if (!destDir) return { ok: false, moved: 0, skipped: 0, movedPaths: [], failed: [], total: items.length, error: 'no-dest' }
  try { mkdirSync(destDir, { recursive: true }) } catch (e) {
    return { ok: false, moved: 0, skipped: 0, movedPaths: [], failed: [], total: items.length, error: errMsg(e) }
  }

  // reserve nama tujuan agar dua job tidak mendapat path yang sama
  const reserved = new Set<string>()
  function uniqueDest(dir: string, name: string): string {
    const ext = extname(name)
    const base = basename(name, ext)
    let candidate = join(dir, name)
    let n = 1
    while (existsSync(candidate) || reserved.has(candidate)) {
      candidate = join(dir, `${base} (${n})${ext}`)
      n++
    }
    reserved.add(candidate)
    return candidate
  }

  function moveOne(src: string, dest: string) {
    try {
      renameSync(src, dest)
    } catch (e) {
      // Node melempar ErrnoException; EXDEV = beda drive/partisi → salin lalu hapus
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        copyFileSync(src, dest)
        unlinkSync(src)
      } else throw e
    }
  }

  const movedPaths: string[] = []
  const failed: { file: string, error: string }[] = []
  let skipped = 0

  for (const it of items) {
    const pairFiles = [it.filePath, it.pairedPath].filter((p): p is string => !!p)
    try {
      if (!existsSync(it.filePath)) throw new Error('file-tidak-ditemukan')
      // Subfolder per kategori ("Buat Folder Terpisah"): Picks/Maybe/Rejects.
      // basename() = anti traversal, mkdir rekursif.
      const dir = it.sub ? join(destDir, basename(it.sub)) : destDir
      try { mkdirSync(dir, { recursive: true }) } catch {}
      // sudah di folder tujuan → skip, jangan hitung moved
      if (pairFiles.every((f) => sameDir(dirname(f), dir))) {
        skipped++
        continue
      }
      // hitung semua destinasi dulu (reservasi), baru pindahkan
      const jobs: [string, string][] = []
      const destMain = uniqueDest(dir, basename(it.filePath))
      jobs.push([it.filePath, destMain])
      if (it.pairedPath && existsSync(it.pairedPath) && !sameDir(dirname(it.pairedPath), dir)) {
        jobs.push([it.pairedPath, uniqueDest(dir, basename(it.pairedPath))])
      }
      // .xmp pendamping ikut pindah, mengikuti nama file tujuannya.
      // RAW+JPG berbagi basename → xmp yang sama; dedupe agar tidak dipindah dua kali.
      const seenXmp = new Set<string>()
      for (const src of pairFiles) {
        if (sameDir(dirname(src), dir)) continue
        const xmpSrc = join(dirname(src), basename(src, extname(src)) + '.xmp')
        const xmpKey = xmpSrc.toLowerCase()
        if (!existsSync(xmpSrc) || seenXmp.has(xmpKey)) continue
        seenXmp.add(xmpKey)
        const pairedJob = jobs.find(([s]) => s === src)
        const destBase = pairedJob ? basename(pairedJob[1], extname(pairedJob[1])) : basename(src, extname(src))
        jobs.push([xmpSrc, uniqueDest(dir, destBase + '.xmp')])
      }
      // satu item = beberapa job; gagal satu job → catat nama yang gagal, jangan rollback
      let itemFailed = false
      for (const [s, d] of jobs) {
        try { moveOne(s, d) } catch (e) {
          failed.push({ file: basename(s), error: errMsg(e) })
          itemFailed = true
        }
      }
      if (itemFailed) {
        // pasangan (RAW+JPG) ditampilkan sebagai satu entri → catat kedua nama
        const err = failed[failed.length - 1].error
        for (const f of pairFiles) {
          const name = basename(f)
          if (!failed.some((x) => x.file === name)) failed.push({ file: name, error: err })
        }
        continue
      }
      movedPaths.push(it.filePath)
    } catch (e) {
      failed.push({ file: basename(it.filePath), error: errMsg(e) })
    }
  }
  return { ok: true, moved: movedPaths.length, skipped, movedPaths, failed, total: items.length }
})

ipcMain.handle('shell:showInFolder', async (_e, filePath: string) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle('shell:openPath', async (_e, filePath: string) => {
  shell.openPath(filePath)
})

ipcMain.handle('app:getPath', async (_e, name: string) => {
  return app.getPath(name as any)
})

ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.handle('window:close', () => mainWindow?.close())
