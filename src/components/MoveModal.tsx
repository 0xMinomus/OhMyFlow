import { useEffect, useState } from 'react'
import { useStore, appStore } from '@/store/useAppStore'
import { dropMemThumbs } from '@/lib/thumbCache'

interface MoveResult {
  moved: number
  total: number
  dest: string
  failed: { file: string, error: string }[]
}

export function MoveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const photos = useStore(s=>s.photos)
  const lang = useStore(s=>s.language)
  const t = (id: string, en: string) => (lang==='id' ? id : en)

  const [destDir, setDestDir] = useState<string | null>(null)
  const [withPicks, setWithPicks] = useState(true)
  const [withMaybe, setWithMaybe] = useState(false)
  const [moving, setMoving] = useState(false)
  const [result, setResult] = useState<MoveResult | null>(null)

  useEffect(() => {
    if (open) {
      setDestDir(null)
      setWithPicks(true)
      setWithMaybe(false)
      setMoving(false)
      setResult(null)
    }
  }, [open ])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !moving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, moving, onClose])

  if (!open) return null

  const picks = photos.filter(p=>p.category==='picks')
  const maybe = photos.filter(p=>p.category==='maybe')
  const selected = [...(withPicks ? picks : []), ...(withMaybe ? maybe : [])]
  const canMove = !!destDir && selected.length > 0 && !moving

  const pickDest = async () => {
    const d = await window.ohmyflow.openFolder()
    if (d) setDestDir(d)
  }

  const doMove = async () => {
    if (!canMove || !destDir) return
    setMoving(true)
    try {
      const res = await window.ohmyflow.movePhotos(
        selected.map(p=>({ filePath: p.filePath, pairedPath: p.pairedPath })),
        destDir
      )
      const movedSet = new Set(res.movedPaths ?? [])
      const movedPhotos = photos.filter(p=> movedSet.has(p.filePath))
      dropMemThumbs(movedPhotos.flatMap(p=> [p.filePath, ...(p.pairedPath ? [p.pairedPath] : [])]))
      appStore.removePhotos(movedPhotos.map(p=> p.id))
      setResult({ moved: res.moved ?? 0, total: res.total ?? selected.length, dest: destDir, failed: res.failed ?? [] })
    } catch (e: any) {
      setResult({ moved: 0, total: selected.length, dest: destDir, failed: [{ file: '', error: String(e?.message || e) }] })
    } finally {
      setMoving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={()=> { if (!moving) onClose() }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Pindah file hasil pilahan', 'Move culled files')}
        className="w-full max-w-sm rounded-md border border-flow-500 bg-flow-800 p-5"
        onClick={(e)=> e.stopPropagation()}
      >
        {result ? (
          <div className="flex flex-col gap-3">
            <div className="font-mono text-[13px] font-bold text-white">
              {result.failed.length === 0
                ? t(`Berhasil memindahkan ${result.moved} foto.`, `Moved ${result.moved} photos.`)
                : t(`Terpindah ${result.moved}/${result.total} foto.`, `Moved ${result.moved}/${result.total} photos.`)}
            </div>
            <div className="truncate font-mono text-[11px] text-zinc-500">{result.dest}</div>
            {result.failed.length > 0 && (
              <div className="max-h-28 overflow-auto rounded border border-red-500/40 bg-red-500/10 p-3 font-mono text-[11px] text-red-300">
                {result.failed.map((f, i)=> <div key={i} className="truncate">{f.file ? `${f.file} — ` : ''}{f.error}</div>)}
              </div>
            )}
            <button onClick={onClose} autoFocus className="mt-1 rounded border border-white bg-white px-5 py-2 font-mono text-[11px] font-bold text-black transition hover:bg-zinc-200">
              {t('[ Tutup ]', '[ Close ]')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="font-mono text-[13px] font-bold text-white">{t('Pindah file hasil pilahan', 'Move culled files')}</div>

            <button
              onClick={pickDest}
              className="w-full truncate rounded border border-dashed border-flow-500 px-4 py-3 font-mono text-[11px] text-zinc-200 transition hover:border-zinc-400 hover:text-white"
            >
              {destDir ?? t('Pilih folder tujuan…', 'Choose destination folder…')}
            </button>

            <div className="flex flex-col gap-2">
              <label className={`flex cursor-pointer items-center gap-2.5 font-mono text-[12px] ${picks.length === 0 ? 'opacity-40' : 'text-zinc-200'}`}>
                <input type="checkbox" checked={withPicks} disabled={picks.length === 0} onChange={(e)=> setWithPicks(e.target.checked)} className="h-3.5 w-3.5 shrink-0 accent-white" />
                <span>[{withPicks ? 'x' : ' '}] Picks <span className="tabular-nums text-zinc-500">({picks.length})</span></span>
              </label>
              <label className={`flex cursor-pointer items-center gap-2.5 font-mono text-[12px] ${maybe.length === 0 ? 'opacity-40' : 'text-zinc-200'}`}>
                <input type="checkbox" checked={withMaybe} disabled={maybe.length === 0} onChange={(e)=> setWithMaybe(e.target.checked)} className="h-3.5 w-3.5 shrink-0 accent-white" />
                <span>[{withMaybe ? 'x' : ' '}] Maybe <span className="tabular-nums text-zinc-500">({maybe.length})</span> <span className="text-[10px] text-zinc-500">· {t('opsional', 'optional')}</span></span>
              </label>
            </div>

            <div className="font-mono text-[10px] leading-snug text-zinc-500">
              {t('RAW+JPG dan .xmp ikut dipindah · Nama kembar diberi nomor · Rejects tidak ikut.',
                 'RAW+JPG pairs and .xmp files move along · Duplicate names get numbered · Rejects stay.')}
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={onClose} disabled={moving} className="rounded px-4 py-2 font-mono text-[11px] font-bold text-zinc-500 transition hover:text-white disabled:opacity-50">
                {t('[ Batal ]', '[ Cancel ]')}
              </button>
              <button
                onClick={doMove}
                disabled={!canMove}
                className="rounded border border-white bg-white px-5 py-2 font-mono text-[11px] font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:border-flow-600 disabled:bg-transparent disabled:text-zinc-500"
              >
                {moving ? t('Memindahkan…', 'Moving…') : t(`[ Pindah ${selected.length} ]`, `[ Move ${selected.length} ]`)}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
