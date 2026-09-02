use std::ffi::CString;
use std::path::Path;

use anyhow::{bail, Context, Result};
use ffmpeg_next::ffi as ff;
use norisk_ipc::ClipCodec;

use crate::buffer::Clip;
use crate::encoder::hw::av_error;

#[derive(Debug, Clone)]
pub struct WrittenClip {
    pub path: std::path::PathBuf,
    pub duration_seconds: f64,
    pub size_bytes: u64,
    pub width: u32,
    pub height: u32,
    pub frames: usize,
}

#[derive(Debug, Clone)]
pub struct TrackInfo {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub time_base_den: i64,
    pub codec: ClipCodec,
    pub extradata: Vec<u8>,
}

fn codec_id(codec: ClipCodec) -> ff::AVCodecID {
    match codec {
        ClipCodec::H264 => ff::AVCodecID::AV_CODEC_ID_H264,
        ClipCodec::H265 => ff::AVCodecID::AV_CODEC_ID_HEVC,
        ClipCodec::Av1 => ff::AVCodecID::AV_CODEC_ID_AV1,
    }
}

#[derive(Debug, Clone)]
pub struct AudioTrack {
    pub sample_rate: u32,
    pub channels: u32,
    pub extradata: Vec<u8>,
    pub packets: Vec<crate::buffer::Packet>,
    pub label: String,
}

impl AudioTrack {
    fn usable(&self) -> bool {
        !self.packets.is_empty() && !self.extradata.is_empty()
    }
}

