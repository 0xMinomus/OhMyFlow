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
            className="w7-drop flex w-full flex-col items-center gap-1.5 px-6 py-10 disabled:opacity-50"
          >
            <FolderIcon size={20} />
            <span className="font-sans text-sm font-bold">
              {scanning ? t('Memindai…', 'Scanning…') : t('Pilih Folder', 'Choose Folder')}
            </span>
            <span className="w7-muted font-sans text-[11px]">JPEG · PNG · TIFF · HEIC · RAW</span>
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
        <div className="w7-field flex min-h-[60px] items-center gap-3 px-3 py-2.5">
          <span className="w7-muted shrink-0"><FolderIcon size={16} /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-sans text-[13px]">{folder}</div>
            <div className="w7-muted w7-num mt-0.5 font-sans text-[11px]">
              {scanning
                ? t('Memindai…', 'Scanning…')
                : `${photos.length} ${t('foto', 'photos')}${paired > 0 ? ` · ${paired} RAW+JPG` : ''}${rawOnly > 0 ? ` · ${rawOnly} RAW` : ''}`}
            </div>
          </div>
          <button
            onClick={pick}
            disabled={scanning}
            className="w7-btn shrink-0 px-4 py-1.5 font-sans text-xs font-bold disabled:opacity-50"
          >
            {t('Ganti', 'Change')}
          </button>
        </div>
      </div>
    </Fieldset>
  )
}
