import { useRef, useState } from 'react'
import { useStore, appStore } from '@/store/useAppStore'
import { runEngine } from '@/lib/ai-engine-v2/pipeline'
import { ANALYSIS_IMAGE_SIZE, V2_ANALYSIS_IMAGE } from '@/lib/ai-engine/pipeline'
import { prefetchThumbsBatch, getMemThumb, prefetchAnalysisBatch } from '@/lib/thumbCache'

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
      const withThumbs = photos.map((p) => ({ ...p }))
      // v2 analysis image HANYA High (verdict mode lain bit-identik).
      const useAnalysis = V2_ANALYSIS_IMAGE && mode === 'high'
      // Bobot bar: thumb 30% + analysis 30% (High) / thumb 60% (lainnya) + AI sisa.
      const thumbW = useAnalysis ? 0.3 : 0.6
      for (let i = 0; i < withThumbs.length; i += 24) {
        if (cancelRef.current) break
        const chunk = withThumbs.slice(i, i + 24)
        let map: Map<string, string | null>
        try {
          map = await prefetchThumbsBatch(chunk)
        } catch {
          map = new Map()
        }
        for (const it of chunk) {
          const u = map.get(it.filePath) ?? getMemThumb(it.filePath) ?? null
          it.thumbUrl = u
        }
        const loaded = Math.min(withThumbs.length, i + 24)
        // Prefetch (sharp+IPC full-res) = kerja berat → bobot jujur (lihat thumbW).
        appStore.setProgress({ done: Math.round(loaded * thumbW), total: photos.length, label: t('Siapkan thumbnail', 'Prepare thumbnails') })
        await new Promise(r => setTimeout(r, 0))
      }
      if (useAnalysis) {
        const aSize = ANALYSIS_IMAGE_SIZE[mode] ?? 1280
        for (let i = 0; i < withThumbs.length; i += 24) {
          if (cancelRef.current) break
          const chunk = withThumbs.slice(i, i + 24)
          let amap: Map<string, string | null>
          try {
            amap = await prefetchAnalysisBatch(chunk, aSize)
          } catch {
            amap = new Map()
          }
          for (const it of chunk) it.analysisUrl = amap.get(it.filePath) ?? null
          const loaded = Math.min(withThumbs.length, i + 24)
          appStore.setProgress({ done: Math.round(withThumbs.length * 0.3 + loaded * 0.3), total: photos.length, label: t('Siapkan analisis', 'Prepare analysis') })
          await new Promise(r => setTimeout(r, 0))
        }
      }
      if (cancelRef.current) {
        appStore.setProgress(null)
        appStore.setStep('select')
        return
      }

      const baseW = useAnalysis ? 0.6 : 0.6
      const config = await window.ohmyflow.getEngineConfig()
      const provider = config.engine !== 'legacy'
        ? new (await import('@/lib/ai-engine-v2/face/mediapipe-provider')).MediaPipeFaceProvider()
        : undefined
      const culled = await runEngine(withThumbs, {
        engine: config.engine,
        provider,
        mode,
        shouldCancel: () => cancelRef.current,
        onProgress: (done,total)=> {
          const mapped = Math.round(total * baseW + done * (1 - baseW))
          appStore.setProgress({ done: Math.min(total, mapped), total, label: t('Analisis', 'Analyzing') })
        }
      })
      // Batal di tengah = hasil parsial (ekor tanpa kategori) → JANGAN ke review.
      if (cancelRef.current) {
        appStore.setProgress(null)
        appStore.setStep('select')
        return
      }

      try {
        await window.ohmyflow.saveEngineTrace(culled.map(p => JSON.stringify((p as any).engineTrace)).join('\n') + '\n')
      } catch (traceError) { console.error('[OhMyFlow] diagnostic write failed:', traceError) }

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
          <span className="w7-num font-sans text-[13px] font-bold">
            {progress.label ? `${progress.label} ` : `${t('Memilah', 'Culling')} `}{progress.done}/{progress.total}
          </span>
          <span className="w7-muted w7-num ml-auto font-sans text-[11px]">{pct}%</span>
        </div>
        <div className="w7-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: pct+'%' }} />
        </div>
        <button onClick={()=>{ cancelRef.current = true }} className="w7-btn self-start px-3 py-1 font-sans text-[11px] font-bold">
          {t('Batal', 'Cancel')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="w7-card p-3" role="alert">
          <div className="font-sans text-[13px] font-bold text-[#5e1a12]">{t('Proses gagal.', 'Process failed.')}</div>
          <div className="mt-1 break-all font-sans text-[11px] text-[#5e1a12]">{error}</div>
          <button onClick={()=>setError(null)} className="w7-btn mt-2 px-3 py-1 font-sans text-[11px] font-bold">
            {t('Tutup', 'Dismiss')}
          </button>
        </div>
      )}
      <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-4">
        <p className="w7-muted flex max-w-[60%] items-start gap-1.5 font-sans text-[11px] leading-snug">
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
          className="w7-btn w7-btn-green w-48 shrink-0 px-4 py-2 font-sans text-[13px] font-bold disabled:opacity-40"
        >
          {t('Mulai Culling →', 'Start Culling →')}
        </button>
      </div>
    </div>
  )
}
