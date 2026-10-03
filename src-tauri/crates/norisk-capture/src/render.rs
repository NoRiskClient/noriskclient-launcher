
use std::path::PathBuf;

use anyhow::{anyhow, bail, Context, Result};
use ffmpeg_next::ffi as ff;

use norisk_ipc::ticks_at;

use crate::buffer::{Clip, Packet};
use crate::codec::{planar_420, shown_at, Decoder, Frame};
use crate::encoder::hw::av_error;
use crate::encoder::video::TIME_BASE_DEN;
use crate::writer::{write_mp4, TrackInfo};

type Ratio = (i64, i64);

#[derive(Debug, Clone)]
pub struct VerticalResult {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub duration_seconds: f64,
    pub size_bytes: u64,
}

fn centre_crop(width: u32, height: u32, ratio: Ratio) -> (u32, u32, u32, u32) {
    let (across, down) = ratio;
    let (width, height) = (width as i64, height as i64);

    if (height * across / down) & !1 >= width {
        let keep_width = width & !1;
        let keep_height = (keep_width * down / across).min(height) & !1;
        let spare = height - keep_height;
        let top = (spare / 2) & !1;
        return (
            0,
            (width - keep_width) as u32,
            top as u32,
            (spare - top) as u32,
        );
    }

    let keep_height = height & !1;
    let keep_width = (keep_height * across / down) & !1;
    let spare = width - keep_width;
    let left = (spare / 2) & !1;

    (
        left as u32,
        (spare - left) as u32,
        0,
        (height - keep_height) as u32,
    )
}

fn crop_ratio(shape: norisk_ipc::ClipShape, width: u32, height: u32) -> Ratio {
    shape.ratio().unwrap_or((width as i64, height as i64))
}

fn to_decode(packets: &[Packet], start: i64, end: i64) -> &[Packet] {
    let first = crate::trim::keyframe_index_at_or_before(packets, start).unwrap_or(0);
    let rest = &packets[first..];
    &rest[..rest.iter().take_while(|p| p.dts <= end).count()]
}

const REFERENCE_HEIGHT: f32 = 1080.0;

fn at_frame_height(overlay: &norisk_ipc::ClipOverlay, frame_height: u32) -> norisk_ipc::ClipOverlay {
    use norisk_ipc::OverlayKind;

    let unit = frame_height as f32 / REFERENCE_HEIGHT;
    let scaled = |value: u32| ((value as f32 * unit).round() as u32).max(1);
    let kind = match &overlay.kind {
        OverlayKind::Blur { strength } => OverlayKind::Blur { strength: scaled(*strength) },
        OverlayKind::Arrow { colour, thickness, towards } => OverlayKind::Arrow {
            colour: *colour,
            thickness: scaled(*thickness),
            towards: *towards,
        },
        OverlayKind::Text { content, size, colour } => OverlayKind::Text {
            content: content.clone(),
            size: scaled(*size),
            colour: *colour,
        },
        other => other.clone(),
    };
    norisk_ipc::ClipOverlay { kind, ..overlay.clone() }
}

fn place(pts: i64, start: i64, end: i64, last: Option<i64>) -> Option<i64> {
    (pts >= start && pts <= end && last.is_none_or(|last| pts > last)).then_some(pts)
}

struct Gaps(Vec<(i64, i64)>);

impl Gaps {
    fn new(removed: &[norisk_ipc::Span], origin: i64, start: i64, end: i64) -> Self {
        let at = |seconds: f64| ticks_at(origin, seconds, TIME_BASE_DEN as i64);
        let mut spans: Vec<(i64, i64)> = removed
            .iter()
            .filter(|span| span.start_seconds.is_finite() && span.end_seconds.is_finite())
            .map(|span| (at(span.start_seconds).max(start), at(span.end_seconds).min(end)))
            .filter(|(from, to)| to > from)
            .collect();
        spans.sort_unstable();

        let mut merged: Vec<(i64, i64)> = Vec::with_capacity(spans.len());
        for (from, to) in spans {
            match merged.last_mut() {
                Some(last) if from <= last.1 => last.1 = last.1.max(to),
                _ => merged.push((from, to)),
            }
        }
        Gaps(merged)
    }

    fn squeeze(&self, pts: i64) -> i64 {
        let mut removed = 0i64;
        for &(from, to) in &self.0 {
            if pts < from {
                break;
            }
            if pts < to {
                return from - removed;
            }
            removed += to - from;
        }
        pts - removed
    }

    fn shift(&self, pts: i64) -> Option<i64> {
        (!self.0.iter().any(|&(from, to)| (from..to).contains(&pts))).then(|| self.squeeze(pts))
    }

    fn close(&self, packets: &[Packet]) -> Vec<Packet> {
        packets
            .iter()
            .filter_map(|packet| {
                let pts = self.shift(packet.pts)?;
                Some(Packet {
                    dts: packet.dts - (packet.pts - pts),
                    pts,
                    ..packet.clone()
                })
            })
            .collect()
    }
}

pub fn render(
    request: &norisk_ipc::ExportVerticalRequest,
    progress: impl Fn(u32, u32),
) -> Result<VerticalResult> {
    let mut used = None;
    match render_with(request, &progress, &RENDER_ENCODERS, &mut used) {
        Err(e)
            if e.downcast_ref::<EncoderFault>().is_some()
                && used.is_some_and(|name| HARDWARE_ENCODERS.contains(&name)) =>
        {
            log::warn!(
                "Rendering with {} failed ({e:#}); rendering again on the processor",
                used.map(|name| name.to_string_lossy()).unwrap_or_default()
            );
            render_with(request, &progress, &[CPU_ENCODER], &mut used)
        }
        done => done,
    }
}

