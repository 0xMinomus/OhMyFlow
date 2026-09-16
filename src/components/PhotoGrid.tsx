import { useEffect, useMemo, useState } from 'react'
import { useStore, appStore } from '@/store/useAppStore'
import type { PhotoItem } from '@/types'
import { LazyThumb } from './LazyThumb'
import { MoveModal } from './MoveModal'
import { Lightbox } from './Lightbox'
import { Fieldset } from './Fieldset'

const PAGE_SIZE = 60

// Dimensi dibaca dari thumbnail yang SUDAH didecode browser (tanpa IPC/scan baru).
const dimsCache = new Map<string, string>()
function useImageDims(item: PhotoItem): string {
  const key = item.previewPath || item.filePath
  const [dims, setDims] = useState<string>(() => dimsCache.get(key) ?? '')
  useEffect(() => {
    if (dimsCache.has(key)) { setDims(dimsCache.get(key)!); return }
    let dead = false
    const src = item.thumbUrl ?? undefined
    if (!src) return
    const img = new Image()
    img.onload = () => {
      const v = `${img.naturalWidth} × ${img.naturalHeight}`
      dimsCache.set(key, v)
      if (!dead) setDims(v)
      img.src = ''
    }
    img.src = src
    return () => { dead = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return dims
}

function VerdictBadge({ cat }: { cat: string }) {
  const label = cat==='picks' ? 'PICKS' : cat==='maybe' ? 'MAYBE' : 'REJECTS'
  const tone = cat==='picks'
    ? 'bg-emerald-400 text-black'
    : cat==='maybe'
      ? 'bg-amber-300 text-black'
      : 'bg-red-400 text-black'
  return <span className={`rounded-sm px-1.5 py-px text-[10px] font-bold tracking-wide ${tone}`}>{label}</span>
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir==='left' ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

function PhotoCard({ p, lang, index, onOpen }: { p: PhotoItem; lang: 'id' | 'en'; index: number; onOpen: () => void }) {
  const t = (id: string, en: string) => (lang==='id' ? id : en)
  const reasons = (lang==='id' ? p.reasons : p.reasonsEn) ?? []
  const lowConf = (p.confidence ?? 1) < 0.45
  const bits = [
    ...(lowConf ? [t('Perlu cek manual', 'Needs manual check')] : []),
    ...reasons,
  ].slice(0, 3)
  const dims = useImageDims(p)
  const num = String(index + 1).padStart(3, '0')

  return (
    <div className="group rounded-sm overflow-hidden bg-flow-800 border border-flow-700 hover:border-zinc-500 transition flex flex-col">
      <div className="flex items-center gap-1.5 px-2 h-8 border-b border-flow-700 shrink-0">
        <span className="font-mono text-[10px] tabular-nums text-zinc-500">{num}</span>
        <VerdictBadge cat={p.category || 'maybe'} />
        <span className="ml-auto rounded-sm border border-white/10 bg-black/60 px-1.5 py-px font-mono text-[10px] tabular-nums text-zinc-300">{p.score ?? 0}</span>
      </div>
      <div className="aspect-[16/8.5] bg-flow-900 relative overflow-hidden">
        <div
          onClick={onOpen}
          onKeyDown={(e)=> { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
          tabIndex={0}
          role="button"
          aria-label={(lang === 'id' ? 'Perbesar ' : 'Enlarge ') + p.fileName}
          className="absolute inset-0 cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70 focus-visible:outline-offset-[-2px]"
        >
          <LazyThumb item={p} className="w-full h-full object-cover" />
        </div>
        {(p.isPaired || (p.isRaw && !p.thumbUrl && !p.dataUrl)) && (
          <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-black/70 px-1.5 py-px text-[9px] font-bold text-zinc-300 border border-white/10 pointer-events-none">
            {p.isPaired ? 'RAW+JPG' : 'RAW'}
          </span>
        )}
        <div className="absolute bottom-1.5 left-1.5 right-1.5 hidden gap-1 group-hover:flex group-focus-within:flex">
          <button disabled={p.category==='picks'} onClick={(e)=>{ e.stopPropagation(); appStore.updatePhotoCategory(p.id,'picks') }} className="flex-1 rounded-sm bg-emerald-400 py-1 font-mono text-[10px] font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">Picks</button>
          <button disabled={p.category==='maybe'} onClick={(e)=>{ e.stopPropagation(); appStore.updatePhotoCategory(p.id,'maybe') }} className="flex-1 rounded-sm bg-amber-300 py-1 font-mono text-[10px] font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">Maybe</button>
          <button disabled={p.category==='rejects'} onClick={(e)=>{ e.stopPropagation(); appStore.updatePhotoCategory(p.id,'rejects') }} className="flex-1 rounded-sm bg-red-400 py-1 font-mono text-[10px] font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">Reject</button>
        </div>
      </div>
      <div className="px-2 py-1.5 flex flex-col">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 truncate font-mono text-[11px] text-zinc-200" title={p.fileName}>{p.fileName}</div>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">{dims || '—'}</span>
          <button
            onClick={()=> window.ohmyflow.showInFolder(p.filePath)}
            aria-label={t('Tampilkan di folder', 'Show in folder')}
            title={t('Tampilkan di folder', 'Show in folder')}
            className="shrink-0 text-zinc-600 opacity-0 transition hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
          >
            <ExternalIcon />
          </button>
        </div>
        <div className="truncate font-mono text-[10px] text-zinc-500" title={bits.join(' · ')}>
          {bits.length > 0 ? (
            <>
              {lowConf && <span className="font-bold text-amber-300">{bits[0]}</span>}
              {lowConf && bits.length > 1 && <span> · </span>}
              {(lowConf ? bits.slice(1) : bits).join(' · ')}
            </>
          ) : <span className="text-zinc-600">-</span>}
        </div>
      </div>
    </div>
  )
}

export function PhotoGrid() {
  const photos = useStore(s=>s.photos)
  const cat = useStore(s=>s.selectedCategory)
  const lang = useStore(s=>s.language)
  const stats = useStore(s=>s.stats)
  const [page, setPage] = useState(0)
  const [moveOpen, setMoveOpen] = useState(false)
  const [lightIds, setLightIds] = useState<string[] | null>(null)
  const [lightId, setLightId] = useState<string | null>(null)
  const t = (id: string, en: string) => (lang==='id' ? id : en)

  const filtered = useMemo(
    () => cat==='all' ? photos : photos.filter(p=>p.category===cat),
    [photos, cat]
  )
  const counts = useMemo(() => ({
    all: photos.length,
    picks: photos.filter(p=>p.category==='picks').length,
    maybe: photos.filter(p=>p.category==='maybe').length,
    rejects: photos.filter(p=>p.category==='rejects').length,
  }), [photos])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  useEffect(() => { setPage(0) }, [cat])

  if (photos.length===0) return null
  if (!stats) return null

  const tabTone = (c: 'all' | 'picks' | 'maybe' | 'rejects', active: boolean) => {
    if (!active) return 'text-zinc-500 border-flow-600 hover:text-white hover:border-zinc-500'
    if (c === 'picks') return 'text-emerald-300 border-emerald-500'
    if (c === 'maybe') return 'text-amber-300 border-amber-500'
    if (c === 'rejects') return 'text-red-300 border-red-500'
    return 'text-white border-white'
  }

  return (
    <>
      <Fieldset num="03" title={t('Hasil', 'Results')}>
        <div className="flex items-center justify-between gap-2 flex-wrap px-3 min-h-[54px] py-2">
          <div className="flex items-center gap-1.5 flex-wrap" role="tablist">
            {(['all','picks','maybe','rejects'] as const).map(c=>{
              const active = cat===c
              const label = c==='all' ? t('Semua', 'All') : c==='picks' ? 'Picks' : c==='maybe' ? 'Maybe' : 'Rejects'
              return (
                <button
                  key={c}
                  role="tab"
                  aria-selected={active}
                  onClick={()=>appStore.setCategory(c)}
                  className={`rounded-sm border px-2.5 py-1.5 font-mono text-[11px] font-bold transition ${tabTone(c, active)}`}
                >
                  [ {label} <span className="tabular-nums">{counts[c]}</span> ]
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={()=> setMoveOpen(true)}
              className="rounded-sm border border-flow-500 px-3.5 py-1.5 font-mono text-[11px] font-bold text-zinc-200 transition hover:border-zinc-400 hover:text-white"
            >
              {t('[ Pindah File ]', '[ Move Files ]')}
            </button>
            <ExportButton lang={lang} />
          </div>
        </div>
        <div className="border-t border-flow-700" />
        <div className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-[60vh] overflow-auto pr-0.5">
            {pageItems.map((p, i)=> (
              <PhotoCard
                key={p.id}
                p={p}
                lang={lang}
                index={safePage * PAGE_SIZE + i}
                onOpen={()=> { setLightIds(filtered.map(x=>x.id)); setLightId(p.id) }}
              />
            ))}
          </div>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 px-3 pb-3">
            <button
              disabled={safePage===0}
              onClick={()=>setPage(safePage-1)}
              aria-label={t('Halaman sebelumnya', 'Previous page')}
              className="rounded-sm border border-flow-600 p-1.5 text-zinc-300 transition hover:border-zinc-400 disabled:opacity-40"
            >
              <Chevron dir="left" />
            </button>
            <span className="font-mono text-[11px] tabular-nums text-zinc-500">{safePage+1} / {totalPages}</span>
            <button
              disabled={safePage>=totalPages-1}
              onClick={()=>setPage(safePage+1)}
              aria-label={t('Halaman berikutnya', 'Next page')}
              className="rounded-sm border border-flow-600 p-1.5 text-zinc-300 transition hover:border-zinc-400 disabled:opacity-40"
            >
              <Chevron dir="right" />
            </button>
          </div>
        )}
      </Fieldset>
      <MoveModal open={moveOpen} onClose={()=> setMoveOpen(false)} />
      {lightIds && lightId && (
        <Lightbox
          ids={lightIds}
          initialId={lightId}
          lang={lang}
          onClose={()=> { setLightIds(null); setLightId(null) }}
        />
      )}
    </>
  )
}

function ExportButton({ lang }: { lang: 'id' | 'en' }) {
  const photos = useStore(s=>s.photos)
  const handle = async () => {
    const items = photos.map(p=>{
      const rating = p.category==='picks' ? 5 : p.category==='maybe' ? 3 : 1
      const label = p.category==='picks' ? 'Green' : p.category==='maybe' ? 'Yellow' : 'Red'
      return { filePath: p.filePath, pairedPath: p.pairedPath, rating, label }
    })
    const res = await window.ohmyflow.writeXmpsBulk(items)
    alert(lang==='id'
      ? `Berhasil! ${res.ok}/${res.total} file XMP ditulis. Buka folder di Lightroom, rating langsung terbaca.`
      : `Done! ${res.ok}/${res.total} XMP files written. Open the folder in Lightroom to see ratings.`)
  }
  return (
    <button onClick={handle} className="rounded-sm border border-zinc-400 px-3.5 py-1.5 font-mono text-[11px] font-bold text-white transition hover:bg-white hover:text-black">
      {lang==='id' ? '[ Ekspor XMP ]' : '[ Export XMP ]'}
    </button>
  )
}
