import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('ohmyflow', {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  scanFolder: (folderPath: string): Promise<any[]> => ipcRenderer.invoke('fs:scanFolder', folderPath),
  readImageAsDataUrl: (filePath: string): Promise<any> => ipcRenderer.invoke('fs:readImageAsDataUrl', filePath),
  getThumbnail: (filePath: string, previewPath?: string): Promise<any> => ipcRenderer.invoke('fs:getThumbnail', filePath, previewPath),
  getThumbnailsBatch: (items: { filePath: string, previewPath?: string }[]): Promise<any> => ipcRenderer.invoke('fs:getThumbnailsBatch', items),
  getAnalysisBatch: (items: { filePath: string, previewPath?: string }[], maxSide?: number): Promise<any> => ipcRenderer.invoke('fs:getAnalysisBatch', items, maxSide),
  clearThumbCache: (): Promise<any> => ipcRenderer.invoke('fs:clearThumbCache'),
  writeXmp: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeXmp', filePath, content),
  writeXmpsBulk: (items: any[]) => ipcRenderer.invoke('fs:writeXmpsBulk', items),
  movePhotos: (items: { filePath: string, pairedPath?: string }[], destDir: string): Promise<any> => ipcRenderer.invoke('fs:movePhotos', { items, destDir }),
  showInFolder: (filePath: string) => ipcRenderer.invoke('shell:showInFolder', filePath),
  openPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
  windowControls: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
  },
})

declare global {
  interface Window {
    ohmyflow: {
      openFolder: () => Promise<string | null>
      scanFolder: (p: string) => Promise<any[]>
      readImageAsDataUrl: (p: string) => Promise<{ dataUrl: string | null, isRaw: boolean, ext?: string, error?: string }>
      getThumbnail: (filePath: string, previewPath?: string) => Promise<{ dataUrl: string | null, isRaw?: boolean, cached?: boolean, ext?: string, error?: string }>
      getThumbnailsBatch: (items: { filePath: string, previewPath?: string }[]) => Promise<Record<string, { dataUrl: string | null, isRaw?: boolean, error?: string }>>
      getAnalysisBatch: (items: { filePath: string, previewPath?: string }[], maxSide?: number) => Promise<Record<string, { dataUrl: string | null, isRaw?: boolean, error?: string }>>
      clearThumbCache: () => Promise<{ ok: boolean, cleared?: number, error?: string }>
      writeXmp: (p: string, c: string) => Promise<any>
      writeXmpsBulk: (items: any[]) => Promise<{ ok: number, total: number }>
      movePhotos: (items: { filePath: string, pairedPath?: string, sub?: string }[], destDir: string) => Promise<{ ok: boolean, moved: number, movedPaths: string[], failed: { file: string, error: string }[], total: number, error?: string }>
      showInFolder: (p: string) => Promise<void>
      openPath: (p: string) => Promise<void>
      getPath: (n: string) => Promise<string>
      windowControls: {
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        close: () => Promise<void>
      }
    }
  }
}