fn render_with(
    request: &norisk_ipc::ExportVerticalRequest,
    progress: &impl Fn(u32, u32),
    encoders: &[&'static std::ffi::CStr],
    used: &mut Option<&'static std::ffi::CStr>,
) -> Result<VerticalResult> {
    let destination = request.destination.as_path();
    let clip = crate::trim::read(&request.source)?;
    let ratio = crop_ratio(request.shape, clip.track.width, clip.track.height);

    let (left, right, top, bottom) = centre_crop(clip.track.width, clip.track.height, ratio);
    let width = clip.track.width.saturating_sub(left + right);
    let height = clip.track.height.saturating_sub(top + bottom);

    if width == 0 || height == 0 {
        bail!(
            "a {}x{} clip has no {}:{} middle to cut",
            clip.track.width,
            clip.track.height,
            ratio.0,
            ratio.1
        );
    }
    if (left, right, top, bottom) == (0, 0, 0, 0) {
        log::info!(
            "{width}x{height} is already {}:{}; only re-encoding",
            ratio.0,
            ratio.1
        );
    }

    log::info!(
        "Cutting {}x{} down to {width}x{height} (dropping {left}+{right} across, {top}+{bottom} down)",
        clip.track.width,
        clip.track.height,
    );

    let duration = clip.duration_seconds();
    let (start_seconds, end_seconds) = crate::trim::usable_range(
        request.start_seconds.unwrap_or(0.0),
        request.end_seconds.unwrap_or(duration),
        duration,
    )?;
    let want_start = ticks_at(clip.first_pts, start_seconds, TIME_BASE_DEN as i64);
    let want_end = ticks_at(clip.first_pts, end_seconds, TIME_BASE_DEN as i64);
    let (picture_start, picture_end) = crate::trim::picture_window(
        request.video_start_seconds,
        request.video_end_seconds,
        clip.first_pts,
        want_start,
        want_end,
    );

    let feed = to_decode(&clip.video, picture_start, picture_end);
    let crop = (left, right, top, bottom);
    let mut decoder = Decoder::open(&clip.track)?;
    let (mut encoder, name) = Encoder::open(width, height, clip.track.fps, encoders)?;
    *used = Some(name);

    let gaps = Gaps::new(&request.removed, clip.first_pts, want_start, want_end);
    let overlays: Vec<norisk_ipc::ClipOverlay> = request
        .blanked
        .iter()
        .map(|span| norisk_ipc::ClipOverlay {
            kind: norisk_ipc::OverlayKind::Box { colour: 0x000000 },
            left: 0.0,
            top: 0.0,
            width: 1.0,
            height: 1.0,
            start_seconds: span.start_seconds,
            end_seconds: span.end_seconds,
        })
        .chain(request.overlays.iter().map(|overlay| at_frame_height(overlay, clip.track.height)))
        .collect();
    let total = feed.len() as u32;
    let mut packets: Vec<Packet> = Vec::with_capacity(feed.len());
    let mut last = None;
    let mut sent = 0usize;
    let mut stamps = crate::overlay::Stamps::default();
    let mut take = |frame: Frame| -> Result<()> {
        let Some(pts) = place(shown_at(&frame), picture_start, picture_end, last) else {
            return Ok(());
        };
        last = Some(pts);
        let Some(shown) = gaps.shift(pts) else {
            return Ok(());
        };
        planar_420(&frame, "rendering")?;
        unsafe { (*frame.0).pts = pts };
        paint(&frame, clip.first_pts, &overlays, &mut stamps)?;
        unsafe { (*frame.0).pts = shown };
        packets.extend(encoder.push(frame, crop).context(EncoderFault)?);
        sent += 1;
        Ok(())
    };

    for (index, packet) in feed.iter().enumerate() {
        for frame in decoder.push(packet)? {
            take(frame)?;
        }
        progress(index as u32 + 1, total);
    }
    for frame in decoder.finish()? {
        take(frame)?;
    }
    packets.extend(encoder.finish().context(EncoderFault)?);
    progress(total, total);

    if sent == 0 {
        bail!("no frames fall inside {start_seconds:.1}s to {end_seconds:.1}s");
    }
    let extradata = encoder.extradata();
    if packets.is_empty() || extradata.is_empty() {
        return Err(anyhow!("the encoder took {sent} frames but gave back no usable picture")
            .context(EncoderFault));
    }

    let audio: Vec<_> = crate::trim::windowed_audio(
        &clip.audio,
        &request.levels,
        clip.first_pts,
        want_start,
        want_end,
    )
    .into_iter()
    .enumerate()
    .map(|(index, source)| crate::trim::AudioSource {
        packets: gaps.close(&source.packets),
        quiet: hushed(&request.muted, index as u32, clip.first_pts, &gaps),
        format: source.format,
    })
    .collect();
    let audio = crate::trim::build_audio(&audio, &request.levels)?;
    let bytes = crate::trim::total_bytes(&packets, &audio);
    let end_pts = crate::trim::furthest_pts(&packets, &audio, want_end);

    let cut = Clip {
        start_pts: want_start,
        end_pts,
        bytes,
        playback_start_pts: want_start,
        packets,
    };

    let track = TrackInfo {
        width,
        height,
        fps: clip.track.fps,
        time_base_den: TIME_BASE_DEN as i64,
        codec: norisk_ipc::ClipCodec::H264,
        extradata,
    };

    let written = write_mp4(&cut, destination, &track, &audio)
        .with_context(|| format!("could not write {}", destination.display()))?;

    Ok(VerticalResult {
        path: written.path,
        width,
        height,
        duration_seconds: written.duration_seconds,
        size_bytes: written.size_bytes,
    })
}

fn hushed(muted: &[norisk_ipc::TrackCut], stream: u32, origin: i64, gaps: &Gaps) -> Vec<(i64, i64)> {
    let at = |seconds: f64| ticks_at(origin, seconds, TIME_BASE_DEN as i64);
    muted
        .iter()
        .filter(|cut| cut.stream == stream)
        .filter(|cut| cut.start_seconds.is_finite() && cut.end_seconds.is_finite())
        .map(|cut| (gaps.squeeze(at(cut.start_seconds)), gaps.squeeze(at(cut.end_seconds))))
        .filter(|(from, to)| to > from)
        .collect()
}

fn paint(
    frame: &Frame,
    origin: i64,
    overlays: &[norisk_ipc::ClipOverlay],
    stamps: &mut crate::overlay::Stamps,
) -> Result<()> {
    use crate::overlay::{covers, halve, rect_in, Plane};

    if overlays.is_empty() {
        return Ok(());
    }

    unsafe {
        let seconds = ((*frame.0).pts - origin) as f64 / TIME_BASE_DEN as f64;
        let wanted: Vec<_> = overlays
            .iter()
            .enumerate()
            .filter(|(_, overlay)| covers(overlay, seconds))
            .collect();
        if wanted.is_empty() {
            return Ok(());
        }

        let rc = ff::av_frame_make_writable(frame.0);
        if rc < 0 {
            bail!("could not make a frame writable to paint on: {}", av_error(rc));
        }

        let width = (*frame.0).width.max(0) as usize;
        let height = (*frame.0).height.max(0) as usize;
        let chroma_width = width.div_ceil(2);
        let chroma_height = height.div_ceil(2);

        for (number, overlay) in wanted {
            let Some(rect) = rect_in(overlay, width, height) else {
                continue;
            };

            let stride = (*frame.0).linesize[0].max(0) as usize;
            if (*frame.0).data[0].is_null() || stride < width {
                bail!("the decoder handed back a frame without a usable luma plane");
            }
            let mut luma = Plane {
                data: std::slice::from_raw_parts_mut((*frame.0).data[0], stride * height),
                stride,
                width,
                height,
                channel: crate::overlay::Channel::Luma,
            };
            stamps.apply(number, &mut luma, rect, &overlay.kind);

            let chroma = halve(rect, chroma_width, chroma_height);
            for index in 1..3 {
                let stride = (*frame.0).linesize[index].max(0) as usize;
                if (*frame.0).data[index].is_null() || stride < chroma_width {
                    continue;
                }
                let mut plane = Plane {
                    data: std::slice::from_raw_parts_mut(
                        (*frame.0).data[index],
                        stride * chroma_height,
                    ),
                    stride,
                    width: chroma_width,
                    height: chroma_height,
                    channel: if index == 1 {
                        crate::overlay::Channel::Blue
                    } else {
                        crate::overlay::Channel::Red
                    },
                };
                stamps.apply(number, &mut plane, chroma, &overlay.kind);
            }
        }
    }

    Ok(())
}

struct Encoder {
    context: *mut ff::AVCodecContext,
    packet: *mut ff::AVPacket,
}

const CPU_ENCODER: &std::ffi::CStr = c"libx264";
const HARDWARE_ENCODERS: [&std::ffi::CStr; 2] = [c"h264_nvenc", c"h264_amf"];
const RENDER_ENCODERS: [&std::ffi::CStr; 3] =
    [HARDWARE_ENCODERS[0], HARDWARE_ENCODERS[1], CPU_ENCODER];

#[derive(Debug)]
struct EncoderFault;

impl std::fmt::Display for EncoderFault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("the video encoder failed")
    }
}

