use std::ffi::CString;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use ffmpeg_next::ffi as ff;
use norisk_ipc::ClipCodec;

use crate::buffer::Clip;
use crate::encoder::hw::av_error;

#[derive(Debug, Clone)]
pub struct WrittenClip {
    pub path: PathBuf,
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

const SPARE_BYTES: u64 = 32 * 1024 * 1024;

pub(crate) fn part_path(destination: &Path) -> PathBuf {
    let mut name = destination.as_os_str().to_owned();
    name.push(".part");
    PathBuf::from(name)
}

struct PartGuard(Option<PathBuf>);

impl Drop for PartGuard {
    fn drop(&mut self) {
        if let Some(part) = self.0.take() {
            let _ = std::fs::remove_file(part);
        }
    }
}

pub(crate) fn staged<T>(destination: &Path, write: impl FnOnce(&Path) -> Result<T>) -> Result<T> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let part = part_path(destination);
    let mut guard = PartGuard(Some(part.clone()));
    let written = write(&part)?;
    std::fs::rename(&part, destination)
        .with_context(|| format!("could not move the finished file to {}", destination.display()))?;
    guard.0 = None;
    Ok(written)
}

pub(crate) fn room_for(path: &Path, bytes: u64) -> Result<()> {
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let Some(folder) = path.parent() else {
        return Ok(());
    };
    let mut free = 0u64;
    let asked = unsafe {
        GetDiskFreeSpaceExW(&windows::core::HSTRING::from(folder), Some(&mut free), None, None)
    };
    if asked.is_err() {
        return Ok(());
    }

    let needed = bytes + bytes / 10 + SPARE_BYTES;
    if free < needed {
        bail!(
            "the drive is too full for this clip: it needs about {} MB and only {} MB are free",
            needed / (1024 * 1024),
            free / (1024 * 1024)
        );
    }
    Ok(())
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
    let bytes: u64 = clip
        .packets
        .iter()
        .chain(audio.iter().flat_map(|track| &track.packets))
        .map(|packet| packet.data.len() as u64)
        .sum();
    room_for(path, bytes)?;

    let mut written = staged(path, |part| mux(clip, part, path, track, audio))?;
    written.path = path.to_path_buf();
    Ok(written)
}

