import { useEffect, useRef, useState } from 'react'
import { useStore, appStore } from '@/store/useAppStore'
import { getMemThumb } from '@/lib/thumbCache'
import { createPadPoller, firstPad } from '@/lib/gamepad'

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
  const binds = useStore(s=>s.keybinds)
  const padOn = useStore(s=>s.padConnected)
  const [curId, setCurId] = useState(initialId)
  const [full, setFull] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const t = (id: string, en: string) => (lang==='id' ? id : en)

  const p = photos.find(x=>x.id === curId)
  const navIds = ids.filter(id=> photos.some(x=>x.id === id))
  const idx = navIds.indexOf(curId)
  const hasPrev = idx > 0
  const hasNext = idx >= 0 && idx < navIds.length - 1

  const pollRef = useRef(createPadPoller(() => appStore.padbinds))
  const navIdsRef = useRef<string[]>([])
  const curIdRef = useRef(curId)
  navIdsRef.current = navIds
  curIdRef.current = curId

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key.toUpperCase() === binds.prev.toUpperCase() && hasPrev) setCurId(navIds[idx - 1])
      else if (e.key.toUpperCase() === binds.next.toUpperCase() && hasNext) setCurId(navIds[idx + 1])
      else if (!p) return
      else {
        const k = e.key.toUpperCase()
        if (k === binds.picks.toUpperCase()) appStore.updatePhotoCategory(p.id, 'picks')
        else if (k === binds.maybe.toUpperCase()) appStore.updatePhotoCategory(p.id, 'maybe')
        else if (k === binds.rejects.toUpperCase()) appStore.updatePhotoCategory(p.id, 'rejects')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    let raf = 0
    let alive = true
    const loop = () => {
      if (!alive) return
      const act = pollRef.current()
      if (act === 'prev' || act === 'next') {
        const ids = navIdsRef.current
        const i = ids.indexOf(curIdRef.current)
        const j = act === 'prev' ? i - 1 : i + 1
        if (j >= 0 && j < ids.length) setCurId(ids[j])
      } else if (act && curIdRef.current) {
        appStore.updatePhotoCategory(curIdRef.current, act)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { alive = false; cancelAnimationFrame(raf) }
  }, [])

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

  if (!p) return null
  const reasons = (lang==='id' ? p.reasons : p.reasonsEn) ?? []
  const thumb = p.thumbUrl ?? getMemThumb(p.filePath) ?? undefined
  const verdict = p.category === 'picks' ? 'PICKS' : p.category === 'maybe' ? 'MAYBE' : 'REJECTS'
  const badgeCls = p.category === 'picks'
    ? 'w7-badge-pick'
    : p.category === 'maybe'
      ? 'w7-badge-maybe'
      : 'w7-badge-reject'
  const btnBase = 'w7-btn px-4 py-1.5 font-sans text-[11px] font-bold '
  const btnActive = 'w7-btn-primary '
  const btnCls = (cat: 'picks' | 'maybe' | 'rejects', color: string) =>
    btnBase + color + (p.category === cat ? btnActive : 'opacity-70 hover:opacity-100')
  const isCur = (cat: 'picks' | 'maybe' | 'rejects') => p.category === cat
  const disCls = 'disabled:cursor-not-allowed disabled:opacity-40 '

  return (
    <div className="w7-scrim fixed inset-0 z-50 flex flex-col p-3" role="dialog" aria-modal="true" aria-label={p.fileName}>
      <div className="w7-dialog flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="w7-dialog-title flex items-center gap-3 px-4 py-2" onClick={(e)=> e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <div className="truncate font-sans text-[13px] font-bold">
            {p.fileName}{' '}
            <span className={`w7-badge ml-1 inline-block px-1.5 py-px font-sans text-[10px] font-bold ${badgeCls}`}>
              {verdict}
            </span>
          </div>
          <div className="mt-0.5 truncate font-sans text-[11px] text-[#41566b]">
            {verdict} · <span className="w7-num">{p.score ?? 0}</span>
            {reasons.length > 0 && ' · ' + reasons.slice(0, 2).join(' · ')}
          </div>
        </div>
        <button
          onClick={onClose}
          autoFocus
          aria-label={t('Tutup', 'Close')}
          className="w7-btn p-1.5"
        >
          <XIcon />
        </button>
      </div>

      <div
        className="w7-viewer relative flex min-h-0 flex-1 items-center justify-center px-12 pb-2 pt-2"
        onClick={onClose}
      >
        {hasPrev && (
          <button
            onClick={(e)=> { e.stopPropagation(); setCurId(navIds[idx - 1]) }}
            aria-label={t('Foto sebelumnya', 'Previous photo')}
            className="w7-btn absolute left-3 p-2"
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
            className="max-h-full max-w-full border border-[#33506c] object-contain"
          />
        ) : thumb ? (
          <img
            src={thumb}
            alt={p.fileName}
            draggable={false}
            onClick={(e)=> e.stopPropagation()}
            className={`max-h-full max-w-full border border-[#33506c] object-contain ${loading ? 'opacity-60' : ''}`}
          />
        ) : (
          <div
            onClick={(e)=> e.stopPropagation()}
            className="w7-card flex flex-col items-center gap-1 px-8 py-10"
          >
            <span className="font-sans text-[11px] font-bold tracking-widest">RAW · {p.ext.replace('.', '').toUpperCase()}</span>
            <span className="w7-muted font-sans text-[11px]">{t('Pratinjau penuh tidak tersedia', 'Full preview unavailable')}</span>
          </div>
        )}
        {loading && (
          <span className="absolute bottom-4 h-4 w-4 animate-spin rounded-full border-2 border-[#9db3c8] border-t-[#2f6ea5]" aria-hidden="true" />
        )}
        {hasNext && (
          <button
            onClick={(e)=> { e.stopPropagation(); setCurId(navIds[idx + 1]) }}
            aria-label={t('Foto berikutnya', 'Next photo')}
            className="w7-btn absolute right-3 p-2"
          >
            <Chevron dir="right" />
          </button>
        )}
      </div>

      <div className="w7-status flex flex-wrap items-center justify-center gap-2 px-4 py-2.5" onClick={(e)=> e.stopPropagation()}>
        <span className="w7-num absolute left-4 font-sans text-[11px]">{idx + 1} / {navIds.length}</span>
        <div className="flex gap-1.5">
          <button disabled={isCur('picks')} aria-disabled={isCur('picks')} onClick={()=> appStore.updatePhotoCategory(p.id, 'picks')} title={isCur('picks') ? t('Sudah Picks', 'Already Picks') : t('Tandai Picks', 'Mark Picks')} className={disCls + btnCls('picks', 'w7-btn-green')}>Picks · {binds.picks}</button>
          <button disabled={isCur('maybe')} aria-disabled={isCur('maybe')} onClick={()=> appStore.updatePhotoCategory(p.id, 'maybe')} title={isCur('maybe') ? t('Sudah Maybe', 'Already Maybe') : t('Tandai Maybe', 'Mark Maybe')} className={disCls + btnCls('maybe', 'w7-btn-amber')}>Maybe · {binds.maybe}</button>
          <button disabled={isCur('rejects')} aria-disabled={isCur('rejects')} onClick={()=> appStore.updatePhotoCategory(p.id, 'rejects')} title={isCur('rejects') ? t('Sudah Reject', 'Already Reject') : t('Tandai Reject', 'Mark Reject')} className={disCls + btnCls('rejects', 'w7-btn-red')}>Reject · {binds.rejects}</button>
        </div>
        <span className="absolute right-4 hidden font-sans text-[10px] text-[#8293a3] sm:inline">{t(`← → pindah · ${binds.picks}/${binds.maybe}/${binds.rejects} nilai · Esc tutup`, `← → navigate · ${binds.picks}/${binds.maybe}/${binds.rejects} rate · Esc close`)}{padOn ? t(' · [PAD]', ' · [PAD]') : ''}</span>
      </div>
      </div>
    </div>
  )
}