impl Encoder {
    fn open(
        width: u32,
        height: u32,
        fps: u32,
        encoders: &[&'static std::ffi::CStr],
    ) -> Result<(Self, &'static std::ffi::CStr)> {
        for &name in encoders {
            match Self::open_with(Some(name), width, height, fps) {
                Ok(opened) => {
                    log::info!("Rendering with {}", name.to_string_lossy());
                    return Ok(opened);
                }
                Err(e) => log::debug!("{} cannot render here: {e:#}", name.to_string_lossy()),
            }
        }
        let (encoder, name) = Self::open_with(None, width, height, fps)?;
        log::info!("Rendering with FFmpeg's default H.264 encoder, {}", name.to_string_lossy());
        Ok((encoder, name))
    }

    fn open_with(
        name: Option<&std::ffi::CStr>,
        width: u32,
        height: u32,
        fps: u32,
    ) -> Result<(Self, &'static std::ffi::CStr)> {
        unsafe {
            let codec = match name {
                Some(name) => ff::avcodec_find_encoder_by_name(name.as_ptr()),
                None => ff::avcodec_find_encoder(ff::AVCodecID::AV_CODEC_ID_H264),
            };
            if codec.is_null() {
                bail!("not in this FFmpeg build");
            }
            let opened: &'static std::ffi::CStr = if (*codec).name.is_null() {
                c"h264"
            } else {
                std::ffi::CStr::from_ptr((*codec).name)
            };
            let hardware = matches!(name, Some(name) if name != CPU_ENCODER);

            let context = ff::avcodec_alloc_context3(codec);
            if context.is_null() {
                bail!("avcodec_alloc_context3 failed for the video encoder");
            }

            let fps = fps.max(1) as i64;
            let mut guard = Self {
                context,
                packet: std::ptr::null_mut(),
            };

            (*context).width = width as i32;
            (*context).height = height as i32;
            (*context).pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_YUV420P;
            (*context).time_base = ff::AVRational {
                num: 1,
                den: TIME_BASE_DEN as i32,
            };
            (*context).framerate = ff::AVRational {
                num: fps as i32,
                den: 1,
            };
            (*context).gop_size = (fps * 2) as i32;
            (*context).bit_rate = 8_000_000;
            (*context).color_primaries = crate::encoder::video::COLOR_PRIMARIES;
            (*context).color_trc = crate::encoder::video::COLOR_TRANSFER;
            (*context).colorspace = crate::encoder::video::COLOR_SPACE;
            (*context).color_range = crate::encoder::video::COLOR_RANGE;
            (*context).chroma_sample_location = crate::encoder::video::CHROMA_LOCATION;
            (*context).flags |= ff::AV_CODEC_FLAG_GLOBAL_HEADER as i32;
            (*context).thread_count = 0;
            if hardware {
                (*context).max_b_frames = 0;
            }
            if !(*context).priv_data.is_null() {
                let (key, value) = match name {
                    Some(name) if name == c"h264_nvenc" => (c"preset", c"p4"),
                    Some(name) if name == c"h264_amf" => (c"quality", c"speed"),
                    _ => (c"preset", c"veryfast"),
                };
                ff::av_opt_set((*context).priv_data, key.as_ptr(), value.as_ptr(), 0);
            }

            let rc = ff::avcodec_open2(context, codec, std::ptr::null_mut());
            if rc < 0 {
                bail!("opening the H.264 encoder failed: {}", av_error(rc));
            }

            guard.packet = ff::av_packet_alloc();
            if guard.packet.is_null() {
                bail!("av_packet_alloc failed");
            }

            Ok((guard, opened))
        }
    }

