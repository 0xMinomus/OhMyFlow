import { useEffect, useRef, useState } from 'react'
import { useStore, appStore, DEFAULT_KEYBINDS } from '@/store/useAppStore'
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
  const binds = useStore(s=>s.keybinds)
  const padbinds = useStore(s=>s.padbinds)
  const padOn = useStore(s=>s.padConnected)
  const [open, setOpen] = useState(false)
  const [capture, setCapture] = useState<'picks' | 'maybe' | 'rejects' | null>(null)
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
      const reserved = ['ESCAPE', 'ARROWLEFT', 'ARROWRIGHT', 'TAB', ' ']
      if (reserved.includes(e.key.toUpperCase())) { setCapture(null); return }
      appStore.setKeybind(capture, e.key.length === 1 ? e.key : e.key)
      setCapture(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capture])
  return (
    <div className="shrink-0 select-none">
    <div className="h-16 flex items-center justify-between px-4 bg-flow-900 border-b border-flow-600" style={{ WebkitAppRegion: 'drag' } as any}>
      <div className="flex items-center gap-2.5 min-w-0">
        <img
          src="logo.png"
          alt="OhMyFlow"
          width={28}
          height={28}
          draggable={false}
          className="w-7 h-7 rounded border border-flow-600 object-cover shrink-0"
          style={{ imageRendering: 'pixelated' }}
        />
        <div className="leading-tight min-w-0">
          <div className="font-mono text-xl font-bold text-white tracking-tight truncate">
            OhMyFlow <span className="text-sm font-normal text-zinc-500">v1.2</span>
          </div>
          <div className="font-mono text-xs text-zinc-500 truncate">Culling made simple.</div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <button
          onClick={()=> { setOpen(o=>!o); setCapture(null); setPadCapture(null) }}
          aria-label={t('Pengaturan', 'Settings')}
          aria-expanded={open}
          className="mr-1 flex items-center justify-center rounded-sm border border-flow-600 px-2 py-1.5 text-zinc-400 transition hover:border-zinc-500 hover:text-white"
        >
          <GearIcon />
        </button>
        <button
          onClick={()=> appStore.setLanguage(lang==='id'?'en':'id')}
          aria-label={lang==='id' ? 'Switch to English' : 'Ganti ke Bahasa Indonesia'}
          className="mr-1 font-mono text-[11px] font-bold border border-flow-600 rounded-sm px-2 py-1 text-zinc-400 hover:text-white hover:border-zinc-500 transition"
        >
          {lang==='id' ? 'EN' : 'ID'}
        </button>
        <button
          onClick={()=> window.ohmyflow.windowControls.minimize()}
          aria-label="Minimize"
          className="w-9 h-8 flex items-center justify-center text-sm text-zinc-400 hover:bg-flow-600 hover:text-white transition"
        >
          ─
        </button>
        <button
          onClick={()=> window.ohmyflow.windowControls.maximize()}
          aria-label="Maximize"
          className="w-9 h-8 flex items-center justify-center text-xs text-zinc-400 hover:bg-flow-600 hover:text-white transition"
        >
          □
        </button>
        <button
          onClick={()=> window.ohmyflow.windowControls.close()}
          aria-label="Close"
          className="w-9 h-8 flex items-center justify-center text-sm text-zinc-400 hover:text-red-400 transition"
        >
          ✕
        </button>
      </div>
    </div>
    {open && (
      <div ref={panelRef} className="border-b border-flow-600 bg-flow-900 px-4 py-3">
        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
          <fieldset className="rounded border border-flow-600 p-3">
            <legend className="px-1 font-mono text-[11px] font-bold tracking-widest text-zinc-300">
              {t('[ KEYBOARD ]', '[ KEYBOARD ]')}
            </legend>
            {(['picks','maybe','rejects'] as const).map(act => (
              <div key={act} className="mb-1.5 flex items-center justify-between gap-2">
                <span className={`h-2 w-2 rounded-full ${act === 'picks' ? 'bg-emerald-400' : act === 'maybe' ? 'bg-amber-300' : 'bg-red-400'}`} aria-hidden="true" />
                <span className="flex-1 font-mono text-[11px] text-zinc-300">
                  {act === 'picks' ? t('Picks', 'Picks') : act === 'maybe' ? t('Maybe', 'Maybe') : t('Reject', 'Reject')}
                </span>
                <button
                  onClick={()=> setCapture(act)}
                  className={`min-w-[3rem] rounded-sm border px-2 py-1 text-center font-mono text-[11px] font-bold transition ${capture === act ? 'border-emerald-400 text-emerald-300' : 'border-flow-700 text-white hover:border-zinc-400'}`}
                >
                  {capture === act ? '…' : binds[act]}
                </button>
              </div>
            ))}
            {capture
              ? <div className="font-mono text-[10px] text-emerald-300">{t('Tekan tombol baru… (Esc batal)', 'Press a new key… (Esc cancels)')}</div>
              : <button
                  onClick={()=> { appStore.resetKeybinds(); setCapture(null) }}
                  className="mt-1 font-mono text-[10px] font-bold text-zinc-500 transition hover:text-white"
                >
                  {t(`[ Reset → ${DEFAULT_KEYBINDS.picks}/${DEFAULT_KEYBINDS.maybe}/${DEFAULT_KEYBINDS.rejects} ]`, `[ Reset → ${DEFAULT_KEYBINDS.picks}/${DEFAULT_KEYBINDS.maybe}/${DEFAULT_KEYBINDS.rejects} ]`)}
                </button>}
          </fieldset>
          <fieldset className="rounded border border-flow-600 p-3">
            <legend className="px-1 font-mono text-[11px] font-bold tracking-widest text-zinc-300">
              {t('[ CONTROLLER ]', '[ CONTROLLER ]')}{' '}
              <span className={padOn ? 'text-emerald-400' : 'text-zinc-600'}>
                {padOn ? '●' : '○'}
              </span>
            </legend>
            {!padOn && (
              <div className="mb-1.5 font-mono text-[10px] text-zinc-500">
                {t('Colok controller + tekan tombol apa saja.', 'Plug in a controller + press any button.')}
              </div>
            )}
            {(['prev','next','picks','maybe','rejects'] as const).map(act => (
              <div key={act} className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex-1 font-mono text-[11px] text-zinc-300">
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
                    ? <span className="inline-flex min-w-[2rem] items-center justify-center rounded-sm border border-emerald-400 px-1.5 py-0.5 font-mono text-[11px] font-bold text-emerald-300">…</span>
                    : <PadButton index={padbinds[act]} kind={kind} />}
                </button>
              </div>
            ))}
            {padCapture
              ? <div className="font-mono text-[10px] text-emerald-300">{t('Tekan tombol controller… (10 dtk)', 'Press controller button… (10s)')}</div>
              : <button
                  onClick={()=> { appStore.resetPadbinds(); setPadCapture(null) }}
                  className="mt-1 font-mono text-[10px] font-bold text-zinc-500 transition hover:text-white"
                >
                  {t('[ Reset bawaan ]', '[ Reset defaults ]')}
                </button>}
          </fieldset>
        </div>
      </div>
    )}
    </div>
  )
}
