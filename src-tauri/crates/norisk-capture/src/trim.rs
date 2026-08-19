use std::ffi::CString;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use ffmpeg_next::ffi as ff;
use norisk_ipc::ClipCodec;

use crate::buffer::{Clip, Packet};
use crate::encoder::hw::av_error;
use crate::encoder::video::TIME_BASE_DEN;
use crate::writer::{write_mp4, AudioTrack, TrackInfo, WrittenClip};

#[derive(Debug, Clone)]
pub struct TrimResult {
    pub path: PathBuf,
    pub duration_seconds: f64,
    pub size_bytes: u64,
    pub start_seconds: f64,
    pub end_seconds: f64,
}

pub fn trim(source: &Path, destination: &Path, start_seconds: f64, end_seconds: f64) -> Result<TrimResult> {
    let clip = read(source)?;

    let (start_seconds, end_seconds) =
        usable_range(start_seconds, end_seconds, clip.duration_seconds())?;

    let want_start = clip.first_pts + (start_seconds * TIME_BASE_DEN as f64) as i64;
    let want_end = clip.first_pts + (end_seconds * TIME_BASE_DEN as f64) as i64;

    let begin = clip
        .video
        .iter()
        .filter(|p| p.keyframe && p.pts <= want_start)
        .map(|p| p.pts)
        .next_back()
        .unwrap_or(clip.first_pts);

    let video: Vec<Packet> = clip
        .video
        .iter()
        .filter(|p| p.pts >= begin && p.pts <= want_end)
        .cloned()
        .collect();

    if video.is_empty() {
        bail!("no frames fall inside {start_seconds:.1}s to {end_seconds:.1}s");
    }

    let audio: Vec<Packet> = clip
        .audio
        .iter()
        .filter(|p| p.pts >= begin && p.pts <= want_end)
        .cloned()
        .collect();

    let bytes = video.iter().map(|p| p.len() as u64).sum::<u64>()
        + audio.iter().map(|p| p.len() as u64).sum::<u64>();
    let end_pts = video.last().map(|p| p.pts).unwrap_or(want_end);

    let cut = Clip {
        start_pts: begin,
        end_pts,
        bytes,
        playback_start_pts: want_start.max(begin),
        packets: video,
    };

    let audio_track = clip.audio_format.as_ref().map(|format| AudioTrack {
        sample_rate: format.sample_rate,
        channels: format.channels,
        extradata: format.extradata.clone(),
        packets: audio,
    });

    let written: WrittenClip = write_mp4(&cut, destination, &clip.track, audio_track.as_ref())
        .with_context(|| format!("could not write the trimmed clip to {}", destination.display()))?;

    Ok(TrimResult {
        path: written.path,
        duration_seconds: written.duration_seconds,
        size_bytes: written.size_bytes,
        start_seconds: (want_start.max(begin) - clip.first_pts) as f64 / TIME_BASE_DEN as f64,
        end_seconds: (end_pts - clip.first_pts) as f64 / TIME_BASE_DEN as f64,
    })
}

const MIN_TRIM_SECONDS: f64 = 0.5;

fn usable_range(start: f64, end: f64, duration: f64) -> Result<(f64, f64)> {
    if !start.is_finite() || !end.is_finite() {
        bail!("the trim range has to be two real numbers");
    }

    let start = start.max(0.0);
    let end = end.min(duration);

    if end - start < MIN_TRIM_SECONDS {
        bail!(
            "a trimmed clip has to be at least {MIN_TRIM_SECONDS} seconds long, and \
             {start:.1}s to {end:.1}s is not"
        );
    }
    Ok((start, end))
}

struct SourceClip {
    track: TrackInfo,
    audio_format: Option<AudioFormat>,
    video: Vec<Packet>,
    audio: Vec<Packet>,
    first_pts: i64,
}

struct AudioFormat {
    sample_rate: u32,
    channels: u32,
    extradata: Vec<u8>,
}

impl SourceClip {
    fn duration_seconds(&self) -> f64 {
        match self.video.last() {
            Some(last) => ((last.pts - self.first_pts).max(0)) as f64 / TIME_BASE_DEN as f64,
            None => 0.0,
        }
    }
}

