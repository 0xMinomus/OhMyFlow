import { open } from 'fs/promises'

const MAX_SCAN_BYTES = 24 * 1024 * 1024
const VALID_SOI_FOLLOW = new Set([0xe0, 0xe1, 0xe2, 0xdb, 0xc0, 0xc1, 0xc2, 0xc4, 0xfe])

function parseJpegBounds(
  buf: Buffer,
  start: number,
): { end: number; width: number; height: number } | null {
  if (start + 4 >= buf.length) return null
  if (buf[start] !== 0xff || buf[start + 1] !== 0xd8 || buf[start + 2] !== 0xff) return null
  if (!VALID_SOI_FOLLOW.has(buf[start + 3])) return null

  let pos = start + 2
  let width = 0
  let height = 0

  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) return null
    while (pos < buf.length && buf[pos] === 0xff) pos++
    if (pos >= buf.length) return null
    const marker = buf[pos++]

    if (marker === 0xd9) {
      return width >= 160 && height >= 120 ? { end: pos, width, height } : null
    }
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue

    if (pos + 2 > buf.length) return null
    const segLen = buf.readUInt16BE(pos)
    if (segLen < 2 || pos + segLen > buf.length) return null

    if ((marker === 0xc0 || marker === 0xc1 || marker === 0xc2) && segLen >= 7) {
      height = buf.readUInt16BE(pos + 3)
      width = buf.readUInt16BE(pos + 5)
    }

    pos += segLen

    if (marker === 0xda) {
      // Entropy-coded scan: advance past byte-stuffed 0xFF00 and RST0..7 until EOI (0xFFD9).
      while (pos + 1 < buf.length) {
        const ff = buf.indexOf(0xff, pos)
        if (ff === -1 || ff + 1 >= buf.length) return null
        const next = buf[ff + 1]
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
          pos = ff + 2
          continue
        }
        if (next === 0xd9) {
          const end = ff + 2
          return width >= 160 && height >= 120 ? { end, width, height } : null
        }
        // Another marker (e.g. progressive JPEG multiple SOS / DQT / DHT)
        pos = ff
        break
      }
    }
  }
  return null
}

/**
 * Extract largest embedded JPEG preview from a pure-JS Buffer (RAF header or JPEG marker scan).
 */
export function extractEmbeddedJpegFromBuffer(buf: Buffer): Buffer | null {
  if (buf.length < 16) return null

  // Fujifilm RAF header: "FUJIFILMCCD-RAW " + JPEG offset@0x54 + length@0x58
  if (buf.length >= 0x5c && buf.subarray(0, 15).toString('ascii') === 'FUJIFILMCCD-RAW') {
    const offset = buf.readUInt32BE(0x54)
    const length = buf.readUInt32BE(0x58)
    if (offset > 0 && length > 64 && offset + length <= buf.length) {
      const slice = buf.subarray(offset, offset + length)
      if (slice[0] === 0xff && slice[1] === 0xd8) return Buffer.from(slice)
    }
  }

  let bestStart = -1
  let bestEnd = -1
  let bestArea = 0

  let idx = 0
  while (idx < buf.length - 4) {
    const soi = buf.indexOf(0xff, idx)
    if (soi === -1 || soi + 3 >= buf.length) break
    if (buf[soi + 1] === 0xd8 && buf[soi + 2] === 0xff && VALID_SOI_FOLLOW.has(buf[soi + 3])) {
      const parsed = parseJpegBounds(buf, soi)
      if (parsed) {
        const area = parsed.width * parsed.height
        if (area > bestArea) {
          bestArea = area
          bestStart = soi
          bestEnd = parsed.end
        }
        idx = parsed.end
        continue
      }
    }
    idx = soi + 1
  }

  return bestStart >= 0 && bestEnd > bestStart
    ? Buffer.from(buf.subarray(bestStart, bestEnd))
    : null
}

/**
 * Extract the largest embedded JPEG preview from a RAW file without external binaries.
 * Returns null if no valid preview >= 160x120 exists.
 */
export async function extractRawPreview(filePath: string): Promise<Buffer | null> {
  const fh = await open(filePath, 'r')
  try {
    const st = await fh.stat()
    if (st.size < 16) return null
    const len = Math.min(st.size, MAX_SCAN_BYTES)
    const buf = Buffer.allocUnsafe(len)
    let offset = 0
    while (offset < len) {
      const { bytesRead } = await fh.read(buf, offset, len - offset, offset)
      if (bytesRead <= 0) break
      offset += bytesRead
    }
    return extractEmbeddedJpegFromBuffer(offset === len ? buf : buf.subarray(0, offset))
  } finally {
    await fh.close()
  }
}
