import { useEffect, useRef, useState } from 'react'
import { useStore, appStore, DEFAULT_KEYBINDS, keyGlyph, type KeyAction } from '@/store/useAppStore'
import { waitPadButton, firstPad, padKind, type PadAction } from '@/lib/gamepad'
import { PadButton } from '@/components/PadButton'

function GearIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function Header() {
  const lang = useStore(s=>s.language)
  const theme = useStore(s=>s.theme)
  const binds = useStore(s=>s.keybinds)
  const padbinds = useStore(s=>s.padbinds)
  const padOn = useStore(s=>s.padConnected)
  const [open, setOpen] = useState(false)
  const [capture, setCapture] = useState<KeyAction | null>(null)
  const [padCapture, setPadCapture] = useState<PadAction | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const t = (id: string, en: string) => (lang==='id' ? id : en)
  const kind = padKind(padOn ? firstPad()?.id : undefined)

  useEffect(() => {
    if (!open) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setCapture(null); setPadCapture(null) } }
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('keydown', onEsc) }
  }, [open ])

  useEffect(() => {
    if (!padCapture) return
    let dead = false
    waitPadButton(10000).then(idx => {
      if (dead) return
      if (idx !== null) appStore.setPadbind(padCapture, idx)
      setPadCapture(null)
    })
    return () => { dead = true }
  }, [padCapture])

  useEffect(() => {
    if (!capture) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const reserved = ['ESCAPE', 'TAB', ' ']
      if (reserved.includes(e.key.toUpperCase())) { setCapture(null); return }
      appStore.setKeybind(capture, e.key.length === 1 ? e.key : e.key)
      setCapture(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capture])
  return (
    <div className="shrink-0 select-none">
    <div className="w7-titlebar flex h-16 items-center justify-between px-4" style={{ WebkitAppRegion: 'drag' } as any}>
      <div className="flex min-w-0 items-center gap-2.5">
        <img
          src="logo.png"
          alt="OhMyFlow"
          width={28}
          height={28}
          draggable={false}
          className="h-7 w-7 shrink-0 border border-white/70 object-cover"
          style={{ imageRendering: 'pixelated' }}
        />
        <div className="min-w-0 leading-tight">
          <div className="w7-title truncate font-sans text-xl font-bold tracking-tight">
            OhMyFlow <span className="w7-subtitle text-sm font-normal">v1.2</span>
          </div>
          <div className="w7-subtitle truncate font-sans text-xs">Culling made simple.</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <button
          onClick={()=> { setOpen(o=>!o); setCapture(null); setPadCapture(null) }}
          aria-label={t('Pengaturan', 'Settings')}
          aria-expanded={open}
          className="w7-caption mr-1 px-2 py-1.5"
        >
          <GearIcon />
        </button>
        <button
          onClick={()=> appStore.setLanguage(lang==='id'?'en':'id')}
          aria-label={lang==='id' ? 'Switch to English' : 'Ganti ke Bahasa Indonesia'}
          className="w7-caption mr-1 px-2 py-1 font-sans text-[11px] font-bold"
        >
          {lang==='id' ? 'EN' : 'ID'}
        </button>
        <button
          onClick={()=> window.ohmyflow.windowControls.minimize()}
          aria-label="Minimize"
          className="w7-caption h-8 w-9 text-sm"
        >
          ─
        </button>
        <button
          onClick={()=> window.ohmyflow.windowControls.maximize()}
          aria-label="Maximize"
          className="w7-caption h-8 w-9 text-xs"
        >
          □
        </button>
        <button
          onClick={()=> window.ohmyflow.windowControls.close()}
          aria-label="Close"
          className="w7-caption w7-caption-danger h-8 w-9 text-sm"
        >
          ✕
        </button>
      </div>
    </div>
    {open && (
      <div
        className="w7-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={()=> { if (!capture && !padCapture) setOpen(false) }}
        role="presentation"
      >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('Pengaturan', 'Settings')}
        onClick={(e)=> e.stopPropagation()}
        className="w7-dialog w-full max-w-lg overflow-hidden"
      >
        <div className="w7-dialog-title flex items-center justify-between px-4 py-2">
          <div className="font-sans text-[13px] font-bold">{t('Pengaturan', 'Settings')}</div>
          <button
            onClick={()=> { setOpen(false); setCapture(null); setPadCapture(null) }}
            aria-label={t('Tutup', 'Close')}
            className="w7-btn px-2 py-0.5 text-xs font-bold"
          >
            ✕
          </button>
        </div>
        <div className="p-4">
        <fieldset className="w7-group mb-3 px-3 py-2">
          <legend className="w7-legend px-1 font-sans text-[11px] font-bold">{t('[ TEMA ]', '[ THEME ]')}</legend>
          <div className="flex gap-1.5" role="radiogroup" aria-label={t('Tema', 'Theme')}>
            {(['win7','win98','mac'] as const).map(id => (
              <button
                key={id}
                role="radio"
                aria-checked={theme===id}
                onClick={()=> appStore.setTheme(id)}
                className={`w7-btn min-w-0 flex-1 py-1.5 font-sans text-[11px] font-bold ${theme===id ? 'w7-btn-primary' : ''}`}
              >
                {theme===id ? '◉' : '○'} {id==='win7' ? t('Windows 7', 'Windows 7') : id==='win98' ? t('Windows 98', 'Windows 98') : t('macOS', 'macOS')}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="w7-group p-3">
            <legend className="w7-legend px-1 font-sans text-[11px] font-bold">
              {t('[ KEYBOARD ]', '[ KEYBOARD ]')}
            </legend>
            {(['prev','next','picks','maybe','rejects'] as const).map(act => (
              <div key={act} className="mb-1.5 flex items-center justify-between gap-2">
                <span className={`h-2 w-2 ${act === 'picks' ? 'bg-[#2f7a3d]' : act === 'maybe' ? 'bg-[#8a6d00]' : act === 'rejects' ? 'bg-[#a93226]' : 'bg-[#8293a3]'}`} aria-hidden="true" />
                <span className="flex-1 font-sans text-[11px]">
                  {act === 'prev' ? t('← Sebelumnya', '← Previous')
                    : act === 'next' ? t('Berikutnya →', 'Next →')
                    : act === 'picks' ? t('Picks', 'Picks')
                    : act === 'maybe' ? t('Maybe', 'Maybe') : t('Reject', 'Reject')}
                </span>
                <button
                  onClick={()=> setCapture(act)}
                  className="w7-btn min-w-[3rem] px-2 py-1 text-center font-sans text-[11px] font-bold"
                >
                  {capture === act ? '…' : keyGlyph(binds[act])}
                </button>
              </div>
            ))}
            {capture
              ? <div className="font-sans text-[10px] text-[#2f6ea5]">{t('Tekan tombol baru… (Esc batal)', 'Press a new key… (Esc cancels)')}</div>
              : <button
                  onClick={()=> { appStore.resetKeybinds(); setCapture(null) }}
                  className="mt-1 font-sans text-[10px] font-bold text-[#5b6b7a] hover:text-[#1e2c3a]"
                >
                  {t('[ Reset bawaan ]', '[ Reset defaults ]')}
                </button>}
          </fieldset>
          <fieldset className="w7-group p-3">
            <legend className="w7-legend px-1 font-sans text-[11px] font-bold">
              {t('[ CONTROLLER ]', '[ CONTROLLER ]')}{' '}
              <span className={padOn ? 'text-[#2f7a3d]' : 'text-[#8293a3]'}>
                {padOn ? '●' : '○'}
              </span>
            </legend>
            {!padOn && (
              <div className="mb-1.5 font-sans text-[10px] text-[#5b6b7a]">
                {t('Colok controller + tekan tombol apa saja.', 'Plug in a controller + press any button.')}
              </div>
            )}
            {(['prev','next','picks','maybe','rejects'] as const).map(act => (
              <div key={act} className="mb-1.5 flex items-center justify-between gap-2">
                <span className={`h-2 w-2 ${act === 'picks' ? 'bg-[#2f7a3d]' : act === 'maybe' ? 'bg-[#8a6d00]' : act === 'rejects' ? 'bg-[#a93226]' : 'bg-[#8293a3]'}`} aria-hidden="true" />
                <span className="flex-1 font-sans text-[11px]">
                  {act === 'prev' ? t('← Sebelumnya', '← Previous')
                    : act === 'next' ? t('Berikutnya →', 'Next →')
                    : act === 'picks' ? t('Picks', 'Picks')
                    : act === 'maybe' ? t('Maybe', 'Maybe')
                    : t('Reject', 'Reject')}
                </span>
                <button
                  onClick={()=> setPadCapture(act)}
                  aria-label={act}
                  className="transition hover:opacity-80"
                >
                  {padCapture === act
                    ? <span className="w7-btn inline-flex min-w-[2rem] items-center justify-center px-1.5 py-0.5 font-sans text-[11px] font-bold">…</span>
                    : <PadButton index={padbinds[act]} kind={kind} />}
                </button>
              </div>
            ))}
            {padCapture
              ? <div className="font-sans text-[10px] text-[#2f6ea5]">{t('Tekan tombol controller… (10 dtk)', 'Press controller button… (10s)')}</div>
              : <button
                  onClick={()=> { appStore.resetPadbinds(); setPadCapture(null) }}
                  className="mt-1 font-sans text-[10px] font-bold text-[#5b6b7a] hover:text-[#1e2c3a]"
                >
                  {t('[ Reset bawaan ]', '[ Reset defaults ]')}
                </button>}
          </fieldset>
        </div>
        <button
          onClick={()=> { setOpen(false); setCapture(null); setPadCapture(null) }}
          className="w7-btn w7-btn-primary mt-4 w-full px-4 py-2 font-sans text-[11px] font-bold"
        >
          {t('[ Tutup ]', '[ Close ]')}
        </button>
        </div>
      </div>
      </div>
    )}
    </div>
  )
}