fn read(path: &Path) -> Result<SourceClip> {
    let c_path = CString::new(path.as_os_str().to_string_lossy().as_bytes())
        .context("the clip path contains an interior nul")?;

    unsafe {
        let mut format_ctx: *mut ff::AVFormatContext = std::ptr::null_mut();
        let rc = ff::avformat_open_input(
            &mut format_ctx,
            c_path.as_ptr(),
            std::ptr::null(),
            std::ptr::null_mut(),
        );
        if rc < 0 {
            bail!("could not open {}: {}", path.display(), av_error(rc));
        }
        let _guard = InputGuard(format_ctx);

        let rc = ff::avformat_find_stream_info(format_ctx, std::ptr::null_mut());
        if rc < 0 {
            bail!("could not read the streams in {}: {}", path.display(), av_error(rc));
        }

        let video_index = ff::av_find_best_stream(
            format_ctx,
            ff::AVMediaType::AVMEDIA_TYPE_VIDEO,
            -1,
            -1,
            std::ptr::null_mut(),
            0,
        );
        if video_index < 0 {
            bail!("{} has no video track", path.display());
        }
        let audio_index = ff::av_find_best_stream(
            format_ctx,
            ff::AVMediaType::AVMEDIA_TYPE_AUDIO,
            -1,
            -1,
            std::ptr::null_mut(),
            0,
        );

        let track = video_track(format_ctx, video_index)?;
        let audio_format = if audio_index >= 0 {
            Some(audio_format(format_ctx, audio_index)?)
        } else {
            None
        };

        let ours = ff::AVRational {
            num: 1,
            den: TIME_BASE_DEN,
        };
        let video_base = (**(*format_ctx).streams.add(video_index as usize)).time_base;
        let audio_base = (audio_index >= 0)
            .then(|| (**(*format_ctx).streams.add(audio_index as usize)).time_base);

        let packet = ff::av_packet_alloc();
        if packet.is_null() {
            bail!("av_packet_alloc failed");
        }
        let _packet_guard = PacketGuard(packet);

        let mut video = Vec::new();
        let mut audio = Vec::new();

        loop {
            let rc = ff::av_read_frame(format_ctx, packet);
            if rc == ff::AVERROR_EOF {
                break;
            }
            if rc < 0 {
                bail!("reading {} failed: {}", path.display(), av_error(rc));
            }

            let index = (*packet).stream_index;
            let (target, source_base) = if index == video_index {
                (&mut video, video_base)
            } else if Some(index) == (audio_index >= 0).then_some(audio_index) {
                (&mut audio, audio_base.unwrap_or(ours))
            } else {
                ff::av_packet_unref(packet);
                continue;
            };

            let pts = ff::av_rescale_q((*packet).pts, source_base, ours);
            let dts = ff::av_rescale_q((*packet).dts, source_base, ours);
            let data =
                std::slice::from_raw_parts((*packet).data, (*packet).size.max(0) as usize).to_vec();

            target.push(Packet {
                data,
                pts,
                dts,
                keyframe: (*packet).flags & ff::AV_PKT_FLAG_KEY != 0,
            });

            ff::av_packet_unref(packet);
        }

        if video.is_empty() {
            bail!("{} holds no video frames", path.display());
        }

        video.sort_by_key(|p: &Packet| p.pts);
        audio.sort_by_key(|p: &Packet| p.pts);

        let start_time = (**(*format_ctx).streams.add(video_index as usize)).start_time;
        let first_pts = if start_time == ff::AV_NOPTS_VALUE {
            video[0].pts
        } else {
            ff::av_rescale_q(start_time, video_base, ours)
        };

        Ok(SourceClip {
            track,
            audio_format,
            video,
            audio,
            first_pts,
        })
    }
}

unsafe fn video_track(format_ctx: *mut ff::AVFormatContext, index: i32) -> Result<TrackInfo> {
    let stream = *(*format_ctx).streams.add(index as usize);
    let par = (*stream).codecpar;

    let codec = match (*par).codec_id {
        ff::AVCodecID::AV_CODEC_ID_H264 => ClipCodec::H264,
        ff::AVCodecID::AV_CODEC_ID_HEVC => ClipCodec::H265,
        ff::AVCodecID::AV_CODEC_ID_AV1 => ClipCodec::Av1,
        other => bail!("this clip is in a codec the trimmer does not know: {other:?}"),
    };

    let rate = if (*stream).avg_frame_rate.num > 0 {
        (*stream).avg_frame_rate
    } else {
        (*stream).r_frame_rate
    };
    let fps = if rate.den > 0 {
        (rate.num as f64 / rate.den as f64).round().max(1.0) as u32
    } else {
        60
    };

    let extradata = if (*par).extradata.is_null() || (*par).extradata_size <= 0 {
        bail!("this clip has no codec header, so a trimmed copy would not decode");
    } else {
        std::slice::from_raw_parts((*par).extradata, (*par).extradata_size as usize).to_vec()
    };

    Ok(TrackInfo {
        width: (*par).width.max(0) as u32,
        height: (*par).height.max(0) as u32,
        fps,
        time_base_den: TIME_BASE_DEN as i64,
        codec,
        extradata,
    })
}