    fn extradata(&self) -> Vec<u8> {
        unsafe {
            let context = &*self.context;
            if context.extradata.is_null() || context.extradata_size <= 0 {
                return Vec::new();
            }
            std::slice::from_raw_parts(context.extradata, context.extradata_size as usize).to_vec()
        }
    }

    fn push(&mut self, frame: Frame, crop: (u32, u32, u32, u32)) -> Result<Vec<Packet>> {
        unsafe {
            let (left, right, top, bottom) = crop;
            (*frame.0).crop_left = left as usize;
            (*frame.0).crop_right = right as usize;
            (*frame.0).crop_top = top as usize;
            (*frame.0).crop_bottom = bottom as usize;

            let rc = ff::av_frame_apply_cropping(
                frame.0,
                ff::AV_FRAME_CROP_UNALIGNED as i32,
            );
            if rc < 0 {
                bail!("cropping the frame failed: {}", av_error(rc));
            }

            (*frame.0).pict_type = ff::AVPictureType::AV_PICTURE_TYPE_NONE;

            let rc = ff::avcodec_send_frame(self.context, frame.0);
            if rc < 0 {
                bail!("avcodec_send_frame failed: {}", av_error(rc));
            }
        }
        self.drain()
    }

    fn finish(&mut self) -> Result<Vec<Packet>> {
        unsafe {
            let rc = ff::avcodec_send_frame(self.context, std::ptr::null());
            if rc < 0 && rc != ff::AVERROR_EOF {
                bail!("flushing the H.264 encoder failed: {}", av_error(rc));
            }
        }
        self.drain()
    }

    fn drain(&mut self) -> Result<Vec<Packet>> {
        let mut out = Vec::new();
        loop {
            let rc = unsafe { ff::avcodec_receive_packet(self.context, self.packet) };
            if rc == ff::AVERROR(ff::EAGAIN) || rc == ff::AVERROR_EOF {
                break;
            }
            if rc < 0 {
                bail!("avcodec_receive_packet failed: {}", av_error(rc));
            }

            unsafe {
                let packet = &*self.packet;
                out.push(Packet {
                    data: std::slice::from_raw_parts(packet.data, packet.size.max(0) as usize)
                        .into(),
                    pts: packet.pts,
                    dts: if packet.dts == ff::AV_NOPTS_VALUE {
                        packet.pts
                    } else {
                        packet.dts
                    },
                    keyframe: packet.flags & ff::AV_PKT_FLAG_KEY as i32 != 0,
                });
                ff::av_packet_unref(self.packet);
            }
        }
        Ok(out)
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        unsafe {
            ff::av_packet_free(&mut self.packet);
            ff::avcodec_free_context(&mut self.context);
        }
    }
}

unsafe impl Send for Encoder {}

#[cfg(test)]
mod tests {
    use super::*;

    fn nine_by_sixteen() -> Ratio {
        norisk_ipc::ClipShape::Vertical.ratio().unwrap()
    }

    fn cropped(width: u32, height: u32) -> (u32, u32) {
        cropped_to(width, height, nine_by_sixteen())
    }

    fn cropped_to(width: u32, height: u32, ratio: Ratio) -> (u32, u32) {
        let (left, right, top, bottom) = centre_crop(width, height, ratio);
        (width - left - right, height - top - bottom)
    }

    #[test]
    fn a_landscape_clip_loses_its_sides() {
        assert_eq!(cropped(1920, 1080), (606, 1080));
        assert_eq!(cropped(2560, 1440), (810, 1440));
    }

