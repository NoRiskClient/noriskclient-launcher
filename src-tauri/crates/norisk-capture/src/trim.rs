use std::ffi::CString;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use ffmpeg_next::ffi as ff;
use norisk_ipc::{ticks_at, ClipCodec};

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
    video_start_seconds: Option<f64>,
    video_end_seconds: Option<f64>,
    levels: &[norisk_ipc::TrackLevel],
) -> Result<TrimResult> {
    let clip = read(source)?;

    let (start_seconds, end_seconds) =
        usable_range(start_seconds, end_seconds, clip.duration_seconds())?;

    let want_start = ticks_at(clip.first_pts, start_seconds, TIME_BASE_DEN as i64);
    let want_end = ticks_at(clip.first_pts, end_seconds, TIME_BASE_DEN as i64);

    let begin = keyframe_at_or_before(&clip.video, want_start, clip.first_pts);

    let (picture_start, picture_end) = picture_window(
        video_start_seconds,
        video_end_seconds,
        clip.first_pts,
        want_start,
        want_end,
    );

    let video = windowed_video(&clip.video, begin, picture_start, picture_end);

    if video.is_empty() {
        bail!("no frames fall inside {start_seconds:.1}s to {end_seconds:.1}s");
    }

    let audio = windowed_audio(&clip.audio, levels, clip.first_pts, begin, want_end);

    let audio_track = build_audio(&audio, levels)?;
    let end_pts = furthest_pts(&video, &audio_track, want_end);

    let bytes = total_bytes(&video, &audio_track);

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

pub(crate) fn keyframe_index_at_or_before(packets: &[Packet], pts: i64) -> Option<usize> {
    packets.iter().rposition(|p| p.keyframe && p.pts <= pts)
}

fn keyframe_at_or_before(packets: &[Packet], pts: i64, fallback: i64) -> i64 {
    keyframe_index_at_or_before(packets, pts)
        .map(|index| packets[index].pts)
        .unwrap_or(fallback)
}

pub(crate) fn picture_window(
    start_seconds: Option<f64>,
    end_seconds: Option<f64>,
    origin: i64,
    begin: i64,
    end: i64,
) -> (i64, i64) {
    let at = |seconds: Option<f64>| {
        seconds
            .filter(|s| s.is_finite())
            .map(|s| ticks_at(origin, s, TIME_BASE_DEN as i64).clamp(begin, end))
    };

    let start = at(start_seconds).unwrap_or(begin);
    (start, at(end_seconds).unwrap_or(end).max(start))
}

fn windowed_video(packets: &[Packet], floor: i64, start: i64, end: i64) -> Vec<Packet> {
    let from = keyframe_at_or_before(packets, start, floor).max(floor);
    packets
        .iter()
        .skip_while(|p| p.pts < from)
        .take_while(|p| p.pts <= end)
        .cloned()
        .collect()
}

pub(crate) fn furthest_pts(video: &[Packet], audio: &[AudioTrack], fallback: i64) -> i64 {
    video
        .iter()
        .chain(audio.iter().flat_map(|track| track.packets.iter()))
        .map(|p| p.pts)
        .max()
        .unwrap_or(fallback)
}

pub(crate) fn total_bytes(video: &[Packet], audio: &[AudioTrack]) -> u64 {
    video
        .iter()
        .chain(audio.iter().flat_map(|track| track.packets.iter()))
        .map(|p| p.len() as u64)
        .sum()
}

pub(crate) fn windowed_audio(
    sources: &[AudioSource],
    levels: &[norisk_ipc::TrackLevel],
    origin: i64,
    begin: i64,
    end: i64,
) -> Vec<AudioSource> {
    sources
        .iter()
        .enumerate()
        .map(|(index, track)| {
            let level = levels.iter().find(|level| level.stream == index as u32);
            let ticks = level
                .map(|level| level.offset_ticks(TIME_BASE_DEN as i64))
                .unwrap_or(0);
            let (from, to) = level
                .map(|level| level.window_ticks(TIME_BASE_DEN as i64, origin))
                .unwrap_or((None, None));

            let first = from.map(|t| t.max(begin)).unwrap_or(begin);
            let last = to.map(|t| t.min(end)).unwrap_or(end);

            AudioSource {
                format: track.format.clone(),
                packets: track
                    .packets
                    .iter()
                    .filter(|p| {
                        p.pts >= first.saturating_sub(ticks)
                            && p.pts <= last.saturating_sub(ticks)
                    })
                    .map(|p| Packet {
                        pts: p.pts.saturating_add(ticks),
                        dts: p.dts.saturating_add(ticks),
                        ..p.clone()
                    })
                    .collect(),
                quiet: Vec::new(),
            }
        })
        .collect()
}

pub(crate) fn build_audio(
    audio: &[AudioSource],
    levels: &[norisk_ipc::TrackLevel],
) -> Result<Vec<AudioTrack>> {
    let Some(mix) = audio.first() else {
        return Ok(Vec::new());
    };

    let hushed = audio.iter().any(|source| !source.quiet.is_empty());
    if !norisk_ipc::levels_change_anything(levels) && !hushed {
        return Ok(as_recorded(mix));
    }

    let mut stems: Vec<(u32, &AudioSource)> = audio
        .iter()
        .enumerate()
        .skip(1)
        .map(|(index, source)| (index as u32, source))
        .collect();
    if stems.is_empty() {
        if !mix.quiet.is_empty() {
            stems.push((0, mix));
        } else {
            log::info!("This clip was recorded before the tracks were kept apart, so its balance is fixed; copying the mix");
            return Ok(as_recorded(mix));
        }
    }

    match remix(&stems, levels) {
        Ok(track) => Ok(vec![track]),
        Err(e) => {
            log::warn!("Could not rebuild the mix, keeping the recorded one: {e:#}");
            Ok(as_recorded(mix))
        }
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

fn remix(stems: &[(u32, &AudioSource)], levels: &[norisk_ipc::TrackLevel]) -> Result<AudioTrack> {
    use crate::audio::decoder::decode_all;
    use crate::audio::encoder::{AudioEncoder, DEFAULT_BITRATE, OUTPUT_CHANNELS, OUTPUT_SAMPLE_RATE};

    let start_pts = stems
        .iter()
        .filter_map(|(_, stem)| stem.packets.first().map(|p| p.pts))
        .min()
        .context("none of the clip's separate tracks has any audio in this range")?;

    let mut mixed: Vec<f32> = Vec::new();

    for &(stream, stem) in stems {
        if stem.packets.is_empty() {
            continue;
        }

        let gain = levels
            .iter()
            .find(|level| level.stream == stream)
            .map(|level| level.gain())
            .unwrap_or(1.0);
        if gain == 0.0 {
            log::info!("Track {stream} was turned all the way down");
            continue;
        }

        let mut samples = decode_all(
            stem.format.sample_rate,
            stem.format.channels,
            &stem.format.extradata,
            &stem.packets,
        )?;
        let frame_at = |pts: i64| {
            ((pts - stem.packets[0].pts).max(0) as i128 * OUTPUT_SAMPLE_RATE as i128
                / TIME_BASE_DEN as i128) as usize
        };
        for &(from, to) in &stem.quiet {
            silence(&mut samples, OUTPUT_CHANNELS as usize, frame_at(from), frame_at(to));
        }

        let offset = ((stem.packets[0].pts - start_pts).max(0) as i128
            * OUTPUT_SAMPLE_RATE as i128
            / TIME_BASE_DEN as i128) as usize
            * OUTPUT_CHANNELS as usize;

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

const FADE_FRAMES: usize = 240;

pub(crate) fn silence(samples: &mut [f32], channels: usize, from: usize, to: usize) {
    let frames = samples.len() / channels.max(1);
    let (from, to) = (from.min(frames), to.min(frames));
    if to <= from {
        return;
    }
    let fade = FADE_FRAMES.min((to - from) / 2);
    for frame in from..to {
        let into = frame - from;
        let left = to - frame - 1;
        let keep = if into < fade {
            1.0 - (into + 1) as f32 / (fade + 1) as f32
        } else if left < fade {
            1.0 - (left + 1) as f32 / (fade + 1) as f32
        } else {
            0.0
        };
        for sample in &mut samples[frame * channels..(frame + 1) * channels] {
            *sample *= keep;
        }
    }
}

const MIN_TRIM_SECONDS: f64 = 0.5;

pub(crate) fn usable_range(start: f64, end: f64, duration: f64) -> Result<(f64, f64)> {
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
    pub(crate) quiet: Vec<(i64, i64)>,
}

#[derive(Clone)]
pub(crate) struct AudioFormat {
    pub(crate) sample_rate: u32,
    pub(crate) channels: u32,
    pub(crate) extradata: Vec<u8>,
    pub(crate) label: String,
}

impl SourceClip {
    pub(crate) fn duration_seconds(&self) -> f64 {
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
                quiet: Vec::new(),
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
    fn a_later_picture_start_still_begins_on_a_keyframe() {
        let packets = ten_seconds();
        let second = TIME_BASE_DEN as i64;
        let begin = keyframe_at_or_before(&packets, 0, 0);

        let (start, end) = picture_window(Some(5.0), None, 0, 0, 10 * second);
        let video = windowed_video(&packets, begin, start, end);

        assert!(video[0].keyframe, "the picture would decode into mush");
        assert_eq!(
            video[0].pts,
            4 * second,
            "5 s should fall back to the keyframe at 4 s, exactly as the clip's own start does"
        );
    }

    #[test]
    fn a_later_picture_start_never_reaches_back_past_the_cut() {
        let packets = ten_seconds();
        let second = TIME_BASE_DEN as i64;
        let want_start = 6 * second;
        let begin = keyframe_at_or_before(&packets, want_start, 0);

        let (start, end) = picture_window(Some(7.0), None, 0, want_start, 10 * second);
        let video = windowed_video(&packets, begin, start, end);

        assert_eq!(
            video[0].pts, begin,
            "with no keyframe of its own to land on, the picture keeps the cut's first frame"
        );
        assert!(video.iter().all(|p| p.pts >= begin));
    }

    #[test]
    fn an_earlier_picture_end_drops_the_frames_after_it() {
        let packets = ten_seconds();
        let second = TIME_BASE_DEN as i64;

        let (start, end) = picture_window(None, Some(3.0), 0, 0, 10 * second);
        let video = windowed_video(&packets, 0, start, end);

        assert_eq!(video.last().unwrap().pts, 3 * second);
        assert!(video.len() < packets.len());
    }

    #[test]
    fn a_picture_window_wider_than_the_cut_is_clamped_rather_than_resurrecting_frames() {
        let packets = ten_seconds();
        let second = TIME_BASE_DEN as i64;
        let (want_start, want_end) = (4 * second, 6 * second);
        let begin = keyframe_at_or_before(&packets, want_start, 0);

        let (start, end) = picture_window(Some(-100.0), Some(100.0), 0, want_start, want_end);
        let greedy = windowed_video(&packets, begin, start, end);

        assert!(greedy.iter().all(|p| p.pts >= begin && p.pts <= want_end));
    }

    #[test]
    fn a_picture_window_that_makes_no_sense_falls_back_to_the_cut() {
        let second = TIME_BASE_DEN as i64;
        let (want_start, want_end) = (second, 8 * second);

        for nonsense in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(
                picture_window(Some(nonsense), Some(nonsense), 0, want_start, want_end),
                (want_start, want_end),
                "{nonsense} should count as no picture window at all"
            );
        }

        let (start, end) = picture_window(Some(6.0), Some(2.0), 0, want_start, want_end);
        assert!(end >= start, "a backwards window must not end before it starts");
    }

    #[test]
    fn a_picture_window_is_measured_from_the_same_place_as_the_cut_and_the_tracks() {
        let second = TIME_BASE_DEN as i64;
        let origin = 5 * second;

        assert_eq!(
            picture_window(Some(2.0), Some(3.0), origin, origin, origin + 10 * second),
            (origin + 2 * second, origin + 3 * second)
        );
    }

    #[test]
    fn sound_that_outlasts_the_picture_still_sets_how_long_the_clip_runs() {
        let second = TIME_BASE_DEN as i64;
        let video: Vec<Packet> = (0..4).map(|i| frame(i * second, i == 0)).collect();
        let track = AudioTrack {
            sample_rate: 48_000,
            channels: 2,
            extradata: vec![0x12, 0x10],
            packets: (0..9).map(|i| frame(i * second, true)).collect(),
            label: "Mix".to_string(),
        };

        assert_eq!(furthest_pts(&video, &[track.clone()], 0), 8 * second);
        assert_eq!(furthest_pts(&video, &[], 0), 3 * second);
        assert_eq!(furthest_pts(&[], &[], 7 * second), 7 * second);

        let reordered: Vec<Packet> = [0, 3, 1, 2].iter().map(|&i| frame(i * second, i == 0)).collect();
        assert_eq!(
            furthest_pts(&reordered, &[], 0),
            3 * second,
            "a frame shown last but decoded earlier still sets the end",
        );
    }

    #[test]
    fn a_picture_window_on_its_own_leaves_the_recorded_mix_alone() {
        let packets = ten_seconds();
        let second = TIME_BASE_DEN as i64;
        let audio = vec![source("Mix", 10), source("Game", 10)];

        let built = build_audio(&audio, &[]).unwrap();
        let (start, end) = picture_window(Some(2.0), Some(6.0), 0, 0, 10 * second);
        let video = windowed_video(&packets, 0, start, end);

        assert_eq!(
            built[0].packets, audio[0].packets,
            "a picture-only window must not send the sound through the mixer"
        );
        assert!(
            !built[0].packets.is_empty(),
            "a picture-only window must not throw the sound away"
        );
        assert!(video.len() < packets.len(), "the picture was not narrowed at all");
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
            quiet: Vec::new(),
        }
    }

    fn level(stream: u32, volume: u32) -> norisk_ipc::TrackLevel {
        norisk_ipc::TrackLevel {
            stream,
            volume,
            offset_seconds: 0.0,
            start_seconds: None,
            end_seconds: None,
        }
    }

    fn offset(stream: u32, offset_seconds: f64) -> norisk_ipc::TrackLevel {
        norisk_ipc::TrackLevel {
            offset_seconds,
            ..level(stream, 100)
        }
    }

    fn window(stream: u32, start: Option<f64>, end: Option<f64>) -> norisk_ipc::TrackLevel {
        norisk_ipc::TrackLevel {
            start_seconds: start,
            end_seconds: end,
            ..level(stream, 100)
        }
    }

    const PACKET: i64 = 1_920;

    #[test]
    fn a_silenced_stretch_goes_quiet_with_soft_edges_and_leaves_the_rest_alone() {
        let channels = 2;
        let frames = 4_000;
        let mut samples = vec![0.5f32; frames * channels];

        silence(&mut samples, channels, 1_000, 3_000);

        let at = |frame: usize| samples[frame * channels];
        assert_eq!(at(999), 0.5, "sound before the stretch changed");
        assert_eq!(at(3_000), 0.5, "sound after the stretch changed");
        assert_eq!(at(2_000), 0.0, "the middle of the stretch is not silent");
        assert!(at(1_000) > 0.0 && at(1_000) < 0.5, "the stretch starts with a hard click");
        assert!(at(2_999) > 0.0 && at(2_999) < 0.5, "the stretch ends with a hard click");
        assert!(
            (1_000..1_240).all(|frame| at(frame) >= at(frame + 1)),
            "the fade out is not a steady slope",
        );
        assert!(samples.chunks(channels).all(|frame| frame[0] == frame[1]), "the channels drifted apart");
    }

    #[test]
    fn silencing_past_the_end_or_backwards_does_not_panic() {
        let mut samples = vec![0.5f32; 100];

        silence(&mut samples, 2, 40, 10_000);
        assert!(samples[..80].iter().all(|s| *s == 0.5));

        let before = samples.clone();
        silence(&mut samples, 2, 30, 10);
        silence(&mut samples, 0, 0, 10);
        assert_eq!(samples.len(), before.len());
    }

    fn as_seconds(ticks: i64) -> f64 {
        ticks as f64 / TIME_BASE_DEN as f64
    }

    #[test]
    fn a_zero_offset_leaves_the_packets_exactly_where_no_offset_leaves_them() {
        let sources = vec![source("Mix", 10), source("Game", 10)];
        let end = 9 * PACKET;

        let without = windowed_audio(&sources, &[], 0, 0, end);
        let zero = windowed_audio(&sources, &[offset(0, 0.0), offset(1, 0.0)], 0, 0, end);

        for (index, (a, b)) in without.iter().zip(&zero).enumerate() {
            assert_eq!(a.packets, b.packets, "track {index} moved");
            assert_eq!(a.packets, sources[index].packets, "track {index} was rewritten");
        }
    }

    #[test]
    fn a_positive_offset_moves_that_track_later_by_the_ticks_it_asks_for() {
        let sources = vec![source("Mix", 10)];

        let shifted = windowed_audio(&sources, &[offset(0, 0.25)], 0, 0, 100 * PACKET);

        let ticks = TIME_BASE_DEN as i64 / 4;
        assert_eq!(shifted[0].packets[0].pts, sources[0].packets[0].pts + ticks);
        assert_eq!(shifted[0].packets[0].dts, sources[0].packets[0].dts + ticks);
    }

    #[test]
    fn a_negative_offset_never_emits_a_timestamp_before_the_cut() {
        let begin = 0;
        let sources = vec![source("Mix", 10)];

        let shifted = windowed_audio(&sources, &[offset(0, -0.05)], 0, begin, 9 * PACKET);

        assert!(!shifted[0].packets.is_empty(), "the whole track was thrown away");
        assert!(
            shifted[0]
                .packets
                .iter()
                .all(|p| p.pts >= begin && p.dts >= begin),
            "a packet landed before the start of the cut"
        );
    }

    #[test]
    fn an_offset_moves_only_the_track_it_names() {
        let sources = vec![source("Mix", 10), source("Game", 10), source("Microphone", 10)];
        let end = 100 * PACKET;

        let shifted = windowed_audio(&sources, &[offset(1, 0.1)], 0, 0, end);

        assert_eq!(shifted[0].packets, sources[0].packets);
        assert_eq!(shifted[2].packets, sources[2].packets);
        assert_eq!(
            shifted[1].packets[0].pts,
            sources[1].packets[0].pts + TIME_BASE_DEN as i64 / 10
        );
    }

    #[test]
    fn an_offset_bigger_than_the_clip_empties_that_track_rather_than_panicking() {
        let sources = vec![source("Mix", 10)];
        let end = 9 * PACKET;

        for seconds in [600.0, -600.0, f64::MAX, f64::MIN] {
            let shifted = windowed_audio(&sources, &[offset(0, seconds)], 0, 0, end);
            assert!(
                shifted[0].packets.is_empty(),
                "{seconds} should push the whole track out of the range"
            );
        }
    }

    #[test]
    fn an_offset_that_runs_past_the_end_is_cut_instead_of_growing_the_file() {
        let sources = vec![source("Mix", 10)];
        let end = 9 * PACKET;

        let kept = windowed_audio(&sources, &[offset(0, 0.0)], 0, 0, end)[0].packets.len();
        let shifted = windowed_audio(&sources, &[offset(0, as_seconds(PACKET * 3))], 0, 0, end);

        assert_eq!(shifted[0].packets.len(), kept - 3);
        assert!(shifted[0].packets.iter().all(|p| p.pts <= end));
    }

    #[test]
    fn a_track_with_no_window_of_its_own_follows_the_clip() {
        let sources = vec![source("Mix", 10), source("Game", 10)];
        let end = 9 * PACKET;

        let without = windowed_audio(&sources, &[], 0, 0, end);
        let empty_window = windowed_audio(
            &sources,
            &[window(0, None, None), window(1, None, None)],
            0,
            0,
            end,
        );

        for (index, (a, b)) in without.iter().zip(&empty_window).enumerate() {
            assert_eq!(a.packets, b.packets, "track {index} moved");
            assert_eq!(
                a.packets, sources[index].packets,
                "track {index} was rewritten"
            );
        }
    }

    #[test]
    fn a_later_start_of_its_own_drops_that_tracks_earlier_packets() {
        let sources = vec![source("Mix", 10)];
        let end = 9 * PACKET;

        let cut = windowed_audio(
            &sources,
            &[window(0, Some(as_seconds(3 * PACKET)), None)],
            0,
            0,
            end,
        );

        assert_eq!(cut[0].packets.as_slice(), &sources[0].packets[3..]);
    }

    #[test]
    fn an_earlier_end_of_its_own_drops_that_tracks_later_packets() {
        let sources = vec![source("Mix", 10)];
        let end = 9 * PACKET;

        let cut = windowed_audio(
            &sources,
            &[window(0, None, Some(as_seconds(5 * PACKET)))],
            0,
            0,
            end,
        );

        assert_eq!(cut[0].packets.as_slice(), &sources[0].packets[..=5]);
    }

    #[test]
    fn a_window_wider_than_the_clip_is_clamped_rather_than_resurrecting_audio() {
        let sources = vec![source("Mix", 10)];
        let (begin, end) = (2 * PACKET, 6 * PACKET);

        let clip = windowed_audio(&sources, &[], 0, begin, end);
        let greedy = windowed_audio(&sources, &[window(0, Some(-100.0), Some(100.0))], 0, begin, end);

        assert_eq!(greedy[0].packets, clip[0].packets);
        assert!(greedy[0].packets.iter().all(|p| p.pts >= begin && p.pts <= end));
    }

    #[test]
    fn a_window_on_one_track_leaves_the_other_tracks_alone() {
        let sources = vec![source("Mix", 10), source("Game", 10), source("Microphone", 10)];
        let end = 9 * PACKET;

        let cut = windowed_audio(
            &sources,
            &[window(1, Some(as_seconds(4 * PACKET)), Some(as_seconds(6 * PACKET)))],
            0,
            0,
            end,
        );

        assert_eq!(cut[0].packets, sources[0].packets);
        assert_eq!(cut[2].packets, sources[2].packets);
        assert_eq!(cut[1].packets.as_slice(), &sources[1].packets[4..=6]);
    }

    #[test]
    fn a_window_that_makes_no_sense_empties_the_track_rather_than_panicking() {
        let sources = vec![source("Mix", 10)];
        let end = 9 * PACKET;

        let backwards = windowed_audio(
            &sources,
            &[window(0, Some(as_seconds(8 * PACKET)), Some(as_seconds(2 * PACKET)))],
            0,
            0,
            end,
        );
        assert!(backwards[0].packets.is_empty());

        let enormous = windowed_audio(
            &sources,
            &[window(0, Some(f64::MAX), Some(f64::MIN))],
            0,
            0,
            end,
        );
        assert!(enormous[0].packets.is_empty());

        for nonsense in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let ignored = windowed_audio(
                &sources,
                &[window(0, Some(nonsense), Some(nonsense))],
                0,
                0,
                end,
            );
            assert_eq!(
                ignored[0].packets, sources[0].packets,
                "{nonsense} should count as no window at all"
            );
        }
    }

    #[test]
    fn a_window_is_read_in_the_finished_clip_so_it_measures_the_track_after_its_shift() {
        let sources = vec![source("Mix", 10)];
        let end = 9 * PACKET;

        let both = windowed_audio(
            &sources,
            &[norisk_ipc::TrackLevel {
                offset_seconds: as_seconds(2 * PACKET),
                start_seconds: Some(as_seconds(4 * PACKET)),
                end_seconds: None,
                ..level(0, 100)
            }],
            0,
            0,
            end,
        );

        assert_eq!(both[0].packets.len(), 6);
        assert_eq!(both[0].packets[0].pts, 4 * PACKET);
        assert_eq!(both[0].packets[0].dts, 4 * PACKET);
        assert!(both[0].packets.iter().all(|p| p.pts >= 0 && p.pts <= end));
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
