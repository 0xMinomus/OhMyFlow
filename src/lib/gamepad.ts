// Gamepad polling (PS/Xbox/generic) — tanpa dependensi (Gamepad API bawaan).
// Dipakai Lightbox saja: prev/next + rate. Edge-detect + debounce agar satu
// tekan = satu aksi. Tanpa controller = diam, tanpa crash.

export type PadAction = 'picks' | 'maybe' | 'rejects' | 'prev' | 'next'

export interface Padbinds {
  picks: number
  maybe: number
  rejects: number
  prev: number
  next: number
}

// Indices mapping standar: Silang=0 Lingkaran=1 Kotak=2 Segitiga=3 L1=4 R1=5.
export const DEFAULT_PADBINDS: Padbinds = { picks: 2, maybe: 3, rejects: 1, prev: 4, next: 5 }

const PS_NAMES: Record<number, string> = {
  0: 'Silang', 1: 'Lingkaran', 2: 'Kotak', 3: 'Segitiga', 4: 'L1', 5: 'R1',
  6: 'L2', 7: 'R2', 8: 'Share', 9: 'Options', 10: 'L3', 11: 'R3',
  12: 'Atas', 13: 'Bawah', 14: 'Kiri', 15: 'Kanan', 16: 'PS',
}

export function padButtonName(i: number): string {
  return PS_NAMES[i] ?? `T${i}`
}

export type PadKind = 'ps' | 'xbox' | 'generic'

/** Tebak jenis controller dari id Gamepad API (Xbox 045e, Sony 054c, dsb). */
export function padKind(id: string | undefined): PadKind {
  const s = (id ?? '').toLowerCase()
  if (s.includes('xbox') || s.includes('045e') || s.includes('x-input')) return 'xbox'
  if (s.includes('playstation') || s.includes('054c') || s.includes('dualshock') || s.includes('dualsense') || s.includes('sony')) return 'ps'
  return 'generic'
}

// Glif tombol per jenis controller (bentuk geometris/teks, bukan emoji).
const PS_GLYPHS: Record<number, string> = {
  0: '✕', 1: '○', 2: '□', 3: '△', 4: 'L1', 5: 'R1',
  6: 'L2', 7: 'R2', 8: 'SHARE', 9: 'OPT', 10: 'L3', 11: 'R3',
  12: '▲', 13: '▼', 14: '◀', 15: '▶', 16: 'PS',
}
const XBOX_GLYPHS: Record<number, string> = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB',
  6: 'LT', 7: 'RT', 8: 'VIEW', 9: 'MENU', 10: 'LS', 11: 'RS',
  12: '▲', 13: '▼', 14: '◀', 15: '▶', 16: 'XBOX',
}

export function padButtonGlyph(i: number, kind: PadKind): string {
  const map = kind === 'xbox' ? XBOX_GLYPHS : PS_GLYPHS
  return map[i] ?? `T${i}`
}

export function firstPad(): Gamepad | null {
  try {
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    for (const p of pads) {
      if (p && p.connected) return p
    }
  } catch {}
  return null
}

/** Polling helper: panggil tiap frame; kembalikan aksi yang baru ditekan. */
export function createPadPoller(binds: () => Padbinds, debounceMs = 250) {
  let prev: boolean[] = []
  let lastFire = 0
  return (): PadAction | null => {
    const pad = firstPad()
    if (!pad) { prev = []; return null }
    const b = binds()
    const now = performance.now()
    const pressed = pad.buttons.map((x) => x.pressed)
    let hit: PadAction | null = null
    const check = (idx: number, act: PadAction) => {
      if (hit) return
      if (pressed[idx] && !prev[idx] && now - lastFire >= debounceMs) {
        hit = act
        lastFire = now
      }
    }
    check(b.prev, 'prev')
    check(b.next, 'next')
    check(b.picks, 'picks')
    check(b.maybe, 'maybe')
    check(b.rejects, 'rejects')
    prev = pressed
    return hit
  }
}

/** Tunggu satu tombol controller ditekan (untuk custom bind). Timeout 10 detik. */
export function waitPadButton(timeoutMs = 10000): Promise<number | null> {
  return new Promise((resolve) => {
    const t0 = performance.now()
    let settled = false
    const done = (v: number | null) => { if (!settled) { settled = true; resolve(v) } }
    const tick = () => {
      if (settled) return
      if (performance.now() - t0 > timeoutMs) { done(null); return }
      const pad = firstPad()
      if (pad) {
        const i = pad.buttons.findIndex((x) => x.pressed)
        if (i >= 0) { done(i); return }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}
