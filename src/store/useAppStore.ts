import type { PhotoItem, Sensitivity, CullStats, AppSettings, CullCategory } from '@/types'
import type { Padbinds } from '@/lib/gamepad'
import { DEFAULT_PADBINDS } from '@/lib/gamepad'

type Step = 'select' | 'culling' | 'review'

export interface Keybinds { picks: string; maybe: string; rejects: string; prev: string; next: string }
export const DEFAULT_KEYBINDS: Keybinds = { picks: 'Q', maybe: 'W', rejects: 'E', prev: 'ArrowLeft', next: 'ArrowRight' }

const KEY_ACTIONS = ['picks', 'maybe', 'rejects', 'prev', 'next'] as const
export type KeyAction = typeof KEY_ACTIONS[number]

function loadKeybinds(): Keybinds {
  try {
    const raw = localStorage.getItem('ohmyflow-keybinds')
    if (!raw) return { ...DEFAULT_KEYBINDS }
    const o = JSON.parse(raw)
    const clean = (v: unknown, fb: string) => typeof v === 'string' && v.length > 0 ? v : fb
    return {
      picks: clean(o.picks, 'Q'), maybe: clean(o.maybe, 'W'), rejects: clean(o.rejects, 'E'),
      prev: clean(o.prev, 'ArrowLeft'), next: clean(o.next, 'ArrowRight'),
    }
  } catch {
    return { ...DEFAULT_KEYBINDS }
  }
}

/** Tampilan tombol keyboard (panah jadi glif). */
export function keyGlyph(k: string): string {
  const u = k.toUpperCase()
  if (u === 'ARROWLEFT') return '←'
  if (u === 'ARROWRIGHT') return '→'
  if (u === 'ARROWUP') return '↑'
  if (u === 'ARROWDOWN') return '↓'
  if (u === ' ') return 'Space'
  return k.length === 1 ? k.toUpperCase() : k
}

interface AppState {
  folderPath: string | null
  photos: PhotoItem[]
  sensitivity: Sensitivity
  language: 'id' | 'en'
  step: Step
  cullingProgress: { done:number, total:number, label?:string } | null
  stats: CullStats | null
  selectedCategory: 'all' | 'picks' | 'maybe' | 'rejects'
  keybinds: Keybinds
  padbinds: Padbinds
  padConnected: boolean
  undoStack: { id: string; prev: CullCategory | undefined }[]
  // actions
  setFolder: (p:string|null)=>void
  setPhotos: (p:PhotoItem[])=>void
  setSensitivity: (s:Sensitivity)=>void
  setLanguage: (l:'id'|'en')=>void
  setStep: (s:Step)=>void
  setProgress: (p:{done:number,total:number,label?:string}|null)=>void
  setStats: (s:CullStats|null)=>void
  setCategory: (c:'all'|'picks'|'maybe'|'rejects')=>void
  setKeybind: (a:KeyAction, k:string)=>void
  resetKeybinds: ()=>void
  setPadbind: (a:'picks'|'maybe'|'rejects'|'prev'|'next', b:number)=>void
  resetPadbinds: ()=>void
  setPadConnected: (v:boolean)=>void
  updatePhotoCategory: (id:string, cat: 'picks'|'maybe'|'rejects')=>void
  undoCategory: ()=>boolean
  persistSession: ()=>void
  removePhotos: (ids:string[])=>void
  resetSession: ()=>void
}

