use std::path::{Path, PathBuf};
use std::time::Duration;

use norisk_ipc::LauncherToCapture;
use uuid::Uuid;

use super::refused;
use super::upload::Progress;
use crate::config::LAUNCHER_DIRECTORY;
use crate::error::{AppError, CommandError};
use crate::minecraft::api::share_api::ShareApi;
use crate::state::capture_state::ExportWatch;
use crate::state::config_state::ClipConfig;
use crate::state::State;

const CONVERT_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const LEFTOVERS_AFTER: Duration = Duration::from_secs(24 * 60 * 60);
const SIZE_HEADROOM: f64 = 0.85;
const AUDIO_KBPS: f64 = 256.0;
const MIN_VIDEO_KBPS: u32 = 1_000;

pub(super) struct Converted(PathBuf);

impl Converted {
    pub(super) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Converted {
    fn drop(&mut self) {
        let mut part = self.0.clone().into_os_string();
        part.push(".part");
        for path in [self.0.clone(), PathBuf::from(part)] {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => log::warn!("Could not remove {}: {e}", path.display()),
            }
        }
    }
}

pub(super) async fn shareable(clip: &Path) -> bool {
    let path = clip.to_path_buf();
    match tokio::task::spawn_blocking(move || crate::utils::mp4_probe::codecs(&path)).await {
        Ok(Ok(codecs)) => {
            log::debug!("{} holds video {:?}, audio {:?}", clip.display(), codecs.video, codecs.audio);
            codecs.shareable()
        }
        Ok(Err(e)) => {
            log::warn!("Could not read the codecs of {}: {e}", clip.display());
            true
        }
        Err(_) => true,
    }
}

pub(super) async fn convert(
    state: &State,
    clips: &ClipConfig,
    clip: &Path,
    seconds: Option<f64>,
    is_experimental: bool,
    progress: &Progress<'_>,
) -> Result<Converted, CommandError> {
    let limit = ShareApi::limits(is_experimental)
        .await
        .inspect_err(|e| log::warn!("Could not read the upload limits: {e}"))
        .ok()
        .map(|limits| limits.max_video_bytes);
    let bitrate_kbps = fitted_kbps(clips.bitrate_kbps, seconds, limit);

    let dir = LAUNCHER_DIRECTORY.cache_dir().join("share");
    tokio::fs::create_dir_all(&dir).await.map_err(AppError::Io)?;
    remove_leftovers(&dir);
    let converted = Converted(dir.join(format!("{}.mp4", Uuid::new_v4())));

    let supervisor = &state.capture_supervisor;
    let started = !supervisor.is_running().await;
    if started {
        let engine = crate::utils::capture_runtime::ensure_engine().await?;
        supervisor.start(engine).await?;
    }

    log::info!(
        "Converting {} to H.264 at {bitrate_kbps} kbps for sharing",
        clip.display()
    );
    let mut watch = supervisor.watch_export(converted.0.clone());
    let outcome = match supervisor.send(LauncherToCapture::ExportVertical(
        norisk_ipc::ExportVerticalRequest {
            source: clip.to_path_buf(),
            destination: converted.0.clone(),
            shape: norisk_ipc::ClipShape::Original,
            bitrate_kbps: Some(bitrate_kbps),
            faststart: true,
            ..Default::default()
        },
    )) {
        Ok(()) => finished(&mut watch, progress).await,
        Err(e) => Err(e.to_string()),
    };
    supervisor.unwatch_export(&converted.0);
    if started && !state.config_manager.get_config().await.clips.enabled {
        supervisor.stop().await;
    }

    let exported = outcome.map_err(|e| {
        log::error!("Converting {} for sharing failed: {e}", clip.display());
        refused("share.errors.convert_failed", e)
    })?;
    if limit.is_some_and(|max| exported.size_bytes > max) {
        return Err(refused(
            "share.errors.converted_too_large",
            format!("the converted clip is {} bytes", exported.size_bytes),
        ));
    }
    Ok(converted)
}

async fn finished(
    watch: &mut ExportWatch,
    progress: &Progress<'_>,
) -> Result<norisk_ipc::ExportedClip, String> {
    let deadline = tokio::time::sleep(CONVERT_TIMEOUT);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            done = &mut watch.done => {
                return done.unwrap_or_else(|_| Err("the capture engine stopped".into()));
            }
            Some((done, total)) = watch.progress.recv() => {
                progress.report("converting", done.into(), total.into());
            }
            _ = &mut deadline => return Err("converting took too long".into()),
        }
    }
}

pub fn fitted_kbps(wanted: u32, seconds: Option<f64>, max_bytes: Option<u64>) -> u32 {
    let (Some(seconds), Some(max_bytes)) = (seconds.filter(|s| *s > 0.0), max_bytes) else {
        return wanted;
    };
    let fits = max_bytes as f64 * 8.0 * SIZE_HEADROOM / seconds / 1000.0 - AUDIO_KBPS;
    wanted.min((fits as u32).max(MIN_VIDEO_KBPS))
}

fn remove_leftovers(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|at| at.elapsed().ok())
            .is_some_and(|age| age > LEFTOVERS_AFTER);
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}
