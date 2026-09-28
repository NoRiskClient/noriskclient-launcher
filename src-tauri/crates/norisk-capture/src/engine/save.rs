use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result};
use norisk_ipc::{CaptureError, CaptureToLauncher, ClipManifest, ErrorCode, SaveClipRequest};

use super::{AudioSelection, Engine, RETAIN_FOR};
use crate::buffer::RingBuffer;
use crate::encoder::video::TIME_BASE_DEN;
use crate::writer::{write_mp4, TrackInfo};

const FRESH_ENOUGH_SECONDS: f64 = 5.0;
const SPARE_BYTES: u64 = 32 * 1024 * 1024;
const PLAYBACK_CHECK_PACKETS: usize = 120;

impl Engine {
    pub(super) fn save_clip(&mut self, request: SaveClipRequest) -> Result<()> {
        if !self.buffering_enabled {
            self.emit_error(
                ErrorCode::Paused,
                "recording is paused, so there is nothing to cut".into(),
                true,
            );
            return Ok(());
        }

        if let Some(audio) = self.active.as_ref().and_then(|p| p.audio.as_ref()) {
            audio.drain_mixer();
        }

        let (pre, post) = (
            request.pre_roll_seconds as f32,
            request.post_roll_seconds as f32,
        );
        let cut = |ring: &Arc<Mutex<RingBuffer>>, spoiled: Duration| {
            let ring = ring.lock().unwrap_or_else(|e| e.into_inner());
            let spoiled = (spoiled.as_secs_f64() * TIME_BASE_DEN as f64) as i64;
            let now = ring.newest_pts().saturating_sub(spoiled);
            ring.extract_around(now, pre, post)
        };

        let live = self.active.as_ref().and_then(|pipeline| {
            cut(&pipeline.ring, Duration::ZERO).map(|clip| {
                (
                    clip,
                    pipeline.extradata.clone(),
                    pipeline.settings,
                    pipeline.audio.as_ref().map(AudioSelection::from),
                )
            })
        });
        let live_seconds = live
            .as_ref()
            .map_or(0.0, |(clip, ..)| clip.duration_seconds(TIME_BASE_DEN as i64));

        let mut chosen = live;

        if let Some(retired) = self.retired.as_ref().filter(|r| r.at.elapsed() < RETAIN_FOR) {
            if let Some(older) = cut(&retired.ring, retired.spoiled) {
                let older_seconds = older.duration_seconds(TIME_BASE_DEN as i64);
                if live_seconds < FRESH_ENOUGH_SECONDS && older_seconds > live_seconds + 0.1 {
                    log::info!(
                        "Cutting from the buffer kept across the rebuild: {older_seconds:.1}s there against {live_seconds:.1}s live"
                    );
                    chosen = Some((
                        older,
                        retired.extradata.clone(),
                        retired.settings,
                        retired.audio.as_ref().map(AudioSelection::from),
                    ));
                }
            }
        }

        let Some((clip, extradata, settings, audio)) = chosen else {
            let (code, message) = if self.active.is_none() {
                (
                    ErrorCode::NotRecording,
                    "nothing is being recorded, so there is nothing to cut",
                )
            } else {
                (
                    ErrorCode::BufferEmpty,
                    "the replay buffer holds nothing to cut",
                )
            };
            if let Some(pipeline) = self.active.as_ref() {
                let stats = pipeline.source.stats();
                let dropped = pipeline.dropped.load(Ordering::Relaxed);
                let ring = pipeline.ring.lock().unwrap_or_else(|e| e.into_inner());
                log::warn!(
                    "Nothing to cut: the source received {} frame(s) and handed on {}, of which {} \
                     never reached the encoder; the ring holds {} segment(s) over {:.1}s ({} bytes) \
                     and threw away {} packet(s) waiting for a first keyframe; the cut asked for \
                     {:.0}s before and {:.0}s after",
                    stats.received,
                    stats.delivered,
                    dropped,
                    ring.segment_count(),
                    ring.duration_seconds(),
                    ring.bytes(),
                    ring.dropped_before_first_keyframe(),
                    pre,
                    post,
                );
            }

            self.emit_error(code, message.into(), true);
            return Ok(());
        };

        let created = chrono_now();
        let path = free_path(
            &self.config.output_dir,
            &created.replace(':', "-"),
            &request.reason.slug(),
        );

        let (audio_track, audio_tracks) = match audio.as_ref() {
            Some(selection) => selection.cut(&clip),
            None => (Vec::new(), Vec::new()),
        };

        let track = TrackInfo {
            width: settings.width,
            height: settings.height,
            fps: settings.fps,
            time_base_den: TIME_BASE_DEN as i64,
            codec: settings.codec,
            extradata,
        };
        let events = self.events.clone();
        let reason = request.reason;

        std::thread::Builder::new()
            .name("nrc-save".into())
            .spawn(move || match room_for(&path, clip.bytes)
                .and_then(|()| write_mp4(&clip, &path, &track, audio_track.as_slice()))
            {
                Ok(written) => {
                    log::info!(
                        "Saved {:.1}s clip to {}",
                        written.duration_seconds,
                        path.display()
                    );
                    if let Err(e) = plays_back(&written.path) {
                        log::error!("The saved clip {} will not play back: {e:#}", written.path.display());
                    }
                    let _ = events.send(CaptureToLauncher::ClipSaved(ClipManifest {
                        path: written.path,
                        thumbnail: None,
                        duration_seconds: written.duration_seconds as f32,
                        width: written.width,
                        height: written.height,
                        fps: settings.fps,
                        bitrate_kbps: settings.bitrate_kbps,
                        size_bytes: written.size_bytes,
                        reason,
                        created_at: created,
                        audio_tracks,
                    }));
                }
                Err(e) => {
                    log::error!("Could not write the clip: {e:#}");
                    let _ = events.send(CaptureToLauncher::Error(CaptureError {
                        code: ErrorCode::ClipWrite,
                        message: format!("{e:#}"),
                        recoverable: true,
                    }));
                }
            })
            .context("could not start the clip writer thread")?;

        Ok(())
    }
}

