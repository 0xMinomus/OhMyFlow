import type { PhotoItem, Sensitivity, CullStats } from '@/types'
import type { Padbinds } from '@/lib/gamepad'
import { DEFAULT_PADBINDS } from '@/lib/gamepad'

type Step = 'select' | 'culling' | 'review'

export interface Keybinds { picks: string; maybe: string; rejects: string }
export const DEFAULT_KEYBINDS: Keybinds = { picks: 'Q', maybe: 'W', rejects: 'E' }

function loadKeybinds(): Keybinds {
  try {
    const raw = localStorage.getItem('ohmyflow-keybinds')
    if (!raw) return { ...DEFAULT_KEYBINDS }
    const o = JSON.parse(raw)
    const clean = (v: unknown, fb: string) => typeof v === 'string' && v.length > 0 ? v.toUpperCase() : fb
    return { picks: clean(o.picks, 'Q'), maybe: clean(o.maybe, 'W'), rejects: clean(o.rejects, 'E') }
  } catch {
    return { ...DEFAULT_KEYBINDS }
  }
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
  // actions
  setFolder: (p:string|null)=>void
  setPhotos: (p:PhotoItem[])=>void
  setSensitivity: (s:Sensitivity)=>void
  setLanguage: (l:'id'|'en')=>void
  setStep: (s:Step)=>void
  setProgress: (p:{done:number,total:number,label?:string}|null)=>void
  setStats: (s:CullStats|null)=>void
  setCategory: (c:'all'|'picks'|'maybe'|'rejects')=>void
  setKeybind: (a:'picks'|'maybe'|'rejects', k:string)=>void
  resetKeybinds: ()=>void
  setPadbind: (a:'picks'|'maybe'|'rejects'|'prev'|'next', b:number)=>void
  resetPadbinds: ()=>void
  setPadConnected: (v:boolean)=>void
  updatePhotoCategory: (id:string, cat: 'picks'|'maybe'|'rejects')=>void
  removePhotos: (ids:string[])=>void
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

// simple zustand-like without dep if not installed, fallback
let listeners: (()=>void)[]=[]
let state: AppState = {
  folderPath: null,
  photos: [],
  sensitivity: 'balanced',
  language: 'id',
  step: 'select',
  cullingProgress: null,
  stats: null,
  selectedCategory: 'all',
  keybinds: loadKeybinds(),
  padbinds: loadPadbinds(),
  padConnected: false,
  setFolder: (p)=>{ state.folderPath=p; emit() },
  setPhotos: (p)=>{ state.photos=p; emit() },
  setSensitivity: (s)=>{ state.sensitivity=s; emit() },
  setLanguage: (l)=>{ state.language=l; emit() },
  setStep: (s)=>{ state.step=s; emit() },
  setProgress: (p)=>{ state.cullingProgress=p; emit() },
  setStats: (s)=>{ state.stats=s; emit() },
  setCategory: (c)=>{ state.selectedCategory=c; emit() },
  setKeybind: (a,k)=>{
    const key = k.toUpperCase()
    // tukar bila bentrok dengan aksi lain (satu tombol = satu aksi)
    const next = { ...state.keybinds } as Keybinds
    for (const act of ['picks','maybe','rejects'] as const) {
      if (act !== a && next[act] === key) next[act] = next[a]
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
  updatePhotoCategory: (id, cat)=>{ state.photos = state.photos.map(ph=> ph.id===id? {...ph, category:cat}:ph); if (state.stats) { const rest = state.photos; state.stats = { ...state.stats, picks: rest.filter(p=>p.category==='picks').length, maybe: rest.filter(p=>p.category==='maybe').length, rejects: rest.filter(p=>p.category==='rejects').length } } emit() },
  removePhotos: (ids)=>{ const gone = new Set(ids); state.photos = state.photos.filter(ph=> !gone.has(ph.id)); if (state.stats) { const rest = state.photos; state.stats = { ...state.stats, total: rest.length, picks: rest.filter(p=>p.category==='picks').length, maybe: rest.filter(p=>p.category==='maybe').length, rejects: rest.filter(p=>p.category==='rejects').length } } emit() },
}
function emit(){ listeners.forEach(l=>l()) }

export function useAppStore(): AppState {
  // This is a minimal store without zustand dep - we manage via useSyncExternalStore
  return state
}
export function useAppStoreSelector<T>(sel:(s:AppState)=>T): T {
  const { useSyncExternalStore } = require('react')
  return useSyncExternalStore(
    (cb:()=>void)=>{ listeners.push(cb); return ()=>{ listeners = listeners.filter(l=>l!==cb)} },
    ()=> sel(state),
    ()=> sel(state)
  )
}
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
