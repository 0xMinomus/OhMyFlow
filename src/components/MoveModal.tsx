import { useEffect, useState } from 'react'
import { useStore, appStore } from '@/store/useAppStore'
import { dropMemThumbs } from '@/lib/thumbCache'

interface MoveResult {
  moved: number
  total: number
  dest: string
  breakdown: string | null
  failed: { file: string, error: string }[]
}

export function MoveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const photos = useStore(s=>s.photos)
  const lang = useStore(s=>s.language)
  const t = (id: string, en: string) => (lang==='id' ? id : en)

  const [destDir, setDestDir] = useState<string | null>(null)
  const [withPicks, setWithPicks] = useState(true)
  const [withMaybe, setWithMaybe] = useState(false)
  const [withRejects, setWithRejects] = useState(false)
  const [splitFolders, setSplitFolders] = useState(false)
  const [moving, setMoving] = useState(false)
  const [result, setResult] = useState<MoveResult | null>(null)

  useEffect(() => {
    if (open) {
      setDestDir(null)
      setWithPicks(true)
      setWithMaybe(false)
      setWithRejects(false)
      setSplitFolders(false)
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
  const rejects = photos.filter(p=>p.category==='rejects')
  const cats = [
    { id: 'picks' as const, list: picks, on: withPicks, set: setWithPicks, dot: 'bg-emerald-400', name: 'Picks', desc: t('Terbaik, layak edit', 'Best shots, worth editing') },
    { id: 'maybe' as const, list: maybe, on: withMaybe, set: setWithMaybe, dot: 'bg-amber-300', name: 'Maybe', desc: t('Meragukan, lirik sekilas', 'Uncertain, quick glance') },
    { id: 'rejects' as const, list: rejects, on: withRejects, set: setWithRejects, dot: 'bg-red-400', name: 'Rejects', desc: t('Gagal, buang dari katalog', 'Failed, drop from catalog') },
  ]
  const selected = [
    ...(withPicks ? picks.map(p=>({ filePath: p.filePath, pairedPath: p.pairedPath, sub: splitFolders ? 'Picks' : undefined })) : []),
    ...(withMaybe ? maybe.map(p=>({ filePath: p.filePath, pairedPath: p.pairedPath, sub: splitFolders ? 'Maybe' : undefined })) : []),
    ...(withRejects ? rejects.map(p=>({ filePath: p.filePath, pairedPath: p.pairedPath, sub: splitFolders ? 'Rejects' : undefined })) : []),
  ]
  const canMove = !!destDir && selected.length > 0 && !moving
  const perSub = splitFolders
    ? cats.filter(c=> (c.id === 'picks' && withPicks) || (c.id === 'maybe' && withMaybe) || (c.id === 'rejects' && withRejects)).map(c=> `${c.name} (${c.list.length})`).join(' · ')
    : null

  const pickDest = async () => {
    const d = await window.ohmyflow.openFolder()
    if (d) setDestDir(d)
  }

  const doMove = async () => {
    if (!canMove || !destDir) return
    setMoving(true)
    try {
      const res = await window.ohmyflow.movePhotos(selected, destDir)
      const movedSet = new Set(res.movedPaths ?? [])
      const movedPhotos = photos.filter(p=> movedSet.has(p.filePath))
      dropMemThumbs(movedPhotos.flatMap(p=> [p.filePath, ...(p.pairedPath ? [p.pairedPath] : [])]))
      appStore.removePhotos(movedPhotos.map(p=> p.id))
      setResult({ moved: res.moved ?? 0, total: res.total ?? selected.length, dest: destDir, breakdown: perSub, failed: res.failed ?? [] })
    } catch (e: any) {
      setResult({ moved: 0, total: selected.length, dest: destDir, breakdown: perSub, failed: [{ file: '', error: String(e?.message || e) }] })
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
          <div className="flex flex-col items-center gap-3 py-2" role="status">
            <span className={`flex h-12 w-12 items-center justify-center rounded-full border-2 font-mono text-xl font-bold ${result.failed.length === 0 ? 'border-emerald-400 bg-emerald-400/10 text-emerald-300' : 'border-amber-300 bg-amber-300/10 text-amber-200'}`} aria-hidden="true">
              {result.failed.length === 0 ? '✓' : '!'}
            </span>
            <div className="text-center font-mono text-[13px] font-bold text-white">
              {result.failed.length === 0
                ? t(`Berhasil! ${result.moved} foto dipindah.`, `Success! Moved ${result.moved} photos.`)
                : t(`Terpindah ${result.moved}/${result.total} foto.`, `Moved ${result.moved}/${result.total} photos.`)}
            </div>
            {result.breakdown && (
              <div className="font-mono text-[11px] tabular-nums text-zinc-400">{result.breakdown}</div>
            )}
            <div className="w-full truncate rounded border border-flow-700 bg-black/30 px-3 py-2 text-center font-mono text-[11px] text-zinc-500">{result.dest}</div>
            {result.failed.length > 0 && (
              <div className="max-h-28 w-full overflow-auto rounded border border-red-500/40 bg-red-500/10 p-3 font-mono text-[11px] text-red-300">
                {result.failed.map((f, i)=> <div key={i} className="truncate">{f.file ? `${f.file} — ` : ''}{f.error}</div>)}
              </div>
            )}
            <div className="mt-1 flex w-full gap-2">
              <button onClick={()=> window.ohmyflow.showInFolder(result.dest)} className="flex-1 rounded border border-flow-500 px-4 py-2 font-mono text-[11px] font-bold text-zinc-200 transition hover:border-zinc-400 hover:text-white">
                {t('[ Lihat Folder ]', '[ Open Folder ]')}
              </button>
              <button onClick={()=> { appStore.resetSession(); onClose() }} autoFocus className="flex-1 rounded border border-emerald-400 bg-emerald-400 px-4 py-2 font-mono text-[11px] font-bold text-black transition hover:bg-emerald-300">
                {t('[ Lanjut → ]', '[ Continue → ]')}
              </button>
            </div>
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

            <div className="flex flex-col gap-2" role="group" aria-label={t('Pilih kategori', 'Choose categories')}>
              {cats.map(c => {
                const empty = c.list.length === 0
                const active = c.on && !empty
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={empty}
                    onClick={()=> c.set(!c.on)}
                    aria-pressed={c.on}
                    className={`flex items-center gap-3 rounded border p-3 text-left transition ${empty ? 'cursor-not-allowed border-flow-700 opacity-40' : active ? 'border-white bg-flow-700' : 'border-flow-600 hover:border-zinc-400'}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[10px] font-bold ${active ? 'border-white bg-white text-black' : 'border-zinc-500 text-transparent'}`} aria-hidden="true">✓</span>
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.dot}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[12px] font-bold text-white">
                        {c.name} <span className="tabular-nums font-normal text-zinc-400">({c.list.length})</span>
                      </span>
                      <span className="block truncate font-mono text-[10px] text-zinc-500">{c.desc}</span>
                    </span>
                  </button>
                )
              })}
              <button
                type="button"
                onClick={()=> setSplitFolders(!splitFolders)}
                aria-pressed={splitFolders}
                className={`flex items-center gap-3 rounded border border-dashed p-3 text-left transition ${splitFolders ? 'border-white bg-flow-700' : 'border-flow-600 hover:border-zinc-400'}`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[10px] font-bold ${splitFolders ? 'border-white bg-white text-black' : 'border-zinc-500 text-transparent'}`} aria-hidden="true">✓</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[12px] font-bold text-white">{t('Buat Folder Terpisah', 'Separate Folders')}</span>
                  <span className="block truncate font-mono text-[10px] text-zinc-500">Picks / Maybe / Rejects</span>
                </span>
              </button>
            </div>

            <div className="rounded border border-flow-700 bg-black/30 px-3 py-2 font-mono text-[11px] tabular-nums text-zinc-300">
              {selected.length === 0
                ? t('Pilih minimal satu kategori.', 'Select at least one category.')
                : perSub
                  ? t(`${selected.length} foto → ${perSub}`, `${selected.length} photos → ${perSub}`)
                  : t(`${selected.length} foto → satu folder`, `${selected.length} photos → one folder`)}
              <div className="mt-0.5 text-[10px] text-zinc-500">
                {t('RAW+JPG dan .xmp ikut · Nama kembar diberi nomor.', 'RAW+JPG pairs and .xmp follow · Duplicate names get numbered.')}
              </div>
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
