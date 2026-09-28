use std::time::{Duration, Instant};

use norisk_ipc::{CaptureError, CaptureToLauncher, ErrorCode};

use super::Engine;

const PROGRESS_EVERY: Duration = Duration::from_millis(150);

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
        let events = self.events.clone();

        let spawned = std::thread::Builder::new()
            .name("nrc-export".into())
            .spawn(move || {
                let started = Instant::now();

                let source = request.source.clone();
                let last = std::cell::Cell::new(Instant::now() - PROGRESS_EVERY);
                let report = |done: u32, total: u32| {
                    let finished = done >= total;
                    if !finished && last.get().elapsed() < PROGRESS_EVERY {
                        return;
                    }
                    last.set(Instant::now());
                    let _ = events.send(CaptureToLauncher::ExportProgress(
                        norisk_ipc::ExportProgress {
                            source: source.clone(),
                            done,
                            total,
                        },
                    ));
                };

                match crate::render::render(&request, report) {
                    Ok(result) => {
                        log::info!(
                            "Exported {} as {}x{} in {} ms",
                            request.source.display(),
                            result.width,
                            result.height,
                            started.elapsed().as_millis()
                        );
                        let _ = events.send(CaptureToLauncher::ClipExported(
                            norisk_ipc::ExportedClip {
                                path: result.path,
                                source: request.source,
                                width: result.width,
                                height: result.height,
                                duration_seconds: result.duration_seconds,
                                size_bytes: result.size_bytes,
                            },
                        ));
                    }
                    Err(e) => {
                        log::error!("Vertical export failed: {e:#}");
                        let _ = events.send(CaptureToLauncher::Error(CaptureError {
                            code: ErrorCode::ClipWrite,
                            message: format!("{e:#}"),
                            recoverable: true,
                        }));
                    }
                }
            });

        if let Err(e) = spawned {
            self.emit_error(
                ErrorCode::ClipWrite,
                format!("could not start the export: {e}"),
                true,
            );
        }
    }

    pub(super) fn export_gif(&self, request: norisk_ipc::ExportGifRequest) {
        let events = self.events.clone();

        let spawned = std::thread::Builder::new()
            .name("nrc-gif".into())
            .spawn(move || {
                let started = Instant::now();

                let source = request.source.clone();
                let last = std::cell::Cell::new(Instant::now() - PROGRESS_EVERY);
                let report = |done: u32, total: u32| {
                    let finished = done >= total;
                    if !finished && last.get().elapsed() < PROGRESS_EVERY {
                        return;
                    }
                    last.set(Instant::now());
                    let _ = events.send(CaptureToLauncher::ExportProgress(
                        norisk_ipc::ExportProgress {
                            source: source.clone(),
                            done,
                            total,
                        },
                    ));
                };

                match crate::gif::to_gif(&request.source, &request.destination, report) {
                    Ok(result) => {
                        log::info!(
                            "Turned {} into a GIF in {} ms",
                            request.source.display(),
                            started.elapsed().as_millis()
                        );
                        let _ = events.send(CaptureToLauncher::GifExported(
                            norisk_ipc::ExportedGif {
                                path: result.path,
                                source: request.source,
                                width: result.width,
                                height: result.height,
                                frames: result.frames,
                                duration_seconds: result.duration_seconds,
                                size_bytes: result.size_bytes,
                                truncated: result.truncated,
                            },
                        ));
                    }
                    Err(e) => {
                        log::error!("GIF export failed: {e:#}");
                        let _ = std::fs::remove_file(&request.destination);
                        let _ = events.send(CaptureToLauncher::Error(CaptureError {
                            code: ErrorCode::ClipWrite,
                            message: format!("{e:#}"),
                            recoverable: true,
                        }));
                    }
                }
            });

        if let Err(e) = spawned {
            self.emit_error(
                ErrorCode::ClipWrite,
                format!("could not start the GIF export: {e}"),
                true,
            );
        }
    }

    pub(super) fn trim_clip(&self, request: norisk_ipc::TrimClipRequest) {
        let started = Instant::now();
        match crate::trim::trim(
            &request.source,
            &request.destination,
            request.start_seconds,
            request.end_seconds,
            request.video_start_seconds,
            request.video_end_seconds,
            &request.levels,
        ) {
            Ok(result) => {
                log::info!(
                    "Trimmed {:.1}s out of {} in {} ms",
                    result.end_seconds - result.start_seconds,
                    request.source.display(),
                    started.elapsed().as_millis()
                );
                let _ = self
                    .events
                    .send(CaptureToLauncher::ClipTrimmed(norisk_ipc::TrimmedClip {
                        path: result.path,
                        source: request.source,
                        duration_seconds: result.duration_seconds,
                        size_bytes: result.size_bytes,
                        start_seconds: result.start_seconds,
                        end_seconds: result.end_seconds,
                    }));
            }
            Err(e) => self.emit_error(ErrorCode::ClipWrite, format!("{e:#}"), true),
        }
    }
}