fn mux(
    clip: &Clip,
    path: &Path,
    named: &Path,
    track: &TrackInfo,
    audio: &[AudioTrack],
) -> Result<WrittenClip> {
    let path_c = CString::new(path.to_string_lossy().as_ref())
        .context("clip path contains an interior nul")?;
    let named_c = CString::new(named.to_string_lossy().as_ref())
        .context("clip path contains an interior nul")?;

    unsafe {
        let mut format_ctx: *mut ff::AVFormatContext = std::ptr::null_mut();
        let rc = ff::avformat_alloc_output_context2(
            &mut format_ctx,
            std::ptr::null_mut(),
            std::ptr::null(),
            named_c.as_ptr(),
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
        (*params).color_primaries = crate::encoder::video::COLOR_PRIMARIES;
        (*params).color_trc = crate::encoder::video::COLOR_TRANSFER;
        (*params).color_space = crate::encoder::video::COLOR_SPACE;
        (*params).color_range = crate::encoder::video::COLOR_RANGE;
        (*params).chroma_location = crate::encoder::video::CHROMA_LOCATION;

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
            .map(|p| (p.dts, 0i32, p, frame_ticks))
            .collect();

        for (position, index) in &audio_streams {
            let source = &audio[*position];
            let audio_ticks =
                (track.time_base_den * 1024 / source.sample_rate.max(1) as i64).max(1);
            queue.extend(
                source
                    .packets
                    .iter()
                    .map(|p| (p.dts, *index, p, audio_ticks)),
            );
        }
        queue.sort_by_key(|(dts, _, _, _)| *dts);

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
            (*packet).dts = (source.dts - origin).min(pts);
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
#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::{Packet, RingBuffer};

    const FPS: i64 = 60;
    const STEP: i64 = 90_000 / FPS;
    const WIDTH: usize = 320;
    const HEIGHT: usize = 240;

    fn encode_with_b_frames(frames: usize) -> Option<(Vec<Packet>, Vec<u8>)> {
        unsafe {
            let codec = ff::avcodec_find_encoder_by_name(c"libx264".as_ptr());
            if codec.is_null() {
                return None;
            }
            let context = ff::avcodec_alloc_context3(codec);
            assert!(!context.is_null());
            (*context).width = WIDTH as i32;
            (*context).height = HEIGHT as i32;
            (*context).pix_fmt = ff::AVPixelFormat::AV_PIX_FMT_YUV420P;
            (*context).time_base = ff::AVRational { num: 1, den: 90_000 };
            (*context).framerate = ff::AVRational { num: FPS as i32, den: 1 };
            (*context).gop_size = 30;
            (*context).max_b_frames = 2;
            (*context).flags |= ff::AV_CODEC_FLAG_GLOBAL_HEADER as i32;
            ff::av_opt_set((*context).priv_data, c"preset".as_ptr(), c"ultrafast".as_ptr(), 0);
            let rc = ff::avcodec_open2(context, codec, std::ptr::null_mut());
            assert!(rc >= 0, "libx264 did not open: {}", av_error(rc));

            let frame = ff::av_frame_alloc();
            (*frame).format = ff::AVPixelFormat::AV_PIX_FMT_YUV420P as i32;
            (*frame).width = WIDTH as i32;
            (*frame).height = HEIGHT as i32;
            assert!(ff::av_frame_get_buffer(frame, 0) >= 0);
            let packet = ff::av_packet_alloc();
            let mut out = Vec::new();

            let drain = |out: &mut Vec<Packet>| loop {
                if ff::avcodec_receive_packet(context, packet) < 0 {
                    break;
                }
                let bytes = std::slice::from_raw_parts((*packet).data, (*packet).size as usize);
                out.push(Packet {
                    data: bytes.into(),
                    pts: (*packet).pts,
                    dts: (*packet).dts,
                    keyframe: (*packet).flags & ff::AV_PKT_FLAG_KEY != 0,
                });
                ff::av_packet_unref(packet);
            };

            for index in 0..frames {
                assert!(ff::av_frame_make_writable(frame) >= 0);
                let luma = (*frame).data[0];
                let stride = (*frame).linesize[0] as usize;
                for row in 0..HEIGHT {
                    for col in 0..WIDTH {
                        *luma.add(row * stride + col) = ((row + col + index * 4) & 0xff) as u8;
                    }
                }
                for plane in 1..=2 {
                    let chroma = (*frame).data[plane];
                    let stride = (*frame).linesize[plane] as usize;
                    for row in 0..HEIGHT / 2 {
                        std::ptr::write_bytes(chroma.add(row * stride), 128, WIDTH / 2);
                    }
                }
                (*frame).pts = index as i64 * STEP;
                assert!(ff::avcodec_send_frame(context, frame) >= 0);
                drain(&mut out);
            }
            ff::avcodec_send_frame(context, std::ptr::null());
            drain(&mut out);

            let extradata = std::slice::from_raw_parts(
                (*context).extradata,
                (*context).extradata_size as usize,
            )
            .to_vec();

            let mut packet = packet;
            ff::av_packet_free(&mut packet);
            let mut frame = frame;
            ff::av_frame_free(&mut frame);
            let mut context = context;
            ff::avcodec_free_context(&mut context);

            Some((out, extradata))
        }
    }

    #[test]
    fn b_frame_packets_survive_the_ring_and_the_muxer_in_decode_order() {
        let Some((packets, extradata)) = encode_with_b_frames(90) else {
            eprintln!("libx264 is not in this FFmpeg build; skipping");
            return;
        };
        assert!(
            packets.iter().any(|p| p.pts != p.dts),
            "the encoder produced no reordering, the test proves nothing"
        );

        let mut ring = RingBuffer::new(30.0, 90_000);
        for packet in &packets {
            ring.push(packet.clone());
        }
        let clip = ring
            .extract_around(ring.newest_pts(), 100.0, 0.0)
            .expect("the ring holds the whole encode");
        assert_eq!(clip.packets.len(), packets.len());

        let path = std::env::temp_dir().join(format!("nrc-bframes-{}.mp4", std::process::id()));
        let track = TrackInfo {
            width: WIDTH as u32,
            height: HEIGHT as u32,
            fps: FPS as u32,
            time_base_den: 90_000,
            codec: ClipCodec::H264,
            extradata,
        };
        let written = write_mp4(&clip, &path, &track, &[]).expect("muxing failed");
        assert_eq!(written.path, path);
        assert_eq!(written.size_bytes, std::fs::metadata(&path).unwrap().len());
        assert!(!part_path(&path).exists(), "nothing half-written may stay behind");
        let back = crate::trim::read(&path).expect("demuxing failed");
        let _ = std::fs::remove_file(&path);

        assert_eq!(back.video.len(), packets.len());
        assert!(
            back.video.windows(2).all(|pair| pair[0].dts < pair[1].dts),
            "dts must climb in decode order"
        );
        let mut shown: Vec<i64> = back.video.iter().map(|p| p.pts - back.first_pts).collect();
        shown.sort_unstable();
        let expected: Vec<i64> = (0..90).map(|i| i * STEP).collect();
        assert_eq!(shown, expected, "every frame must come back at its display time");
        assert!(
            (written.duration_seconds - 1.5).abs() < 0.1,
            "90 frames at 60 fps should be 1.5s, got {:.2}s",
            written.duration_seconds
        );
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nrc-staged-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn names_in(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn a_write_that_fails_halfway_leaves_nothing_in_the_folder() {
        let dir = scratch("fails");
        let destination = dir.join("fight.mp4");

        let result = staged(&destination, |part| -> Result<()> {
            std::fs::write(part, b"half a clip")?;
            bail!("the drive filled up")
        });

        assert!(result.is_err());
        assert_eq!(names_in(&dir), Vec::<String>::new());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_write_that_fails_keeps_the_file_it_would_have_replaced() {
        let dir = scratch("keeps");
        let destination = dir.join("fight.mp4");
        std::fs::write(&destination, b"the old clip").unwrap();

        let result = staged(&destination, |part| -> Result<()> {
            std::fs::write(part, b"half a clip")?;
            bail!("the encoder gave up")
        });

        assert!(result.is_err());
        assert_eq!(names_in(&dir), vec!["fight.mp4".to_string()]);
        assert_eq!(std::fs::read(&destination).unwrap(), b"the old clip");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_write_in_progress_never_looks_like_a_clip_and_a_finished_one_does() {
        let dir = scratch("finishes");
        let destination = dir.join("fight.mp4");

        staged(&destination, |part| -> Result<()> {
            assert_eq!(part.parent(), destination.parent());
            assert_ne!(
                part.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase),
                Some("mp4".to_string())
            );
            assert!(!destination.exists());
            std::fs::write(part, b"a whole clip")?;
            Ok(())
        })
        .unwrap();

        assert_eq!(names_in(&dir), vec!["fight.mp4".to_string()]);
        assert_eq!(std::fs::read(&destination).unwrap(), b"a whole clip");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "needs a real clip in NRC_TEST_CLIP"]
    fn a_written_clip_says_which_colours_it_holds() {
        let source = std::path::PathBuf::from(std::env::var("NRC_TEST_CLIP").unwrap());
        let destination = std::env::temp_dir().join("nrc-colour-test.mp4");
        let _ = std::fs::remove_file(&destination);

        crate::trim::trim(&source, &destination, 0.0, 2.0, None, None, &[]).unwrap();

        let probe = std::process::Command::new("ffprobe")
            .args([
                "-hide_banner", "-v", "error", "-select_streams", "v:0",
                "-show_entries",
                "stream=color_space,color_primaries,color_transfer,color_range",
                "-of", "default=noprint_wrappers=1",
            ])
            .arg(&destination)
            .output()
            .expect("ffprobe");
        let text = String::from_utf8_lossy(&probe.stdout).to_string();
        eprintln!("{text}");

        for wanted in [
            "color_space=bt709",
            "color_primaries=bt709",
            "color_transfer=bt709",
            "color_range=tv",
        ] {
            assert!(text.contains(wanted), "missing {wanted} in:\n{text}");
        }
    }
}
