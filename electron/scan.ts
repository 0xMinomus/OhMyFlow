// Scan folder + pairing RAW+JPG.
// Bug lama: `basename(entry, ext.toLowerCase())` tidak memotong ekstensi huruf besar
// (`.CR3`, `.JPG`) → key `img_1234.cr3` ≠ `img_1234.jpg`, foto Canon/Nikon tampil
// sebagai dua entri terpisah dan menulis sidecar yang sama.
// Sekarang ekstensi dipotong manual dari nama asli, base case-preserved, key lowercase.

import { readdir, stat } from 'fs/promises'
import { join, extname } from 'path'

export const SUPPORTED_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp', '.bmp',
  '.heic', '.heif',
  '.cr2', '.cr3', '.nef', '.arw', '.raf', '.dng', '.rw2', '.orf', '.pef',
  '.xmp' // to ignore
])

export const RAW_EXTS = new Set(['.cr2', '.cr3', '.nef', '.arw', '.raf', '.dng', '.rw2', '.orf', '.pef'])

export interface ScannedFile {
  id: string
  fileName: string
  filePath: string
  pairedPath?: string
  previewPath?: string
  isPaired: boolean
  isRaw: boolean
  ext: string
  size: number
  baseName: string
  mtimeMs: number
}

export async function scanFolder(folderPath: string): Promise<ScannedFile[]> {
  // sort dulu supaya hasil deterministik (readdir tidak menjamin urutan)
  const entries = (await readdir(folderPath)).sort((a, b) => a.localeCompare(b))

  // indeks JPG per base lowercase → nama file lengkap
  const jpgByBase = new Map<string, string>()
  for (const entry of entries) {
    const ext = extname(entry).toLowerCase()
    if (ext !== '.jpg' && ext !== '.jpeg') continue
    const key = entry.slice(0, entry.length - ext.length).toLowerCase()
    if (!jpgByBase.has(key)) jpgByBase.set(key, entry)
  }

  const map = new Map<string, ScannedFile>()
  for (const entry of entries) {
    const ext = extname(entry).toLowerCase()
    if (ext === '.xmp' || !SUPPORTED_EXTS.has(ext)) continue

    const full = join(folderPath, entry)
    let st
    try { st = await stat(full) } catch { continue } // file hilang antara readdir & stat
    if (st.isDirectory()) continue

    const base = entry.slice(0, entry.length - ext.length) // preserve case asli
    const key = base.toLowerCase()

    if (RAW_EXTS.has(ext)) {
      const jpg = jpgByBase.get(key)
      if (jpg) {
        const pairedPath = join(folderPath, jpg)
        map.set(key, {
          id: key + '_rawjpg',
          fileName: entry,
          filePath: full,
          pairedPath,
          previewPath: pairedPath, // renderer pakai ini untuk thumbnail
          isPaired: true,
          isRaw: true,
          ext,
          size: st.size,
          baseName: base,
          mtimeMs: st.mtimeMs,
        })
      } else if (!map.has(key)) {
        map.set(key, {
          id: key,
          fileName: entry,
          filePath: full,
          isPaired: false,
          isRaw: true,
          ext,
          size: st.size,
          baseName: base,
          mtimeMs: st.mtimeMs,
        })
      }
    } else {
      // JPG pasangan sudah diwakili entri RAW+JPG
      if (map.has(key) && map.get(key)!.isPaired) continue
      const rec: ScannedFile = {
        id: map.has(key) ? key + '_' + ext : key,
        fileName: entry,
        filePath: full,
        previewPath: full,
        isPaired: false,
        isRaw: false,
        ext,
        size: st.size,
        baseName: base,
        mtimeMs: st.mtimeMs,
      }
      if (!map.has(key)) map.set(key, rec)
      else map.set(rec.id, rec)
    }
  }

  return [...map.values()].sort((a, b) => a.fileName.localeCompare(b.fileName))
}
