// Thumbnail cache: memori LRU + disk cache (main) + dedup request + batch prefetch.
// Tujuannya: grid 1500 foto tetap ringan — hanya thumbnail visible yang di-load,
// masing-masing ~20-50KB (bukan 5-30MB full-res).

import type { PhotoItem } from '@/types'

const memCache = new Map<string, string | null>() // filePath -> thumb dataUrl (null = RAW/gagal)
const inflight = new Map<string, Promise<string | null>>()
const MAX_MEM = 400

function memSet(key: string, val: string | null) {
  if (memCache.has(key)) memCache.delete(key)
  memCache.set(key, val)
  if (memCache.size > MAX_MEM) {
    const first = memCache.keys().next().value
    if (first) memCache.delete(first)
  }
}

export function getMemThumb(filePath: string): string | null | undefined {
  return memCache.has(filePath) ? memCache.get(filePath)! : undefined
}

export function setMemThumb(filePath: string, url: string | null) {
  memSet(filePath, url)
}

/** Ambil 1 thumbnail (cached). Aman dipanggil dari banyak card bersamaan (dedup). */
export function fetchThumb(item: PhotoItem): Promise<string | null> {
  const key = item.filePath
  const mem = getMemThumb(key)
  if (mem !== undefined) return Promise.resolve(mem)
  if (item.thumbUrl !== undefined && item.thumbUrl !== null) {
    memSet(key, item.thumbUrl)
    return Promise.resolve(item.thumbUrl)
  }
  const run = inflight.get(key)
  if (run) return run
  const p = (async () => {
    try {
      const res = await window.ohmyflow.getThumbnail(item.filePath, item.previewPath)
      const url = res?.dataUrl ?? null
      memSet(key, url)
      return url
    } catch {
      memSet(key, null)
      return null
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

/** Prefetch batch (max 12/IPC) untuk AI culling — jauh lebih hemat IPC daripada satu-satu. */
export async function prefetchThumbsBatch(items: PhotoItem[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const missing = items.filter((i) => getMemThumb(i.filePath) === undefined && !(i.thumbUrl))
  // yang sudah ada langsung kembalikan
  for (const i of items) {
    const m = getMemThumb(i.filePath)
    if (m !== undefined) out.set(i.filePath, m)
    else if (i.thumbUrl) { memSet(i.filePath, i.thumbUrl); out.set(i.filePath, i.thumbUrl) }
  }
  // batch 12
  for (let k = 0; k < missing.length; k += 12) {
    const chunk = missing.slice(k, k + 12)
    try {
      const res = await window.ohmyflow.getThumbnailsBatch(
        chunk.map((c) => ({ filePath: c.filePath, previewPath: c.previewPath }))
      )
      for (const c of chunk) {
        const url = res?.[c.filePath]?.dataUrl ?? null
        memSet(c.filePath, url)
        out.set(c.filePath, url)
      }
    } catch {
      for (const c of chunk) { memSet(c.filePath, null); out.set(c.filePath, null) }
    }
  }
  return out
}

export function clearMemThumbs() {
  memCache.clear()
  inflight.clear()
}

/** Buang cache milik file yang sudah dipindah/dihapus agar tidak tampil basi. */
export function dropMemThumbs(filePaths: string[]) {
  for (const k of filePaths) {
    memCache.delete(k)
    inflight.delete(k)
  }
}
