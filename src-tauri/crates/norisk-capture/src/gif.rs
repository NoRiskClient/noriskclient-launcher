use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use ffmpeg_next::ffi as ff;

use crate::render::{Decoder, Frame};

const MAX_WIDTH: u32 = 400;
const TARGET_FPS: u32 = 12;
const MAX_SECONDS: u32 = 10;
const QUANTISE_SPEED: i32 = 10;

#[derive(Debug, Clone)]
pub struct GifResult {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub frames: u32,
    pub duration_seconds: f64,
    pub size_bytes: u64,
    pub truncated: bool,
}

fn fit(width: u32, height: u32) -> (u32, u32) {
    if width <= MAX_WIDTH {
        return (width.max(1), height.max(1));
    }
    let scaled = (height as u64 * MAX_WIDTH as u64 / width.max(1) as u64) as u32;
    (MAX_WIDTH, scaled.max(1))
}

pub fn to_gif(
    source: &Path,
    destination: &Path,
    progress: impl Fn(u32, u32),
) -> Result<GifResult> {
    let clip = crate::trim::read(source)?;

    let source_fps = clip.track.fps.max(1);
    let keep_every = (source_fps as f64 / TARGET_FPS as f64).round().max(1.0) as usize;
    let fps = source_fps as f64 / keep_every as f64;
    let delay = ((100.0 / fps).round() as u16).max(2);
    let budget = (fps * MAX_SECONDS as f64).ceil() as u32;

    let (width, height) = fit(clip.track.width, clip.track.height);

    log::info!(
        "Turning {} ({}x{} at {source_fps} fps) into a {width}x{height} GIF, every {keep_every}. frame",
        source.display(),
        clip.track.width,
        clip.track.height,
    );

    let file = std::fs::File::create(destination)
        .with_context(|| format!("could not create {}", destination.display()))?;
    let mut writer = std::io::BufWriter::new(file);
    let mut encoder = gif::Encoder::new(&mut writer, width as u16, height as u16, &[])
        .context("could not start the GIF")?;
    encoder
        .set_repeat(gif::Repeat::Infinite)
        .context("could not mark the GIF as looping")?;

    let mut decoder = Decoder::open(&clip.track)?;
    let total = clip.video.len() as u32;
    let mut seen = 0usize;
    let mut written = 0u32;
    let mut truncated = false;
    let mut planes = Planes::default();

    'outer: for (index, packet) in clip.video.iter().enumerate() {
        for frame in decoder.push(packet)? {
            if written >= budget {
                truncated = true;
                break 'outer;
            }
            if seen % keep_every == 0 {
                write_frame(&mut encoder, &frame, width, height, delay, &mut planes)?;
                written += 1;
            }
            seen += 1;
        }
        progress(index as u32 + 1, total);
    }

    if !truncated {
        for frame in decoder.finish()? {
            if written >= budget {
                truncated = true;
                break;
            }
            if seen % keep_every == 0 {
                write_frame(&mut encoder, &frame, width, height, delay, &mut planes)?;
                written += 1;
            }
            seen += 1;
        }
    }
    progress(total, total);

    if written == 0 {
        bail!("the clip produced no frames to turn into a GIF");
    }

    drop(encoder);
    writer
        .into_inner()
        .map_err(|e| anyhow::anyhow!("{}", e.error()))
        .with_context(|| format!("could not finish writing {}", destination.display()))?;

    let size_bytes = std::fs::metadata(destination)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let duration_seconds = written as f64 * delay as f64 / 100.0;

    if truncated {
        log::info!("The clip is longer than {MAX_SECONDS}s; the GIF holds its first {written} frames");
    }
    log::info!(
        "Wrote {} ({written} frames, {:.1} MB)",
        destination.display(),
        size_bytes as f64 / 1e6,
    );

    Ok(GifResult {
        path: destination.to_path_buf(),
        width,
        height,
        frames: written,
        duration_seconds,
        size_bytes,
        truncated,
    })
}

#[derive(Default)]
struct Planes {
    luma: Vec<u8>,
    blue: Vec<u8>,
    red: Vec<u8>,
    rgb: Vec<u8>,
}

fn write_frame<W: std::io::Write>(
    encoder: &mut gif::Encoder<W>,
    frame: &Frame,
    width: u32,
    height: u32,
    delay: u16,
    planes: &mut Planes,
) -> Result<()> {
    read_planes(frame, width, height, planes)?;

    let full_range = unsafe { (*frame.0).format }
        == ff::AVPixelFormat::AV_PIX_FMT_YUVJ420P as i32;
    to_rgb(planes, full_range);

    let mut out = gif::Frame::from_rgb_speed(
        width as u16,
        height as u16,
        &planes.rgb,
        QUANTISE_SPEED,
    );
    out.delay = delay;
    encoder
        .write_frame(&out)
        .context("could not write a GIF frame")?;
    Ok(())
}

