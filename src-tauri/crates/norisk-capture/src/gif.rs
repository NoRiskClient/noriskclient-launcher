use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use ffmpeg_next::ffi as ff;

use crate::codec::{planar_420, shown_at, Decoder, Frame};
use crate::encoder::video::TIME_BASE_DEN;

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

    let delay = ((100.0 / TARGET_FPS as f64).round() as u16).max(2);

    let (width, height) = fit(clip.track.width, clip.track.height);

    log::info!(
        "Turning {} ({}x{} at {} fps) into a {width}x{height} GIF, one frame every {} ms",
        source.display(),
        clip.track.width,
        clip.track.height,
        clip.track.fps,
        delay as u32 * 10,
    );

    let (written, filled, truncated) = crate::writer::staged(destination, |part| {
        encode(&clip, part, (width, height), delay, &progress)
    })?;

    let size_bytes = std::fs::metadata(destination)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let duration_seconds = filled as f64 * delay as f64 / 100.0;

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

fn encode(
    clip: &crate::trim::SourceClip,
    destination: &Path,
    (width, height): (u32, u32),
    delay: u16,
    progress: &impl Fn(u32, u32),
) -> Result<(u32, u32, bool)> {
    let budget = MAX_SECONDS * 100 / delay as u32;
    let mut pacer = Pacer::new(delay);

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
    let mut written = 0u32;
    let mut filled = 0u32;
    let mut truncated = false;
    let mut planes = Planes::default();
    let mut held: Option<Frame> = None;

    let mut take = |next: Option<Frame>| -> Result<bool> {
        let slots = match &next {
            Some(frame) => pacer.slots(shown_at(frame)),
            None => 1,
        };
        if slots == 0 {
            return Ok(true);
        }
        if filled >= budget {
            return Ok(false);
        }
        if let Some(previous) = std::mem::replace(&mut held, next) {
            let slots = slots.min(budget - filled);
            let shown_for = (delay as u32 * slots).min(u16::MAX as u32) as u16;
            write_frame(&mut encoder, &previous, width, height, shown_for, &mut planes)?;
            filled += slots;
            written += 1;
        }
        Ok(true)
    };

    'outer: for (index, packet) in clip.video.iter().enumerate() {
        for frame in decoder.push(packet)? {
            if !take(Some(frame))? {
                truncated = true;
                break 'outer;
            }
        }
        progress(index as u32 + 1, total);
    }

    if !truncated {
        for frame in decoder.finish()? {
            if !take(Some(frame))? {
                truncated = true;
                break;
            }
        }
    }
    if !truncated && !take(None)? {
        truncated = true;
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

    Ok((written, filled, truncated))
}

struct Pacer {
    interval: i64,
    next_due: Option<i64>,
}

impl Pacer {
    fn new(delay_centiseconds: u16) -> Self {
        Self {
            interval: (TIME_BASE_DEN as i64 * delay_centiseconds as i64 / 100).max(1),
            next_due: None,
        }
    }

    fn slots(&mut self, pts: i64) -> u32 {
        if pts == ff::AV_NOPTS_VALUE {
            return 0;
        }
        let due = *self.next_due.get_or_insert(pts);
        if pts < due {
            return 0;
        }
        let slots = (pts - due) / self.interval + 1;
        self.next_due = Some(due.saturating_add(slots.saturating_mul(self.interval)));
        slots.min(u32::MAX as i64) as u32
    }
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
    let full_range = planar_420(frame, "GIF export")?;
    read_planes(frame, width, height, planes)?;
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
    let (source_width, source_height) = unsafe { ((*raw).width, (*raw).height) };

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

    fn picked(times: &[i64]) -> (Vec<i64>, u32) {
        let mut pacer = Pacer::new(8);
        let mut kept = Vec::new();
        let mut slots = 0;
        for &pts in times {
            let taken = pacer.slots(pts);
            if taken > 0 {
                kept.push(pts);
                slots += taken;
            }
        }
        (kept, slots)
    }

    #[test]
    fn frames_are_picked_by_their_time_so_uneven_spacing_keeps_the_real_speed() {
        let gaps = [1_200i64, 1_700, 1_400, 2_300, 1_500, 900, 1_600, 1_800];
        let times: Vec<i64> = (0..600)
            .scan(0i64, |at, i| {
                let now = *at;
                *at += gaps[i % gaps.len()];
                Some(now)
            })
            .collect();
        let interval = TIME_BASE_DEN as i64 * 8 / 100;

        let (kept, slots) = picked(&times);

        let span = times.last().unwrap() - times.first().unwrap();
        let played = slots as i64 * interval;
        assert!(
            (played - span).abs() <= interval,
            "the GIF plays {played} ticks for {span} ticks of clip",
        );
        assert_eq!(slots as usize, kept.len(), "a clip faster than the GIF never stretches a frame");
    }

    #[test]
    fn a_steady_sixty_fps_clip_keeps_one_frame_per_gif_interval() {
        let step = TIME_BASE_DEN as i64 / 60;
        let times: Vec<i64> = (0..600).map(|i| 1_000 + i * step).collect();
        let interval = TIME_BASE_DEN as i64 * 8 / 100;

        let (kept, slots) = picked(&times);

        assert_eq!(kept[0], 1_000, "the first frame is always kept");
        assert_eq!(slots as usize, kept.len(), "a fast clip never stretches a frame");
        let expected = (times.last().unwrap() - times[0]) / interval + 1;
        assert_eq!(kept.len() as i64, expected);
    }

    #[test]
    fn a_clip_slower_than_the_gif_holds_its_frames_longer_instead_of_speeding_up() {
        let step = TIME_BASE_DEN as i64 / 5;
        let times: Vec<i64> = (0..50).map(|i| i * step).collect();
        let interval = TIME_BASE_DEN as i64 * 8 / 100;

        let (kept, slots) = picked(&times);

        assert_eq!(kept.len(), times.len(), "every slow frame is kept");
        let played = slots as i64 * interval;
        let span = times.last().unwrap() - times[0];
        assert!((played - span).abs() <= interval, "{played} vs {span}");
    }

    #[test]
    fn frames_without_a_time_or_going_backwards_are_skipped() {
        let mut pacer = Pacer::new(8);
        assert_eq!(pacer.slots(ff::AV_NOPTS_VALUE), 0);
        assert_eq!(pacer.slots(10_000), 1);
        assert_eq!(pacer.slots(9_000), 0);
        assert_eq!(pacer.slots(i64::MAX), u32::MAX);
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
