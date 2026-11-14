import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron'
import { join, extname } from 'path'
import { access, mkdir, readdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import Module, { createRequire } from 'module'
import type sharpType from 'sharp'
import { scanFolder, RAW_EXTS } from './scan'
import { pruneCacheDir } from './cache'
import { movePhotos, type MovePhotoItem } from './fs-ops'
import { extractRawPreview } from './raw-preview'
import { loadFolderSession, saveFolderSession, type FolderSession } from './session'
import { ALLOWED_APP_PATHS, APP_CSP, isSafeLocalPath, resolveBundlePath } from './security'

let mainWindow: BrowserWindow | null = null

const THUMB_CACHE_MAX_BYTES = 250 * 1024 * 1024
const ANALYSIS_CACHE_MAX_BYTES = 500 * 1024 * 1024
const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const SESSION_CACHE_MAX_BYTES = 50 * 1024 * 1024
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const WEB_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

// Skema privileged untuk renderer (standard + fetchable). Wajib sebelum ready.
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

async function createWindow() {
  // icon per platform: Linux butuh .png, Windows .ico. Jangan set bila file tidak ada.
  const iconPath = process.platform === 'linux'
    ? join(__dirname, '../build/icon.png')
    : join(__dirname, '../build/icon.ico')
  let hasIcon = false
  try { await access(iconPath); hasIcon = true } catch {}

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
      sandbox: true,
    },
    show: false,
    ...(hasIcon ? { icon: iconPath } : {}),
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadURL('app://app/index.html')
  }
}

async function pruneCaches() {
  const userData = app.getPath('userData')
  await Promise.all([
    pruneCacheDir(join(userData, 'thumbs'), THUMB_CACHE_MAX_BYTES, CACHE_MAX_AGE_MS),
    pruneCacheDir(join(userData, 'analysis'), ANALYSIS_CACHE_MAX_BYTES, CACHE_MAX_AGE_MS),
    pruneCacheDir(join(userData, 'sessions'), SESSION_CACHE_MAX_BYTES, SESSION_MAX_AGE_MS),
  ])
}

app.whenReady().then(async () => {
  // Renderer via `app://` (bukan file://) agar bisa pasang COOP/COEP →
  // crossOriginIsolated = true → SharedArrayBuffer untuk ONNX wasm.
  // Hanya layani GET di dalam dist/ (anti traversal + CSP ketat).
  protocol.handle('app', async (req) => {
    try {
      if (req.method !== 'GET') return new Response('method not allowed', { status: 405 })
      const u = new URL(req.url)
      const root = join(__dirname, '../dist')
      const filePath = resolveBundlePath(root, u.pathname)
      if (!filePath) return new Response('forbidden', { status: 403 })
      let st
      try { st = await stat(filePath) } catch { return new Response('not found', { status: 404 }) }
      if (!st.isFile()) return new Response('not found', { status: 404 })
      const res = await net.fetch('file:///' + filePath.replace(/\\/g, '/'))
      const headers = new Headers(res.headers)
      headers.set('Cross-Origin-Opener-Policy', 'same-origin')
      headers.set('Cross-Origin-Embedder-Policy', 'credentialless')
      headers.set('Content-Security-Policy', APP_CSP)
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
    } catch (e: unknown) {
      return new Response(e instanceof Error ? e.message : String(e), { status: 500 })
    }
  })

  await createWindow()
  setTimeout(() => { void pruneCaches() }, 4000).unref()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})

// ---- IPC ----

ipcMain.handle('dialog:openFolder', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('fs:scanFolder', async (_e, folderPath: string) => {
  if (!isSafeLocalPath(folderPath)) throw new Error('invalid-folder-path')
  return scanFolder(folderPath)
})

// ---- Thumbnail & analysis image pipelines (async, cached, bounded) ----

async function ensureDir(sub: 'thumbs' | 'analysis'): Promise<string> {
  const d = join(app.getPath('userData'), sub)
  try { await mkdir(d, { recursive: true }) } catch {}
  return d
}

function thumbKey(filePath: string, size: number, mtimeMs: number): string {
  return createHash('md5').update(`${filePath}|${size}|${Math.round(mtimeMs)}`).digest('hex')
}

let cachedSharp: typeof sharpType | null = null
function getSharp(): typeof sharpType {
  if (cachedSharp) return cachedSharp
  const nodeRequire = createRequire(__filename)
  // Di Linux Electron, binary native @img/sharp-linux-* bentrok dengan libglib sistem
  // yang di-link Electron (VIPS_IS_OBJECT abort / SIGSEGV). Pakai @img/sharp-wasm32.
  if (process.platform === 'linux' && process.versions.electron) {
    try {
      nodeRequire.resolve('@img/sharp-wasm32/sharp.node')
      const M = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown }
      const origLoad = M._load
      M._load = function (req: string, parent: unknown, isMain: boolean) {
        if (typeof req === 'string' && req.startsWith('@img/sharp-linux')) {
          throw Object.assign(new Error('skip native sharp on Electron Linux'), { code: 'MODULE_NOT_FOUND' })
        }
        return origLoad.call(this, req, parent, isMain)
      }
      try {
        cachedSharp = nodeRequire('sharp') as typeof sharpType
        return cachedSharp
      } finally {
        M._load = origLoad
      }
    } catch {}
  }
  cachedSharp = nodeRequire('sharp') as typeof sharpType
  return cachedSharp
}

