// Chip ikon tombol controller (PS/Xbox/generic). Glif geometris, bukan emoji.
import { padButtonGlyph, type PadKind } from '@/lib/gamepad'

const SHAPES: Record<string, string> = {
  '○': 'rounded-full',
  '△': 'rounded-sm',
  '□': 'rounded-[2px]',
  '✕': 'rounded-sm',
  A: 'rounded-full', B: 'rounded-full', X: 'rounded-full', Y: 'rounded-full',
}

export function PadButton({ index, kind, active }: { index: number; kind: PadKind; active?: boolean }) {
  const g = padButtonGlyph(index, kind)
  const shape = SHAPES[g] ?? 'rounded-sm'
  return (
    <span
      className={`inline-flex min-w-[2rem] items-center justify-center border px-1.5 py-0.5 font-mono text-[11px] font-bold ${shape} ${active ? 'border-emerald-400 text-emerald-300' : 'border-flow-500 text-white'}`}
    >
      {g}
    </span>
  )
}