pub fn write_mp4(
    clip: &Clip,
    path: &Path,
    track: &TrackInfo,
    audio: &[AudioTrack],
) -> Result<WrittenClip> {
    if clip.packets.is_empty() {
        bail!("refusing to write an empty clip");
    }
    if track.extradata.is_empty() {
        bail!("no codec header available — the MP4 track header would be incomplete");
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let path_c = CString::new(path.to_string_lossy().as_ref())
        .context("clip path contains an interior nul")?;

    unsafe {
        let mut format_ctx: *mut ff::AVFormatContext = std::ptr::null_mut();
        let rc = ff::avformat_alloc_output_context2(
            &mut format_ctx,
            std::ptr::null_mut(),
            std::ptr::null(),
            path_c.as_ptr(),
        );
        if rc < 0 || format_ctx.is_null() {
            bail!("could not create an MP4 context: {}", av_error(rc));
        }

        let mut guard = FormatGuard::new(format_ctx);

        let stream = ff::avformat_new_stream(format_ctx, std::ptr::null());
        if stream.is_null() {
            bail!("avformat_new_stream failed");
        }

        let params = (*stream).codecpar;
        (*params).codec_type = ff::AVMediaType::AVMEDIA_TYPE_VIDEO;
        (*params).codec_id = codec_id(track.codec);
        (*params).width = track.width as i32;
        (*params).height = track.height as i32;
        (*params).format = ff::AVPixelFormat::AV_PIX_FMT_YUV420P as i32;

        let extradata = ff::av_malloc(track.extradata.len() + ff::AV_INPUT_BUFFER_PADDING_SIZE as usize)
            as *mut u8;
        if extradata.is_null() {
            bail!("could not allocate extradata");
        }
        std::ptr::copy_nonoverlapping(track.extradata.as_ptr(), extradata, track.extradata.len());
        std::ptr::write_bytes(
            extradata.add(track.extradata.len()),
            0,
            ff::AV_INPUT_BUFFER_PADDING_SIZE as usize,
        );
        (*params).extradata = extradata;
        (*params).extradata_size = track.extradata.len() as i32;

        let time_base = ff::AVRational {
            num: 1,
            den: track.time_base_den as i32,
        };
        (*stream).time_base = time_base;
        (*stream).avg_frame_rate = ff::AVRational {
            num: track.fps as i32,
            den: 1,
        };

        let mut audio_streams: Vec<(usize, i32)> = Vec::with_capacity(audio.len());
        for (position, wanted) in audio.iter().enumerate() {
            if !wanted.usable() {
                log::warn!(
                    "Audio track {position} ({}) had no packets or no header and was left out",
                    if wanted.label.is_empty() { "unnamed" } else { &wanted.label }
                );
                continue;
            }

            let stream = ff::avformat_new_stream(format_ctx, std::ptr::null());
            if stream.is_null() {
                bail!("avformat_new_stream failed for audio");
            }
            let params = (*stream).codecpar;
            (*params).codec_type = ff::AVMediaType::AVMEDIA_TYPE_AUDIO;
            (*params).codec_id = ff::AVCodecID::AV_CODEC_ID_AAC;
            (*params).sample_rate = wanted.sample_rate as i32;
            (*params).format = ff::AVSampleFormat::AV_SAMPLE_FMT_FLTP as i32;
            ff::av_channel_layout_default(&mut (*params).ch_layout, wanted.channels as i32);

            let extradata = ff::av_malloc(
                wanted.extradata.len() + ff::AV_INPUT_BUFFER_PADDING_SIZE as usize,
            ) as *mut u8;
            if extradata.is_null() {
                bail!("could not allocate audio extradata");
            }
            std::ptr::copy_nonoverlapping(
                wanted.extradata.as_ptr(),
                extradata,
                wanted.extradata.len(),
            );
            std::ptr::write_bytes(
                extradata.add(wanted.extradata.len()),
                0,
                ff::AV_INPUT_BUFFER_PADDING_SIZE as usize,
            );
            (*params).extradata = extradata;
            (*params).extradata_size = wanted.extradata.len() as i32;

            (*stream).time_base = ff::AVRational {
                num: 1,
                den: track.time_base_den as i32,
            };

            if audio_streams.is_empty() {
                (*stream).disposition |= ff::AV_DISPOSITION_DEFAULT;
            }

            if !wanted.label.is_empty() {
                name_stream(stream, &wanted.label)?;
            }

            audio_streams.push((position, (*stream).index));
        }

        let rc = ff::avio_open(&mut (*format_ctx).pb, path_c.as_ptr(), ff::AVIO_FLAG_WRITE);
        if rc < 0 {
            bail!("could not open {} for writing: {}", path.display(), av_error(rc));
        }
        guard.1 = true;

        (*format_ctx).avoid_negative_ts = ff::AVFMT_AVOID_NEG_TS_DISABLED;

        let rc = ff::avformat_write_header(format_ctx, std::ptr::null_mut());
        if rc < 0 {
            bail!("avformat_write_header failed: {}", av_error(rc));
        }

        let source_time_base = ff::AVRational {
            num: 1,
            den: track.time_base_den as i32,
        };
        let stream_time_bases: Vec<ff::AVRational> = (0..(*format_ctx).nb_streams)
            .map(|i| (**(*format_ctx).streams.add(i as usize)).time_base)
            .collect();

        let origin = clip.playback_start_pts.min(clip.end_pts);
        let frame_ticks = (track.time_base_den / track.fps.max(1) as i64).max(1);

        let packet = ff::av_packet_alloc();
        if packet.is_null() {
            bail!("av_packet_alloc failed");
        }
        let _packet_guard = PacketGuard(packet);

        let mut queue: Vec<(i64, i32, &crate::buffer::Packet, i64)> = clip
            .packets
            .iter()
            .map(|p| (p.pts, 0i32, p, frame_ticks))
            .collect();

        for (position, index) in &audio_streams {
            let source = &audio[*position];
            let audio_ticks =
                (track.time_base_den * 1024 / source.sample_rate.max(1) as i64).max(1);
            queue.extend(
                source
                    .packets
                    .iter()
                    .map(|p| (p.pts, *index, p, audio_ticks)),
            );
        }
        queue.sort_by_key(|(pts, _, _, _)| *pts);

        for (_, stream_index, source, duration) in queue {
            let rc = ff::av_new_packet(packet, source.data.len() as i32);
            if rc < 0 {
                bail!("av_new_packet failed: {}", av_error(rc));
            }
            std::ptr::copy_nonoverlapping(
                source.data.as_ptr(),
                (*packet).data,
                source.data.len(),
            );

            let pts = source.pts - origin;
            (*packet).stream_index = stream_index;
            (*packet).pts = pts;
            (*packet).dts = pts;
            (*packet).duration = duration;
            (*packet).flags = if source.keyframe {
                ff::AV_PKT_FLAG_KEY
            } else {
                0
            };

            if let Some(target) = stream_time_bases.get(stream_index as usize) {
                ff::av_packet_rescale_ts(packet, source_time_base, *target);
            }

            let rc = ff::av_interleaved_write_frame(format_ctx, packet);
            if rc < 0 {
                bail!("writing a packet failed: {}", av_error(rc));
            }
        }

        let rc = ff::av_write_trailer(format_ctx);
        if rc < 0 {
            bail!("av_write_trailer failed: {}", av_error(rc));
        }

        drop(guard);

        let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let duration_seconds = clip.duration_seconds(track.time_base_den);

        Ok(WrittenClip {
            path: path.to_path_buf(),
            duration_seconds,
            size_bytes,
            width: track.width,
            height: track.height,
            frames: clip.packets.len(),
        })
    }
}

unsafe fn name_stream(stream: *mut ff::AVStream, label: &str) -> Result<()> {
    let value = CString::new(label).context("a track label contains an interior nul")?;
    for key in ["title", "handler_name"] {
        let key = CString::new(key).expect("literal key has no nul");
        let rc = ff::av_dict_set(&mut (*stream).metadata, key.as_ptr(), value.as_ptr(), 0);
        if rc < 0 {
            bail!("could not label an audio track: {}", av_error(rc));
        }
    }
    Ok(())
}

struct FormatGuard(*mut ff::AVFormatContext, bool);

impl FormatGuard {
    fn new(ctx: *mut ff::AVFormatContext) -> Self {
        Self(ctx, false)
    }
}

impl Drop for FormatGuard {
    fn drop(&mut self) {
        unsafe {
            if !self.0.is_null() {
                if self.1 && !(*self.0).pb.is_null() {
                    ff::avio_closep(&mut (*self.0).pb);
                }
                ff::avformat_free_context(self.0);
            }
        }
    }
}

struct PacketGuard(*mut ff::AVPacket);

impl Drop for PacketGuard {
    fn drop(&mut self) {
        unsafe {
            let mut packet = self.0;
            ff::av_packet_free(&mut packet);
        }
    }
}