fn read_planes(frame: &Frame, width: u32, height: u32, planes: &mut Planes) -> Result<()> {
    let raw = frame.0;
    let (format, source_width, source_height) =
        unsafe { ((*raw).format, (*raw).width, (*raw).height) };

    if format != ff::AVPixelFormat::AV_PIX_FMT_YUV420P as i32
        && format != ff::AVPixelFormat::AV_PIX_FMT_YUVJ420P as i32
    {
        bail!("GIF export needs planar 4:2:0 video, but this clip decoded to format {format}");
    }
    if source_width <= 0 || source_height <= 0 {
        bail!("the decoder returned a {source_width}x{source_height} frame");
    }

    let (source_width, source_height) = (source_width as usize, source_height as usize);
    let chroma_width = source_width.div_ceil(2);
    let chroma_height = source_height.div_ceil(2);

    unsafe {
        box_scale(
            (*raw).data[0],
            (*raw).linesize[0] as usize,
            source_width,
            source_height,
            width as usize,
            height as usize,
            &mut planes.luma,
        )?;
        box_scale(
            (*raw).data[1],
            (*raw).linesize[1] as usize,
            chroma_width,
            chroma_height,
            width as usize,
            height as usize,
            &mut planes.blue,
        )?;
        box_scale(
            (*raw).data[2],
            (*raw).linesize[2] as usize,
            chroma_width,
            chroma_height,
            width as usize,
            height as usize,
            &mut planes.red,
        )?;
    }
    Ok(())
}

unsafe fn box_scale(
    data: *const u8,
    stride: usize,
    source_width: usize,
    source_height: usize,
    width: usize,
    height: usize,
    out: &mut Vec<u8>,
) -> Result<()> {
    if data.is_null() {
        bail!("the decoder handed back a frame with a missing plane");
    }
    if stride < source_width {
        bail!("a {source_width} wide plane cannot have a stride of {stride}");
    }

    out.clear();
    out.reserve(width * height);

    for y in 0..height {
        let top = y * source_height / height;
        let bottom = (((y + 1) * source_height).div_ceil(height)).max(top + 1);
        for x in 0..width {
            let left = x * source_width / width;
            let right = (((x + 1) * source_width).div_ceil(width)).max(left + 1);

            let mut sum = 0u32;
            for row in top..bottom {
                let base = data.add(row * stride);
                for column in left..right {
                    sum += *base.add(column) as u32;
                }
            }
            let count = ((bottom - top) * (right - left)) as u32;
            out.push((sum / count) as u8);
        }
    }
    Ok(())
}

fn to_rgb(planes: &mut Planes, full_range: bool) {
    let pixels = planes.luma.len();
    planes.rgb.clear();
    planes.rgb.reserve(pixels * 3);

    for index in 0..pixels {
        let blue = planes.blue[index] as f32 - 128.0;
        let red = planes.red[index] as f32 - 128.0;
        let luma = if full_range {
            planes.luma[index] as f32
        } else {
            (planes.luma[index] as f32 - 16.0) * 1.164_383
        };

        let (r, g, b) = if full_range {
            (
                luma + 1.5748 * red,
                luma - 0.1873 * blue - 0.4681 * red,
                luma + 1.8556 * blue,
            )
        } else {
            (
                luma + 1.792_741 * red,
                luma - 0.213_249 * blue - 0.532_909 * red,
                luma + 2.112_402 * blue,
            )
        };

        planes.rgb.push(clamp(r));
        planes.rgb.push(clamp(g));
        planes.rgb.push(clamp(b));
    }
}

