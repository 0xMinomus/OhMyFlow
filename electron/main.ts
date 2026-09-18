import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron'
import { join, normalize } from 'path'
import { existsSync, readdirSync, statSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, renameSync, copyFileSync } from 'fs'
import { createHash } from 'crypto'
import { extname, basename, dirname } from 'path'

let mainWindow: BrowserWindow | null = null

// Skema privileged untuk renderer (standard + fetchable). Wajib sebelum ready.
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

const SUPPORTED_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp', '.bmp',
  '.heic', '.heif',
  '.cr2', '.cr3', '.nef', '.arw', '.raf', '.dng', '.rw2', '.orf', '.pef',
  '.xmp' // to ignore
])

const RAW_EXTS = new Set(['.cr2', '.cr3', '.nef', '.arw', '.raf', '.dng', '.rw2', '.orf', '.pef'])

function createWindow() {
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
    icon: join(__dirname, '../build/icon.ico')
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
  try {
    const entries = readdirSync(folderPath)
    // O(n) index: pre-build jpg basename set to avoid O(n^2) find
    const jpgBases = new Set<string>()
    const entryExt = new Map<string, string>()
    for (const e of entries) {
      const ex = extname(e).toLowerCase()
      entryExt.set(e, ex)
      if (ex === '.jpg' || ex === '.jpeg') {
        jpgBases.add(basename(e, ex).toLowerCase())
      }
    }

    const map = new Map<string, any>()
    for (const entry of entries) {
      const full = join(folderPath, entry)
      let stat: any
      try { stat = statSync(full) } catch { continue }
      if (stat.isDirectory()) continue
      const ext = entryExt.get(entry)!
      if (ext === '.xmp') continue
      if (!SUPPORTED_EXTS.has(ext)) continue

      const base = basename(entry, ext)
      const key = base.toLowerCase()

      if (RAW_EXTS.has(ext)) {
        if (jpgBases.has(key)) {
          // RAW+JPG pair — cari file JPG pasangannya (O(1) via set, ambil satu)
          const jpgPair = entries.find(e => basename(e, extname(e).toLowerCase()) === key && (extname(e).toLowerCase() === '.jpg' || extname(e).toLowerCase() === '.jpeg'))
          // Fallback aman jika find gagal (seharusnya tidak)
          const pairedFile = jpgPair ? join(folderPath, jpgPair) : undefined
          // Baca stat paired untuk previewPath (dipakai thumbnail)
          let previewPath = pairedFile
          if (!map.has(key)) {
            map.set(key, {
              id: key + '_rawjpg',
              fileName: entry,
              filePath: full,
              pairedPath: pairedFile,
              previewPath: previewPath, // renderer pakai ini untuk thumbnail
              isPaired: true,
              isRaw: true,
              ext,
              size: stat.size,
              baseName: base,
              mtimeMs: stat.mtimeMs
            })
          }
        } else {
          if (!map.has(key)) map.set(key, {
            id: key,
            fileName: entry,
            filePath: full,
            isPaired: false,
            isRaw: true,
            ext,
            size: stat.size,
            baseName: base,
            mtimeMs: stat.mtimeMs
          })
        }
      } else {
        if (map.has(key) && map.get(key).isPaired) continue
        const id = map.has(key) ? key + '_' + ext : key
        const rec = {
          id,
          fileName: entry,
          filePath: full,
          previewPath: full,
          isPaired: false,
          isRaw: false,
          ext,
          size: stat.size,
          baseName: base,
          mtimeMs: stat.mtimeMs
        }
        if (!map.has(key)) map.set(key, rec)
        else map.set(id, rec)
      }
    }

    const files = [...map.values()]
    files.sort((a,b)=> a.fileName.localeCompare(b.fileName))
    return files
  } catch (e:any) {
    console.error(e)
    return []
  }
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
        const cachePath = join(analysisCacheDir(), key + '.jpg')
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
        const cachePath = join(thumbCacheDir(), key + '.jpg')
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
    const { readdirSync: rs, unlinkSync: ul } = await import('fs')
    const dir = thumbCacheDir()
    const files = rs(dir)
    let n = 0
    for (const f of files) { try { ul(join(dir, f)); n++ } catch {} }
    return { ok: true, cleared: n }
  } catch (e:any) { return { ok: false, error: e.message } }
})