fn free_path(dir: &std::path::Path, stamp: &str, reason: &str) -> std::path::PathBuf {
    let first = dir.join(format!("{stamp}_{reason}.mp4"));
    if !first.exists() {
        return first;
    }

    for attempt in 2..=99 {
        let candidate = dir.join(format!("{stamp}_{reason}-{attempt}.mp4"));
        if !candidate.exists() {
            return candidate;
        }
    }

    dir.join(format!("{stamp}_{reason}-{}.mp4", std::process::id()))
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn room_for(path: &std::path::Path, bytes: u64) -> Result<()> {
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
        anyhow::bail!(
            "the drive is too full for this clip: it needs about {} MB and only {} MB are free",
            needed / (1024 * 1024),
            free / (1024 * 1024)
        );
    }
    Ok(())
}

fn plays_back(path: &std::path::Path) -> Result<()> {
    use ffmpeg_next as ffmpeg;

    let mut input = ffmpeg::format::input(&path).context("the file does not open")?;
    let (index, parameters) = {
        let stream = input
            .streams()
            .best(ffmpeg::media::Type::Video)
            .context("it holds no picture")?;
        (stream.index(), stream.parameters())
    };
    if !matches!(parameters.id(), ffmpeg::codec::Id::H264 | ffmpeg::codec::Id::HEVC) {
        return Ok(());
    }
    let mut decoder = ffmpeg::codec::context::Context::from_parameters(parameters)?
        .decoder()
        .video()
        .context("no decoder for its picture")?;

    let mut frame = ffmpeg::frame::Video::empty();
    let packets = input
        .packets()
        .filter(|(stream, _)| stream.index() == index)
        .take(PLAYBACK_CHECK_PACKETS);
    for (_, packet) in packets {
        decoder.send_packet(&packet).context("its picture data is broken")?;
        if decoder.receive_frame(&mut frame).is_ok() {
            return Ok(());
        }
    }
    decoder.send_eof().ok();
    if decoder.receive_frame(&mut frame).is_ok() {
        return Ok(());
    }
    anyhow::bail!("not one picture in it can be decoded")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_clip_in_the_same_second_does_not_overwrite_the_first() {
        let dir = std::env::temp_dir().join(format!("nrc-free-path-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");

        let first = free_path(&dir, "1788803479", "clip");
        assert_eq!(first.file_name().unwrap(), "1788803479_clip.mp4");
        std::fs::write(&first, b"x").expect("write");

        let second = free_path(&dir, "1788803479", "clip");
        assert_ne!(second, first, "the first clip must survive the second");
        assert_eq!(second.file_name().unwrap(), "1788803479_clip-2.mp4");
        std::fs::write(&second, b"x").expect("write");

        let third = free_path(&dir, "1788803479", "clip");
        assert_eq!(third.file_name().unwrap(), "1788803479_clip-3.mp4");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
