import { appStore, useStore } from '@/store/useAppStore'
import type { Sensitivity } from '@/types'

export interface ModeInfo {
  id: Sensitivity
  name: string
  descId: string
  descEn: string
  paceId: string
  paceEn: string
  throughputPerMin: number
}

export const SENSITIVITY_MODES: ModeInfo[] = [
  {
    id: 'fast', name: 'Fast',
    descId: 'Sortir awal. Hanya foto yang jelas gagal yang dibuang.',
    descEn: 'First pass. Only clearly failed shots are rejected.',
    paceId: 'Tercepat', paceEn: 'Fastest',
    throughputPerMin: 900,
  },
  {
    id: 'balanced', name: 'Balance',
    descId: 'Seimbang untuk harian. Hasil penuh Picks / Maybe / Rejects.',
    descEn: 'Balanced for daily use. Full Picks / Maybe / Rejects.',
    paceId: 'Standar', paceEn: 'Standard',
    throughputPerMin: 500,
  },
  {
    id: 'high', name: 'High',
    descId: 'Seleksi akhir. Blur, komposisi lemah, dan duplikat ikut tertangkap.',
    descEn: 'Final selection. Blur, weak composition, and duplicates get caught.',
    paceId: 'Paling teliti', paceEn: 'Most thorough',
    throughputPerMin: 250,
  },
]

export function estimateDuration(count: number, throughputPerMin: number, lang: 'id' | 'en'): string {
  if (count <= 0 || throughputPerMin <= 0) return '—'
  const secs = Math.max(3, Math.round((count / throughputPerMin) * 60))
  if (secs < 90) return lang==='id' ? `±${secs} dtk` : `±${secs}s`
  const mins = Math.max(1, Math.round(secs / 60))
  return lang==='id' ? `±${mins} mnt` : `±${mins} min`
}

export function SensitivitySelector() {
  const mode = useStore(s=>s.sensitivity)
  const lang = useStore(s=>s.language)
  const photoCount = useStore(s=>s.photos.length)

  return (
    <div className="grid md:grid-cols-3 gap-3">
      {SENSITIVITY_MODES.map(m=>(
        <button
          key={m.id}
          onClick={()=> appStore.setSensitivity(m.id)}
          aria-pressed={mode===m.id}
          className={`rounded-sm border p-3.5 text-left transition min-h-[92px] ${
            mode===m.id
              ? 'bg-flow-800 border-emerald-500'
              : 'bg-flow-800 border-flow-600 hover:border-zinc-500'
          }`}
        >
          <div className="flex items-center gap-2 font-mono text-sm font-bold leading-none">
            <span aria-hidden="true" className={mode===m.id ? 'text-emerald-400' : 'text-zinc-600'}>
              {mode===m.id ? '[●]' : '[ ]'}
            </span>
            <span className="text-white">{m.name}</span>
          </div>
          <div className="font-mono text-[11px] mt-2 leading-snug text-zinc-400">
            {lang==='id' ? m.descId : m.descEn}
          </div>
          <div className="mt-2 font-mono text-[11px] tabular-nums text-zinc-500">
            {estimateDuration(photoCount, m.throughputPerMin, lang)} · {photoCount} {lang==='id' ? 'foto' : 'photos'} · {lang==='id' ? m.paceId : m.paceEn}
          </div>
        </button>
      ))}
    </div>
  )
}