async function resolveSharpInput(sourcePath: string): Promise<string | Buffer | null> {
  const ext = extname(sourcePath).toLowerCase()
  if (RAW_EXTS.has(ext)) return extractRawPreview(sourcePath)
  return sourcePath
}

async function makeThumbnail(sourcePath: string, cachePath: string): Promise<{ buf: Buffer | null; isRawNoPreview?: boolean }> {
  try {
    const input = await resolveSharpInput(sourcePath)
    if (!input) return { buf: null, isRawNoPreview: true }
    const sharp = getSharp()
    const buf = await sharp(input, { failOn: 'none' })
      .rotate() // auto-orient EXIF
      .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 62, mozjpeg: false })
      .toBuffer()
    try { await writeFile(cachePath, buf) } catch {}
    return { buf }
  } catch {
    return { buf: null }
  }
}

async function makeAnalysisImage(sourcePath: string, cachePath: string, maxSide: number): Promise<{ buf: Buffer | null; isRawNoPreview?: boolean }> {
  try {
    const input = await resolveSharpInput(sourcePath)
    if (!input) return { buf: null, isRawNoPreview: true }
    const sharp = getSharp()
    const size = Math.max(320, Math.min(1600, Math.round(maxSide)))
    const buf = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: false })
      .toBuffer()
    try { await writeFile(cachePath, buf) } catch {}
    return { buf }
  } catch {
    return { buf: null }
  }
}

