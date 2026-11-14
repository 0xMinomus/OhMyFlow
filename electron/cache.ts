import { readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'

export interface PruneResult {
  removed: number
  freedBytes: number
  remainingBytes: number
}

/**
 * Bounded LRU disk cache pruner: removes files older than `maxAgeMs`, then trims
 * oldest-mtime files until total size <= 85% of `maxBytes` when `maxBytes` is exceeded.
 */
export async function pruneCacheDir(
  dir: string,
  maxBytes: number,
  maxAgeMs: number,
  nowMs = Date.now(),
): Promise<PruneResult> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return { removed: 0, freedBytes: 0, remainingBytes: 0 }
  }

  const entries: { path: string; size: number; mtimeMs: number }[] = []
  const queue = [...names]
  async function statWorker() {
    while (queue.length) {
      const name = queue.shift()!
      const p = join(dir, name)
      try {
        const st = await stat(p)
        if (st.isFile()) entries.push({ path: p, size: st.size, mtimeMs: st.mtimeMs })
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, Math.max(1, names.length)) }, statWorker))

  let removed = 0
  let freedBytes = 0
  const kept: typeof entries = []
  let totalBytes = 0

  for (const e of entries) {
    if (maxAgeMs > 0 && nowMs - e.mtimeMs > maxAgeMs) {
      try {
        await unlink(e.path)
        removed++
        freedBytes += e.size
        continue
      } catch {}
    }
    kept.push(e)
    totalBytes += e.size
  }

  if (maxBytes > 0 && totalBytes > maxBytes) {
    kept.sort((a, b) => a.mtimeMs - b.mtimeMs)
    const targetBytes = Math.floor(maxBytes * 0.85)
    for (const e of kept) {
      if (totalBytes <= targetBytes) break
      try {
        await unlink(e.path)
        removed++
        freedBytes += e.size
        totalBytes -= e.size
      } catch {}
    }
  }

  return { removed, freedBytes, remainingBytes: totalBytes }
}