    #[test]
    fn every_shape_cuts_to_its_own_ratio() {
        for shape in [
            norisk_ipc::ClipShape::Vertical,
            norisk_ipc::ClipShape::Square,
            norisk_ipc::ClipShape::Wide,
        ] {
            let ratio = shape.ratio().unwrap();
            for (width, height) in [(1920, 1080), (2560, 1440), (1280, 720)] {
                let (w, h) = cropped_to(width, height, ratio);
                let got = w as f64 / h as f64;
                let wanted = ratio.0 as f64 / ratio.1 as f64;
                assert!(
                    (got - wanted).abs() < 0.02,
                    "{shape:?}: {width}x{height} became {w}x{h}, ratio {got:.4} not {wanted:.4}",
                );
                assert!(w <= width && h <= height, "{shape:?} grew the picture");
            }
        }
    }

    #[test]
    fn original_keeps_the_source_size() {
        for (width, height) in [(1920, 1080), (2560, 1440), (1080, 1920), (1000, 1000)] {
            let ratio = crop_ratio(norisk_ipc::ClipShape::Original, width, height);
            assert_eq!(
                centre_crop(width, height, ratio),
                (0, 0, 0, 0),
                "{width}x{height} should lose nothing",
            );
            assert_eq!(cropped_to(width, height, ratio), (width, height));
        }
    }

    #[test]
    fn a_square_cut_of_a_wide_clip_keeps_the_full_height() {
        let (w, h) = cropped_to(1920, 1080, (1, 1));
        assert_eq!(h, 1080);
        assert_eq!(w, 1080);
    }

    #[test]
    fn what_is_left_is_nine_by_sixteen() {
        for (width, height) in [(1920, 1080), (2560, 1440), (3840, 2160), (1280, 720)] {
            let (w, h) = cropped(width, height);
            let ratio = w as f64 / h as f64;
            let wanted = nine_by_sixteen().0 as f64 / nine_by_sixteen().1 as f64;
            assert!(
                (ratio - wanted).abs() < 0.01,
                "{width}x{height} cropped to {w}x{h}, ratio {ratio:.4}",
            );
        }
    }

    #[test]
    fn the_cut_is_centred() {
        let (left, right, _, _) = centre_crop(1920, 1080, nine_by_sixteen());
        assert!(
            left.abs_diff(right) <= 2,
            "the column should sit in the middle: {left} vs {right}",
        );
    }

    #[test]
    fn every_offset_is_even() {
        for (width, height) in [(1920, 1080), (2559, 1439), (1281, 721), (3840, 2160)] {
            let (left, _, top, _) = centre_crop(width, height, nine_by_sixteen());
            assert_eq!(left % 2, 0, "{width}x{height} crops {left} from the left");
            assert_eq!(top % 2, 0, "{width}x{height} crops {top} from the top");
        }
    }

    #[test]
    fn what_is_left_has_even_sides() {
        for (width, height) in [
            (1920, 1080),
            (2560, 1440),
            (3840, 2160),
            (1280, 720),
            (2559, 1439),
            (1281, 721),
            (1080, 2400),
            (1000, 1000),
        ] {
            let (w, h) = cropped(width, height);
            assert_eq!(w % 2, 0, "{width}x{height} left a {w}-wide column");
            assert_eq!(h % 2, 0, "{width}x{height} left a {h}-tall column");
        }
    }

    #[test]
    fn a_clip_already_taller_than_wide_loses_its_top_and_bottom() {
        let (left, right, top, bottom) = centre_crop(1080, 2400, nine_by_sixteen());
        assert_eq!((left, right), (0, 0), "nothing should come off the sides");
        assert!(top > 0 && bottom > 0);

        let (w, h) = cropped(1080, 2400);
        assert_eq!(w, 1080);
        assert_eq!(h, 1920, "1080 wide at 9:16 is 1920 tall");
    }

    #[test]
    fn a_clip_already_at_the_right_shape_is_left_alone() {
        assert_eq!(centre_crop(1080, 1920, nine_by_sixteen()), (0, 0, 0, 0));
    }

    #[test]
    fn a_square_clip_loses_its_sides() {
        let (w, h) = cropped(1000, 1000);
        assert!(w < h, "a square has to become taller than it is wide: {w}x{h}");
    }

    const STEP: i64 = TIME_BASE_DEN as i64 / 60;

    fn packet(pts: i64, dts: i64, keyframe: bool) -> Packet {
        Packet {
            data: vec![0; 4].into(),
            pts,
            dts,
            keyframe,
        }
    }

    fn kept(times: &[i64], start: i64, end: i64) -> Vec<i64> {
        let mut last = None;
        times
            .iter()
            .filter_map(|&pts| {
                let placed = place(pts, start, end, last);
                last = placed.or(last);
                placed
            })
            .collect()
    }

    fn uneven() -> Vec<i64> {
        let gaps = [1_200, 1_700, 1_400, 2_300, 1_500, 900, 1_600, 1_800];
        (0..600)
            .scan(0i64, |at, i| {
                let now = *at;
                *at += gaps[i % gaps.len()];
                Some(now)
            })
            .collect()
    }