ipcMain.handle('fs:getAnalysisBatch', async (_e, items: { filePath: string; previewPath?: string }[], maxSide?: number) => {
  const size = Math.max(320, Math.min(1600, Math.round(maxSide || 1280)))
  const sliced = (items || []).slice(0, 12)
  const out: Record<string, { dataUrl: string | null; isRaw?: boolean; error?: string }> = {}
  const queue = [...sliced]
  const cacheDir = await ensureDir('analysis')
  async function worker() {
    while (queue.length) {
      const it = queue.shift()!
      const src = it.previewPath || it.filePath
      if (!isSafeLocalPath(src)) { out[it.filePath] = { dataUrl: null, error: 'invalid-path' }; continue }
      try {
        let st
        try { st = await stat(src) } catch { out[it.filePath] = { dataUrl: null, error: 'not-found' }; continue }
        const key = thumbKey(`${src}|a${size}`, st.size, st.mtimeMs)
        const cachePath = join(cacheDir, key + '.jpg')
        try {
          const cached = await readFile(cachePath)
          out[it.filePath] = { dataUrl: `data:image/jpeg;base64,${cached.toString('base64')}` }
          continue
        } catch {}
        const res = await makeAnalysisImage(src, cachePath, size)
        if (res.buf) out[it.filePath] = { dataUrl: `data:image/jpeg;base64,${res.buf.toString('base64')}` }
        else if (res.isRawNoPreview) out[it.filePath] = { dataUrl: null, isRaw: true }
        else out[it.filePath] = { dataUrl: null, error: 'decode-failed' }
      } catch (err: unknown) {
        out[it.filePath] = { dataUrl: null, error: err instanceof Error ? err.message : String(err) }
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return out
})

ipcMain.handle('fs:getThumbnail', async (_e, filePath: string, previewPath?: string) => {
  try {
    const src = previewPath || filePath
    if (!isSafeLocalPath(src)) return { dataUrl: null, error: 'invalid-path' }
    const ext = extname(src).toLowerCase()
    let st
    try { st = await stat(src) } catch { return { dataUrl: null, error: 'not-found' } }
    const key = thumbKey(src, st.size, st.mtimeMs)
    const cacheDir = await ensureDir('thumbs')
    const cachePath = join(cacheDir, key + '.jpg')
    try {
      const cached = await readFile(cachePath)
      return { dataUrl: `data:image/jpeg;base64,${cached.toString('base64')}`, isRaw: false, cached: true }
    } catch {}
    const res = await makeThumbnail(src, cachePath)
    if (!res.buf) {
      return res.isRawNoPreview
        ? { dataUrl: null, isRaw: true, ext }
        : { dataUrl: null, error: 'decode-failed' }
    }
    return { dataUrl: `data:image/jpeg;base64,${res.buf.toString('base64')}`, isRaw: false, cached: false }
  } catch (e: unknown) {
    return { dataUrl: null, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('fs:getThumbnailsBatch', async (_e, items: { filePath: string; previewPath?: string }[]) => {
  const sliced = (items || []).slice(0, 12)
  const out: Record<string, { dataUrl: string | null; isRaw?: boolean; error?: string }> = {}
  const queue = [...sliced]
  const cacheDir = await ensureDir('thumbs')
  async function worker() {
    while (queue.length) {
      const it = queue.shift()!
      const src = it.previewPath || it.filePath
      if (!isSafeLocalPath(src)) { out[it.filePath] = { dataUrl: null, error: 'invalid-path' }; continue }
      try {
        let st
        try { st = await stat(src) } catch { out[it.filePath] = { dataUrl: null, error: 'not-found' }; continue }
        const key = thumbKey(src, st.size, st.mtimeMs)
        const cachePath = join(cacheDir, key + '.jpg')
        try {
          const cached = await readFile(cachePath)
          out[it.filePath] = { dataUrl: `data:image/jpeg;base64,${cached.toString('base64')}` }
          continue
        } catch {}
        const res = await makeThumbnail(src, cachePath)
        if (res.buf) out[it.filePath] = { dataUrl: `data:image/jpeg;base64,${res.buf.toString('base64')}` }
        else if (res.isRawNoPreview) out[it.filePath] = { dataUrl: null, isRaw: true }
        else out[it.filePath] = { dataUrl: null, error: 'decode-failed' }
      } catch (err: unknown) {
        out[it.filePath] = { dataUrl: null, error: err instanceof Error ? err.message : String(err) }
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return out
})

ipcMain.handle('fs:clearThumbCache', async () => {
  try {
    const cleared = { thumbs: 0, analysis: 0 }
    for (const name of ['thumbs', 'analysis'] as const) {
      const dir = await ensureDir(name)
      const files = await readdir(dir)
      await Promise.all(files.map(async (f) => {
        try { await unlink(join(dir, f)); cleared[name]++ } catch {}
      }))
    }
    return { ok: true, cleared }
  } catch (e) {
    return { ok: false, cleared: { thumbs: 0, analysis: 0 }, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('fs:readImageAsDataUrl', async (_e, filePath: string) => {
  if (!isSafeLocalPath(filePath)) return { dataUrl: null, isRaw: false, error: 'invalid-path' }
  const ext = extname(filePath).toLowerCase()
  try {
    if (RAW_EXTS.has(ext)) {
      const rawPreview = await extractRawPreview(filePath)
      if (!rawPreview) return { dataUrl: null, isRaw: true, ext }
      try {
        const sharp = getSharp()
        const oriented = await sharp(rawPreview, { failOn: 'none' }).rotate().jpeg({ quality: 92 }).toBuffer()
        return { dataUrl: `data:image/jpeg;base64,${oriented.toString('base64')}`, isRaw: false, ext }
      } catch {
        return { dataUrl: `data:image/jpeg;base64,${rawPreview.toString('base64')}`, isRaw: false, ext }
      }
    }

    const mime = WEB_MIME[ext]
    if (mime) {
      const buf = await readFile(filePath)
      return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, isRaw: false, ext }
    }

    const sharp = getSharp()
    const buf = await sharp(filePath, { failOn: 'none' })
      .rotate()
      .jpeg({ quality: 90 })
      .toBuffer()
    return { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`, isRaw: false, ext }
  } catch {
    return { dataUrl: null, isRaw: false, error: 'decode-failed', ext }
  }
})


ipcMain.handle('fs:movePhotos', async (_e, payload: { items: MovePhotoItem[]; destDir: string }) => {
  if (!isSafeLocalPath(payload?.destDir)) {
    return { ok: false, moved: 0, skipped: 0, movedPaths: [], failed: [], total: payload?.items?.length ?? 0, error: 'invalid-dest' }
  }
  return movePhotos(payload)
})

ipcMain.handle('shell:showInFolder', async (_e, filePath: string) => {
  if (!isSafeLocalPath(filePath)) return
  shell.showItemInFolder(filePath)
})

ipcMain.handle('shell:openPath', async (_e, filePath: string) => {
  if (!isSafeLocalPath(filePath)) return
  await shell.openPath(filePath)
})

ipcMain.handle('app:getPath', async (_e, name: string) => {
  if (!ALLOWED_APP_PATHS[name]) throw new Error('disallowed-app-path')
  return app.getPath(name as Parameters<typeof app.getPath>[0])
})

ipcMain.handle('session:load', async (_e, folderPath: string) => {
  if (!isSafeLocalPath(folderPath)) return null
  return loadFolderSession(join(app.getPath('userData'), 'sessions'), folderPath)
})

ipcMain.handle('session:save', async (_e, session: FolderSession) => {
  if (!session || !isSafeLocalPath(session.folderPath)) return false
  return saveFolderSession(join(app.getPath('userData'), 'sessions'), session)
})

ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.handle('window:close', () => mainWindow?.close())
