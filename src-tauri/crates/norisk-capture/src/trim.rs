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

pub fn trim(
    source: &Path,
    destination: &Path,
    start_seconds: f64,
    end_seconds: f64,
    levels: &[norisk_ipc::TrackLevel],
) -> Result<TrimResult> {
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
        .skip_while(|p| p.pts < begin)
        .take_while(|p| p.pts <= want_end)
        .cloned()
        .collect();

    if video.is_empty() {
        bail!("no frames fall inside {start_seconds:.1}s to {end_seconds:.1}s");
    }

    let audio: Vec<AudioSource> = clip
        .audio
        .iter()
        .map(|track| AudioSource {
            format: track.format.clone(),
            packets: track
                .packets
                .iter()
                .filter(|p| p.pts >= begin && p.pts <= want_end)
                .cloned()
                .collect(),
        })
        .collect();

    let end_pts = video.last().map(|p| p.pts).unwrap_or(want_end);
    let audio_track = build_audio(&audio, levels)?;

    let bytes = video.iter().map(|p| p.len() as u64).sum::<u64>()
        + audio_track
            .iter()
            .flat_map(|t| t.packets.iter())
            .map(|p| p.len() as u64)
            .sum::<u64>();

    let cut = Clip {
        start_pts: begin,
        end_pts,
        bytes,
        playback_start_pts: want_start.max(begin),
        packets: video,
    };

    let written: WrittenClip = write_mp4(&cut, destination, &clip.track, &audio_track)
        .with_context(|| format!("could not write the trimmed clip to {}", destination.display()))?;

    Ok(TrimResult {
        path: written.path,
        duration_seconds: written.duration_seconds,
        size_bytes: written.size_bytes,
        start_seconds: (want_start.max(begin) - clip.first_pts) as f64 / TIME_BASE_DEN as f64,
        end_seconds: (end_pts - clip.first_pts) as f64 / TIME_BASE_DEN as f64,
    })
}

#[cfg(windows)]
fn build_audio(
    audio: &[AudioSource],
    levels: &[norisk_ipc::TrackLevel],
) -> Result<Vec<AudioTrack>> {
    let Some(mix) = audio.first() else {
        return Ok(Vec::new());
    };

    if !norisk_ipc::levels_change_anything(levels) {
        return Ok(as_recorded(mix));
    }

    let stems: Vec<&AudioSource> = audio.iter().skip(1).collect();
    if stems.is_empty() {
        log::info!("This clip was recorded before the tracks were kept apart, so its balance is fixed; copying the mix");
        return Ok(as_recorded(mix));
    }

    match remix(&stems, levels) {
        Ok(track) => Ok(vec![track]),
        Err(e) => {
            log::warn!("Could not rebuild the mix, keeping the recorded one: {e:#}");
            Ok(as_recorded(mix))
        }
    }
}

#[cfg(not(windows))]
fn build_audio(
    audio: &[AudioSource],
    _levels: &[norisk_ipc::TrackLevel],
) -> Result<Vec<AudioTrack>> {
    Ok(audio.first().map(as_recorded).unwrap_or_default())
}

pub(crate) fn as_recorded_mix(clip: &SourceClip) -> Vec<AudioTrack> {
    match clip.audio.first() {
        Some(mix) => as_recorded(mix),
        None => Vec::new(),
    }
}

fn as_recorded(source: &AudioSource) -> Vec<AudioTrack> {
    if source.packets.is_empty() {
        return Vec::new();
    }
    vec![AudioTrack {
        sample_rate: source.format.sample_rate,
        channels: source.format.channels,
        extradata: source.format.extradata.clone(),
        packets: source.packets.clone(),
        label: source.format.label.clone(),
    }]
}

