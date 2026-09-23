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
    { id: 'picks' as const, list: picks, on: withPicks, set: setWithPicks, dot: 'bg-[#2f7a3d]', name: 'Picks', desc: t('Terbaik, layak edit', 'Best shots, worth editing') },
    { id: 'maybe' as const, list: maybe, on: withMaybe, set: setWithMaybe, dot: 'bg-[#8a6d00]', name: 'Maybe', desc: t('Meragukan, lirik sekilas', 'Uncertain, quick glance') },
    { id: 'rejects' as const, list: rejects, on: withRejects, set: setWithRejects, dot: 'bg-[#a93226]', name: 'Rejects', desc: t('Gagal, buang dari katalog', 'Failed, drop from catalog') },
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
      className="w7-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={()=> { if (!moving) onClose() }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Pindah file hasil pilahan', 'Move culled files')}
        className="w7-dialog w-full max-w-sm overflow-hidden"
        onClick={(e)=> e.stopPropagation()}
      >
        <div className="w7-dialog-title px-4 py-2 font-sans text-[13px] font-bold">
          {t('Pindah file hasil pilahan', 'Move culled files')}
        </div>
        <div className="p-4">
        {result ? (
          <div className="flex flex-col items-center gap-3 py-2" role="status">
            <span className={`flex h-12 w-12 items-center justify-center rounded-full border-2 font-sans text-xl font-bold ${result.failed.length === 0 ? 'border-[#2f7a3d] bg-[#e7f3ea] text-[#0f3d1a]' : 'border-[#8a6d00] bg-[#faf3d7] text-[#4d3d00]'}`} aria-hidden="true">
              {result.failed.length === 0 ? '✓' : '!'}
            </span>
            <div className="text-center font-sans text-[13px] font-bold">
              {result.failed.length === 0
                ? t(`Berhasil! ${result.moved} foto dipindah.`, `Success! Moved ${result.moved} photos.`)
                : t(`Terpindah ${result.moved}/${result.total} foto.`, `Moved ${result.moved}/${result.total} photos.`)}
            </div>
            {result.breakdown && (
              <div className="w7-muted w7-num font-sans text-[11px]">{result.breakdown}</div>
            )}
            <div className="w7-field w-full truncate px-3 py-2 text-center font-sans text-[11px] text-[#5b6b7a]">{result.dest}</div>
            {result.failed.length > 0 && (
              <div className="w7-field max-h-28 w-full overflow-auto p-3 font-sans text-[11px] text-[#5e1a12]">
                {result.failed.map((f, i)=> <div key={i} className="truncate">{f.file ? `${f.file} — ` : ''}{f.error}</div>)}
              </div>
            )}
            <div className="mt-1 flex w-full gap-2">
              <button onClick={()=> window.ohmyflow.showInFolder(result.dest)} className="w7-btn flex-1 px-4 py-2 font-sans text-[11px] font-bold">
                {t('Lihat Folder', 'Open Folder')}
              </button>
              <button onClick={()=> { appStore.resetSession(); onClose() }} autoFocus className="w7-btn w7-btn-green flex-1 px-4 py-2 font-sans text-[11px] font-bold">
                {t('Lanjut →', 'Continue →')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <button
              onClick={pickDest}
              className="w7-drop w-full truncate px-4 py-3 font-sans text-[11px]"
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
                    className={`w7-btn items-center gap-3 p-3 text-left ${active ? 'w7-btn-primary' : ''} ${empty ? 'opacity-40' : ''}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center border border-[#5f7a93] bg-white text-[10px] font-bold ${active ? 'text-[#12324f]' : 'text-transparent'}`} aria-hidden="true">✓</span>
                    <span className={`h-2.5 w-2.5 shrink-0 ${c.dot}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-sans text-[12px] font-bold">
                        {c.name} <span className="w7-num font-normal text-[#5b6b7a]">({c.list.length})</span>
                      </span>
                      <span className="block truncate font-sans text-[10px] text-[#5b6b7a]">{c.desc}</span>
                    </span>
                  </button>
                )
              })}
              <button
                type="button"
                onClick={()=> setSplitFolders(!splitFolders)}
                aria-pressed={splitFolders}
                className={`w7-btn items-center gap-3 p-3 text-left ${splitFolders ? 'w7-btn-primary' : ''}`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center border border-[#5f7a93] bg-white text-[10px] font-bold ${splitFolders ? 'text-[#12324f]' : 'text-transparent'}`} aria-hidden="true">✓</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-sans text-[12px] font-bold">{t('Buat Folder Terpisah', 'Separate Folders')}</span>
                  <span className="block truncate font-sans text-[10px] text-[#5b6b7a]">Picks / Maybe / Rejects</span>
                </span>
              </button>
            </div>

            <div className="w7-field w7-num px-3 py-2 font-sans text-[11px]">
              {selected.length === 0
                ? t('Pilih minimal satu kategori.', 'Select at least one category.')
                : perSub
                  ? t(`${selected.length} foto → ${perSub}`, `${selected.length} photos → ${perSub}`)
                  : t(`${selected.length} foto → satu folder`, `${selected.length} photos → one folder`)}
              <div className="mt-0.5 text-[10px] text-[#5b6b7a]">
                {t('RAW+JPG dan .xmp ikut · Nama kembar diberi nomor.', 'RAW+JPG pairs and .xmp follow · Duplicate names get numbered.')}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={onClose} disabled={moving} className="w7-btn px-4 py-2 font-sans text-[11px] font-bold disabled:opacity-50">
                {t('Batal', 'Cancel')}
              </button>
              <button
                onClick={doMove}
                disabled={!canMove}
                className="w7-btn w7-btn-primary px-5 py-2 font-sans text-[11px] font-bold disabled:opacity-40"
              >
                {moving ? t('Memindahkan…', 'Moving…') : t(`Pindah ${selected.length}`, `Move ${selected.length}`)}
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
