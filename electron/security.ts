import { isAbsolute, relative, resolve } from 'path'

export const APP_CSP = [
  "default-src 'self' app:",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' app: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' app:",
  "worker-src 'self' app: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ')

export const ALLOWED_APP_PATHS: Record<string, true> = {
  userData: true,
  temp: true,
  pictures: true,
  desktop: true,
  documents: true,
  downloads: true,
  home: true,
}

/**
 * Resolve URL pathname inside `root` safely (blocks `..`, encoded traversal, and sibling prefixes).
 * Returns null if invalid/outside root.
 */
export function resolveBundlePath(root: string, rawPathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPathname || '/')
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const rel = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '')
  const rootAbs = resolve(root)
  const targetAbs = resolve(rootAbs, rel)
  const diff = relative(rootAbs, targetAbs)
  if (diff === '' || diff === '.') return targetAbs
  if (diff.startsWith('..') || isAbsolute(diff)) return null
  return targetAbs
}

export function isSafeLocalPath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && !p.includes('\0') && isAbsolute(p)
}