    #[test]
    fn kept_frames_keep_their_own_times_inside_the_window() {
        let times = uneven();
        let (start, end) = (100_000, 500_000);

        let out = kept(&times, start, end);
        let inside: Vec<i64> = times
            .iter()
            .copied()
            .filter(|pts| (start..=end).contains(pts))
            .collect();

        assert_eq!(out, inside, "a frame was moved, lost or invented");
        assert!(out.iter().all(|pts| (start..=end).contains(pts)));
        assert!(out.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn uneven_frames_span_what_the_source_spans_not_count_times_interval() {
        let times = uneven();
        let (start, end) = (0, *times.last().unwrap());

        let out = kept(&times, start, end);
        let span = out.last().unwrap() - out.first().unwrap();
        let counted = (out.len() as i64 - 1) * STEP;

        assert_eq!(span, times.last().unwrap() - times.first().unwrap());
        assert_ne!(
            span, counted,
            "the test spacing is too even to tell real times from a counter"
        );
    }

    #[test]
    fn a_frame_that_repeats_or_goes_back_is_dropped_rather_than_sent_twice() {
        let times = [0, STEP, STEP, STEP - 100, 2 * STEP, 3 * STEP];

        assert_eq!(kept(&times, 0, 10 * STEP), vec![0, STEP, 2 * STEP, 3 * STEP]);
    }

    #[test]
    fn a_window_that_makes_no_sense_keeps_nothing_and_does_not_panic() {
        let times = uneven();

        assert!(kept(&times, 500_000, 100_000).is_empty());
        assert!(kept(&times, i64::MAX, i64::MAX).is_empty());
        assert!(kept(&times, i64::MIN, i64::MIN).is_empty());
        assert!(kept(&[], 0, 10).is_empty());
        assert_eq!(kept(&times, i64::MIN, i64::MAX), times);
        assert!(kept(&[i64::MIN, i64::MAX], 0, 10).is_empty());

        assert!(to_decode(&[], 0, 10).is_empty());
        let packets: Vec<Packet> = times.iter().map(|&t| packet(t, t, t == 0)).collect();
        assert!(to_decode(&packets, 500_000, 100_000)
            .iter()
            .all(|p| p.dts <= 100_000));
        assert!(to_decode(&packets, i64::MIN, i64::MIN).is_empty());
        assert_eq!(to_decode(&packets, i64::MAX, i64::MAX).len(), packets.len());
    }

    #[test]
    fn a_nonsense_picture_window_renders_the_whole_cut() {
        let times = uneven();
        let (want_start, want_end) = (100_000, 500_000);

        let (start, end) = crate::trim::picture_window(
            Some(f64::NAN),
            Some(f64::INFINITY),
            0,
            want_start,
            want_end,
        );

        assert_eq!(kept(&times, start, end), kept(&times, want_start, want_end));
    }

    #[test]
    fn decoding_starts_at_the_keyframe_before_the_window_and_stops_after_it() {
        let packets: Vec<Packet> = (0..600)
            .map(|i| packet(i * STEP, i * STEP, i % 120 == 0))
            .collect();
        let second = TIME_BASE_DEN as i64;
        let (start, end) = (5 * second + STEP / 2, 7 * second);

        let fed = to_decode(&packets, start, end);

        assert!(fed[0].keyframe);
        assert_eq!(fed[0].pts, 4 * second);
        assert_eq!(fed.last().unwrap().pts, end);
        assert!(packets
            .iter()
            .filter(|p| (start..=end).contains(&p.pts))
            .all(|p| fed.contains(p)));
    }

    #[test]
    fn a_window_before_the_first_keyframe_decodes_from_the_first_packet() {
        let packets: Vec<Packet> = (0..60)
            .map(|i| packet(i * STEP, i * STEP, i == 10))
            .collect();

        let fed = to_decode(&packets, 3 * STEP, 20 * STEP);

        assert_eq!(fed[0].pts, 0);
        assert_eq!(fed.len(), 21);
    }

    #[test]
    fn reordered_frames_up_to_the_end_are_all_fed_to_the_decoder() {
        let order = [0, 3, 1, 2, 6, 4, 5, 9, 7, 8];
        let packets: Vec<Packet> = order
            .iter()
            .enumerate()
            .map(|(i, &shown)| packet(shown * STEP, (i as i64 - 1) * STEP, i == 0))
            .collect();
        let end = 4 * STEP;

        let fed = to_decode(&packets, 0, end);

        for shown in 0..=4 {
            assert!(
                fed.iter().any(|p| p.pts == shown * STEP),
                "frame {shown} is shown before the end but was never decoded"
            );
        }
        assert!(fed.iter().all(|p| p.dts <= end));
    }

    #[test]
    fn overlay_sizes_mean_the_same_share_of_the_picture_at_every_resolution() {
        use norisk_ipc::{ClipOverlay, Corner, OverlayKind};

        let arrow = ClipOverlay {
            kind: OverlayKind::Arrow { colour: 0xffffff, thickness: 6, towards: Corner::TopLeft },
            left: 0.1,
            top: 0.2,
            width: 0.3,
            height: 0.4,
            start_seconds: 1.0,
            end_seconds: 2.0,
        };
        let text = ClipOverlay {
            kind: OverlayKind::Text { content: "HI".into(), size: 48, colour: 0 },
            ..arrow.clone()
        };
        let blur = ClipOverlay { kind: OverlayKind::Blur { strength: 12 }, ..arrow.clone() };
        let size = |overlay: &ClipOverlay, height: u32| match at_frame_height(overlay, height).kind {
            OverlayKind::Arrow { thickness, .. } => thickness,
            OverlayKind::Text { size, .. } => size,
            OverlayKind::Blur { strength } => strength,
            OverlayKind::Box { .. } => 0,
        };

        assert_eq!(size(&arrow, 1080), 6, "1080p is the reference and must not change");
        assert_eq!(size(&arrow, 540), 3);
        assert_eq!(size(&arrow, 2160), 12);
        assert_eq!(size(&text, 720), 32);
        assert_eq!(size(&blur, 672), 7);
        assert_eq!(size(&arrow, 10), 1, "a size never drops to nothing");

        let moved = at_frame_height(&arrow, 720);
        assert_eq!((moved.left, moved.top, moved.width, moved.height), (0.1, 0.2, 0.3, 0.4));
        assert_eq!((moved.start_seconds, moved.end_seconds), (1.0, 2.0));
    }

    fn span(start_seconds: f64, end_seconds: f64) -> norisk_ipc::Span {
        norisk_ipc::Span { start_seconds, end_seconds }
    }

    #[test]
    fn a_removed_stretch_is_dropped_and_what_follows_closes_the_gap() {
        let second = TIME_BASE_DEN as i64;
        let gaps = Gaps::new(&[span(2.0, 3.0)], 0, 0, 10 * second);
        let times: Vec<i64> = (0..600).map(|i| i * STEP).collect();

        let out: Vec<i64> = times.iter().filter_map(|&pts| gaps.shift(pts)).collect();

        assert_eq!(out.len(), times.len() - 60, "one second of 60 fps frames should go");
        assert!(out.windows(2).all(|pair| pair[1] - pair[0] == STEP), "the join left a hole or an overlap");
        assert_eq!(gaps.shift(2 * second - STEP), Some(2 * second - STEP), "a frame before the cut moved");
        assert_eq!(gaps.shift(2 * second), None, "the cut's first frame stayed");
        assert_eq!(gaps.shift(3 * second - STEP), None, "the cut's last frame stayed");
        assert_eq!(gaps.shift(3 * second), Some(2 * second), "the first frame after the cut did not close the gap");
    }

    #[test]
    fn removed_stretches_merge_and_stay_inside_the_kept_clip() {
        let second = TIME_BASE_DEN as i64;
        let origin = 5 * second;
        let gaps = Gaps::new(
            &[span(6.0, 7.0), span(1.0, 1.5), span(1.25, 2.0), span(-3.0, 0.5), span(9.0, 99.0)],
            origin,
            origin,
            origin + 8 * second,
        );

        assert_eq!(gaps.shift(origin + second / 4), None);
        assert_eq!(gaps.shift(origin + 7 * second / 4), None);
        assert_eq!(gaps.shift(origin + 13 * second / 2), None);
        assert_eq!(gaps.shift(origin + 3 * second), Some(origin + 3 * second / 2));
        assert_eq!(gaps.shift(origin + 15 * second / 2), Some(origin + 5 * second));
    }

    #[test]
    fn a_removed_stretch_that_makes_no_sense_removes_nothing() {
        let gaps = Gaps::new(
            &[span(f64::NAN, 2.0), span(3.0, f64::INFINITY), span(4.0, 3.0), span(1.0, 1.0)],
            0,
            0,
            10 * TIME_BASE_DEN as i64,
        );

        for pts in [12_345, 3 * TIME_BASE_DEN as i64 / 2, 7 * TIME_BASE_DEN as i64 / 2] {
            assert_eq!(gaps.shift(pts), Some(pts));
        }
    }

    #[test]
    fn a_muted_stretch_follows_the_sound_when_an_earlier_stretch_is_cut_out() {
        let second = TIME_BASE_DEN as i64;
        let gaps = Gaps::new(&[span(1.0, 2.0)], 0, 0, 10 * second);
        let cut = |stream, start_seconds, end_seconds| norisk_ipc::TrackCut {
            stream,
            start_seconds,
            end_seconds,
        };

        let after = hushed(&[cut(2, 4.0, 5.0), cut(1, 4.0, 5.0)], 2, 0, &gaps);
        assert_eq!(after, vec![(3 * second, 4 * second)], "the muted stretch did not move back with the sound");

        let across = hushed(&[cut(2, 1.5, 3.0)], 2, 0, &gaps);
        assert_eq!(across, vec![(second, 2 * second)], "a stretch reaching into the cut was not trimmed to it");

        assert!(hushed(&[cut(2, 1.2, 1.8)], 2, 0, &gaps).is_empty(), "a stretch inside the cut still muted something");
        assert!(hushed(&[cut(2, f64::NAN, 3.0)], 2, 0, &gaps).is_empty());
    }

    #[test]
    fn sound_loses_the_same_stretch_as_the_picture() {
        let second = TIME_BASE_DEN as i64;
        let gaps = Gaps::new(&[span(1.0, 2.0)], 0, 0, 5 * second);
        let frame = second / 50;
        let sound: Vec<Packet> = (0..250).map(|i| packet(i * frame, i * frame, true)).collect();

        let closed = gaps.close(&sound);

        assert_eq!(closed.len(), 200);
        assert!(closed.iter().all(|p| p.pts == p.dts));
        assert!(closed.windows(2).all(|pair| pair[1].pts - pair[0].pts == frame));
    }
}

#[cfg(test)]
mod render_tests {
    #[test]
    #[ignore = "needs a real clip in NRC_TEST_CLIP"]
    fn a_real_clip_takes_a_blur_an_arrow_and_some_text() {
        let source = std::path::PathBuf::from(std::env::var("NRC_TEST_CLIP").unwrap());
        let destination = std::env::temp_dir().join("nrc-overlay-test.mp4");
        let _ = std::fs::remove_file(&destination);

        let overlays = vec![
            norisk_ipc::ClipOverlay {
                kind: norisk_ipc::OverlayKind::Text {
                    content: "NORISK CLIPS".into(),
                    size: 48,
                    colour: 0xff3b30,
                },
                left: 0.08,
                top: 0.62,
                width: 0.84,
                height: 0.2,
                start_seconds: 0.0,
                end_seconds: 999.0,
            },
            norisk_ipc::ClipOverlay {
                kind: norisk_ipc::OverlayKind::Arrow {
                    colour: 0xff3b30,
                    thickness: 9,
                    towards: norisk_ipc::Corner::BottomRight,
                },
                left: 0.55,
                top: 0.12,
                width: 0.3,
                height: 0.3,
                start_seconds: 0.0,
                end_seconds: 999.0,
            },
            norisk_ipc::ClipOverlay {
            kind: norisk_ipc::OverlayKind::Blur { strength: 12 },
            left: 0.0,
            top: 0.0,
            width: 0.45,
            height: 0.22,
            start_seconds: 0.0,
            end_seconds: 999.0,
        }];

        let request = norisk_ipc::ExportVerticalRequest {
            source,
            destination: destination.clone(),
            shape: norisk_ipc::ClipShape::Square,
            overlays,
            ..Default::default()
        };
        let result = super::render(&request, |_, _| {}).unwrap();

        assert_eq!(result.width, result.height, "a square export was not square");
        println!(
            "{}x{}  {:.1}s  {:.1} MB  -> {}",
            result.width,
            result.height,
            result.duration_seconds,
            result.size_bytes as f64 / 1e6,
            destination.display(),
        );
    }

    #[test]
    #[ignore = "needs a real clip in NRC_TEST_CLIP"]
    fn a_cut_render_runs_exactly_as_long_as_the_cut() {
        use crate::encoder::video::TIME_BASE_DEN;

        let source = std::path::PathBuf::from(std::env::var("NRC_TEST_CLIP").unwrap());
        let destination = std::env::temp_dir().join("nrc-cut-render-test.mp4");
        let _ = std::fs::remove_file(&destination);

        let original = crate::trim::read(&source).unwrap();
        let (start, end) = (1.0, (original.duration_seconds() - 1.0).min(11.0));
        assert!(end - start >= 1.0, "the test clip is too short to cut");

        let request = norisk_ipc::ExportVerticalRequest {
            source,
            destination: destination.clone(),
            shape: norisk_ipc::ClipShape::Original,
            start_seconds: Some(start),
            end_seconds: Some(end),
            ..Default::default()
        };
        super::render(&request, |_, _| {}).unwrap();

        let written = crate::trim::read(&destination).unwrap();
        let first = written.video.iter().map(|p| p.pts).min().unwrap();
        let last = written.video.iter().map(|p| p.pts).max().unwrap();
        let frame = TIME_BASE_DEN as i64 / original.track.fps.max(1) as i64;
        let seconds = |ticks: i64| ticks as f64 / TIME_BASE_DEN as f64;

        let video = seconds(last - first + frame);
        let wanted = end - start;
        println!(
            "{} frames, video {video:.3}s for a {wanted:.3}s cut -> {}",
            written.video.len(),
            destination.display(),
        );
        assert!(
            (video - wanted).abs() <= seconds(frame),
            "the picture runs {video:.3}s, not the {wanted:.3}s that was cut"
        );

        let audio_first = written
            .audio
            .first()
            .and_then(|track| track.packets.iter().map(|p| p.pts).min());
        if let Some(audio_first) = audio_first {
            let apart = seconds((audio_first - first).abs());
            println!("sound starts {apart:.3}s away from the picture");
            assert!(apart < 0.1, "sound and picture start {apart:.3}s apart");
        }
    }

    #[test]
    #[ignore = "needs a real clip in NRC_TEST_CLIP"]
    fn a_stretch_cut_out_of_the_middle_shortens_picture_and_sound_alike() {
        use crate::encoder::video::TIME_BASE_DEN;

        let source = std::path::PathBuf::from(std::env::var("NRC_TEST_CLIP").unwrap());
        let destination = std::env::temp_dir().join("nrc-removed-render-test.mp4");
        let _ = std::fs::remove_file(&destination);

        let original = crate::trim::read(&source).unwrap();
        let (start, end) = (1.0, (original.duration_seconds() - 1.0).min(11.0));
        let (gone_from, gone_to) = (start + 2.0, start + 5.0);
        assert!(end > gone_to + 1.0, "the test clip is too short to cut a stretch out of");

        let request = norisk_ipc::ExportVerticalRequest {
            source,
            destination: destination.clone(),
            shape: norisk_ipc::ClipShape::Original,
            start_seconds: Some(start),
            end_seconds: Some(end),
            removed: vec![norisk_ipc::Span { start_seconds: gone_from, end_seconds: gone_to }],
            ..Default::default()
        };
        super::render(&request, |_, _| {}).unwrap();

        let written = crate::trim::read(&destination).unwrap();
        let seconds = |ticks: i64| ticks as f64 / TIME_BASE_DEN as f64;
        let frame = TIME_BASE_DEN as i64 / original.track.fps.max(1) as i64;
        let first = written.video.iter().map(|p| p.pts).min().unwrap();
        let last = written.video.iter().map(|p| p.pts).max().unwrap();

        let video = seconds(last - first + frame);
        let wanted = end - start - (gone_to - gone_from);
        println!("video {video:.3}s for {wanted:.3}s kept -> {}", destination.display());
        assert!(
            (video - wanted).abs() <= 2.0 * seconds(frame),
            "the picture runs {video:.3}s, not the {wanted:.3}s that was kept"
        );

        let mut times: Vec<i64> = written.video.iter().map(|p| p.pts).collect();
        times.sort_unstable();
        let widest = times.windows(2).map(|pair| pair[1] - pair[0]).max().unwrap();
        assert!(seconds(widest) < 0.25, "the picture still has a {:.3}s hole", seconds(widest));

        if let Some(track) = written.audio.first() {
            let sound_first = track.packets.iter().map(|p| p.pts).min().unwrap();
            let sound_last = track.packets.iter().map(|p| p.pts).max().unwrap();
            let sound = seconds(sound_last - sound_first);
            println!("sound {sound:.3}s");
            assert!((sound - wanted).abs() < 0.1, "the sound runs {sound:.3}s, not {wanted:.3}s");
        }
    }
}
