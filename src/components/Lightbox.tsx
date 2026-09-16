import { useEffect, useState } from 'react'
import { useStore, appStore } from '@/store/useAppStore'
import { getMemThumb } from '@/lib/thumbCache'

function XIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === 'left' ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
    </svg>
  )
}

export function Lightbox({ ids, initialId, lang, onClose }: {
  ids: string[]
  initialId: string
  lang: 'id' | 'en'
  onClose: () => void
}) {
  const photos = useStore(s=>s.photos)
  const [curId, setCurId] = useState(initialId)
  const [full, setFull] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const t = (id: string, en: string) => (lang==='id' ? id : en)

  const p = photos.find(x=>x.id === curId)
  const navIds = ids.filter(id=> photos.some(x=>x.id === id))
  const idx = navIds.indexOf(curId)
  const hasPrev = idx > 0
  const hasNext = idx >= 0 && idx < navIds.length - 1

  useEffect(() => { setCurId(initialId) }, [initialId])
  useEffect(() => { if (!p) onClose() }, [p, onClose])
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  useEffect(() => {
    let dead = false
    setFull(null)
    if (!p) return
    if (p.isRaw && !p.previewPath) return
    setLoading(true)
    window.ohmyflow.readImageAsDataUrl(p.previewPath || p.filePath).then(r => {
      if (!dead) { setFull(r?.dataUrl ?? null); setLoading(false) }
    }).catch(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [p?.filePath, p?.previewPath, p?.isRaw]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && hasPrev) setCurId(navIds[idx - 1])
      else if (e.key === 'ArrowRight' && hasNext) setCurId(navIds[idx + 1])
      else if (e.key === '1' && p) appStore.updatePhotoCategory(p.id, 'picks')
      else if (e.key === '2' && p) appStore.updatePhotoCategory(p.id, 'maybe')
      else if (e.key === '3' && p) appStore.updatePhotoCategory(p.id, 'rejects')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!p) return null
  const reasons = (lang==='id' ? p.reasons : p.reasonsEn) ?? []
  const thumb = p.thumbUrl ?? getMemThumb(p.filePath) ?? undefined
  const verdict = p.category === 'picks' ? 'PICKS' : p.category === 'maybe' ? 'MAYBE' : 'REJECTS'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label={p.fileName}>
      <div className="flex items-center gap-3 border-b border-flow-700 px-4 py-2.5" onClick={(e)=> e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px] font-bold text-white">{p.fileName}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
            {verdict} · <span className="tabular-nums">{p.score ?? 0}</span>
            {reasons.length > 0 && ' · ' + reasons.slice(0, 2).join(' · ')}
          </div>
        </div>
        <button
          onClick={onClose}
          autoFocus
          aria-label={t('Tutup', 'Close')}
          className="rounded border border-flow-600 p-1.5 text-zinc-300 transition hover:border-zinc-400 hover:text-white"
        >
          <XIcon />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-12 pb-2 pt-2"
        onClick={onClose}
      >
        {hasPrev && (
          <button
            onClick={(e)=> { e.stopPropagation(); setCurId(navIds[idx - 1]) }}
            aria-label={t('Foto sebelumnya', 'Previous photo')}
            className="absolute left-3 rounded border border-flow-600 bg-black/60 p-2 text-zinc-300 transition hover:border-zinc-400 hover:text-white"
          >
            <Chevron dir="left" />
          </button>
        )}
        {full ? (
          <img
            src={full}
            alt={p.fileName}
            draggable={false}
            onClick={(e)=> e.stopPropagation()}
            className="max-h-full max-w-full rounded-sm border border-flow-700 object-contain"
          />
        ) : thumb ? (
          <img
            src={thumb}
            alt={p.fileName}
            draggable={false}
            onClick={(e)=> e.stopPropagation()}
            className={`max-h-full max-w-full rounded-sm border border-flow-700 object-contain ${loading ? 'opacity-60' : ''}`}
          />
        ) : (
          <div
            onClick={(e)=> e.stopPropagation()}
            className="flex flex-col items-center gap-1 rounded border border-flow-600 bg-flow-800 px-8 py-10"
          >
            <span className="font-mono text-[11px] font-bold tracking-widest text-zinc-300">RAW · {p.ext.replace('.', '').toUpperCase()}</span>
            <span className="font-mono text-[11px] text-zinc-500">{t('Pratinjau penuh tidak tersedia', 'Full preview unavailable')}</span>
          </div>
        )}
        {loading && (
          <span className="absolute bottom-4 h-4 w-4 animate-spin rounded-full border-2 border-flow-500 border-t-white" aria-hidden="true" />
        )}
        {hasNext && (
          <button
            onClick={(e)=> { e.stopPropagation(); setCurId(navIds[idx + 1]) }}
            aria-label={t('Foto berikutnya', 'Next photo')}
            className="absolute right-3 rounded border border-flow-600 bg-black/60 p-2 text-zinc-300 transition hover:border-zinc-400 hover:text-white"
          >
            <Chevron dir="right" />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap border-t border-flow-700 px-4 py-2.5" onClick={(e)=> e.stopPropagation()}>
        <span className="font-mono text-[11px] tabular-nums text-zinc-500">{idx + 1} / {navIds.length}</span>
        <div className="flex gap-1.5">
          <button onClick={()=> appStore.updatePhotoCategory(p.id, 'picks')} className="rounded-sm bg-emerald-400 px-4 py-1.5 font-mono text-[11px] font-bold text-black">[ Picks ]</button>
          <button onClick={()=> appStore.updatePhotoCategory(p.id, 'maybe')} className="rounded-sm bg-amber-300 px-4 py-1.5 font-mono text-[11px] font-bold text-black">[ Maybe ]</button>
          <button onClick={()=> appStore.updatePhotoCategory(p.id, 'rejects')} className="rounded-sm bg-red-400 px-4 py-1.5 font-mono text-[11px] font-bold text-black">[ Reject ]</button>
        </div>
        <span className="hidden sm:inline font-mono text-[10px] text-zinc-600">{t('← → pindah · 1/2/3 nilai · Esc tutup', '← → navigate · 1/2/3 rate · Esc close')}</span>
      </div>
    </div>
  )
}