function loadPadbinds(): Padbinds {
  try {
    const raw = localStorage.getItem('ohmyflow-padbinds')
    if (!raw) return { ...DEFAULT_PADBINDS }
    const o = JSON.parse(raw)
    const clean = (v: unknown, fb: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 32 ? (v as number) : fb
    return {
      picks: clean(o.picks, 2), maybe: clean(o.maybe, 3), rejects: clean(o.rejects, 1),
      prev: clean(o.prev, 4), next: clean(o.next, 5),
    }
  } catch {
    return { ...DEFAULT_PADBINDS }
  }
}

/** Bahasa + mode culling terakhir; nilai tak dikenal jatuh ke bawaan. */
function loadSettings(): AppSettings {
  const s: AppSettings = { language: 'id', sensitivity: 'balanced' }
  try {
    const lang = localStorage.getItem('ohmyflow-lang')
    if (lang === 'id' || lang === 'en') s.language = lang
    const mode = localStorage.getItem('ohmyflow-mode')
    if (mode === 'fast' || mode === 'balanced' || mode === 'high') s.sensitivity = mode
  } catch {}
  return s
}
const saved = loadSettings()

// simple zustand-like without dep if not installed, fallback
let listeners: (()=>void)[]=[]
let state: AppState = {
  folderPath: null,
  photos: [],
  sensitivity: saved.sensitivity,
  language: saved.language,
  step: 'select',
  cullingProgress: null,
  stats: null,
  selectedCategory: 'all',
  keybinds: loadKeybinds(),
  padbinds: loadPadbinds(),
  undoStack: [],
  padConnected: false,
  setFolder: (p)=>{ state.folderPath=p; emit() },
  setPhotos: (p)=>{ state.photos=p; emit() },
  setSensitivity: (s)=>{ state.sensitivity=s; try { localStorage.setItem('ohmyflow-mode', s) } catch {}; emit() },
  setLanguage: (l)=>{ state.language=l; try { localStorage.setItem('ohmyflow-lang', l) } catch {}; emit() },
  setStep: (s)=>{ state.step=s; emit() },
  setProgress: (p)=>{ state.cullingProgress=p; emit() },
  setStats: (s)=>{ state.stats=s; emit() },
  setCategory: (c)=>{ state.selectedCategory=c; emit() },
  setKeybind: (a,k)=>{
    const key = k.length === 1 ? k.toUpperCase() : k
    // tukar bila bentrok dengan aksi lain (satu tombol = satu aksi)
    const next = { ...state.keybinds } as Keybinds
    for (const act of KEY_ACTIONS) {
      if (act !== a && next[act].toUpperCase() === key.toUpperCase()) next[act] = next[a]
    }
    next[a] = key
    state.keybinds = next
    try { localStorage.setItem('ohmyflow-keybinds', JSON.stringify(next)) } catch {}
    emit()
  },
  resetKeybinds: ()=>{ state.keybinds = { ...DEFAULT_KEYBINDS }; try { localStorage.removeItem('ohmyflow-keybinds') } catch {}; emit() },
  setPadbind: (a,b)=>{
    const next = { ...state.padbinds } as Padbinds
    for (const act of ['picks','maybe','rejects','prev','next'] as const) {
      if (act !== a && next[act] === b) next[act] = next[a]
    }
    next[a] = b
    state.padbinds = next
    try { localStorage.setItem('ohmyflow-padbinds', JSON.stringify(next)) } catch {}
    emit()
  },
  resetPadbinds: ()=>{ state.padbinds = { ...DEFAULT_PADBINDS }; try { localStorage.removeItem('ohmyflow-padbinds') } catch {}; emit() },
  setPadConnected: (v)=>{ state.padConnected=v; emit() },
  updatePhotoCategory: (id, cat)=>{
    const cur = state.photos.find(ph=> ph.id===id)
    if (!cur || cur.category === cat) return
    state.undoStack = [...state.undoStack.slice(-49), { id, prev: cur.category }]
    state.photos = state.photos.map(ph=> ph.id===id? {...ph, category:cat}:ph)
    if (state.stats) state.stats = { ...state.stats, ...countCats(state.photos) }
    emit()
    schedulePersist()
  },
  undoCategory: ()=>{
    if (state.undoStack.length === 0) return false
    const last = state.undoStack[state.undoStack.length - 1]
    state.undoStack = state.undoStack.slice(0, -1)
    state.photos = state.photos.map(ph=> ph.id===last.id? {...ph, category:last.prev}:ph)
    if (state.stats) state.stats = { ...state.stats, ...countCats(state.photos) }
    emit()
    schedulePersist()
    return true
  },
  persistSession: ()=>{ persistNow() },
  removePhotos: (ids)=>{ const gone = new Set(ids); state.photos = state.photos.filter(ph=> !gone.has(ph.id)); state.undoStack = state.undoStack.filter(u=> !gone.has(u.id)); if (state.stats) state.stats = { ...state.stats, total: state.photos.length, ...countCats(state.photos) }; emit(); schedulePersist() },
  resetSession: ()=>{ state.photos = []; state.stats = null; state.folderPath = null; state.step = 'select'; state.selectedCategory = 'all'; state.cullingProgress = null; state.undoStack = []; emit() },
}

function countCats(list: PhotoItem[]) {
  let picks = 0, maybe = 0, rejects = 0
  for (const p of list) {
    if (p.category === 'picks') picks++
    else if (p.category === 'maybe') maybe++
    else if (p.category === 'rejects') rejects++
  }
  return { picks, maybe, rejects }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
function persistNow() {
  if (typeof window === 'undefined' || !window.ohmyflow?.saveSession) return
  if (!state.folderPath || !state.stats || state.photos.length === 0) return
  const payload = {
    version: 1 as const,
    folderPath: state.folderPath,
    sensitivity: state.sensitivity,
    savedAt: Date.now(),
    stats: state.stats,
    items: state.photos.map(p => ({
      fileName: p.fileName,
      size: p.size,
      mtimeMs: p.mtimeMs ?? 0,
      category: p.category,
      score: p.score,
      sharpness: p.sharpness,
      aesthetic: p.aesthetic,
      exposure: p.exposure,
      composition: p.composition,
      confidence: p.confidence,
      eyesClosed: p.eyesClosed,
      reasons: p.reasons,
      reasonsEn: p.reasonsEn,
      reasonCodes: p.reasonCodes,
      isDuplicate: p.isDuplicate,
      duplicateGroup: p.duplicateGroup,
      clusterRank: p.clusterRank,
      clusterSize: p.clusterSize,
      marginToBest: p.marginToBest,
      subjFocus: p.subjFocus,
      hasFace: p.hasFace,
      objMode: p.objMode,
      whiteBg: p.whiteBg,
      eyesState: p.eyesState,
      eyesP: p.eyesP,
    })),
  }
  void window.ohmyflow.saveSession(payload).catch(() => {})
}
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(persistNow, 300)
}
function emit(){ listeners.forEach(l=>l()) }

// For simplicity, we will just import state directly and force update via hook
import { useSyncExternalStore } from 'react'
export function useStore<T>(selector:(s:AppState)=>T): T {
  return useSyncExternalStore(
    (cb)=>{ listeners.push(cb); return ()=>{ listeners = listeners.filter(l=>l!==cb)} },
    ()=> selector(state),
    ()=> selector(state)
  )
}
export const appStore = state
