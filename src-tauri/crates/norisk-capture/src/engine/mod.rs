use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use norisk_ipc::{
    CaptureConfig, CaptureError, CaptureState, CaptureToLauncher, ErrorCode, LauncherToCapture,
    ReadyInfo, StatusReport,
};
use tokio::sync::mpsc::UnboundedSender;

use crate::buffer::{AudioRing, PeakRing, RingBuffer};
use crate::capture::{fit_output, window, BgraFrame, CaptureDevice, CaptureSession, Converter};
use crate::encoder::{
    video::TIME_BASE_DEN, EncoderSettings, HwFramePool, PoolFrame, VideoEncoder,
};

mod edits;
mod save;
mod target;
mod trouble;

use target::{Aim, Target};
use trouble::{Trouble, Verdict, TROUBLE_LIMIT, TROUBLE_WINDOW};

const STATUS_INTERVAL: Duration = Duration::from_secs(1);
const HEALTH_GRACE: Duration = Duration::from_secs(3);
const FAILURE_LOG_EVERY: u64 = 600;
const HEALTHY_AFTER: Duration = Duration::from_secs(120);

const ENCODE_QUEUE_DEPTH: usize = 4;

const MIN_CAPTURE_SIDE: u32 = 128;
const ENCODE_DRAIN_BUDGET: Duration = Duration::from_millis(2_000);
const ATTACH_TIMEOUT: Duration = Duration::from_secs(60);
const EMPTY_RING_GRACE: Duration = Duration::from_secs(8);

pub struct Engine {
    config: CaptureConfig,
    events: UnboundedSender<CaptureToLauncher>,
    active: Option<Pipeline>,
    pending_attach: Option<window::WindowSearch>,
    resize_settling: Option<((u32, u32), Instant, Instant)>,
    retired: Option<Retired>,
    buffering_enabled: bool,
    paused: Option<Aim>,
    trouble: Trouble,
    last_status: Instant,
    rate_sample: std::cell::Cell<(u64, u64, Instant)>,
    keyframe_warned: std::cell::Cell<bool>,
    empty_warned: std::cell::Cell<bool>,
}

enum FrameSource {
    Window(CaptureSession),
    Hook(Box<crate::capture::hook::HookCapture>),
}

impl FrameSource {
    fn adapter(&self) -> &str {
        match self {
            Self::Window(session) => session.adapter(),
            Self::Hook(hook) => hook.adapter(),
        }
    }

    fn has_stopped(&self) -> bool {
        match self {
            Self::Window(_) => false,
            Self::Hook(hook) => hook.has_stopped(),
        }
    }

    fn state(&self) -> CaptureState {
        match self {
            Self::Window(session) => session.state(),
            Self::Hook(_) => CaptureState::Buffering,
        }
    }

    fn stats(&self) -> crate::capture::CaptureStats {
        match self {
            Self::Window(session) => session.stats(),
            Self::Hook(hook) => crate::capture::CaptureStats {
                received: hook.frames_delivered(),
                delivered: hook.frames_delivered(),
                gated: 0,
                size_changes: 0,
            },
        }
    }

    fn describe(&self) -> &'static str {
        match self {
            Self::Window(session) if session.is_screen() => "screen capture",
            Self::Window(_) => "window capture",
            Self::Hook(_) => "graphics hook",
        }
    }
}

struct Retired {
    ring: Arc<Mutex<RingBuffer>>,
    extradata: Vec<u8>,
    settings: EncoderSettings,
    audio: Option<RetiredAudio>,
    at: Instant,
    spoiled: Duration,
}

struct RetiredAudio {
    master: AudioStem,
    stems: Vec<AudioStem>,
    sample_rate: u32,
    channels: u32,
}

const RETAIN_FOR: Duration = Duration::from_secs(MAX_CLIP_SECONDS_RETAINED);
const MAX_CLIP_SECONDS_RETAINED: u64 = 130;

struct Pipeline {
    device: CaptureDevice,
    hidden: Arc<AtomicBool>,
    source: FrameSource,
    encode_thread: Option<std::thread::JoinHandle<()>>,
    encode_done: Receiver<()>,
    frames_tx: Option<SyncSender<PoolFrame>>,
    ring: Arc<Mutex<RingBuffer>>,
    extradata: Vec<u8>,
    dropped: Arc<AtomicU64>,
    encode_latency: LatencyWindow,
    settings: EncoderSettings,
    encoder: norisk_ipc::EncoderPreference,
    audio: Option<AudioPipeline>,
    target: Target,
    started: Instant,
}

type LatencyWindow = Arc<Mutex<VecDeque<u32>>>;

const LATENCY_SAMPLES: usize = 240;

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

struct AudioPlan {
    sources: Vec<PlannedSource>,
}

struct PlannedSource {
    source: crate::audio::wasapi::AudioSource,
    track: crate::audio::Track,
    gain: f32,
}

impl AudioPlan {
    fn single(source: crate::audio::wasapi::AudioSource, gain: f32) -> Self {
        Self {
            sources: vec![PlannedSource {
                source,
                track: crate::audio::Track::Game,
                gain,
            }],
        }
    }

    fn push(
        &mut self,
        source: crate::audio::wasapi::AudioSource,
        track: crate::audio::Track,
        gain: f32,
    ) {
        self.sources.push(PlannedSource {
            source,
            track,
            gain,
        });
    }
}

