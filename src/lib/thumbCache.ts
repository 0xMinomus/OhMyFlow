// Thumbnail cache: menyimpan media:// URL ringan di memori (zero base64 IPC / bloat).
import type { PhotoItem } from '@/types'
import { mediaUrl } from './bridge'

const memCache = new Map<string, string | null>()
const MAX_MEM = 2000

function memSet(key: string, val: string | null) {
  if (memCache.has(key)) memCache.delete(key)
  memCache.set(key, val)
  if (memCache.size > MAX_MEM) {
    const first = memCache.keys().next().value
    if (first !== undefined) memCache.delete(first)
  }
}

export function getMemThumb(filePath: string): string | null | undefined {
  return memCache.has(filePath) ? memCache.get(filePath)! : undefined
}

export function setMemThumb(filePath: string, url: string | null) {
  memSet(filePath, url)
}

export function fetchThumb(item: PhotoItem): Promise<string | null> {
  const key = item.filePath
  const mem = getMemThumb(key)
  if (mem !== undefined) return Promise.resolve(mem)
  const url = mediaUrl(item.previewPath || item.filePath, 'thumb', item.mtimeMs)
  memSet(key, url)
  return Promise.resolve(url)
}

export async function prefetchThumbsBatch(items: PhotoItem[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  for (const i of items) {
    const m = getMemThumb(i.filePath)
    if (m !== undefined) {
      out.set(i.filePath, m)
    } else {
      const url = mediaUrl(i.previewPath || i.filePath, 'thumb', i.mtimeMs)
      memSet(i.filePath, url)
      out.set(i.filePath, url)
    }
  }
  return out
}

export function clearMemThumbs() {
  memCache.clear()
}

export async function prefetchAnalysisBatch(): Promise<Map<string, string | null>> {
  return new Map()
}

export function dropMemThumbs(filePaths: string[]) {
  for (const k of filePaths) {
    memCache.delete(k)
  }
}

export function clearMemAnalysis() {}
