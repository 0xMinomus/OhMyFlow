import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, appStore } from '@/store/useAppStore'
import { getMemThumb } from '@/lib/thumbCache'
import { createPadPoller } from '@/lib/gamepad'
import { mediaUrl as buildMediaUrl } from '@/lib/bridge'

// Pre-decode LRU untuk bitmap 1:1 via media:// (tanpa base64 IPC / bloat JS heap).
const PREDECODE_MAX = 10
const decodedImgs = new Map<string, HTMLImageElement>()
const inflightDecode = new Map<string, Promise<string | null>>()

function mediaUrl(filePath: string, mtimeMs?: number): string {
  return buildMediaUrl(filePath, 'full', mtimeMs)
}

function cacheBitmap(url: string, img: HTMLImageElement) {
  decodedImgs.delete(url)
  decodedImgs.set(url, img)
  while (decodedImgs.size > PREDECODE_MAX) {
    const oldest = decodedImgs.keys().next().value
    if (oldest === undefined) break
    const evicted = decodedImgs.get(oldest)
    decodedImgs.delete(oldest)
    if (evicted) evicted.src = ''
  }
}

function predecodeUrl(url: string): Promise<string | null> {
  const existing = decodedImgs.get(url)
  if (existing) {
    decodedImgs.delete(url)
    decodedImgs.set(url, existing)
    return Promise.resolve(url)
  }
  const active = inflightDecode.get(url)
  if (active) return active
  const attempt = (retriesLeft: number): Promise<string | null> => new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      const done = () => { cacheBitmap(url, img); resolve(url) }
      if (typeof img.decode === 'function') img.decode().then(done, done)
      else done()
    }
    img.onerror = () => {
      if (retriesLeft > 0) setTimeout(() => { void attempt(retriesLeft - 1).then(resolve) }, 80)
      else resolve(null)
    }
    img.src = url
  })
  const p = attempt(1).finally(() => { inflightDecode.delete(url) })
  inflightDecode.set(url, p)
  return p
}

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
  const undoCount = useStore(s=>s.undoStack.length)
  const [curId, setCurId] = useState(initialId)
  const [full, setFull] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [compare, setCompare] = useState(false)
  const [bestFull, setBestFull] = useState<string | null>(null)
  const t = (id: string, en: string) => (lang==='id' ? id : en)

  const p = photos.find(x=>x.id === curId)
  const burstBest = useMemo(() => {
    if (!p) return null
    if (p.duplicateGroup) return photos.find(x => x.id === p.duplicateGroup) ?? null
    if ((p.clusterSize ?? 0) > 1) {
      return photos.find(x => x.duplicateGroup === p.id && x.id !== p.id) ?? null
    }
    return null
  }, [p, photos])
  const navIds = useMemo(() => ids.filter(id=> photos.some(x=>x.id === id)), [ids, photos])
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
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        appStore.undoCategory()
      } else if (e.key.toUpperCase() === 'B' && burstBest) {
        setCompare(c => !c)
      } else if (e.key.toUpperCase() === binds.prev.toUpperCase() && hasPrev) setCurId(navIds[idx - 1])
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
  }, [binds, p, burstBest, hasPrev, hasNext, navIds, idx, onClose])
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
    if (!p) { setFull(null); return }
    const url = mediaUrl(p.previewPath || p.filePath, p.mtimeMs)
    const schedulePreload = () => {
      return window.setTimeout(() => {
        if (dead) return
        for (const offset of [1, -1, 2]) {
          const nId = navIds[idx + offset]
          if (!nId) continue
          const np = photos.find(x => x.id === nId)
          if (!np) continue
          void predecodeUrl(mediaUrl(np.previewPath || np.filePath, np.mtimeMs))
        }
      }, 80)
    }
    let preloadTimer: number | undefined
    if (decodedImgs.has(url)) {
      const hit = decodedImgs.get(url)!
      decodedImgs.delete(url)
      decodedImgs.set(url, hit)
      setFull(url)
      setLoading(false)
      preloadTimer = schedulePreload()
      return () => { dead = true; window.clearTimeout(preloadTimer) }
    }
    setFull(null)
    setLoading(true)
    void predecodeUrl(url).then((readyUrl) => {
      if (dead) return
      setFull(readyUrl)
      setLoading(false)
      preloadTimer = schedulePreload()
    })
    return () => { dead = true; window.clearTimeout(preloadTimer) }
  }, [p?.filePath, p?.previewPath, p?.mtimeMs, idx]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!burstBest) { setCompare(false); setBestFull(null); return }
    if (!compare) return
    let dead = false
    const url = mediaUrl(burstBest.previewPath || burstBest.filePath, burstBest.mtimeMs)
    if (decodedImgs.has(url)) {
      setBestFull(url)
      return
    }
    void predecodeUrl(url).then((readyUrl) => {
      if (!dead) setBestFull(readyUrl)
    })
    return () => { dead = true }
  }, [compare, burstBest?.filePath, burstBest?.previewPath, burstBest?.mtimeMs]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null
  const reasons = (lang==='id' ? p.reasons : p.reasonsEn) ?? []
  const thumb = p.thumbUrl ?? getMemThumb(p.filePath) ?? undefined
  const verdict = p.category === 'picks' ? 'PICKS' : p.category === 'maybe' ? 'MAYBE' : 'REJECTS'
  const badgeCls = p.category === 'picks'
    ? 'border-emerald-400 bg-emerald-400 text-black'
    : p.category === 'maybe'
      ? 'border-amber-300 bg-amber-300 text-black'
      : 'border-red-400 bg-red-400 text-black'
  const btnBase = 'rounded-sm px-4 py-1.5 font-mono text-[11px] font-bold transition border '
  const btnActive = 'ring-2 ring-white ring-offset-1 ring-offset-black '
  const btnCls = (cat: 'picks' | 'maybe' | 'rejects', color: string) =>
    btnBase + color + (p.category === cat ? btnActive : 'opacity-70 hover:opacity-100')
  const isCur = (cat: 'picks' | 'maybe' | 'rejects') => p.category === cat
  const disCls = 'disabled:cursor-not-allowed disabled:opacity-40 '

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label={p.fileName}>
      <div className="flex items-center gap-3 border-b border-flow-700 px-4 py-2.5" onClick={(e)=> e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px] font-bold text-white">
            {p.fileName}{' '}
            <span className={`ml-1 inline-block rounded-sm border px-1.5 py-px font-mono text-[10px] font-bold ${badgeCls}`}>
              [ {verdict} ]
            </span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
            {verdict} · <span className="tabular-nums">{p.score ?? 0}</span>
            {reasons.length > 0 && ' · ' + reasons.slice(0, 2).join(' · ')}
          </div>
        </div>
        {burstBest && (
          <button
            onClick={()=> setCompare(c => !c)}
            className={`rounded border px-2.5 py-1 font-mono text-[11px] font-bold transition ${compare ? 'border-emerald-400 bg-emerald-400 text-black' : 'border-flow-600 text-zinc-300 hover:border-zinc-400 hover:text-white'}`}
          >
            {t('[ Bandingkan Burst · B ]', '[ Compare Burst · B ]')}
          </button>
        )}
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
        {compare && burstBest ? (
          <div onClick={(e)=> e.stopPropagation()} className="grid h-full w-full max-w-6xl grid-cols-2 gap-3 py-2">
            <div className="flex min-h-0 flex-col items-center justify-center rounded-sm border border-emerald-500/40 bg-flow-900/50 p-2">
              <div className="mb-1.5 font-mono text-[10px] text-emerald-300 truncate w-full text-center">
                {burstBest.clusterRank === 0 ? t('Terbaik di Burst', 'Best in Burst') : t('Pembanding Burst', 'Burst Peer')} · {burstBest.fileName} · {t('Skor', 'Score')} {burstBest.score ?? 0} · {t('Fokus', 'Focus')} {burstBest.sharpness ?? 0}
              </div>
              {(bestFull ?? burstBest.thumbUrl ?? getMemThumb(burstBest.filePath)) ? (
                <img
                  src={bestFull ?? burstBest.thumbUrl ?? getMemThumb(burstBest.filePath) ?? ''}
                  alt={burstBest.fileName}
                  draggable={false}
                  className="min-h-0 flex-1 max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="font-mono text-[11px] text-zinc-500">{t('Memuat…', 'Loading…')}</span>
              )}
            </div>
            <div className="flex min-h-0 flex-col items-center justify-center rounded-sm border border-flow-600 bg-flow-900/50 p-2">
              <div className="mb-1.5 font-mono text-[10px] text-zinc-300 truncate w-full text-center">
                {t('Saat Ini', 'Current')} · {p.fileName} · {t('Skor', 'Score')} {p.score ?? 0} · {t('Fokus', 'Focus')} {p.sharpness ?? 0}
              </div>
              {(full || thumb) ? (
                <img
                  src={full || thumb}
                  alt={p.fileName}
                  draggable={false}
                  className="min-h-0 flex-1 max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="font-mono text-[11px] text-zinc-500">{t('Pratinjau tidak tersedia', 'Preview unavailable')}</span>
              )}
            </div>
          </div>
        ) : full ? (
          <img
            key={`full:${p.id}`}
            src={full}
            alt={p.fileName}
            draggable={false}
            onClick={(e)=> e.stopPropagation()}
            className="max-h-full max-w-full rounded-sm border border-flow-700 object-contain"
          />
        ) : thumb ? (
          <img
            key={`thumb:${p.id}`}
            src={thumb}
            alt={p.fileName}
            draggable={false}
            onClick={(e)=> e.stopPropagation()}
            className={`h-full w-full rounded-sm border border-flow-700 object-contain ${loading ? 'opacity-60' : ''}`}
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

      <div className="flex items-center justify-center gap-2 flex-wrap border-t border-flow-700 px-4 py-2.5" onClick={(e)=> e.stopPropagation()}>
        <span className="absolute left-4 font-mono text-[11px] tabular-nums text-zinc-500">{idx + 1} / {navIds.length}</span>
        <div className="flex gap-1.5">
          {undoCount > 0 && (
            <button onClick={()=> appStore.undoCategory()} title="Ctrl+Z" className="rounded-sm border border-flow-500 px-3 py-1.5 font-mono text-[11px] font-bold text-zinc-300 transition hover:border-zinc-400 hover:text-white">
              Undo
            </button>
          )}
          <button disabled={isCur('picks')} aria-disabled={isCur('picks')} onClick={()=> appStore.updatePhotoCategory(p.id, 'picks')} title={isCur('picks') ? t('Sudah Picks', 'Already Picks') : t('Tandai Picks', 'Mark Picks')} className={disCls + btnCls('picks', 'border-emerald-400 bg-emerald-400 text-black')}>[ Picks · {binds.picks} ]</button>
          <button disabled={isCur('maybe')} aria-disabled={isCur('maybe')} onClick={()=> appStore.updatePhotoCategory(p.id, 'maybe')} title={isCur('maybe') ? t('Sudah Maybe', 'Already Maybe') : t('Tandai Maybe', 'Mark Maybe')} className={disCls + btnCls('maybe', 'border-amber-300 bg-amber-300 text-black')}>[ Maybe · {binds.maybe} ]</button>
          <button disabled={isCur('rejects')} aria-disabled={isCur('rejects')} onClick={()=> appStore.updatePhotoCategory(p.id, 'rejects')} title={isCur('rejects') ? t('Sudah Reject', 'Already Reject') : t('Tandai Reject', 'Mark Reject')} className={disCls + btnCls('rejects', 'border-red-400 bg-red-400 text-black')}>[ Reject · {binds.rejects} ]</button>
        </div>
        <span className="absolute right-4 hidden sm:inline font-mono text-[10px] text-zinc-600">{t(`← → pindah · ${binds.picks}/${binds.maybe}/${binds.rejects} nilai · Esc tutup`, `← → navigate · ${binds.picks}/${binds.maybe}/${binds.rejects} rate · Esc close`)}{padOn ? t(' · [PAD]', ' · [PAD]') : ''}</span>
      </div>
    </div>
  )
}