fn gain(percent: u32) -> f32 {
    (percent.min(200) as f32) / 100.0
}

#[derive(Clone)]
struct AudioStem {
    label: &'static str,
    ring: Arc<Mutex<AudioRing>>,
    extradata: Arc<Mutex<Vec<u8>>>,
    peaks: Arc<Mutex<PeakRing>>,
}

struct AudioPipeline {
    _captures: Vec<crate::audio::LoopbackCapture>,
    master: AudioStem,
    stems: Vec<AudioStem>,
    sample_rate: u32,
    channels: u32,
    mixers: Vec<(crate::audio::Mixer, AudioSink)>,
}

type AudioSink = Arc<Mutex<dyn FnMut(&[f32], i64) + Send>>;

impl AudioPipeline {
    fn tracks(&self) -> impl Iterator<Item = &AudioStem> {
        std::iter::once(&self.master).chain(self.stems.iter())
    }

    fn drain_mixer(&self) {
        for (mixer, sink) in &self.mixers {
            let tail = mixer.flush();
            if tail.is_empty() {
                continue;
            }

            let samples: usize = tail.iter().map(|block| block.samples.len()).sum();
            let mut sink = sink.lock().unwrap_or_else(|e| e.into_inner());
            for block in tail {
                (*sink)(&block.samples, block.timestamp_100ns);
            }
            drop(sink);

            log::debug!(
                "Drained {:.0} ms of held audio out of a mixer",
                mixer.span_100ns(samples) as f64 / 10_000.0
            );
        }

        for stem in self.tracks() {
            stem.peaks.lock().unwrap_or_else(|e| e.into_inner()).flush();
        }
    }
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
            last_status: Instant::now(),
            rate_sample: std::cell::Cell::new((0, 0, Instant::now())),
            keyframe_warned: std::cell::Cell::new(false),
            empty_warned: std::cell::Cell::new(false),
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
                if !self.buffering_enabled {
                    log::info!("Buffering is paused; process {pid} waits for the resume");
                    self.paused = Some(Aim::Process(pid));
                } else if self.attached_aim() == Some(Aim::Process(pid)) {
                    log::debug!("Already recording process {pid}; leaving the pipeline alone");
                } else if self.trouble.resting(pid, Instant::now()) {
                    log::debug!("Recording process {pid} kept failing; waiting before trying again");
                } else {
                    self.detach();
                    self.begin_attach(pid);
                }
            }
            LauncherToCapture::AttachScreen { device } => {
                let aim = Aim::Screen(device.clone());
                if !self.buffering_enabled {
                    log::info!("Buffering is paused; screen {device} waits for the resume");
                    self.paused = Some(aim);
                } else if self.attached_aim() == Some(aim.clone()) {
                    log::debug!("Already recording screen {device}; leaving the pipeline alone");
                } else if self.trouble.resting(0, Instant::now()) {
                    log::debug!("Recording screen {device} kept failing; waiting before trying again");
                } else {
                    self.detach();
                    self.aim_at(aim);
                }
            }
            LauncherToCapture::DetachWindow => {
                self.paused = None;
                self.trouble = Trouble::default();
                self.detach();
            }
            LauncherToCapture::SetBufferEnabled { enabled } => {
                if enabled == self.buffering_enabled {
                    return Ok(());
                }
                self.buffering_enabled = enabled;
                self.trouble = Trouble::default();

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

    fn system_source(
        &self,
        device: crate::audio::wasapi::AudioSource,
    ) -> crate::audio::wasapi::AudioSource {
        use crate::audio::wasapi::AudioSource;

        let Some(executable) = self
            .config
            .excluded_audio_executable
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
        else {
            return device;
        };

        if self.config.audio_device_id.as_deref().is_some_and(|id| !id.is_empty()) {
            log::warn!(
                "{executable} cannot be kept out of the clip while a specific audio device is chosen; recording the device as it is"
            );
            return device;
        }

        match crate::audio::wasapi::pid_of_executable(executable) {
            Some(pid) => {
                log::info!("Keeping {executable} (pid {pid}) out of the clip's audio");
                AudioSource::EverythingExcept(pid)
            }
            None => {
                log::info!("{executable} is not running, so there is nothing to keep out");
                device
            }
        }
    }

    fn audio_plan(&self, pid: u32) -> AudioPlan {
        use crate::audio::wasapi::AudioSource;
        use crate::audio::Track;
        use norisk_ipc::AudioSourceChoice;

        let device = match self.config.audio_device_id.as_deref() {
            Some(id) if !id.is_empty() => AudioSource::Device(id.to_string()),
            _ => AudioSource::DefaultDevice,
        };

        let choice = if pid == 0 {
            AudioSourceChoice::System
        } else {
            self.config.audio_source
        };
        let mut plan = match choice {
            AudioSourceChoice::System => {
                AudioPlan::single(self.system_source(device), gain(self.config.other_volume))
            }
            AudioSourceChoice::GameOnly => {
                AudioPlan::single(AudioSource::Process(pid), gain(self.config.game_volume))
            }
            AudioSourceChoice::Both => {
                let mut plan = AudioPlan::single(
                    AudioSource::Process(pid),
                    gain(self.config.game_volume),
                );
                plan.push(
                    AudioSource::EverythingExcept(pid),
                    Track::Other,
                    gain(self.config.other_volume),
                );
                plan
            }
        };

        if self.config.capture_microphone {
            let device = self
                .config
                .microphone_device_id
                .as_deref()
                .filter(|id| !id.is_empty())
                .map(|id| id.to_string());

            plan.push(
                AudioSource::Microphone(device),
                Track::Microphone,
                gain(self.config.microphone_volume),
            );
        }

        plan
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
            self.troubled(0, ErrorCode::Internal, format!("{e:#}"));
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
                    self.troubled(pid, ErrorCode::Internal, format!("{e:#}"));
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

        if crate::fault::due("crash", pipeline.started) {
            panic!("simulated crash because NRC_FAULT=crash is set");
        }

        let broken = if crate::fault::due("device", pipeline.started) {
            Some("the graphics driver reset (simulated)".to_string())
        } else if let Err(e) = unsafe { pipeline.device.device.GetDeviceRemovedReason() } {
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
        let key = pipeline.target.pid();
        log::warn!("Recording broke because {why}; rebuilding it");
        let again = self.troubled(
            key,
            ErrorCode::GraphicsDevice,
            format!("recording broke because {why}; it is starting again"),
        );
        self.detach_retaining_buffer(Duration::ZERO);
        if again {
            self.aim_at(aim);
        }
    }

    fn troubled(&mut self, pid: u32, code: ErrorCode, message: String) -> bool {
        match self.trouble.note(pid, Instant::now()) {
            Verdict::Report => {
                self.emit_error(code, message, true);
                true
            }
            Verdict::Quiet => true,
            Verdict::Rest(rest) => {
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
            Some((pending, since, began)) if pending == wanted => {
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
            Some((_, _, began)) => self.resize_settling = Some((wanted, Instant::now(), began)),
            None => self.resize_settling = Some((wanted, Instant::now(), Instant::now())),
        }
    }

    fn choose_encoder(&self) -> Result<(norisk_ipc::ClipCodec, norisk_ipc::EncoderPreference)> {
        let matrix = crate::encoder::capabilities();
        let requested = self.config.codec;

        let Some((codec, encoder)) =
            norisk_ipc::select_encoder(requested, self.config.encoder, &matrix)
        else {
            anyhow::bail!("this machine has no usable video encoder for any codec");
        };

        if codec != requested {
            log::warn!("{requested:?} cannot be encoded on this machine; recording in {codec:?} instead");
        }
        if encoder != self.config.encoder && self.config.encoder != norisk_ipc::EncoderPreference::Auto
        {
            log::warn!(
                "{:?} is not usable on this machine; recording with {encoder:?} instead",
                self.config.encoder
            );
        }

        log::info!("Recording {codec:?} with {encoder:?}");
        Ok((codec, encoder))
    }

    fn attach(&mut self, target: Target) -> Result<()> {
        log::info!("Attaching to {}", target.label());
        self.keyframe_warned.set(false);
        self.empty_warned.set(false);

        let (codec, chosen) = self.choose_encoder()?;

        let Some(source) = target.size() else {
            anyhow::bail!(
                "{} is minimised or has no drawable area, so there is nothing to record yet",
                target.label(),
            );
        };

        if source.0 < MIN_CAPTURE_SIDE || source.1 < MIN_CAPTURE_SIDE {
            anyhow::bail!(
                "{} is only {}x{} on screen, too small to record — it is probably minimised",
                target.label(),
                source.0,
                source.1,
            );
        }

        let (width, height) = fit_output(source, (self.config.width, self.config.height));
        if (width, height) != (self.config.width, self.config.height) {
            log::info!(
                "Recording at {width}x{height}: the game renders {}x{} and the preset caps at {}x{}",
                source.0,
                source.1,
                self.config.width,
                self.config.height
            );
        }

        let settings = EncoderSettings {
            width,
            height,
            fps: self.config.fps,
            bitrate_kbps: self.config.bitrate_kbps,
            gop_seconds: self.config.gop_seconds,
            codec,
        };

        let (device, hooked) = match &target {
            Target::Window(window) => match hook_handshake(window, settings.fps) {
                Ok((session, texture)) => {
                    match CaptureDevice::new_for_shared_texture(window.hwnd, texture.handle) {
                        Ok(device) => (device, Ok((session, texture))),
                        Err(e) => (CaptureDevice::new_for_window(window.hwnd)?, Err(e)),
                    }
                }
                Err(e) => (CaptureDevice::new_for_window(window.hwnd)?, Err(e)),
            },
            Target::Screen(screen) => (
                CaptureDevice::new_for_monitor(screen.monitor)?,
                Err(anyhow::anyhow!("a screen is recorded as it is shown")),
            ),
        };

        let pool = HwFramePool::new(&device, settings.width, settings.height)?;
        let (encoder, settings, chosen) = open_encoder(&pool, settings, chosen, &device.adapter_name)?;
        let extradata = encoder.extradata();
        let black = black_frame(&device, &pool, settings.fps)
            .inspect_err(|e| log::debug!("No black picture for a minimised game, holding its last frame instead: {e:#}"))
            .ok();
        let hidden = Arc::new(AtomicBool::new(false));

        let converter = if let Ok((_, texture)) = &hooked {
            let mut converter =
                Converter::new(&device, (settings.width, settings.height), settings.fps)?;
            converter.set_flip_vertical(texture.flip);
            converter
        } else {
            Converter::for_window(
                &device,
                (settings.width, settings.height),
                settings.fps,
                match &target {
                    Target::Window(window) => Some(window.hwnd),
                    Target::Screen(_) => None,
                },
            )?
        };

        let ring = Arc::new(Mutex::new(RingBuffer::new(
            self.config.buffer_seconds as f32,
            TIME_BASE_DEN as i64,
        )));
        let dropped = Arc::new(AtomicU64::new(0));
        let fps = self.config.fps.max(1);
        let (frames_tx, frames_rx) = std::sync::mpsc::sync_channel::<PoolFrame>(ENCODE_QUEUE_DEPTH);

        let encode_latency: LatencyWindow = Arc::new(Mutex::new(
            VecDeque::with_capacity(LATENCY_SAMPLES),
        ));
        let (encode_done_tx, encode_done) = std::sync::mpsc::channel::<()>();
        let encode_thread = {
            let ring = Arc::clone(&ring);
            let latency = Arc::clone(&encode_latency);
            let hidden = Arc::clone(&hidden);
            std::thread::Builder::new()
                .name("nrc-encode".into())
                .spawn(move || {
                    let _done = encode_done_tx;
                    encode_loop(encoder, frames_rx, ring, fps, latency, black, hidden)
                })
                .context("could not start the encode thread")?
        };

        let epoch = Arc::new(AtomicI64::new(i64::MIN));
        let epoch_for_audio = Arc::clone(&epoch);
        let sink_dropped = Arc::clone(&dropped);
        let sink_tx = frames_tx.clone();
        let failures = AtomicU64::new(0);
        let failed = move |what: &str, e: anyhow::Error| {
            let seen = failures.fetch_add(1, Ordering::Relaxed);
            if seen % FAILURE_LOG_EVERY == 0 {
                log::warn!("A frame was dropped because {what} failed ({} so far): {e:#}", seen + 1);
            }
        };

        let sink = move |frame: BgraFrame<'_>| {
                let _ = epoch.compare_exchange(
                    i64::MIN,
                    frame.timestamp_100ns,
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                );
                let base = epoch.load(Ordering::Relaxed);

                let mut pool_frame = match pool.acquire() {
                    Ok(pool_frame) => pool_frame,
                    Err(e) => {
                        sink_dropped.fetch_add(1, Ordering::Relaxed);
                        failed("taking a frame from the pool", e);
                        return;
                    }
                };
                {
                    let (texture, slice) = pool_frame.target();
                    if let Err(e) =
                        converter.convert(frame.texture, (frame.width, frame.height), texture, slice)
                    {
                        sink_dropped.fetch_add(1, Ordering::Relaxed);
                        failed("converting the picture", e);
                        return;
                    }
                }
                pool_frame.set_pts(rebase_pts(frame.timestamp_100ns, base));

                if let Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) =
                    sink_tx.try_send(pool_frame)
                {
                    sink_dropped.fetch_add(1, Ordering::Relaxed);
                }
        };

        let health_device = device.clone();
        let source = match hooked {
            Ok((session, texture)) => {
                log::info!(
                    "Recording through the graphics hook: {}x{}{}",
                    texture.width,
                    texture.height,
                    if texture.flip { ", flipped" } else { "" }
                );
                FrameSource::Hook(Box::new(crate::capture::hook::HookCapture::start(
                    device,
                    session,
                    texture,
                    settings.fps,
                    sink,
                )?))
            }
            Err(e) => {
                let capture = match &target {
                    Target::Window(window) => {
                        log::warn!("Graphics hook unavailable, falling back to window capture: {e:#}");
                        crate::capture::wgc::Source::Window(window.hwnd)
                    }
                    Target::Screen(screen) => crate::capture::wgc::Source::Screen(screen.monitor),
                };
                FrameSource::Window(CaptureSession::start(device, capture, settings.fps, sink)?)
            }
        };

        let audio = if self.config.capture_audio {
            match start_audio(
                self.config.buffer_seconds as f32,
                self.audio_plan(target.pid()),
                Arc::clone(&epoch_for_audio),
                self.config.microphone_denoise,
            ) {
                Ok(pipeline) => Some(pipeline),
                Err(e) => {
                    log::warn!("Desktop audio unavailable, recording video only: {e:#}");
                    self.emit_error(
                        ErrorCode::AudioDevice,
                        format!("{e:#}"),
                        true,
                    );
                    None
                }
            }
        } else {
            None
        };

        log::info!("Attached to {} via {}", target.label(), source.describe());

        self.active = Some(Pipeline {
            device: health_device,
            hidden,
            target,
            audio,
            source,
            encode_thread: Some(encode_thread),
            encode_done,
            frames_tx: Some(frames_tx),
            ring,
            extradata,
            dropped,
            encode_latency,
            settings,
            encoder: chosen,
            started: Instant::now(),
        });
        Ok(())
    }

    fn detach_retaining_buffer(&mut self, spoiled: Duration) {
        if let Some(audio) = self.active.as_ref().and_then(|p| p.audio.as_ref()) {
            audio.drain_mixer();
        }

        let retired = self.active.as_ref().map(|pipeline| Retired {
            ring: Arc::clone(&pipeline.ring),
            extradata: pipeline.extradata.clone(),
            settings: pipeline.settings,
            audio: pipeline.audio.as_ref().map(|audio| RetiredAudio {
                master: audio.master.clone(),
                stems: audio.stems.clone(),
                sample_rate: audio.sample_rate,
                channels: audio.channels,
            }),
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

    fn emit_status(&self) {
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
            && !self.empty_warned.get()
        {
            self.empty_warned.set(true);
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

        if dropped_before_keyframe > 0 && buffer_fill_seconds <= 0.0 && !self.keyframe_warned.get()
        {
            self.keyframe_warned.set(true);
            log::warn!(
                "{} has produced {dropped_before_keyframe} packet(s) and not one keyframe, so the \
                 replay buffer is throwing all of them away and every clip will fail. The encoder \
                 is not honouring the keyframe request.",
                crate::encoder::encoder_name(pipeline.settings.codec, pipeline.encoder)
                    .unwrap_or("the encoder")
            );
        }

        let now = Instant::now();
        let (received_before, delivered_before, sampled_at) = self.rate_sample.replace((
            stats.received,
            stats.delivered,
            now,
        ));
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
            capture_method: Some(pipeline.source.describe().to_string()),
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

enum Destination {
    Direct { sink: AudioSink, gain: f32 },
    Mixed {
        mixer: crate::audio::Mixer,
        track: crate::audio::Track,
        sink: AudioSink,
        gain: f32,
    },
}

impl Destination {
    fn accept(&self, samples: &[f32], relative: i64, scratch: &mut Vec<f32>) {
        match self {
            Destination::Direct { sink, gain } => {
                let mut sink = sink.lock().unwrap_or_else(|e| e.into_inner());
                if (gain - 1.0).abs() < f32::EPSILON {
                    (*sink)(samples, relative);
                } else {
                    crate::audio::mix::apply_gain(samples, *gain, scratch);
                    (*sink)(scratch, relative);
                }
            }
            Destination::Mixed {
                mixer,
                track,
                sink,
                gain,
            } => {
                for block in mixer.push(*track, samples, relative, *gain) {
                    let mut sink = sink.lock().unwrap_or_else(|e| e.into_inner());
                    (*sink)(&block.samples, block.timestamp_100ns);
                }
            }
        }
    }
}

fn open_stem(
    label: &'static str,
    window_seconds: f32,
    format: crate::audio::AudioFormat,
) -> Result<(AudioStem, AudioSink)> {
    use crate::audio::{encoder::DEFAULT_BITRATE, AudioEncoder};

    let mut encoder = AudioEncoder::open(format, DEFAULT_BITRATE)?;

    let header = encoder.extradata();
    if header.is_empty() {
        anyhow::bail!("the AAC encoder produced no header for the {label} track, which would leave it undecodable");
    }

    let stem = AudioStem {
        label,
        ring: Arc::new(Mutex::new(AudioRing::new(
            window_seconds,
            TIME_BASE_DEN as i64,
        ))),
        extradata: Arc::new(Mutex::new(header)),
        peaks: Arc::new(Mutex::new(PeakRing::new(
            window_seconds,
            TIME_BASE_DEN as i64,
            format.sample_rate,
            format.channels,
        ))),
    };

    let ring = Arc::clone(&stem.ring);
    let peaks = Arc::clone(&stem.peaks);

    let sink: AudioSink = Arc::new(Mutex::new(move |samples: &[f32], relative: i64| {
        peaks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(samples, relative);

        match encoder.push(samples, relative) {
            Ok(packets) if !packets.is_empty() => {
                let mut ring = ring.lock().unwrap_or_else(|e| e.into_inner());
                for packet in packets {
                    ring.push(packet);
                }
            }
            Ok(_) => {}
            Err(e) => log::warn!("Encoding the {label} track failed: {e:#}"),
        }
    }));

    Ok((stem, sink))
}

struct AudioSelection {
    master: AudioStem,
    stems: Vec<AudioStem>,
    sample_rate: u32,
    channels: u32,
}

impl From<&AudioPipeline> for AudioSelection {
    fn from(pipeline: &AudioPipeline) -> Self {
        Self {
            master: pipeline.master.clone(),
            stems: pipeline.stems.clone(),
            sample_rate: pipeline.sample_rate,
            channels: pipeline.channels,
        }
    }
}

impl From<&RetiredAudio> for AudioSelection {
    fn from(retired: &RetiredAudio) -> Self {
        Self {
            master: retired.master.clone(),
            stems: retired.stems.clone(),
            sample_rate: retired.sample_rate,
            channels: retired.channels,
        }
    }
}

impl AudioSelection {
    fn tracks(&self) -> impl Iterator<Item = &AudioStem> {
        std::iter::once(&self.master).chain(self.stems.iter())
    }

    fn cut(
        &self,
        clip: &crate::buffer::Clip,
    ) -> (Vec<crate::writer::AudioTrack>, Vec<norisk_ipc::ClipAudioTrack>) {
        let mut written = Vec::new();
        let mut described = Vec::new();

        for stem in self.tracks() {
            let packets = {
                let ring = stem.ring.lock().unwrap_or_else(|e| e.into_inner());
                log::debug!(
                    "Clip range {}..{} ticks; the {} ring holds {} packets over {:.1}s",
                    clip.start_pts,
                    clip.end_pts,
                    stem.label,
                    ring.len(),
                    ring.duration_seconds()
                );
                ring.extract(clip.start_pts, clip.end_pts)
            };

            if packets.is_empty() {
                log::warn!("Nothing on the {} track covered the clip", stem.label);
                continue;
            }

            let extradata = stem
                .extradata
                .lock()
                .map(|header| header.clone())
                .unwrap_or_default();
            if extradata.is_empty() {
                log::warn!("The {} track has no codec header; leaving it out", stem.label);
                continue;
            }

            let peaks = {
                let ring = stem.peaks.lock().unwrap_or_else(|e| e.into_inner());
                dense_peaks(&ring.extract(clip.playback_start_pts, clip.end_pts), clip)
            };

            described.push(norisk_ipc::ClipAudioTrack {
                label: stem.label.to_string(),
                stream: written.len() as u32,
                adjustable: stem.label != crate::audio::MIX_LABEL,
                peaks,
            });

            written.push(crate::writer::AudioTrack {
                sample_rate: self.sample_rate,
                channels: self.channels,
                extradata,
                packets,
                label: stem.label.to_string(),
            });
        }

        (written, described)
    }
}

fn dense_peaks(points: &[crate::buffer::Peak], clip: &crate::buffer::Clip) -> Vec<u8> {
    let step = (norisk_ipc::PEAK_STEP_MS as i64 * TIME_BASE_DEN as i64 / 1_000).max(1);
    let from = clip.playback_start_pts;
    let span = (clip.end_pts - from).max(0);

    let slots = ((span / step) + 1).clamp(0, 60 * 60 * 1_000 / norisk_ipc::PEAK_STEP_MS as i64)
        as usize;

    let mut out = vec![0u8; slots];
    for point in points {
        let slot = ((point.pts - from) / step).max(0) as usize;
        if let Some(cell) = out.get_mut(slot) {
            *cell = (*cell).max(point.value);
        }
    }
    out
}

fn start_audio(
    window_seconds: f32,
    plan: AudioPlan,
    epoch: Arc<AtomicI64>,
    denoise_microphone: bool,
) -> Result<AudioPipeline> {
    use crate::audio::{LoopbackCapture, Mixer, Track};

    if plan.sources.is_empty() {
        anyhow::bail!("no audio source to record");
    }

    let (primary, format) = crate::audio::wasapi::probe_source(&plan.sources[0].source)?;

    let (master, master_sink) = open_stem(crate::audio::MIX_LABEL, window_seconds, format)?;

    let mut mixers: Vec<(Mixer, AudioSink)> = Vec::new();

    let master_mixer = if plan.sources.len() > 1 {
        let tracks: Vec<Track> = plan.sources.iter().map(|source| source.track).collect();
        let mixer = Mixer::new(format.sample_rate, format.channels, &tracks);
        mixers.push((mixer.clone(), Arc::clone(&master_sink)));
        Some(mixer)
    } else {
        None
    };

    let has_microphone = plan
        .sources
        .iter()
        .any(|source| source.track == Track::Microphone);
    let game_sources = plan
        .sources
        .iter()
        .filter(|source| source.track != Track::Microphone)
        .count();

    let microphone_format = plan
        .sources
        .iter()
        .find(|source| source.track == Track::Microphone)
        .and_then(|source| crate::audio::wasapi::probe_source(&source.source).ok())
        .map(|(_, format)| format)
        .unwrap_or(format);

    let mut stems = Vec::new();
    let mut game_stem: Option<(Option<Mixer>, AudioSink)> = None;
    let mut microphone_stem: Option<AudioSink> = None;

    if has_microphone && game_sources > 0 {
        let (stem, sink) = open_stem(crate::audio::GAME_LABEL, window_seconds, format)?;
        let mixer = if game_sources > 1 {
            let tracks: Vec<Track> = plan
                .sources
                .iter()
                .map(|source| source.track)
                .filter(|track| *track != Track::Microphone)
                .collect();
            let mixer = Mixer::new(format.sample_rate, format.channels, &tracks);
            mixers.push((mixer.clone(), Arc::clone(&sink)));
            Some(mixer)
        } else {
            None
        };
        stems.push(stem);
        game_stem = Some((mixer, sink));

        let (stem, sink) = open_stem(crate::audio::MIC_LABEL, window_seconds, microphone_format)?;
        stems.push(stem);
        microphone_stem = Some(sink);
    }

    fn rebase(epoch: &AtomicI64, timestamp: i64) -> i64 {
        let _ = epoch.compare_exchange(i64::MIN, timestamp, Ordering::Relaxed, Ordering::Relaxed);
        timestamp
            .saturating_sub(epoch.load(Ordering::Relaxed))
            .max(0)
    }

    let mut captures = Vec::new();

    for (index, planned) in plan.sources.into_iter().enumerate() {
        let source = if index == 0 {
            primary.clone()
        } else {
            planned.source
        };
        let track = planned.track;
        let gain = planned.gain;

        let mut destinations = vec![match master_mixer.as_ref() {
            Some(mixer) => Destination::Mixed {
                mixer: mixer.clone(),
                track,
                sink: Arc::clone(&master_sink),
                gain,
            },
            None => Destination::Direct {
                sink: Arc::clone(&master_sink),
                gain,
            },
        }];

        if track == Track::Microphone {
            if let Some(sink) = microphone_stem.as_ref() {
                destinations.push(Destination::Direct {
                    sink: Arc::clone(sink),
                    gain,
                });
            }
        } else if let Some((mixer, sink)) = game_stem.as_ref() {
            destinations.push(match mixer {
                Some(mixer) => Destination::Mixed {
                    mixer: mixer.clone(),
                    track,
                    sink: Arc::clone(sink),
                    gain,
                },
                None => Destination::Direct {
                    sink: Arc::clone(sink),
                    gain,
                },
            });
        }

        let epoch = Arc::clone(&epoch);
        let mut scratch = Vec::new();

        let mut denoiser = (denoise_microphone && track == Track::Microphone)
            .then(|| crate::audio::denoise::Denoiser::new(microphone_format.channels));
        let mut cleaned: Vec<f32> = Vec::new();

        captures.push(LoopbackCapture::start_from(
            source,
            move |samples: &[f32], timestamp: i64| {
                let relative = rebase(&epoch, timestamp);
                let samples = match denoiser.as_mut() {
                    Some(denoiser) => {
                        cleaned.clear();
                        cleaned.extend_from_slice(samples);
                        denoiser.process(&mut cleaned);
                        cleaned.as_slice()
                    }
                    None => samples,
                };
                for destination in &destinations {
                    destination.accept(samples, relative, &mut scratch);
                }
            },
        )?);

        if denoise_microphone && track == Track::Microphone {
            log::info!(
                "Recording {track:?} audio at {:.0}% with noise suppression",
                gain * 100.0
            );
        } else {
            log::info!("Recording {track:?} audio at {:.0}%", gain * 100.0);
        }
    }

    log::info!(
        "Desktop audio attached: {} source(s), {} Hz {}ch, written as {} track(s)",
        captures.len(),
        format.sample_rate,
        format.channels,
        1 + stems.len()
    );

    Ok(AudioPipeline {
        _captures: captures,
        master,
        stems,
        sample_rate: crate::audio::encoder::OUTPUT_SAMPLE_RATE as u32,
        channels: crate::audio::encoder::OUTPUT_CHANNELS as u32,
        mixers,
    })
}

const REPEAT_AFTER_FRAMES: u32 = 2;

fn encode_loop(
    mut encoder: VideoEncoder,
    frames: Receiver<PoolFrame>,
    ring: Arc<Mutex<RingBuffer>>,
    fps: u32,
    latency: LatencyWindow,
    mut black: Option<PoolFrame>,
    hidden: Arc<AtomicBool>,
) {
    use std::sync::mpsc::RecvTimeoutError;

    let fps = fps.max(1) as i64;
    let step = (TIME_BASE_DEN as i64 / fps).max(1);
    let wait =
        std::time::Duration::from_nanos((1_000_000_000 / fps as u64) * REPEAT_AFTER_FRAMES as u64);

    let report_after = (fps / REPEAT_AFTER_FRAMES as i64).max(1) as u64;

    let started = Instant::now();
    let mut last: Option<PoolFrame> = None;
    let mut last_pts = i64::MIN;
    let mut repeats: u64 = 0;
    let mut reported = false;

    let emit = |encoder: &mut VideoEncoder, frame: &PoolFrame| -> bool {
        let started = Instant::now();
        match encoder.encode(frame) {
            Ok(packets) => {
                let micros = started.elapsed().as_micros().min(u32::MAX as u128) as u32;
                {
                    let mut window = latency.lock().unwrap_or_else(|e| e.into_inner());
                    if window.len() == LATENCY_SAMPLES {
                        window.pop_front();
                    }
                    window.push_back(micros);
                }
                let mut guard = ring.lock().unwrap_or_else(|e| e.into_inner());
                for packet in packets {
                    guard.push(packet);
                }
                true
            }
            Err(e) => {
                log::error!("Encoding failed: {e:#}");
                false
            }
        }
    };

    loop {
        if crate::fault::due("encoder", started) {
            log::error!("Encoding failed: simulated because NRC_FAULT=encoder is set");
            return;
        }
        match frames.recv_timeout(wait) {
            Ok(mut frame) => {
                if reported {
                    log::debug!("The source drew again after {repeats} repeated frame(s)");
                    reported = false;
                }
                repeats = 0;

                if frame.pts() <= last_pts {
                    frame.set_pts(last_pts + 1);
                }
                let pts = frame.pts();

                let shown = match black.as_mut() {
                    Some(black) if hidden.load(Ordering::Relaxed) => {
                        black.set_pts(pts);
                        &*black
                    }
                    _ => &frame,
                };
                if !emit(&mut encoder, shown) {
                    return;
                }
                last_pts = pts;
                last = Some(frame);
            }
            Err(RecvTimeoutError::Timeout) => {
                let Some(frame) = last.as_mut() else { continue };

                last_pts += step;
                let shown = match black.as_mut() {
                    Some(black) if hidden.load(Ordering::Relaxed) => black,
                    _ => frame,
                };
                shown.set_pts(last_pts);
                if !emit(&mut encoder, shown) {
                    return;
                }

                repeats += 1;
                if repeats == report_after {
                    log::debug!("The source has not drawn for about a second; holding its last frame");
                    reported = true;
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    if let Ok(packets) = encoder.finish() {
        let mut guard = ring.lock().unwrap_or_else(|e| e.into_inner());
        for packet in packets {
            guard.push(packet);
        }
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

fn rebase_pts(timestamp_100ns: i64, epoch_100ns: i64) -> i64 {
    ((timestamp_100ns.saturating_sub(epoch_100ns)) as i128 * TIME_BASE_DEN as i128 / 10_000_000)
        as i64
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

fn black_frame(device: &CaptureDevice, pool: &HwFramePool, fps: u32) -> Result<PoolFrame> {
    use windows::Win32::Graphics::Direct3D11::{
        D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_SUBRESOURCE_DATA,
        D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
    };
    use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};

    const SIDE: u32 = 16;
    let pixels = [0u8, 0, 0, 255].repeat((SIDE * SIDE) as usize);
    let desc = D3D11_TEXTURE2D_DESC {
        Width: SIDE,
        Height: SIDE,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        ..Default::default()
    };
    let data = D3D11_SUBRESOURCE_DATA {
        pSysMem: pixels.as_ptr() as *const _,
        SysMemPitch: SIDE * 4,
        SysMemSlicePitch: 0,
    };

    let mut texture = None;
    unsafe { device.device.CreateTexture2D(&desc, Some(&data), Some(&mut texture)) }
        .context("could not make a black picture")?;
    let texture = texture.context("the black picture came back empty")?;

    let frame = pool.acquire()?;
    let (target, slice) = frame.target();
    Converter::new(device, (pool.width(), pool.height()), fps)?.convert(
        &texture,
        (SIDE, SIDE),
        target,
        slice,
    )?;
    Ok(frame)
}

fn open_encoder(
    pool: &HwFramePool,
    settings: EncoderSettings,
    preferred: norisk_ipc::EncoderPreference,
    adapter: &str,
) -> Result<(VideoEncoder, EncoderSettings, norisk_ipc::EncoderPreference)> {
    use norisk_ipc::{ClipCodec, EncoderPreference};

    let matrix = crate::encoder::capabilities();
    let first = (settings.codec, preferred);
    let mut tries = vec![first];
    for other in matrix
        .iter()
        .filter(|c| c.codec == settings.codec && c.available && c.hardware)
        .map(|c| (c.codec, c.encoder))
        .chain([(settings.codec, EncoderPreference::Software), (ClipCodec::H264, EncoderPreference::Software)])
    {
        if !tries.contains(&other) {
            tries.push(other);
        }
    }

    let mut last = None;
    for (codec, encoder) in tries {
        let Some(name) = crate::encoder::encoder_name(codec, encoder) else {
            continue;
        };
        let settings = EncoderSettings { codec, ..settings };
        match VideoEncoder::open(name, pool, settings) {
            Ok(opened) if !opened.extradata().is_empty() => {
                if (codec, encoder) != first {
                    log::warn!("Recording with {name} on '{adapter}' instead of the encoder picked first");
                }
                return Ok((opened, settings, encoder));
            }
            Ok(_) => {
                log::warn!("{name} opened on '{adapter}' but gave no codec header; trying the next encoder");
            }
            Err(e) => {
                log::warn!("{name} would not open on '{adapter}': {e:#}; trying the next encoder");
                last = Some(e);
            }
        }
    }

    Err(last.unwrap_or_else(|| anyhow::anyhow!("no encoder could be opened")))
}

fn hook_handshake(
    target: &window::GameWindow,
    fps: u32,
) -> Result<(
    crate::capture::hook::HookSession,
    crate::capture::hook::HookTexture,
)> {
    use crate::capture::hook::{self, HookStep};
    const BUDGET: Duration = Duration::from_millis(6_000);

    let dll = hook::locate_hook_dll()?;

    let mut session = hook::HookSession::new(target.pid, target.hwnd, fps)?;

    let started = Instant::now();
    let injected = hook::inject(target.pid, window::thread_of(target.hwnd), &dll)
        .with_context(|| format!("could not load the hook into process {}", target.pid))?;

    match injected {
        hook::Injected::Loaded => {
            log::info!("Loaded the graphics hook into process {}", target.pid)
        }
        hook::Injected::AlreadyPresent => log::info!(
            "The graphics hook was already in process {} — sharing it with whatever put it there",
            target.pid
        ),
    }

    loop {
        match session.poll() {
            HookStep::Ready(texture) => {
                log::info!(
                    "Graphics hook ready in {:.0} ms",
                    started.elapsed().as_secs_f64() * 1000.0
                );
                return Ok((session, texture));
            }
            HookStep::Failed(e) => return Err(e),
            HookStep::Waiting => {
                if started.elapsed() > BUDGET {
                    anyhow::bail!("the hook did not produce a texture within {BUDGET:?}");
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        }
    }
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

    #[test]
    fn timestamps_rebase_onto_the_first_frame() {
        let epoch = 1_000_000i64;
        assert_eq!(rebase_pts(epoch, epoch), 0);
        assert_eq!(rebase_pts(epoch + 10_000_000, epoch), TIME_BASE_DEN as i64);
    }

    #[test]
    fn a_timestamp_before_the_epoch_does_not_wrap() {
        assert_eq!(rebase_pts(0, 1_000_000), -9_000);
    }
}