fn clamp(value: f32) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_clips_shrink_to_the_limit_and_keep_their_shape() {
        for (width, height) in [(1920, 1080), (2560, 1440), (3840, 2160), (1080, 1920)] {
            let (fitted_width, fitted_height) = fit(width, height);
            assert_eq!(fitted_width, MAX_WIDTH, "{width}x{height} kept its width");

            let wanted = height as f64 / width as f64;
            let got = fitted_height as f64 / fitted_width as f64;
            assert!(
                (wanted - got).abs() < 0.01,
                "{width}x{height} became {fitted_width}x{fitted_height}, which is a different shape",
            );
        }
    }

    #[test]
    fn narrow_clips_are_left_alone() {
        assert_eq!(fit(320, 240), (320, 240));
        assert_eq!(fit(MAX_WIDTH, 225), (MAX_WIDTH, 225));
    }

    #[test]
    fn a_clip_never_collapses_to_nothing() {
        let (width, height) = fit(4000, 1);
        assert!(width >= 1 && height >= 1, "got {width}x{height}");
    }

    #[test]
    fn a_flat_plane_survives_scaling_unchanged() {
        let source = vec![200u8; 64 * 64];
        let mut out = Vec::new();
        unsafe { box_scale(source.as_ptr(), 64, 64, 64, 16, 16, &mut out).unwrap() };
        assert_eq!(out.len(), 16 * 16);
        assert!(out.iter().all(|&value| value == 200));
    }

    #[test]
    fn scaling_averages_instead_of_dropping_pixels() {
        let mut source = vec![0u8; 4 * 4];
        source[0] = 255;
        source[1] = 255;
        source[4] = 255;
        source[5] = 255;

        let mut out = Vec::new();
        unsafe { box_scale(source.as_ptr(), 4, 4, 4, 2, 2, &mut out).unwrap() };
        assert_eq!(out, vec![255, 0, 0, 0]);
    }

    #[test]
    fn scaling_reads_rows_at_the_stride_not_the_width() {
        let mut source = vec![9u8; 4 * 8];
        for row in 0..4 {
            for column in 0..4 {
                source[row * 8 + column] = 100;
            }
        }

        let mut out = Vec::new();
        unsafe { box_scale(source.as_ptr(), 8, 4, 4, 2, 2, &mut out).unwrap() };
        assert!(out.iter().all(|&value| value == 100), "padding leaked in: {out:?}");
    }

    #[test]
    fn a_plane_can_grow_without_dividing_by_zero() {
        let source = vec![50u8; 2 * 2];
        let mut out = Vec::new();
        unsafe { box_scale(source.as_ptr(), 2, 2, 2, 5, 5, &mut out).unwrap() };
        assert_eq!(out.len(), 25);
        assert!(out.iter().all(|&value| value == 50));
    }

    #[test]
    fn limited_range_black_and_white_land_on_black_and_white() {
        let mut planes = Planes {
            luma: vec![16, 235],
            blue: vec![128, 128],
            red: vec![128, 128],
            rgb: Vec::new(),
        };
        to_rgb(&mut planes, false);
        assert_eq!(planes.rgb, vec![0, 0, 0, 255, 255, 255]);
    }

    #[test]
    fn full_range_black_and_white_land_on_black_and_white() {
        let mut planes = Planes {
            luma: vec![0, 255],
            blue: vec![128, 128],
            red: vec![128, 128],
            rgb: Vec::new(),
        };
        to_rgb(&mut planes, true);
        assert_eq!(planes.rgb, vec![0, 0, 0, 255, 255, 255]);
    }

    #[test]
    #[ignore = "needs a real clip in NRC_TEST_CLIP"]
    fn a_real_clip_turns_into_a_gif_that_starts_with_the_gif_header() {
        let source = std::path::PathBuf::from(std::env::var("NRC_TEST_CLIP").unwrap());
        let destination = std::env::temp_dir().join("nrc-gif-test.gif");
        let _ = std::fs::remove_file(&destination);

        let result = to_gif(&source, &destination, |_, _| {}).unwrap();

        assert!(result.frames > 0, "no frames were written");
        assert!(result.width <= MAX_WIDTH);
        assert_eq!(result.size_bytes, std::fs::metadata(&destination).unwrap().len());

        let bytes = std::fs::read(&destination).unwrap();
        assert_eq!(&bytes[..6], b"GIF89a", "not a GIF");
        assert_eq!(&bytes[bytes.len() - 1..], &[0x3b], "GIF is not terminated");

        println!(
            "{}x{}, {} frames, {:.1} MB, truncated={}",
            result.width,
            result.height,
            result.frames,
            result.size_bytes as f64 / 1e6,
            result.truncated,
        );
    }

    #[test]
    fn red_stays_red_and_blue_stays_blue() {
        let mut planes = Planes {
            luma: vec![82, 41],
            blue: vec![90, 240],
            red: vec![240, 110],
            rgb: Vec::new(),
        };
        to_rgb(&mut planes, false);

        let (r, g, b) = (planes.rgb[0], planes.rgb[1], planes.rgb[2]);
        assert!(r > 200 && g < 60 && b < 60, "expected red, got {r},{g},{b}");

        let (r, g, b) = (planes.rgb[3], planes.rgb[4], planes.rgb[5]);
        assert!(b > 200 && r < 60 && g < 60, "expected blue, got {r},{g},{b}");
    }
}
