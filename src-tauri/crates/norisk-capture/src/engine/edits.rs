use std::sync::Mutex;
use std::time::{Duration, Instant};

use norisk_ipc::{CaptureError, CaptureToLauncher, ErrorCode};

use super::Engine;

const PROGRESS_EVERY: Duration = Duration::from_millis(150);

static ONE_EDIT_AT_A_TIME: Mutex<()> = Mutex::new(());

impl Engine {
    pub(super) fn prepare_preview(&self, request: norisk_ipc::AudioPreviewRequest) {
        let events = self.events.clone();

        let spawned = std::thread::Builder::new()
            .name("nrc-preview".into())
            .spawn(move || match crate::preview::prepare(&request.source) {
                Ok(tracks) => {
                    let _ = events.send(CaptureToLauncher::AudioPreviewReady(
                        norisk_ipc::AudioPreview {
                            source: request.source,
                            tracks,
                        },
                    ));
                }
                Err(e) => {
                    log::warn!("Could not prepare the audio preview: {e:#}");
                    let _ = events.send(CaptureToLauncher::AudioPreviewReady(
                        norisk_ipc::AudioPreview {
                            source: request.source,
                            tracks: Vec::new(),
                        },
                    ));
                }
            });

        if let Err(e) = spawned {
            log::warn!("Could not start the audio preview: {e}");
        }
    }

    pub(super) fn export_vertical(&self, request: norisk_ipc::ExportVerticalRequest) {
        self.spawn_export(
            "nrc-export",
            "Vertical export failed",
            "could not start the export",
            request.source.clone(),
            move |report| {
                let started = Instant::now();
                let result = crate::render::render(&request, report)?;
                log::info!(
                    "Exported {} as {}x{} in {} ms",
                    request.source.display(),
                    result.width,
                    result.height,
                    started.elapsed().as_millis()
                );
                Ok(CaptureToLauncher::ClipExported(norisk_ipc::ExportedClip {
                    path: result.path,
                    source: request.source,
                    width: result.width,
                    height: result.height,
                    duration_seconds: result.duration_seconds,
                    size_bytes: result.size_bytes,
                }))
            },
        );
    }

    pub(super) fn export_gif(&self, request: norisk_ipc::ExportGifRequest) {
        self.spawn_export(
            "nrc-gif",
            "GIF export failed",
            "could not start the GIF export",
            request.source.clone(),
            move |report| {
                let started = Instant::now();
                let result = crate::gif::to_gif(&request.source, &request.destination, report)?;
                log::info!(
                    "Turned {} into a GIF in {} ms",
                    request.source.display(),
                    started.elapsed().as_millis()
                );
                Ok(CaptureToLauncher::GifExported(norisk_ipc::ExportedGif {
                    path: result.path,
                    source: request.source,
                    width: result.width,
                    height: result.height,
                    frames: result.frames,
                    duration_seconds: result.duration_seconds,
                    size_bytes: result.size_bytes,
                    truncated: result.truncated,
                }))
            },
        );
    }

    fn spawn_export<F>(
        &self,
        thread: &str,
        failed: &'static str,
        unstarted: &str,
        source: std::path::PathBuf,
        work: F,
    ) where
        F: FnOnce(&dyn Fn(u32, u32)) -> anyhow::Result<CaptureToLauncher> + Send + 'static,
    {
        let events = self.events.clone();
        let about = source.clone();

        let spawned = std::thread::Builder::new()
            .name(thread.into())
            .spawn(move || {
                let _turn = ONE_EDIT_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
                let last = std::cell::Cell::new(None::<Instant>);
                let report = |done: u32, total: u32| {
                    let finished = done >= total;
                    if !finished && last.get().is_some_and(|at| at.elapsed() < PROGRESS_EVERY) {
                        return;
                    }
                    last.set(Some(Instant::now()));
                    let _ = events.send(CaptureToLauncher::ExportProgress(
                        norisk_ipc::ExportProgress {
                            source: source.clone(),
                            done,
                            total,
                        },
                    ));
                };

                match work(&report) {
                    Ok(exported) => {
                        let _ = events.send(exported);
                    }
                    Err(e) => {
                        log::error!("{failed}: {e:#}");
                        let _ = events.send(CaptureToLauncher::Error(CaptureError {
                            code: ErrorCode::ClipWrite,
                            message: format!("{e:#}"),
                            recoverable: true,
                            source: Some(source.clone()),
                        }));
                    }
                }
            });

        if let Err(e) = spawned {
            self.emit_error_about(ErrorCode::ClipWrite, format!("{unstarted}: {e}"), true, Some(about));
        }
    }

    pub(super) fn trim_clip(&self, request: norisk_ipc::TrimClipRequest) {
        self.spawn_export(
            "nrc-trim",
            "Trim failed",
            "could not start the trim",
            request.source.clone(),
            move |_| {
                let started = Instant::now();
                let result = crate::trim::trim(
                    &request.source,
                    &request.destination,
                    request.start_seconds,
                    request.end_seconds,
                    request.video_start_seconds,
                    request.video_end_seconds,
                    &request.levels,
                )?;
                log::info!(
                    "Trimmed {:.1}s out of {} in {} ms",
                    result.end_seconds - result.start_seconds,
                    request.source.display(),
                    started.elapsed().as_millis()
                );
                Ok(CaptureToLauncher::ClipTrimmed(norisk_ipc::TrimmedClip {
                    path: result.path,
                    source: request.source,
                    duration_seconds: result.duration_seconds,
                    size_bytes: result.size_bytes,
                    start_seconds: result.start_seconds,
                    end_seconds: result.end_seconds,
                }))
            },
        );
    }
}