unsafe fn audio_format(format_ctx: *mut ff::AVFormatContext, index: i32) -> Result<AudioFormat> {
    let stream = *(*format_ctx).streams.add(index as usize);
    let par = (*stream).codecpar;

    let extradata = if (*par).extradata.is_null() || (*par).extradata_size <= 0 {
        Vec::new()
    } else {
        std::slice::from_raw_parts((*par).extradata, (*par).extradata_size as usize).to_vec()
    };

    Ok(AudioFormat {
        sample_rate: (*par).sample_rate.max(0) as u32,
        channels: (*par).ch_layout.nb_channels.max(0) as u32,
        extradata,
    })
}

struct InputGuard(*mut ff::AVFormatContext);

impl Drop for InputGuard {
    fn drop(&mut self) {
        unsafe { ff::avformat_close_input(&mut self.0) };
    }
}

struct PacketGuard(*mut ff::AVPacket);

impl Drop for PacketGuard {
    fn drop(&mut self) {
        unsafe { ff::av_packet_free(&mut self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(pts: i64, keyframe: bool) -> Packet {
        Packet {
            data: vec![0; 10],
            pts,
            dts: pts,
            keyframe,
        }
    }

    fn ten_seconds() -> Vec<Packet> {
        (0..600)
            .map(|i| {
                let pts = i * (TIME_BASE_DEN as i64 / 60);
                frame(pts, i % 120 == 0)
            })
            .collect()
    }

    #[test]
    fn the_copied_data_begins_at_a_keyframe() {
        let packets = ten_seconds();
        let want_start = 5 * TIME_BASE_DEN as i64; // 5.0 s, mid group

        let begin = packets
            .iter()
            .filter(|p| p.keyframe && p.pts <= want_start)
            .map(|p| p.pts)
            .next_back()
            .unwrap();

        assert_eq!(
            begin,
            4 * TIME_BASE_DEN as i64,
            "5 s should fall back to the keyframe at 4 s"
        );
    }

    #[test]
    fn a_start_on_a_keyframe_needs_no_lead_in() {
        let packets = ten_seconds();
        let want_start = 6 * TIME_BASE_DEN as i64;

        let begin = packets
            .iter()
            .filter(|p| p.keyframe && p.pts <= want_start)
            .map(|p| p.pts)
            .next_back()
            .unwrap();

        assert_eq!(begin, want_start);
    }

    #[test]
    fn the_end_is_exact() {
        let packets = ten_seconds();
        let want_end = 7 * TIME_BASE_DEN as i64 + TIME_BASE_DEN as i64 / 60;

        let kept: Vec<&Packet> = packets.iter().filter(|p| p.pts <= want_end).collect();
        let last = kept.last().unwrap().pts;

        assert!(
            (want_end - last) < TIME_BASE_DEN as i64 / 60,
            "the last kept frame should sit within one frame of the request"
        );
    }


    #[test]
    fn a_range_too_short_to_keep_is_refused() {
        assert!(usable_range(1.0, 1.2, 10.0).is_err());
        assert!(usable_range(1.0, 2.0, 10.0).is_ok());
    }

    #[test]
    fn a_range_past_the_end_is_clamped() {
        assert_eq!(usable_range(2.0, 99.0, 10.0).unwrap(), (2.0, 10.0));
        assert_eq!(usable_range(-5.0, 4.0, 10.0).unwrap(), (0.0, 4.0));
    }

    #[test]
    fn a_range_that_is_not_a_number_is_refused() {
        assert!(usable_range(f64::NAN, 5.0, 10.0).is_err());
        assert!(usable_range(0.0, f64::NAN, 10.0).is_err());
        assert!(usable_range(0.0, f64::INFINITY, 10.0).is_err());
    }

    #[test]
    fn a_clip_with_lead_in_is_measured_from_where_it_plays() {
        let second = TIME_BASE_DEN as i64;

        let clip = SourceClip {
            track: TrackInfo {
                width: 1920,
                height: 1080,
                fps: 60,
                time_base_den: second,
                codec: ClipCodec::H264,
                extradata: vec![0; 4],
            },
            audio_format: None,
            video: (-60..420)
                .map(|i| frame(i * second / 60, i % 120 == 0))
                .collect(),
            audio: Vec::new(),
            first_pts: 0,
        };

        assert!(
            (clip.duration_seconds() - 7.0).abs() < 0.05,
            "seven seconds play, not the eight that are stored — got {:.2}",
            clip.duration_seconds()
        );
    }
}