#[cfg(windows)]
fn remix(stems: &[&AudioSource], levels: &[norisk_ipc::TrackLevel]) -> Result<AudioTrack> {
    use crate::audio::decoder::decode_all;
    use crate::audio::encoder::{AudioEncoder, DEFAULT_BITRATE, OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE};

    let start_pts = stems
        .iter()
        .filter_map(|stem| stem.packets.first().map(|p| p.pts))
        .min()
        .context("none of the clip's separate tracks has any audio in this range")?;

    let mut mixed: Vec<f32> = Vec::new();

    for (index, stem) in stems.iter().enumerate() {
        if stem.packets.is_empty() {
            continue;
        }

        let stream = (index + 1) as u32;
        let gain = levels
            .iter()
            .find(|level| level.stream == stream)
            .map(|level| level.gain())
            .unwrap_or(1.0);
        if gain == 0.0 {
            log::info!("Track {stream} was turned all the way down");
            continue;
        }

        let samples = decode_all(
            stem.format.sample_rate,
            stem.format.channels,
            &stem.format.extradata,
            &stem.packets,
        )?;

        let offset = ((stem.packets[0].pts - start_pts).max(0) as i128
            * OUTPUT_SAMPLE_RATE as i128
            * OUTPUT_CHANNELS as i128
            / TIME_BASE_DEN as i128) as usize;

        if mixed.len() < offset + samples.len() {
            mixed.resize(offset + samples.len(), 0.0);
        }
        for (into, sample) in mixed[offset..].iter_mut().zip(&samples) {
            *into += sample * gain;
        }
    }

    if mixed.is_empty() {
        bail!("every track was silent, so there is nothing to encode");
    }

    for sample in &mut mixed {
        *sample = sample.clamp(-1.0, 1.0);
    }

    let format = crate::audio::AudioFormat {
        sample_rate: OUTPUT_SAMPLE_RATE as u32,
        channels: OUTPUT_CHANNELS as u16,
    };
    let mut encoder = AudioEncoder::open(format, DEFAULT_BITRATE)
        .context("could not open an encoder for the rebuilt mix")?;

    let start_100ns = (start_pts as i128 * 10_000_000 / TIME_BASE_DEN as i128) as i64;
    let mut packets = encoder.push(&mixed, start_100ns)?;
    packets.extend(encoder.finish()?);

    if packets.is_empty() {
        bail!("the rebuilt mix produced no packets");
    }

    let extradata = encoder.extradata();
    if extradata.is_empty() {
        bail!("the rebuilt mix has no codec header, so it would not decode");
    }

    log::info!(
        "Rebuilt the mix from {} track(s) into {:.1}s of audio",
        stems.len(),
        mixed.len() as f64 / (OUTPUT_SAMPLE_RATE as f64 * OUTPUT_CHANNELS as f64)
    );

    Ok(AudioTrack {
        sample_rate: OUTPUT_SAMPLE_RATE as u32,
        channels: OUTPUT_CHANNELS as u32,
        extradata,
        packets,
        label: crate::audio::MIX_LABEL.to_string(),
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

pub(crate) struct SourceClip {
    pub(crate) track: TrackInfo,
    pub(crate) video: Vec<Packet>,
    pub(crate) audio: Vec<AudioSource>,
    pub(crate) first_pts: i64,
}

pub(crate) struct AudioSource {
    pub(crate) format: AudioFormat,
    pub(crate) packets: Vec<Packet>,
}

#[derive(Clone)]
#[allow(dead_code)]
pub(crate) struct AudioFormat {
    pub(crate) sample_rate: u32,
    pub(crate) channels: u32,
    pub(crate) extradata: Vec<u8>,
    pub(crate) label: String,
}

impl SourceClip {
    fn duration_seconds(&self) -> f64 {
        match self.video.last() {
            Some(last) => ((last.pts - self.first_pts).max(0)) as f64 / TIME_BASE_DEN as f64,
            None => 0.0,
        }
    }
}

pub(crate) fn read(path: &Path) -> Result<SourceClip> {
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

        let track = video_track(format_ctx, video_index)?;

        let audio_indices: Vec<i32> = (0..(*format_ctx).nb_streams as i32)
            .filter(|i| {
                let stream = *(*format_ctx).streams.add(*i as usize);
                (*(*stream).codecpar).codec_type == ff::AVMediaType::AVMEDIA_TYPE_AUDIO
            })
            .collect();

        let ours = ff::AVRational {
            num: 1,
            den: TIME_BASE_DEN,
        };
        let video_base = (**(*format_ctx).streams.add(video_index as usize)).time_base;

        let mut audio: Vec<AudioSource> = Vec::with_capacity(audio_indices.len());
        let mut audio_bases = Vec::with_capacity(audio_indices.len());
        for index in &audio_indices {
            audio.push(AudioSource {
                format: audio_format(format_ctx, *index)?,
                packets: Vec::new(),
            });
            audio_bases.push((**(*format_ctx).streams.add(*index as usize)).time_base);
        }

        let packet = ff::av_packet_alloc();
        if packet.is_null() {
            bail!("av_packet_alloc failed");
        }
        let _packet_guard = PacketGuard(packet);

        let mut video = Vec::new();

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
            } else if let Some(slot) = audio_indices.iter().position(|i| *i == index) {
                (&mut audio[slot].packets, audio_bases[slot])
            } else {
                ff::av_packet_unref(packet);
                continue;
            };

            let pts = ff::av_rescale_q((*packet).pts, source_base, ours);
            let dts = ff::av_rescale_q((*packet).dts, source_base, ours);
            let data =
                std::slice::from_raw_parts((*packet).data, (*packet).size.max(0) as usize).to_vec();

            target.push(Packet {
                data: data.into(),
                pts,
                dts,
                keyframe: (*packet).flags & ff::AV_PKT_FLAG_KEY != 0,
            });

            ff::av_packet_unref(packet);
        }

        if video.is_empty() {
            bail!("{} holds no video frames", path.display());
        }

        video.sort_by_key(|p: &Packet| p.dts);
        for source in &mut audio {
            source.packets.sort_by_key(|p: &Packet| p.dts);
        }

        let start_time = (**(*format_ctx).streams.add(video_index as usize)).start_time;
        let first_pts = if start_time == ff::AV_NOPTS_VALUE {
            video[0].pts
        } else {
            ff::av_rescale_q(start_time, video_base, ours)
        };

        Ok(SourceClip {
            track,
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
        label: stream_label(stream),
    })
}

unsafe fn stream_label(stream: *mut ff::AVStream) -> String {
    for key in ["title", "handler_name"] {
        let Ok(key) = CString::new(key) else { continue };
        let entry = ff::av_dict_get((*stream).metadata, key.as_ptr(), std::ptr::null(), 0);
        if entry.is_null() || (*entry).value.is_null() {
            continue;
        }
        let value = std::ffi::CStr::from_ptr((*entry).value).to_string_lossy();
        if !value.is_empty() && !value.contains("Handler") {
            return value.into_owned();
        }
    }
    String::new()
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
            data: vec![0; 10].into(),
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

    fn source(label: &str, packets: usize) -> AudioSource {
        AudioSource {
            format: AudioFormat {
                sample_rate: 48_000,
                channels: 2,
                extradata: vec![0x12, 0x10],
                label: label.to_string(),
            },
            packets: (0..packets as i64).map(|i| frame(i * 1_920, true)).collect(),
        }
    }

    fn level(stream: u32, volume: u32) -> norisk_ipc::TrackLevel {
        norisk_ipc::TrackLevel { stream, volume }
    }

    #[test]
    fn leaving_the_faders_alone_copies_the_recorded_mix() {
        let audio = vec![source("Mix", 10), source("Game", 10), source("Microphone", 10)];

        let built = build_audio(&audio, &[]).unwrap();

        assert_eq!(built.len(), 1, "a trimmed clip carries one audio track");
        assert_eq!(built[0].label, "Mix");
        assert_eq!(
            built[0].packets, audio[0].packets,
            "an untouched balance must not be re-encoded: the packets should be              the recorded ones, byte for byte"
        );
    }

    #[test]
    fn levels_all_at_a_hundred_are_not_a_change() {
        let audio = vec![source("Mix", 10), source("Game", 10), source("Microphone", 10)];

        let built = build_audio(&audio, &[level(1, 100), level(2, 100)]).unwrap();

        assert_eq!(built[0].packets, audio[0].packets, "nothing was moved");
    }

    #[test]
    fn a_clip_without_separate_tracks_keeps_its_mix_rather_than_failing() {
        let audio = vec![source("Mix", 10)];

        let built = build_audio(&audio, &[level(1, 0)]).unwrap();

        assert_eq!(built.len(), 1);
        assert_eq!(built[0].packets, audio[0].packets);
    }

    #[test]
    fn a_silent_clip_stays_silent() {
        assert!(build_audio(&[], &[level(1, 50)]).unwrap().is_empty());
        assert!(build_audio(&[], &[]).unwrap().is_empty());
    }

    #[test]
    fn a_track_the_range_missed_is_left_out_entirely() {
        let audio = vec![source("Mix", 0)];
        assert!(build_audio(&audio, &[]).unwrap().is_empty());
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
