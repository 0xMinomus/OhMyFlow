import { useState } from 'react'
import { appStore, useStore } from '@/store/useAppStore'
import { clearMemThumbs } from '@/lib/thumbCache'
import { Fieldset } from '@/components/Fieldset'

export function FolderIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  )
}

export function FolderPicker() {
  const folder = useStore(s=>s.folderPath)
  const photos = useStore(s=>s.photos)
  const lang = useStore(s=>s.language)
  const [scanning, setScanning] = useState(false)
  const t = (id: string, en: string) => (lang==='id' ? id : en)

  const pick = async () => {
    const f = await window.ohmyflow.openFolder()
    if (!f) return
    setScanning(true)
    try {
      appStore.setFolder(f)
      appStore.setStats(null)
      appStore.setStep('select')
      clearMemThumbs()
      appStore.setPhotos(await window.ohmyflow.scanFolder(f))
    } finally {
      setScanning(false)
    }
  }

  if (!folder) {
    return (
      <Fieldset num="01" title={t('Folder', 'Folder')}>
        <div className="p-3">
          <button
            onClick={pick}
            disabled={scanning}
            className="w-full flex flex-col items-center gap-1.5 rounded-sm border border-dashed border-flow-500 px-6 py-10 text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-50"
          >
            <FolderIcon size={20} />
            <span className="font-mono text-sm font-bold text-white">
              {scanning ? t('Memindai…', 'Scanning…') : t('[ Pilih Folder ]', '[ Choose Folder ]')}
            </span>
            <span className="font-mono text-[11px]">JPEG · PNG · TIFF · HEIC · RAW</span>
          </button>
        </div>
      </Fieldset>
    )
  }

  const paired = photos.filter(p=>p.isPaired).length
  const rawOnly = photos.filter(p=>p.isRaw && !p.isPaired).length

  return (
    <Fieldset num="01" title={t('Folder', 'Folder')}>
      <div className="p-3">
        <div className="flex items-center gap-3 rounded-sm border border-flow-600 px-3 py-2.5 min-h-[60px]">
          <span className="shrink-0 text-zinc-400"><FolderIcon size={16} /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[13px] text-zinc-100">{folder}</div>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-500">
              {scanning
                ? t('Memindai…', 'Scanning…')
                : `${photos.length} ${t('foto', 'photos')}${paired > 0 ? ` · ${paired} RAW+JPG` : ''}${rawOnly > 0 ? ` · ${rawOnly} RAW` : ''}`}
            </div>
          </div>
          <button
            onClick={pick}
            disabled={scanning}
            className="shrink-0 rounded-sm border border-flow-500 px-4 py-1.5 font-mono text-xs font-bold text-zinc-200 transition hover:border-zinc-400 hover:text-white disabled:opacity-50"
          >
            {t('[ Ganti ]', '[ Change ]')}
          </button>
        </div>
      </div>
    </Fieldset>
  )
}
