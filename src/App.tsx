import { useEffect } from 'react'
import { Header } from '@/components/Header'
import { FolderPicker } from '@/components/FolderPicker'
import { Fieldset } from '@/components/Fieldset'
import { SensitivitySelector } from '@/components/SensitivitySelector'
import { CullingView } from '@/components/CullingView'
import { PhotoGrid } from '@/components/PhotoGrid'
import { SENSITIVITY_MODES } from '@/components/SensitivitySelector'
import { useStore, appStore } from '@/store/useAppStore'

export default function App() {
  useEffect(() => {
    const sync = () => {
      try {
        const pads = navigator.getGamepads ? navigator.getGamepads() : []
        appStore.setPadConnected([...pads].some(p => p && p.connected))
      } catch {}
    }
    sync()
    window.addEventListener('gamepadconnected', sync)
    window.addEventListener('gamepaddisconnected', sync)
    const iv = setInterval(sync, 2000)
    return () => { window.removeEventListener('gamepadconnected', sync); window.removeEventListener('gamepaddisconnected', sync); clearInterval(iv) }
  }, [])
  const step = useStore(s=> s.step)
  const lang = useStore(s=> s.language)
  const stats = useStore(s=> s.stats)
  const photos = useStore(s=> s.photos)
  const mode = useStore(s=> s.sensitivity)
  const progress = useStore(s=> s.cullingProgress)
  const padOn = useStore(s=> s.padConnected)
  const t = (id: string, en: string) => (lang==='id' ? id : en)

  const hasPhotos = photos.length > 0
  const modeName = SENSITIVITY_MODES.find(m=>m.id===mode)?.name ?? mode
  const status = progress
    ? `${t('Memilah', 'Culling')} ${progress.done}/${progress.total}`
    : stats
      ? t('Selesai', 'Done')
      : hasPhotos
        ? t('Siap', 'Ready')
        : t('Siap untuk memulai', 'Ready to start')

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <div className="flex-1 mx-auto my-4 w-[calc(100%-2rem)] max-w-[1520px] rounded-md border border-flow-500 bg-flow-900 flex flex-col min-h-[calc(100vh-2rem)] overflow-hidden">
        <Header />
        <main className="flex-1 w-full px-4 py-4 flex flex-col gap-4">
          <FolderPicker />
          {hasPhotos && (
            <Fieldset num="02" title={t('Mode Culling', 'Culling Mode')}>
              <div className="p-3">
                <SensitivitySelector />
              </div>
              <div className="border-t border-flow-700" />
              <div className="px-3 py-3">
                <CullingView />
              </div>
            </Fieldset>
          )}
          {(step==='review' || stats) && <PhotoGrid />}
        </main>
        <footer className="shrink-0 border-t border-flow-700 px-4 h-10 flex items-center justify-between gap-2 font-mono text-[11px] tabular-nums text-zinc-500">
          <span className="truncate">
            {hasPhotos ? `${photos.length} ${t('foto', 'photos')} | Mode: ${modeName} | ${status}` : status}
          </span>
          <span className="shrink-0 hidden sm:flex items-center gap-1.5">
            OhMyFlow v1.0
            <span className="text-zinc-600">|</span>
            {padOn && (<span className="text-emerald-400 font-bold">[PAD]</span>)}
            {padOn && (<span className="text-zinc-600">|</span>)}
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            {t('100% Lokal', '100% Local')}
          </span>
        </footer>
      </div>
    </div>
  )
}
