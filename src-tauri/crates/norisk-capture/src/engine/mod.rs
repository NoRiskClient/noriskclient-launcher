use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Result;
use norisk_ipc::{
    CaptureConfig, CaptureError, CaptureState, CaptureToLauncher, ErrorCode, LauncherToCapture,
    ReadyInfo, StatusReport,
};
use tokio::sync::mpsc::UnboundedSender;

use crate::buffer::RingBuffer;
use crate::capture::{fit_output, window, CaptureDevice};
use crate::encoder::EncoderSettings;

mod audio;
mod edits;
mod pipeline;
mod save;
mod target;
mod trouble;

use audio::AudioSelection;
use pipeline::{LatencyWindow, Pipeline};
use target::{Aim, Target};
use trouble::{Trouble, Verdict, TROUBLE_LIMIT, TROUBLE_WINDOW};

const STATUS_INTERVAL: Duration = Duration::from_secs(1);
const HEALTH_GRACE: Duration = Duration::from_secs(3);
const HEALTHY_AFTER: Duration = Duration::from_secs(120);

const MIN_CAPTURE_SIDE: u32 = 128;
const ENCODE_DRAIN_BUDGET: Duration = Duration::from_millis(2_000);
const ATTACH_TIMEOUT: Duration = Duration::from_secs(60);
const EMPTY_RING_GRACE: Duration = Duration::from_secs(8);
const RETRY_AFTER: Duration = Duration::from_secs(2);

pub struct Engine {
    config: CaptureConfig,
    events: UnboundedSender<CaptureToLauncher>,
    active: Option<Pipeline>,
    pending_attach: Option<window::WindowSearch>,
    resize_settling: Option<ResizeSettling>,
    retired: Option<Retired>,
    buffering_enabled: bool,
    paused: Option<Aim>,
    trouble: Trouble,
    retry: Option<Retry>,
    last_status: Instant,
    rate_sample: (u64, u64, Instant),
    keyframe_warned: bool,
    empty_warned: bool,
}

#[derive(Clone, Copy)]
struct ResizeSettling {
    wanted: (u32, u32),
    since: Instant,
    began: Instant,
}

struct Retry {
    aim: Aim,
    at: Instant,
}

struct Retired {
    ring: Arc<Mutex<RingBuffer>>,
    extradata: Vec<u8>,
    settings: EncoderSettings,
    audio: Option<AudioSelection>,
    at: Instant,
    spoiled: Duration,
}

const RETAIN_FOR: Duration = Duration::from_secs(MAX_CLIP_SECONDS_RETAINED);
const MAX_CLIP_SECONDS_RETAINED: u64 = 130;

fn latency_p99_ms(window: &LatencyWindow) -> f32 {
    let mut samples: Vec<u32> = window
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .copied()
        .collect();
    if samples.is_empty() {
        return 0.0;
    }
    samples.sort_unstable();
    let index = ((samples.len() - 1) as f32 * 0.99).round() as usize;
    samples[index] as f32 / 1000.0
}

impl Engine {
    pub fn new(events: UnboundedSender<CaptureToLauncher>) -> Self {
        Self {
            config: CaptureConfig::default(),
            events,
            active: None,
            pending_attach: None,
            resize_settling: None,
            retired: None,
            buffering_enabled: true,
            paused: None,
            trouble: Trouble::default(),
            retry: None,
            last_status: Instant::now(),
            rate_sample: (0, 0, Instant::now()),
            keyframe_warned: false,
            empty_warned: false,
        }
    }

