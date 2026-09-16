import { useStore, appStore } from '@/store/useAppStore'

export function Header() {
  const lang = useStore(s=>s.language)
  return (
    <div className="h-16 flex items-center justify-between px-4 bg-flow-900 border-b border-flow-600 select-none shrink-0" style={{ WebkitAppRegion: 'drag' } as any}>
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
            OhMyFlow <span className="text-sm font-normal text-zinc-500">v1.0</span>
          </div>
          <div className="font-mono text-xs text-zinc-500 truncate">Culling made simple.</div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
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
  )
}
