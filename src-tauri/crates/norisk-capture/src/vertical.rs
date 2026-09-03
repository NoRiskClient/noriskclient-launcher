
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use ffmpeg_next::ffi as ff;

use crate::buffer::{Clip, Packet};
use crate::encoder::hw::av_error;
use crate::encoder::video::TIME_BASE_DEN;
use crate::writer::{write_mp4, TrackInfo};

const VERTICAL_WIDTH: i64 = 9;
const VERTICAL_HEIGHT: i64 = 16;

#[derive(Debug, Clone)]
pub struct VerticalResult {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub duration_seconds: f64,
    pub size_bytes: u64,
}

fn centre_crop(width: u32, height: u32) -> (u32, u32, u32, u32) {
    let (width, height) = (width as i64, height as i64);

    if (height * VERTICAL_WIDTH / VERTICAL_HEIGHT) & !1 >= width {
        let keep_width = width & !1;
        let keep_height = (keep_width * VERTICAL_HEIGHT / VERTICAL_WIDTH).min(height) & !1;
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
    let keep_width = (keep_height * VERTICAL_WIDTH / VERTICAL_HEIGHT) & !1;
    let spare = width - keep_width;
    let left = (spare / 2) & !1;

    (
        left as u32,
        (spare - left) as u32,
        0,
        (height - keep_height) as u32,
    )
}

pub fn to_vertical(
    source: &Path,
    destination: &Path,
    progress: impl Fn(u32, u32),
) -> Result<VerticalResult> {
    let clip = crate::trim::read(source)?;

    let (left, right, top, bottom) = centre_crop(clip.track.width, clip.track.height);
    let width = clip.track.width.saturating_sub(left + right);
    let height = clip.track.height.saturating_sub(top + bottom);

    if width == 0 || height == 0 {
        bail!(
            "a {}x{} clip has no 9:16 middle to cut",
            clip.track.width,
            clip.track.height
        );
    }
    if (left, right, top, bottom) == (0, 0, 0, 0) {
        log::info!("{}x{} is already 9:16; only re-encoding", width, height);
    }

    log::info!(
        "Cutting {}x{} down to {width}x{height} (dropping {left}+{right} across, {top}+{bottom} down)",
        clip.track.width,
        clip.track.height,
    );

    let mut decoder = Decoder::open(&clip.track)?;
    let mut encoder = Encoder::open(width, height, clip.track.fps)?;

    let total = clip.video.len() as u32;
    let mut packets: Vec<Packet> = Vec::with_capacity(clip.video.len());

    for (index, packet) in clip.video.iter().enumerate() {
        for frame in decoder.push(packet)? {
            packets.extend(encoder.push(frame, (left, right, top, bottom))?);
        }
        progress(index as u32 + 1, total);
    }
    for frame in decoder.finish()? {
        packets.extend(encoder.push(frame, (left, right, top, bottom))?);
    }
    packets.extend(encoder.finish()?);
    progress(total, total);

    if packets.is_empty() {
        bail!("the clip produced no frames to write");
    }

    let audio = crate::trim::as_recorded_mix(&clip);

    let bytes = packets.iter().map(|p| p.len() as u64).sum::<u64>()
        + audio
            .iter()
            .flat_map(|track| track.packets.iter())
            .map(|p| p.len() as u64)
            .sum::<u64>();

    let start_pts = packets.first().map(|p| p.pts).unwrap_or(0);
    let end_pts = packets.last().map(|p| p.pts).unwrap_or(start_pts);

    let cut = Clip {
        start_pts,
        end_pts,
        bytes,
        playback_start_pts: start_pts,
        packets,
    };

    let track = TrackInfo {
        width,
        height,
        fps: clip.track.fps,
        time_base_den: TIME_BASE_DEN as i64,
        codec: norisk_ipc::ClipCodec::H264,
        extradata: encoder.extradata(),
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

struct Decoder {
    context: *mut ff::AVCodecContext,
    packet: *mut ff::AVPacket,
}

impl Decoder {
    fn open(track: &TrackInfo) -> Result<Self> {
        unsafe {
            let id = match track.codec {
                norisk_ipc::ClipCodec::H264 => ff::AVCodecID::AV_CODEC_ID_H264,
                norisk_ipc::ClipCodec::H265 => ff::AVCodecID::AV_CODEC_ID_HEVC,
                norisk_ipc::ClipCodec::Av1 => ff::AVCodecID::AV_CODEC_ID_AV1,
            };

            let codec = ff::avcodec_find_decoder(id);
            if codec.is_null() {
                bail!("no decoder for {:?} in this FFmpeg build", track.codec);
            }

            let context = ff::avcodec_alloc_context3(codec);
            if context.is_null() {
                bail!("avcodec_alloc_context3 failed for the video decoder");
            }

            let mut guard = Self {
                context,
                packet: std::ptr::null_mut(),
            };

            (*context).width = track.width as i32;
            (*context).height = track.height as i32;

            if !track.extradata.is_empty() {
                let size = track.extradata.len();
                let buffer =
                    ff::av_mallocz(size + ff::AV_INPUT_BUFFER_PADDING_SIZE as usize) as *mut u8;
                if buffer.is_null() {
                    bail!("could not allocate room for the stream header");
                }
                std::ptr::copy_nonoverlapping(track.extradata.as_ptr(), buffer, size);
                (*context).extradata = buffer;
                (*context).extradata_size = size as i32;
            }

            let rc = ff::avcodec_open2(context, codec, std::ptr::null_mut());
            if rc < 0 {
                bail!("opening the video decoder failed: {}", av_error(rc));
            }

            guard.packet = ff::av_packet_alloc();
            if guard.packet.is_null() {
                bail!("av_packet_alloc failed");
            }

            Ok(guard)
        }
    }

    fn push(&mut self, packet: &Packet) -> Result<Vec<Frame>> {
        unsafe {
            ff::av_packet_unref(self.packet);
            let rc = ff::av_new_packet(self.packet, packet.len() as i32);
            if rc < 0 {
                bail!("av_new_packet failed: {}", av_error(rc));
            }
            std::ptr::copy_nonoverlapping(
                packet.data.as_ptr(),
                (*self.packet).data,
                packet.len(),
            );
            (*self.packet).pts = packet.pts;
            (*self.packet).dts = packet.dts;
            if packet.keyframe {
                (*self.packet).flags |= ff::AV_PKT_FLAG_KEY as i32;
            }

            let rc = ff::avcodec_send_packet(self.context, self.packet);
            if rc < 0 && rc != ff::AVERROR(ff::EAGAIN) {
                bail!("avcodec_send_packet failed: {}", av_error(rc));
            }
        }
        self.drain()
    }

    fn finish(&mut self) -> Result<Vec<Frame>> {
        unsafe {
            let rc = ff::avcodec_send_packet(self.context, std::ptr::null());
            if rc < 0 && rc != ff::AVERROR_EOF {
                bail!("flushing the video decoder failed: {}", av_error(rc));
            }
        }
        self.drain()
    }

    fn drain(&mut self) -> Result<Vec<Frame>> {
        let mut out = Vec::new();
        loop {
            let frame = Frame::alloc()?;
            let rc = unsafe { ff::avcodec_receive_frame(self.context, frame.0) };
            if rc == ff::AVERROR(ff::EAGAIN) || rc == ff::AVERROR_EOF {
                break;
            }
            if rc < 0 {
                bail!("avcodec_receive_frame failed: {}", av_error(rc));
            }
            out.push(frame);
        }
        Ok(out)
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        unsafe {
            ff::av_packet_free(&mut self.packet);
            ff::avcodec_free_context(&mut self.context);
        }
    }
}

struct Frame(*mut ff::AVFrame);

impl Frame {
    fn alloc() -> Result<Self> {
        let frame = unsafe { ff::av_frame_alloc() };
        if frame.is_null() {
            bail!("av_frame_alloc failed");
        }
        Ok(Self(frame))
    }
}

impl Drop for Frame {
    fn drop(&mut self) {
        unsafe { ff::av_frame_free(&mut self.0) };
    }
}

struct Encoder {
    context: *mut ff::AVCodecContext,
    packet: *mut ff::AVPacket,
    next_pts: i64,
    fps: i64,
}

impl Encoder {
    fn open(width: u32, height: u32, fps: u32) -> Result<Self> {
        unsafe {
            let name = c"libx264";
            let codec = ff::avcodec_find_encoder_by_name(name.as_ptr());
            let codec = if codec.is_null() {
                ff::avcodec_find_encoder(ff::AVCodecID::AV_CODEC_ID_H264)
            } else {
                codec
            };
            if codec.is_null() {
                bail!("no H.264 encoder in this FFmpeg build");
            }

            let context = ff::avcodec_alloc_context3(codec);
            if context.is_null() {
                bail!("avcodec_alloc_context3 failed for the video encoder");
            }

            let fps = fps.max(1) as i64;
            let mut guard = Self {
                context,
                packet: std::ptr::null_mut(),
                next_pts: 0,
                fps,
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
            (*context).flags |= ff::AV_CODEC_FLAG_GLOBAL_HEADER as i32;
            (*context).thread_count = 0;
            if !(*context).priv_data.is_null() {
                ff::av_opt_set((*context).priv_data, c"preset".as_ptr(), c"veryfast".as_ptr(), 0);
            }

            let rc = ff::avcodec_open2(context, codec, std::ptr::null_mut());
            if rc < 0 {
                bail!("opening the H.264 encoder failed: {}", av_error(rc));
            }

            guard.packet = ff::av_packet_alloc();
            if guard.packet.is_null() {
                bail!("av_packet_alloc failed");
            }

            Ok(guard)
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

            (*frame.0).pts = self.next_pts;
            self.next_pts += TIME_BASE_DEN as i64 / self.fps;

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

unsafe impl Send for Decoder {}
unsafe impl Send for Encoder {}

#[cfg(test)]
mod tests {
    use super::*;

    fn cropped(width: u32, height: u32) -> (u32, u32) {
        let (left, right, top, bottom) = centre_crop(width, height);
        (width - left - right, height - top - bottom)
    }

    #[test]
    fn a_landscape_clip_loses_its_sides() {
        assert_eq!(cropped(1920, 1080), (606, 1080));
        assert_eq!(cropped(2560, 1440), (810, 1440));
    }

    #[test]
    fn what_is_left_is_nine_by_sixteen() {
        for (width, height) in [(1920, 1080), (2560, 1440), (3840, 2160), (1280, 720)] {
            let (w, h) = cropped(width, height);
            let ratio = w as f64 / h as f64;
            let wanted = VERTICAL_WIDTH as f64 / VERTICAL_HEIGHT as f64;
            assert!(
                (ratio - wanted).abs() < 0.01,
                "{width}x{height} cropped to {w}x{h}, ratio {ratio:.4}",
            );
        }
    }

    #[test]
    fn the_cut_is_centred() {
        let (left, right, _, _) = centre_crop(1920, 1080);
        assert!(
            left.abs_diff(right) <= 2,
            "the column should sit in the middle: {left} vs {right}",
        );
    }

    #[test]
    fn every_offset_is_even() {
        for (width, height) in [(1920, 1080), (2559, 1439), (1281, 721), (3840, 2160)] {
            let (left, _, top, _) = centre_crop(width, height);
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
        let (left, right, top, bottom) = centre_crop(1080, 2400);
        assert_eq!((left, right), (0, 0), "nothing should come off the sides");
        assert!(top > 0 && bottom > 0);

        let (w, h) = cropped(1080, 2400);
        assert_eq!(w, 1080);
        assert_eq!(h, 1920, "1080 wide at 9:16 is 1920 tall");
    }

    #[test]
    fn a_clip_already_at_the_right_shape_is_left_alone() {
        assert_eq!(centre_crop(1080, 1920), (0, 0, 0, 0));
    }

    #[test]
    fn a_square_clip_loses_its_sides() {
        let (w, h) = cropped(1000, 1000);
        assert!(w < h, "a square has to become taller than it is wide: {w}x{h}");
    }
}

#[cfg(test)]
mod probe {
    #[test]
    #[ignore = "needs a real clip; run it by hand"]
    fn probe_export() {
        let Ok(source) = std::env::var("NRC_CLIP") else {
            println!("set NRC_CLIP to a clip to try this");
            return;
        };
        let destination = std::env::temp_dir().join("nrc-vertical-probe.mp4");
        let _ = std::fs::remove_file(&destination);

        let started = std::time::Instant::now();
        match super::to_vertical(std::path::Path::new(&source), &destination, |_, _| {}) {
            Ok(result) => println!(
                "OK  {}x{}  {:.1}s  {:.1} MB  in {} ms  -> {}",
                result.width,
                result.height,
                result.duration_seconds,
                result.size_bytes as f64 / 1e6,
                started.elapsed().as_millis(),
                result.path.display(),
            ),
            Err(e) => println!("FAILED after {} ms: {e:#}", started.elapsed().as_millis()),
        }
    }
}
