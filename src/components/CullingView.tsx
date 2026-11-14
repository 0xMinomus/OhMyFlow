import { useRef, useState } from 'react'
import { useStore, appStore } from '@/store/useAppStore'
import { cullPhotos } from '@/lib/ai-engine/culler'
import { ANALYSIS_IMAGE_SIZE, V2_ANALYSIS_IMAGE } from '@/lib/ai-engine/pipeline'
import { prefetchThumbsBatch, getMemThumb, prefetchAnalysisBatch, clearMemAnalysis } from '@/lib/thumbCache'

function InfoIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8v.1" />
    </svg>
  )
}

export function CullingView() {
  const photos = useStore(s=>s.photos)
  const mode = useStore(s=>s.sensitivity)
  const lang = useStore(s=>s.language)
  const progress = useStore(s=>s.cullingProgress)
  const cancelRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const t = (id: string, en: string) => (lang==='id' ? id : en)

  const start = async () => {
    if (photos.length===0) return
    cancelRef.current = false
    setError(null)
    appStore.setStep('culling')
    appStore.setProgress({ done:0, total: photos.length, label: t('Siapkan thumbnail', 'Prepare thumbnails') })
    const t0 = performance.now()

    try {
      const useAnalysis = V2_ANALYSIS_IMAGE && mode === 'high'
      const aSize = ANALYSIS_IMAGE_SIZE[mode] ?? 1280
      const input = photos.map((p) => ({ ...p }))
      const culled = await cullPhotos(input, {
        mode,
        shouldCancel: () => cancelRef.current,
        prepareBatch: async (batch) => {
          let tmap: Map<string, string | null>
          try {
            tmap = await prefetchThumbsBatch(batch)
          } catch {
            tmap = new Map()
          }
          for (const it of batch) {
            it.thumbUrl = tmap.get(it.filePath) ?? getMemThumb(it.filePath) ?? null
          }
          if (useAnalysis) {
            let amap: Map<string, string | null>
            try {
              amap = await prefetchAnalysisBatch(batch, aSize)
            } catch {
              amap = new Map()
            }
            for (const it of batch) it.analysisUrl = amap.get(it.filePath) ?? null
          }
        },
        onProgress: (done, total) => {
          appStore.setProgress({ done, total, label: t('Memilah', 'Culling') })
        },
      })
      clearMemAnalysis()
      // Batal di tengah = hasil parsial (ekor tanpa kategori) → JANGAN ke review.
      if (cancelRef.current) {
        appStore.setProgress(null)
        appStore.setStep('select')
        return
      }

      const dt = performance.now()-t0
      const picks = culled.filter(p=>p.category==='picks').length
      const maybe = culled.filter(p=>p.category==='maybe').length
      const rejects = culled.filter(p=>p.category==='rejects').length
      const debug = (culled as any).cullDebug ?? {}
      const throughput = Math.round((culled.length / Math.max(1,(dt/60000))))
      appStore.setPhotos(culled)
      appStore.setStats({ total: culled.length, picks, maybe, rejects, durationMs: dt, throughputPerMin: throughput, thumbNull: debug.noSrc ?? 0, featNull: debug.featNull ?? 0 })
      appStore.setProgress(null)
      appStore.setStep('review')
      appStore.setCategory('all')
    } catch (e: any) {
      console.error('[OhMyFlow] culling gagal:', e)
      appStore.setProgress(null)
      appStore.setStep('select')
      setError(e?.message ? String(e.message) : t('Proses gagal tanpa pesan error.', 'Process failed with no error message.'))
    }
  }

  if (progress) {
    const pct = Math.round((progress.done/progress.total)*100)
    return (
      <div className="flex flex-col gap-3 px-1 py-1" aria-live="polite">
        <div className="flex items-center gap-3">
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-flow-500 border-t-white" aria-hidden="true" />
          <span className="font-mono text-[13px] font-bold text-white tabular-nums">
            {progress.label ? `${progress.label} ` : `${t('Memilah', 'Culling')} `}{progress.done}/{progress.total}
          </span>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-500">{pct}%</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-flow-900" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-emerald-400 transition-all" style={{ width: pct+'%' }} />
        </div>
        <button onClick={()=>{ cancelRef.current = true }} className="self-start font-mono text-[11px] font-bold text-zinc-500 transition hover:text-white">
          {t('[ Batal ]', '[ Cancel ]')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="rounded-sm border border-red-500/40 bg-red-500/10 p-3" role="alert">
          <div className="font-mono text-[13px] font-bold text-red-300">{t('Proses gagal.', 'Process failed.')}</div>
          <div className="mt-1 break-all font-mono text-[11px] text-red-300/80">{error}</div>
          <button onClick={()=>setError(null)} className="mt-2 rounded-sm border border-flow-500 px-3 py-1 font-mono text-[11px] font-bold text-zinc-200 transition hover:text-white">
            {t('[ Tutup ]', '[ Dismiss ]')}
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 flex-wrap min-h-[44px]">
        <p className="flex items-start gap-1.5 font-mono text-[11px] leading-snug text-zinc-500 max-w-[60%]">
          <span className="mt-0.5 shrink-0"><InfoIcon /></span>
          <span>
            {lang==='id'
              ? 'Semua mode berjalan 100% lokal di laptop ini. Fast untuk sortir awal ribuan foto, High untuk seleksi akhir sebelum edit.'
              : 'All modes run 100% locally on this laptop. Fast for an initial pass over thousands of photos, High for final selection before editing.'}
          </span>
        </p>
        <button
          disabled={photos.length===0}
          onClick={start}
          className="shrink-0 w-48 rounded-sm border border-emerald-400 bg-emerald-400 px-4 py-2 font-mono text-[13px] font-bold text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:border-flow-600 disabled:bg-flow-700 disabled:opacity-40"
        >
          {t('[ Mulai Culling → ]', '[ Start Culling → ]')}
        </button>
      </div>
    </div>
  )
}
