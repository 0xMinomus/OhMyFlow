import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import type { CullStats, PhotoItem, Sensitivity } from '@/types'

export interface CullOutput {
  photos: PhotoItem[]
  stats: CullStats
  cancelled: boolean
}

export interface MoveResult {
  ok: boolean
  moved: number
  skipped: number
  movedPaths: string[]
  failed: { file: string; error: string }[]
  total: number
  error?: string
}

export interface FolderSession {
  version: number
  folderPath: string
  sensitivity: Sensitivity
  savedAt: number
  stats: CullStats | null
  items: Partial<PhotoItem>[]
}

const mediaOrigin = (() => {
  try {
    return convertFileSrc('x', 'media').replace(/x$/, '')
  } catch {
    return 'media://localhost/'
  }
})()

export function mediaUrl(filePath: string, kind: 'full' | 'thumb' = 'full', mtimeMs?: number): string {
  return `${mediaOrigin}?path=${encodeURIComponent(filePath)}&kind=${kind}&v=${Math.round(mtimeMs || 0)}`
}

export interface OhMyFlowBridge {
  openFolder: () => Promise<string | null>
  scanFolder: (folderPath: string) => Promise<PhotoItem[]>
  cullPhotos: (
    items: PhotoItem[],
    mode: Sensitivity,
    onProgress?: (done: number, total: number) => void,
  ) => Promise<CullOutput>
  cancelCull: () => Promise<void>
  clearThumbCache: () => Promise<{ ok: boolean; cleared: { thumbs: number; analysis: number }; error?: string }>
  movePhotos: (
    items: { filePath: string; pairedPath?: string; sub?: string }[],
    destDir: string,
  ) => Promise<MoveResult>
  showInFolder: (filePath: string) => Promise<void>
  openPath: (filePath: string) => Promise<void>
  loadSession: (folderPath: string) => Promise<FolderSession | null>
  saveSession: (session: FolderSession) => Promise<boolean>
  windowControls: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
  }
}

declare global {
  interface Window {
    ohmyflow: OhMyFlowBridge
  }
}

export function installTauriBridge() {
  if (typeof window === 'undefined' || window.ohmyflow) return

  const bridge: OhMyFlowBridge = {
    async openFolder() {
      const res = await open({ directory: true, multiple: false })
      return typeof res === 'string' ? res : null
    },
    scanFolder(folderPath: string) {
      return invoke<PhotoItem[]>('scan_folder_cmd', { folderPath })
    },
    async cullPhotos(items, mode, onProgress) {
      const unlisten = onProgress
        ? await listen<{ done: number; total: number }>('cull:progress', (ev) => {
            onProgress(ev.payload.done, ev.payload.total)
          })
        : null
      try {
        return await invoke<CullOutput>('cull_photos_cmd', { items, mode })
      } finally {
        if (unlisten) unlisten()
      }
    },
    cancelCull() {
      return invoke<void>('cancel_cull_cmd')
    },
    clearThumbCache() {
      return invoke('clear_thumb_cache_cmd')
    },
    movePhotos(items, destDir) {
      return invoke<MoveResult>('move_photos_cmd', { items, destDir })
    },
    showInFolder(filePath: string) {
      return invoke<void>('show_in_folder_cmd', { filePath })
    },
    openPath(filePath: string) {
      return invoke<void>('open_path_cmd', { filePath })
    },
    loadSession(folderPath: string) {
      return invoke<FolderSession | null>('load_session_cmd', { folderPath })
    },
    saveSession(session: FolderSession) {
      return invoke<boolean>('save_session_cmd', { session })
    },
    windowControls: {
      minimize: () => getCurrentWindow().minimize(),
      maximize: () => getCurrentWindow().toggleMaximize(),
      close: () => getCurrentWindow().close(),
    },
  }

  window.ohmyflow = bridge
}