ipcMain.handle('fs:readImageAsDataUrl', async (_e, filePath: string) => {
  try {
    const ext = extname(filePath).toLowerCase()
    // For RAW, we can't decode, return null and renderer will show placeholder
    if (RAW_EXTS.has(ext)) {
      // Try to find embedded JPG? For now return null
      return { dataUrl: null, isRaw: true, ext }
    }
    const buf = readFileSync(filePath)
    const mime =
      ext === '.png' ? 'image/png' :
      ext === '.webp' ? 'image/webp' :
      ext === '.tiff' || ext === '.tif' ? 'image/tiff' :
      'image/jpeg'
    const base64 = buf.toString('base64')
    return { dataUrl: `data:${mime};base64,${base64}`, isRaw: false, ext }
  } catch (e) {
    return { dataUrl: null, error: String(e) }
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

ipcMain.handle('fs:writeXmpsBulk', async (_e, items: { filePath: string, rating: number, label: string, pairedPath?: string }[]) => {
  let ok = 0
  for (const it of items) {
    const rating = it.rating
    const label = it.label // Green/Yellow/Red
    const xmp = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="OhMyFlow">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp:Rating="${rating}"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/">
   <xmp:Rating>${rating}</xmp:Rating>
   <xmp:Label>${label}</xmp:Label>
   <lr:hierarchicalSubject>
    <rdf:Bag><rdf:li>OhMyFlow/${label}</rdf:li></rdf:Bag>
   </lr:hierarchicalSubject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`
    try {
      const base = basename(it.filePath, extname(it.filePath))
      const dir = dirname(it.filePath)
      writeFileSync(join(dir, base + '.xmp'), xmp, 'utf-8')
      if (it.pairedPath) {
        const base2 = basename(it.pairedPath, extname(it.pairedPath))
        writeFileSync(join(dir, base2 + '.xmp'), xmp, 'utf-8')
      }
      ok++
    } catch {}
  }
  return { ok, total: items.length }
})

ipcMain.handle('fs:movePhotos', async (_e, payload: { items: { filePath: string, pairedPath?: string, sub?: string }[], destDir: string }) => {
  const items = payload?.items ?? []
  const destDir = payload?.destDir
  if (!destDir) return { ok: false, moved: 0, movedPaths: [], failed: [], total: items.length, error: 'no-dest' }
  try { mkdirSync(destDir, { recursive: true }) } catch (e: any) {
    return { ok: false, moved: 0, movedPaths: [], failed: [], total: items.length, error: String(e?.message || e) }
  }

  function uniqueDest(dir: string, name: string): string {
    const ext = extname(name)
    const base = basename(name, ext)
    let candidate = join(dir, name)
    let n = 1
    while (existsSync(candidate)) {
      candidate = join(dir, `${base} (${n})${ext}`)
      n++
    }
    return candidate
  }

  function moveOne(src: string, dest: string) {
    try {
      renameSync(src, dest)
    } catch (e: any) {
      if (e?.code === 'EXDEV') {
        // beda drive/partisi → salin lalu hapus
        copyFileSync(src, dest)
        unlinkSync(src)
      } else throw e
    }
  }

  const movedPaths: string[] = []
  const failed: { file: string, error: string }[] = []

  for (const it of items) {
    try {
      if (!existsSync(it.filePath)) throw new Error('file-tidak-ditemukan')
      // Subfolder per kategori ("Buat Folder Terpisah"): Picks/Maybe/Rejects.
      // basename() = anti traversal, mkdir rekursif.
      const dir = it.sub ? join(destDir, basename(it.sub)) : destDir
      try { mkdirSync(dir, { recursive: true }) } catch {}
      // sudah di folder tujuan → anggap beres tanpa menyentuh
      if (dirname(it.filePath) === dir && (!it.pairedPath || dirname(it.pairedPath) === dir)) {
        movedPaths.push(it.filePath)
        continue
      }
      const jobs: [string, string][] = []
      const destMain = uniqueDest(dir, basename(it.filePath))
      jobs.push([it.filePath, destMain])
      if (it.pairedPath && existsSync(it.pairedPath) && dirname(it.pairedPath) !== dir) {
        jobs.push([it.pairedPath, uniqueDest(dir, basename(it.pairedPath))])
      }
      // .xmp pendamping ikut pindah, mengikuti nama file tujuannya.
      // RAW+JPG berbagi basename → xmp yang sama; dedupe agar tidak dipindah dua kali.
      const seenXmp = new Set<string>()
      for (const src of [it.filePath, it.pairedPath].filter(Boolean) as string[]) {
        if (dirname(src) === dir) continue
        const xmpSrc = join(dirname(src), basename(src, extname(src)) + '.xmp')
        const xmpKey = xmpSrc.toLowerCase()
        if (!existsSync(xmpSrc) || seenXmp.has(xmpKey)) continue
        seenXmp.add(xmpKey)
        const pairedJob = jobs.find(([s]) => s === src)
        const destBase = pairedJob ? basename(pairedJob[1], extname(pairedJob[1])) : basename(src, extname(src))
        jobs.push([xmpSrc, uniqueDest(dir, destBase + '.xmp')])
      }
      for (const [s, d] of jobs) moveOne(s, d)
      movedPaths.push(it.filePath)
    } catch (e: any) {
      failed.push({ file: basename(it.filePath), error: String(e?.message || e) })
    }
  }
  return { ok: true, moved: movedPaths.length, movedPaths, failed, total: items.length }
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