    pub fn run(mut self, commands: Receiver<LauncherToCapture>) {
        self.announce_ready();

        loop {
            match commands.recv_timeout(STATUS_INTERVAL) {
                Ok(LauncherToCapture::Shutdown) => break,
                Ok(command) => {
                    if let Err(e) = self.handle(command) {
                        log::warn!("Command failed: {e:#}");
                        self.emit_error(ErrorCode::Internal, format!("{e:#}"), true);
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }

            self.step_pending_attach();
            self.step_retry();
            self.step_health();
            self.step_resize_watch();

            if self.retired.as_ref().is_some_and(|r| r.at.elapsed() >= RETAIN_FOR) {
                log::debug!("Releasing the buffer kept across the last rebuild");
                self.retired = None;
            }
            self.step_retired_budget();

            if self.last_status.elapsed() >= STATUS_INTERVAL {
                self.last_status = Instant::now();
                self.emit_status();
            }
        }

        log::info!("Engine shutting down");
        self.detach();
    }

    fn announce_ready(&self) {
        let gpus = crate::capture::system::gpus();
        crate::capture::system::log_system(&gpus);
        let matrix = crate::encoder::capabilities();
        report_encoders(&matrix);
        let encoders = crate::encoder::available_for(norisk_ipc::ClipCodec::H264, &matrix);
        let adapter = self
            .active
            .as_ref()
            .map(|p| p.source.adapter().to_string())
            .or_else(|| match CaptureDevice::new_default() {
                Ok(device) => Some(device.adapter_name.clone()),
                Err(e) => {
                    log::warn!("This machine has no graphics device we can record with: {e:#}");
                    None
                }
            })
            .unwrap_or_else(|| "no usable graphics device".into());

        fn describe(
            devices: Result<Vec<crate::audio::AudioDevice>, anyhow::Error>,
            what: &str,
        ) -> Vec<norisk_ipc::AudioDeviceInfo> {
            devices
                .unwrap_or_else(|e| {
                    log::warn!("Could not list {what}: {e:#}");
                    Vec::new()
                })
                .into_iter()
                .map(|device| norisk_ipc::AudioDeviceInfo {
                    id: device.id,
                    name: device.name,
                    is_default: device.is_default,
                })
                .collect()
        }

        let audio_devices = describe(crate::audio::wasapi::output_devices(), "audio outputs");
        let microphones = describe(crate::audio::wasapi::input_devices(), "microphones");

        let gpu_driver = gpus
            .iter()
            .find(|gpu| adapter.starts_with(&gpu.name))
            .and_then(|gpu| gpu.driver.clone());

        let _ = self.events.send(CaptureToLauncher::Ready(ReadyInfo {
            protocol_version: norisk_ipc::PROTOCOL_VERSION,
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
            available_encoders: encoders,
            capabilities: matrix,
            adapter,
            audio_devices,
            microphones,
            supports_game_only_audio: crate::audio::wasapi::supports_process_capture(),
            gpu_driver,
        }));
    }

    fn handle(&mut self, command: LauncherToCapture) -> Result<()> {
        match command {
            LauncherToCapture::Configure(config) => {
                self.trouble = Trouble::default();
                let restart = self.active.is_some() && needs_restart(&self.config, &config);
                self.config = config;
                if restart {
                    log::info!("Configuration changed materially; restarting the pipeline");
                    if let Some(aim) = self.attached_aim() {
                        self.detach_retaining_buffer(Duration::ZERO);
                        self.aim_at(aim);
                    }
                }
            }
            LauncherToCapture::AttachWindow { pid } => {
                let aim = Aim::Process(pid);
                self.retry = None;
                if !self.buffering_enabled {
                    log::info!("Buffering is paused; process {pid} waits for the resume");
                    self.paused = Some(aim);
                } else if self.attached_aim() == Some(aim.clone()) {
                    log::debug!("Already recording process {pid}; leaving the pipeline alone");
                } else if let Some(at) = self.trouble.rest_ends(&aim, Instant::now()) {
                    log::debug!("Recording process {pid} kept failing; waiting before trying again");
                    self.retry = Some(Retry { aim, at });
                } else {
                    self.detach();
                    self.begin_attach(pid);
                }
            }
            LauncherToCapture::AttachScreen { device } => {
                let aim = Aim::Screen(device.clone());
                self.retry = None;
                if !self.buffering_enabled {
                    log::info!("Buffering is paused; screen {device} waits for the resume");
                    self.paused = Some(aim);
                } else if self.attached_aim() == Some(aim.clone()) {
                    log::debug!("Already recording screen {device}; leaving the pipeline alone");
                } else if let Some(at) = self.trouble.rest_ends(&aim, Instant::now()) {
                    log::debug!("Recording screen {device} kept failing; waiting before trying again");
                    self.retry = Some(Retry { aim, at });
                } else {
                    self.detach();
                    self.aim_at(aim);
                }
            }
            LauncherToCapture::DetachWindow => {
                self.paused = None;
                self.retry = None;
                self.trouble = Trouble::default();
                self.detach();
            }
            LauncherToCapture::SetBufferEnabled { enabled } => {
                if enabled == self.buffering_enabled {
                    return Ok(());
                }
                self.buffering_enabled = enabled;
                self.trouble = Trouble::default();
                self.retry = None;

                if enabled {
                    log::info!("Buffering resumed");
                    if let Some(aim) = self.paused.take() {
                        self.aim_at(aim);
                    }
                } else {
                    log::info!("Buffering paused; releasing the capture until it resumes");
                    self.paused = self.attached_aim();
                    self.detach_retaining_buffer(Duration::ZERO);
                }
            }
            LauncherToCapture::SaveClip(request) => self.save_clip(request)?,
            LauncherToCapture::TrimClip(request) => self.trim_clip(request),
            LauncherToCapture::ExportVertical(request) => self.export_vertical(request),
            LauncherToCapture::ExportGif(request) => self.export_gif(request),
            LauncherToCapture::PrepareAudioPreview(request) => self.prepare_preview(request),
            LauncherToCapture::Ping { seq } => {
                let _ = self.events.send(CaptureToLauncher::Pong { seq });
            }
            LauncherToCapture::Shutdown => {}
        }
        Ok(())
    }

    fn attached_aim(&self) -> Option<Aim> {
        self.active
            .as_ref()
            .map(|pipeline| pipeline.target.aim())
            .or_else(|| self.pending_attach.as_ref().map(|search| Aim::Process(search.pid())))
    }

    fn aim_at(&mut self, aim: Aim) {
        match aim {
            Aim::Process(pid) => self.begin_attach(pid),
            Aim::Screen(device) => self.attach_screen(&device),
        }
    }

    fn attach_screen(&mut self, device: &str) {
        let Some(screen) = crate::capture::screen::find(device) else {
            let message = format!("screen {device} is not connected");
            log::warn!("{message}");
            self.emit_error(ErrorCode::WindowNotFound, message, true);
            return;
        };
        if let Err(e) = self.attach(Target::Screen(screen)) {
            log::error!("Could not start recording screen {device}: {e:#}");
            self.troubled(Aim::Screen(device.to_string()), ErrorCode::Internal, format!("{e:#}"));
        }
    }

    fn begin_attach(&mut self, pid: u32) {
        log::info!("Waiting for a window from process {pid}");
        self.pending_attach = Some(window::WindowSearch::new(pid, ATTACH_TIMEOUT));
    }

    fn step_pending_attach(&mut self) {
        let Some(search) = self.pending_attach.as_mut() else {
            return;
        };
        let pid = search.pid();

        match search.poll() {
            window::SearchStep::Waiting => {}
            window::SearchStep::Found(target) => {
                if window::client_size(target.hwnd).is_none() {
                    return;
                }
                self.pending_attach = None;
                if let Err(e) = self.attach(Target::Window(target)) {
                    log::error!("Could not start capturing process {pid}: {e:#}");
                    self.troubled(Aim::Process(pid), ErrorCode::Internal, format!("{e:#}"));
                }
            }
            window::SearchStep::TimedOut => {
                self.pending_attach = None;
                let message =
                    format!("process {pid} showed no window to capture within {ATTACH_TIMEOUT:?}");
                log::warn!("{message}");
                self.emit_error(ErrorCode::WindowNotFound, message, true);
            }
        }
    }

    fn step_health(&mut self) {
        let Some(pipeline) = self.active.as_ref() else {
            return;
        };
        if pipeline.started.elapsed() < HEALTH_GRACE {
            return;
        }
        if pipeline.started.elapsed() >= HEALTHY_AFTER && self.trouble.has_history() {
            log::debug!("Recording has run cleanly for {HEALTHY_AFTER:?}; forgetting earlier failures");
            self.trouble = Trouble::default();
        }

        let broken = if let Err(e) = unsafe { pipeline.device.device.GetDeviceRemovedReason() } {
            Some(format!("the graphics driver reset or the card went away ({e})"))
        } else if matches!(
            pipeline.encode_done.try_recv(),
            Ok(()) | Err(std::sync::mpsc::TryRecvError::Disconnected)
        ) {
            Some("the video encoder stopped".to_string())
        } else if pipeline.source.has_stopped() {
            Some("the game stopped handing over its picture".to_string())
        } else {
            None
        };

        let Some(why) = broken else {
            return;
        };

        let aim = pipeline.target.aim();
        log::warn!("Recording broke because {why}; rebuilding it");
        let again = self.troubled(
            aim.clone(),
            ErrorCode::GraphicsDevice,
            format!("recording broke because {why}; it is starting again"),
        );
        self.detach_retaining_buffer(Duration::ZERO);
        if again {
            self.aim_at(aim);
        }
    }

    fn troubled(&mut self, aim: Aim, code: ErrorCode, message: String) -> bool {
        let now = Instant::now();
        match self.trouble.note(&aim, now) {
            Verdict::Report => {
                self.emit_error(code, message, true);
                true
            }
            Verdict::Quiet => {
                self.retry = Some(Retry {
                    aim,
                    at: now + RETRY_AFTER,
                });
                true
            }
            Verdict::Rest(rest) => {
                self.retry = Some(Retry { aim, at: now + rest });
                log::warn!(
                    "Recording failed {TROUBLE_LIMIT} times within {TROUBLE_WINDOW:?}; waiting {rest:?} before trying again"
                );
                self.emit_error(
                    code,
                    format!(
                        "recording keeps failing, so it waits {} s before trying again: {message}",
                        rest.as_secs()
                    ),
                    true,
                );
                false
            }
        }
    }

    fn step_retry(&mut self) {
        let now = Instant::now();
        let Some(retry) = self.retry.take_if(|retry| now >= retry.at) else {
            return;
        };
        if !self.buffering_enabled || self.active.is_some() || self.pending_attach.is_some() {
            return;
        }
        log::info!("Trying to record {:?} again after it failed", retry.aim);
        self.aim_at(retry.aim);
    }

    fn step_resize_watch(&mut self) {
        const SETTLE: Duration = Duration::from_secs(2);

        let Some(pipeline) = self.active.as_ref() else {
            self.resize_settling = None;
            return;
        };

        let source = pipeline.target.size();
        pipeline.hidden.store(source.is_none(), Ordering::Relaxed);
        let Some(source) = source else {
            self.resize_settling = None;
            return;
        };

        if source.0 < MIN_CAPTURE_SIDE || source.1 < MIN_CAPTURE_SIDE {
            self.resize_settling = None;
            return;
        }

        let wanted = fit_output(source, (self.config.width, self.config.height));
        if wanted == (pipeline.settings.width, pipeline.settings.height) {
            self.resize_settling = None;
            return;
        }

        match self.resize_settling {
            Some(ResizeSettling {
                wanted: pending,
                since,
                began,
            }) if pending == wanted => {
                if since.elapsed() < SETTLE {
                    return;
                }
                let aim = pipeline.target.aim();
                let was = (pipeline.settings.width, pipeline.settings.height);
                log::info!(
                    "Window settled at {}x{}; rebuilding the pipeline to record {}x{} instead of {}x{}",
                    source.0,
                    source.1,
                    wanted.0,
                    wanted.1,
                    was.0,
                    was.1
                );
                self.resize_settling = None;
                self.detach_retaining_buffer(began.elapsed() + STATUS_INTERVAL);
                self.aim_at(aim);
            }
            Some(ResizeSettling { began, .. }) => {
                self.resize_settling = Some(ResizeSettling {
                    wanted,
                    since: Instant::now(),
                    began,
                })
            }
            None => {
                let now = Instant::now();
                self.resize_settling = Some(ResizeSettling {
                    wanted,
                    since: now,
                    began: now,
                })
            }
        }
    }

    fn detach_retaining_buffer(&mut self, spoiled: Duration) {
        if let Some(audio) = self.active.as_ref().and_then(|p| p.audio.as_ref()) {
            audio.drain_mixer();
        }

        let retired = self.active.as_ref().map(|pipeline| Retired {
            ring: Arc::clone(&pipeline.ring),
            extradata: pipeline.extradata.clone(),
            settings: pipeline.settings,
            audio: pipeline.audio.as_ref().map(AudioSelection::from),
            at: Instant::now(),
            spoiled,
        });

        let drained = self.detach();

        if let Some(retired) = retired {
            let held = retired
                .ring
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .duration_seconds();
            if drained {
                log::info!("Keeping {held:.1}s of the previous buffer across the rebuild");
            } else {
                log::info!(
                    "Keeping the previous buffer across the rebuild; it holds {held:.1}s so far \
                     and the encoder is still flushing into it"
                );
            }
            self.retired = Some(retired);
        }
    }

    fn step_retired_budget(&mut self) {
        let (Some(retired), Some(active)) = (self.retired.as_ref(), self.active.as_ref()) else {
            return;
        };

        let live = active
            .ring
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .duration_seconds();
        let spare = self.config.buffer_seconds as f64 - live;

        if spare <= 0.0 {
            log::debug!("The live buffer is full again; releasing the one kept across the rebuild");
            self.retired = None;
            return;
        }

        retired
            .ring
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .shrink_window(spare as f32);
    }

    fn detach(&mut self) -> bool {
        self.pending_attach = None;

        let Some(mut pipeline) = self.active.take() else {
            return true;
        };
        self.retired = None;
        log::info!("Detaching");

        drop(pipeline.source);
        pipeline.frames_tx.take();
        let Some(handle) = pipeline.encode_thread.take() else {
            return true;
        };

        match pipeline.encode_done.recv_timeout(ENCODE_DRAIN_BUDGET) {
            Err(RecvTimeoutError::Timeout) => {
                log::warn!(
                    "The encoder is still flushing after {ENCODE_DRAIN_BUDGET:?}; letting it \
                     finish on its own so the engine stays answerable"
                );
                false
            }
            _ => {
                let _ = handle.join();
                true
            }
        }
    }

    fn emit_status(&mut self) {
        let Some(pipeline) = self.active.as_ref() else {
            let _ = self.events.send(CaptureToLauncher::Status(StatusReport {
                state: if !self.buffering_enabled {
                    CaptureState::Paused
                } else if self.pending_attach.is_some() {
                    CaptureState::Attaching
                } else if self.trouble.resting_at_all(Instant::now()) {
                    CaptureState::Failed
                } else {
                    CaptureState::Idle
                },
                buffer_fill_seconds: 0.0,
                buffer_bytes: 0,
                capture_fps: 0.0,
                encode_fps: 0.0,
                dropped_frames: 0,
                dropped_before_keyframe: 0,
                encode_latency_ms_p99: 0.0,
                capture_method: None,
                retry_in_seconds: self.trouble.retry_in(Instant::now()),
                active_codec: None,
                active_encoder: None,
            }));
            return;
        };

        let stats = pipeline.source.stats();
        let (buffer_fill_seconds, buffer_bytes, dropped_before_keyframe) = {
            let ring = pipeline.ring.lock().unwrap_or_else(|e| e.into_inner());
            (
                ring.duration_seconds() as f32,
                ring.bytes(),
                ring.dropped_before_first_keyframe(),
            )
        };

        if buffer_fill_seconds <= 0.0
            && dropped_before_keyframe == 0
            && stats.delivered > 0
            && pipeline.started.elapsed() >= EMPTY_RING_GRACE
            && !self.empty_warned
        {
            self.empty_warned = true;
            log::error!(
                "Nothing has reached the replay buffer in {:?} of recording: the source handed on \
                 {} frame(s), {} never reached the encoder, and {} packet(s) were thrown away \
                 waiting for a first keyframe. No clip can be cut in this state.",
                pipeline.started.elapsed(),
                stats.delivered,
                pipeline.dropped.load(Ordering::Relaxed),
                dropped_before_keyframe,
            );
        }

        if dropped_before_keyframe > 0 && buffer_fill_seconds <= 0.0 && !self.keyframe_warned {
            self.keyframe_warned = true;
            log::warn!(
                "{} has produced {dropped_before_keyframe} packet(s) and not one keyframe, so the \
                 replay buffer is throwing all of them away and every clip will fail. The encoder \
                 is not honouring the keyframe request.",
                crate::encoder::encoder_name(pipeline.settings.codec, pipeline.encoder)
                    .unwrap_or("the encoder")
            );
        }

        let now = Instant::now();
        let (received_before, delivered_before, sampled_at) = std::mem::replace(
            &mut self.rate_sample,
            (stats.received, stats.delivered, now),
        );
        let elapsed = now.duration_since(sampled_at).as_secs_f32().max(1e-3);
        let rate = |after: u64, before: u64| after.saturating_sub(before) as f32 / elapsed;

        let state = if !self.buffering_enabled {
            CaptureState::Paused
        } else {
            pipeline.source.state()
        };

        let _ = self.events.send(CaptureToLauncher::Status(StatusReport {
            state,
            buffer_fill_seconds,
            buffer_bytes,
            capture_fps: rate(stats.received, received_before),
            encode_fps: rate(stats.delivered, delivered_before),
            dropped_frames: pipeline.dropped.load(Ordering::Relaxed),
            dropped_before_keyframe,
            encode_latency_ms_p99: latency_p99_ms(&pipeline.encode_latency),
            capture_method: Some(pipeline.source.method()),
            retry_in_seconds: None,
            active_codec: Some(pipeline.settings.codec),
            active_encoder: Some(pipeline.encoder),
        }));
    }

    fn emit_error(&self, code: ErrorCode, message: String, recoverable: bool) {
        if recoverable {
            log::warn!("{code:?}: {message}");
        } else {
            log::error!("{code:?}: {message}");
        }
        let _ = self.events.send(CaptureToLauncher::Error(CaptureError {
            code,
            message,
            recoverable,
        }));
    }
}

fn report_encoders(matrix: &[norisk_ipc::EncoderCapability]) {
    for codec in norisk_ipc::ClipCodec::all() {
        let verdicts: Vec<String> = matrix
            .iter()
            .filter(|c| c.codec == codec)
            .map(|c| match (c.available, c.detail.as_deref()) {
                (true, _) => format!("{:?} yes", c.encoder),
                (false, Some(why)) => format!("{:?} no ({why})", c.encoder),
                (false, None) => format!("{:?} no", c.encoder),
            })
            .collect();

        if !verdicts.is_empty() {
            log::info!("{codec:?} encoders: {}", verdicts.join(", "));
        }
    }
}

fn needs_restart(current: &CaptureConfig, next: &CaptureConfig) -> bool {
    current.width != next.width
        || current.height != next.height
        || current.fps != next.fps
        || current.encoder != next.encoder
        || current.codec != next.codec
        || current.gop_seconds != next.gop_seconds
        || current.audio_source != next.audio_source
        || current.audio_device_id != next.audio_device_id
        || current.capture_audio != next.capture_audio
        || current.game_volume != next.game_volume
        || current.other_volume != next.other_volume
        || current.capture_microphone != next.capture_microphone
        || current.microphone_device_id != next.microphone_device_id
        || current.microphone_volume != next.microphone_volume
        || current.microphone_denoise != next.microphone_denoise
        || current.excluded_audio_executable != next.excluded_audio_executable
}

#[cfg(test)]
mod tests {
    use super::*;
    use norisk_ipc::EncoderPreference;

    fn base() -> CaptureConfig {
        CaptureConfig::default()
    }

    #[test]
    fn resolution_and_encoder_changes_force_a_restart() {
        let mut next = base();
        next.width = 1280;
        assert!(needs_restart(&base(), &next));

        let mut next = base();
        next.encoder = EncoderPreference::Software;
        assert!(needs_restart(&base(), &next));

        let mut next = base();
        next.fps = 30;
        assert!(needs_restart(&base(), &next));

        let mut next = base();
        next.codec = norisk_ipc::ClipCodec::Av1;
        assert!(needs_restart(&base(), &next));
    }

    #[test]
    fn every_audio_setting_the_pipeline_reads_once_forces_a_restart() {
        let mut next = base();
        next.microphone_denoise = !base().microphone_denoise;
        assert!(
            needs_restart(&base(), &next),
            "noise suppression is decided when the pipeline starts, so it has to restart",
        );

        let mut next = base();
        next.capture_microphone = !base().capture_microphone;
        assert!(needs_restart(&base(), &next));

        let mut next = base();
        next.microphone_device_id = Some("another".into());
        assert!(needs_restart(&base(), &next));

        let mut next = base();
        next.excluded_audio_executable = Some("Spotify.exe".into());
        assert!(needs_restart(&base(), &next));
    }

    #[test]
    fn bitrate_and_buffer_length_apply_without_a_restart() {
        let mut next = base();
        next.bitrate_kbps = 40_000;
        assert!(!needs_restart(&base(), &next));

        let mut next = base();
        next.buffer_seconds = 60;
        assert!(!needs_restart(&base(), &next));
    }
}
