use std::fs::File;
use std::io::Read;
use std::path::Path;

const MAX_SCAN_BYTES: usize = 24 * 1024 * 1024;

#[inline]
fn is_valid_soi_follow(b: u8) -> bool {
    matches!(b, 0xe0 | 0xe1 | 0xe2 | 0xdb | 0xc0 | 0xc1 | 0xc2 | 0xc4 | 0xfe)
}

fn parse_jpeg_bounds(buf: &[u8], start: usize) -> Option<(usize, u32, u32)> {
    if start + 4 >= buf.len() {
        return None;
    }
    if buf[start] != 0xff || buf[start + 1] != 0xd8 || buf[start + 2] != 0xff {
        return None;
    }
    if !is_valid_soi_follow(buf[start + 3]) {
        return None;
    }

    let mut pos = start + 2;
    let mut width: u32 = 0;
    let mut height: u32 = 0;

    while pos + 4 <= buf.len() {
        if buf[pos] != 0xff {
            return None;
        }
        while pos < buf.len() && buf[pos] == 0xff {
            pos += 1;
        }
        if pos >= buf.len() {
            return None;
        }
        let marker = buf[pos];
        pos += 1;

        if marker == 0xd9 {
            return if width >= 160 && height >= 120 {
                Some((pos, width, height))
            } else {
                None
            };
        }
        if marker == 0x00 || (0xd0..=0xd7).contains(&marker) || marker == 0x01 {
            continue;
        }
        if pos + 2 > buf.len() {
            return None;
        }
        let seg_len = u16::from_be_bytes([buf[pos], buf[pos + 1]]) as usize;
        if seg_len < 2 || pos + seg_len > buf.len() {
            return None;
        }
        if matches!(marker, 0xc0 | 0xc1 | 0xc2) && seg_len >= 7 {
            height = u16::from_be_bytes([buf[pos + 3], buf[pos + 4]]) as u32;
            width = u16::from_be_bytes([buf[pos + 5], buf[pos + 6]]) as u32;
        }
        pos += seg_len;

        if marker == 0xda {
            while pos + 1 < buf.len() {
                let Some(rel) = buf[pos..].iter().position(|&b| b == 0xff) else {
                    return None;
                };
                let ff = pos + rel;
                if ff + 1 >= buf.len() {
                    return None;
                }
                let next = buf[ff + 1];
                if next == 0x00 || (0xd0..=0xd7).contains(&next) || next == 0xff {
                    pos = ff + 2;
                    continue;
                }
                if next == 0xd9 {
                    let end = ff + 2;
                    return if width >= 160 && height >= 120 {
                        Some((end, width, height))
                    } else {
                        None
                    };
                }
                pos = ff;
                break;
            }
        }
    }
    None
}

pub fn extract_embedded_jpeg_from_buffer(buf: &[u8]) -> Option<Vec<u8>> {
    if buf.len() < 16 {
        return None;
    }

    if buf.len() >= 0x5c && &buf[0..15] == b"FUJIFILMCCD-RAW" {
        let offset = u32::from_be_bytes([buf[0x54], buf[0x55], buf[0x56], buf[0x57]]) as usize;
        let length = u32::from_be_bytes([buf[0x58], buf[0x59], buf[0x5a], buf[0x5b]]) as usize;
        if offset > 0 && length > 64 && offset.saturating_add(length) <= buf.len() {
            let slice = &buf[offset..offset + length];
            if slice[0] == 0xff && slice[1] == 0xd8 {
                return Some(slice.to_vec());
            }
        }
    }

    let mut best: Option<(usize, usize, u64)> = None;
    let mut idx = 0usize;
    while idx + 4 < buf.len() {
        let Some(rel) = buf[idx..buf.len() - 3].iter().position(|&b| b == 0xff) else {
            break;
        };
        let soi = idx + rel;
        if buf[soi + 1] == 0xd8 && buf[soi + 2] == 0xff && is_valid_soi_follow(buf[soi + 3]) {
            if let Some((end, w, h)) = parse_jpeg_bounds(buf, soi) {
                let area = (w as u64) * (h as u64);
                if best.map_or(true, |(_, _, b_area)| area > b_area) {
                    best = Some((soi, end, area));
                }
                idx = end;
                continue;
            }
        }
        idx = soi + 1;
    }

    best.map(|(s, e, _)| buf[s..e].to_vec())
}

pub fn extract_raw_preview(path: &Path) -> Option<Vec<u8>> {
    let mut f = File::open(path).ok()?;
    let size = f.metadata().ok()?.len() as usize;
    if size < 16 {
        return None;
    }
    let to_read = size.min(MAX_SCAN_BYTES);
    let mut buf = vec![0u8; to_read];
    let mut read_total = 0usize;
    while read_total < to_read {
        let n = f.read(&mut buf[read_total..]).ok()?;
        if n == 0 {
            break;
        }
        read_total += n;
    }
    buf.truncate(read_total);
    extract_embedded_jpeg_from_buffer(&buf)
}
