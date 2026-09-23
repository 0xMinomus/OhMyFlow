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

  const theme = useStore(s=> s.theme)
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
    <div className={`h-screen w-screen overflow-hidden font-sans ${theme==='win98' ? 'theme-98' : theme==='mac' ? 'theme-mac' : ''}`}>
      <div className="w7-window flex h-full w-full flex-col overflow-hidden">
        <Header />
        <main className="w7-client flex w-full flex-1 flex-col overflow-hidden min-h-0">
          <div className="flex shrink-0 flex-col gap-3 px-4 pt-4">
            <FolderPicker />
            {hasPhotos && (
              <Fieldset num="02" title={t('Mode Culling', 'Culling Mode')}>
                <div className="p-3">
                  <SensitivitySelector />
                </div>
                <div className="w7-separator" />
                <div className="px-3 py-3">
                  <CullingView />
                </div>
              </Fieldset>
            )}
          </div>
          {(step==='review' || stats) && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-3">
              <PhotoGrid />
            </div>
          )}
        </main>
        <footer className="w7-status flex h-9 shrink-0 items-center justify-between gap-2 px-3 text-[11px]">
          <span className="truncate">
            {hasPhotos ? `${photos.length} ${t('foto', 'photos')} | Mode: ${modeName} | ${status}` : status}
          </span>
          <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
            OhMyFlow v1.2
            {padOn && (<span className="w7-faint">|</span>)}
            {padOn && (<span className="font-bold text-[#2f7a3d]">PAD</span>)}
          </span>
        </footer>
      </div>
    </div>
  )
}
