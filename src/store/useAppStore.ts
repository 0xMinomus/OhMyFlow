import type { PhotoItem, Sensitivity, CullStats } from '@/types'

type Step = 'select' | 'culling' | 'review'

interface AppState {
  folderPath: string | null
  photos: PhotoItem[]
  sensitivity: Sensitivity
  language: 'id' | 'en'
  step: Step
  cullingProgress: { done:number, total:number } | null
  stats: CullStats | null
  selectedCategory: 'all' | 'picks' | 'maybe' | 'rejects'
  // actions
  setFolder: (p:string|null)=>void
  setPhotos: (p:PhotoItem[])=>void
  setSensitivity: (s:Sensitivity)=>void
  setLanguage: (l:'id'|'en')=>void
  setStep: (s:Step)=>void
  setProgress: (p:{done:number,total:number}|null)=>void
  setStats: (s:CullStats|null)=>void
  setCategory: (c:'all'|'picks'|'maybe'|'rejects')=>void
  updatePhotoCategory: (id:string, cat: 'picks'|'maybe'|'rejects')=>void
  removePhotos: (ids:string[])=>void
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
  setFolder: (p)=>{ state.folderPath=p; emit() },
  setPhotos: (p)=>{ state.photos=p; emit() },
  setSensitivity: (s)=>{ state.sensitivity=s; emit() },
  setLanguage: (l)=>{ state.language=l; emit() },
  setStep: (s)=>{ state.step=s; emit() },
  setProgress: (p)=>{ state.cullingProgress=p; emit() },
  setStats: (s)=>{ state.stats=s; emit() },
  setCategory: (c)=>{ state.selectedCategory=c; emit() },
  updatePhotoCategory: (id, cat)=>{ state.photos = state.photos.map(ph=> ph.id===id? {...ph, category:cat}:ph); emit() },
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
