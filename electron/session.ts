import { createHash } from 'crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { join, resolve } from 'path'

export interface PersistedPhotoPatch {
  fileName: string
  size: number
  mtimeMs: number
  category?: 'picks' | 'maybe' | 'rejects'
  score?: number
  sharpness?: number
  aesthetic?: number
  exposure?: number
  composition?: number
  confidence?: number
  eyesClosed?: boolean
  reasons?: string[]
  reasonsEn?: string[]
  reasonCodes?: string[]
  isDuplicate?: boolean
  duplicateGroup?: string
  clusterRank?: number
  clusterSize?: number
  marginToBest?: number
  subjFocus?: number | null
  hasFace?: boolean
  objMode?: boolean
  whiteBg?: boolean
  eyesState?: string
  eyesP?: number
}

export interface FolderSession {
  version: 1
  folderPath: string
  sensitivity: 'fast' | 'balanced' | 'high'
  savedAt: number
  stats: {
    total: number
    picks: number
    maybe: number
    rejects: number
    durationMs: number
    throughputPerMin: number
    thumbNull?: number
    featNull?: number
  } | null
  items: PersistedPhotoPatch[]
}

export function sessionFilePath(sessionsDir: string, folderPath: string): string {
  const key = createHash('md5').update(resolve(folderPath)).digest('hex')
  return join(sessionsDir, key + '.json')
}

export async function saveFolderSession(sessionsDir: string, session: FolderSession): Promise<boolean> {
  try {
    await mkdir(sessionsDir, { recursive: true })
    const dest = sessionFilePath(sessionsDir, session.folderPath)
    const tmp = dest + '.tmp'
    await writeFile(tmp, JSON.stringify(session), 'utf-8')
    await rename(tmp, dest)
    return true
  } catch {
    try { await unlink(sessionFilePath(sessionsDir, session.folderPath) + '.tmp') } catch {}
    return false
  }
}

export async function loadFolderSession(sessionsDir: string, folderPath: string): Promise<FolderSession | null> {
  try {
    const raw = await readFile(sessionFilePath(sessionsDir, folderPath), 'utf-8')
    const parsed = JSON.parse(raw) as FolderSession
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) return null
    return parsed
  } catch {
    return null
  }
}
