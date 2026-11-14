import { access, copyFile, mkdir, rename, unlink } from 'fs/promises'
import { basename, dirname, extname, join, resolve } from 'path'

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

// resolve() dulu; Windows case-insensitive
export function sameDir(a: string, b: string): boolean {
  const ra = resolve(a)
  const rb = resolve(b)
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb
}

export interface MovePhotoItem {
  filePath: string
  pairedPath?: string
  sub?: string
}

export async function movePhotos(payload: { items: MovePhotoItem[]; destDir: string }) {
  const items = payload?.items ?? []
  const destDir = payload?.destDir
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
  if (!destDir) return { ok: false, moved: 0, skipped: 0, movedPaths: [] as string[], failed: [] as { file: string; error: string }[], total: items.length, error: 'no-dest' }
  try { await mkdir(destDir, { recursive: true }) } catch (e) {
    return { ok: false, moved: 0, skipped: 0, movedPaths: [] as string[], failed: [] as { file: string; error: string }[], total: items.length, error: errMsg(e) }
  }

  // reserve nama tujuan agar dua job tidak mendapat path yang sama
  const reserved = new Set<string>()
  async function uniqueDest(dir: string, name: string): Promise<string> {
    const ext = extname(name)
    const base = basename(name, ext)
    let candidate = join(dir, name)
    let n = 1
    while (reserved.has(candidate) || await exists(candidate)) {
      candidate = join(dir, `${base} (${n})${ext}`)
      n++
    }
    reserved.add(candidate)
    return candidate
  }

  async function moveOne(src: string, dest: string) {
    try {
      await rename(src, dest)
    } catch (e) {
      // EXDEV = beda drive/partisi → salin async lalu hapus
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        await copyFile(src, dest)
        await unlink(src)
      } else throw e
    }
  }

  const movedPaths: string[] = []
  const failed: { file: string; error: string }[] = []
  let skipped = 0

  for (const it of items) {
    const pairFiles = [it.filePath, it.pairedPath].filter((p): p is string => !!p)
    try {
      if (!(await exists(it.filePath))) throw new Error('file-tidak-ditemukan')
      // Subfolder per kategori ("Buat Folder Terpisah"): Picks/Maybe/Rejects.
      // basename() = anti traversal, mkdir rekursif.
      const dir = it.sub ? join(destDir, basename(it.sub)) : destDir
      try { await mkdir(dir, { recursive: true }) } catch {}
      // sudah di folder tujuan → skip, jangan hitung moved
      if (pairFiles.every((f) => sameDir(dirname(f), dir))) {
        skipped++
        continue
      }
      // hitung semua destinasi dulu (reservasi), baru pindahkan
      const jobs: [string, string][] = []
      const destMain = await uniqueDest(dir, basename(it.filePath))
      jobs.push([it.filePath, destMain])
      if (it.pairedPath && (await exists(it.pairedPath)) && !sameDir(dirname(it.pairedPath), dir)) {
        jobs.push([it.pairedPath, await uniqueDest(dir, basename(it.pairedPath))])
      }
      // .xmp pendamping ikut pindah, mengikuti nama file tujuannya.
      // RAW+JPG berbagi basename → xmp yang sama; dedupe agar tidak dipindah dua kali.
      const seenXmp = new Set<string>()
      for (const src of pairFiles) {
        if (sameDir(dirname(src), dir)) continue
        const xmpSrc = join(dirname(src), basename(src, extname(src)) + '.xmp')
        const xmpKey = xmpSrc.toLowerCase()
        if (!(await exists(xmpSrc)) || seenXmp.has(xmpKey)) continue
        seenXmp.add(xmpKey)
        const pairedJob = jobs.find(([s]) => s === src)
        const destBase = pairedJob ? basename(pairedJob[1], extname(pairedJob[1])) : basename(src, extname(src))
        jobs.push([xmpSrc, await uniqueDest(dir, destBase + '.xmp')])
      }
      // satu item = beberapa job; gagal satu job → catat nama yang gagal, jangan rollback
      let itemFailed = false
      for (const [s, d] of jobs) {
        try { await moveOne(s, d) } catch (e) {
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
}
