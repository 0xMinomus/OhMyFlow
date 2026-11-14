use fast_image_resize::images::Image as FirImage;
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::{flip_horizontal, flip_vertical, rotate180, rotate270, rotate90};
use image::{DynamicImage, ImageReader};
use std::io::Cursor;
use std::path::Path;

use super::raw_preview::extract_raw_preview;

pub const RAW_EXTS: &[&str] = &[
    "cr2", "cr3", "nef", "arw", "raf", "dng", "rw2", "orf", "pef",
];

#[inline]
pub fn is_raw_ext(ext_no_dot_lower: &str) -> bool {
    RAW_EXTS.contains(&ext_no_dot_lower)
}

#[derive(Clone)]
pub struct RgbaImageBuf {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

fn read_exif_orientation(bytes: &[u8]) -> u32 {
    let mut cursor = Cursor::new(bytes);
    let Ok(exif_data) = exif::Reader::new().read_from_container(&mut cursor) else {
        return 1;
    };
    exif_data
        .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .unwrap_or(1)
}

fn apply_orientation(img: DynamicImage, orient: u32) -> DynamicImage {
    match orient {
        2 => DynamicImage::ImageRgba8(flip_horizontal(&img)),
        3 => DynamicImage::ImageRgba8(rotate180(&img)),
        4 => DynamicImage::ImageRgba8(flip_vertical(&img)),
        5 => {
            let r = rotate90(&img);
            DynamicImage::ImageRgba8(flip_horizontal(&r))
        }
        6 => DynamicImage::ImageRgba8(rotate90(&img)),
        7 => {
            let r = rotate270(&img);
            DynamicImage::ImageRgba8(flip_horizontal(&r))
        }
        8 => DynamicImage::ImageRgba8(rotate270(&img)),
        _ => img,
    }
}

pub fn load_image_bytes(path: &Path) -> Option<Vec<u8>> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if is_raw_ext(&ext) {
        extract_raw_preview(path)
    } else {
        std::fs::read(path).ok()
    }
}

pub fn decode_oriented_dynamic(bytes: &[u8]) -> Option<DynamicImage> {
    let orient = read_exif_orientation(bytes);
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let decoded = reader.decode().ok()?;
    Some(apply_orientation(decoded, orient))
}

pub fn resize_dynamic_to_rgba(img: &DynamicImage, max_side: u32) -> Option<RgbaImageBuf> {
    let sw = img.width();
    let sh = img.height();
    if sw == 0 || sh == 0 {
        return None;
    }
    let (dw, dh) = if sw > max_side || sh > max_side {
        let s = (max_side as f64 / sw as f64).min(max_side as f64 / sh as f64);
        (
            (sw as f64 * s).round().max(2.0) as u32,
            (sh as f64 * s).round().max(2.0) as u32,
        )
    } else {
        (sw, sh)
    };

    let rgba = img.to_rgba8();
    if dw == sw && dh == sh {
        return Some(RgbaImageBuf {
            data: rgba.into_raw(),
            width: sw,
            height: sh,
        });
    }

    let src = FirImage::from_vec_u8(sw, sh, rgba.into_raw(), PixelType::U8x4).ok()?;
    let mut dst = FirImage::new(dw, dh, PixelType::U8x4);
    let mut resizer = Resizer::new();
    let opts = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Bilinear));
    resizer.resize(&src, &mut dst, &opts).ok()?;
    Some(RgbaImageBuf {
        data: dst.into_vec(),
        width: dw,
        height: dh,
    })
}

pub fn downsample_rgba(src: &RgbaImageBuf, max_side: u32) -> RgbaImageBuf {
    let sw = src.width;
    let sh = src.height;
    if sw <= max_side && sh <= max_side {
        return src.clone();
    }
    let s = (max_side as f64 / sw as f64).min(max_side as f64 / sh as f64);
    let dw = (sw as f64 * s).round().max(2.0) as u32;
    let dh = (sh as f64 * s).round().max(2.0) as u32;
    let mut out = vec![0u8; (dw * dh * 4) as usize];
    let sd = &src.data;
    let x_ratio = (sw as f64 - 1.0) / (dw.max(2) - 1) as f64;
    let y_ratio = (sh as f64 - 1.0) / (dh.max(2) - 1) as f64;
    for y in 0..dh {
        let gy = y as f64 * y_ratio;
        let y0 = gy.floor() as u32;
        let y1 = (y0 + 1).min(sh - 1);
        let fy = gy - y0 as f64;
        let iy = 1.0 - fy;
        for x in 0..dw {
            let gx = x as f64 * x_ratio;
            let x0 = gx.floor() as u32;
            let x1 = (x0 + 1).min(sw - 1);
            let fx = gx - x0 as f64;
            let ix = 1.0 - fx;
            let w00 = ix * iy;
            let w10 = fx * iy;
            let w01 = ix * fy;
            let w11 = fx * fy;
            let i00 = ((y0 * sw + x0) * 4) as usize;
            let i10 = ((y0 * sw + x1) * 4) as usize;
            let i01 = ((y1 * sw + x0) * 4) as usize;
            let i11 = ((y1 * sw + x1) * 4) as usize;
            let o = ((y * dw + x) * 4) as usize;
            for c in 0..3 {
                let v = sd[i00 + c] as f64 * w00
                    + sd[i10 + c] as f64 * w10
                    + sd[i01 + c] as f64 * w01
                    + sd[i11 + c] as f64 * w11;
                out[o + c] = v.round().clamp(0.0, 255.0) as u8;
            }
            out[o + 3] = 255;
        }
    }
    RgbaImageBuf {
        data: out,
        width: dw,
        height: dh,
    }
}

pub fn encode_jpeg_thumbnail(path: &Path, max_side: u32, quality: u8) -> Option<Vec<u8>> {
    let raw = load_image_bytes(path)?;
    let dyn_img = decode_oriented_dynamic(&raw)?;
    let rgba = resize_dynamic_to_rgba(&dyn_img, max_side)?;
    let mut rgb = Vec::with_capacity((rgba.width * rgba.height * 3) as usize);
    for px in rgba.data.chunks_exact(4) {
        rgb.push(px[0]);
        rgb.push(px[1]);
        rgb.push(px[2]);
    }
    let mut out = Vec::with_capacity(32 * 1024);
    let mut enc = JpegEncoder::new_with_quality(&mut out, quality);
    enc.encode(&rgb, rgba.width, rgba.height, image::ExtendedColorType::Rgb8)
        .ok()?;
    Some(out)
}
