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
      className={`w7-btn inline-flex min-w-[2rem] items-center justify-center px-1.5 py-0.5 font-sans text-[11px] font-bold ${shape} ${active ? 'w7-btn-primary' : ''}`}
    >
      {g}
    </span>
  )
}
