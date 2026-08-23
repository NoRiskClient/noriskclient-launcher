use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use norisk_ipc::{
    CaptureConfig, CaptureError, CaptureState, CaptureToLauncher, ClipManifest, ErrorCode,
    LauncherToCapture, ReadyInfo, SaveClipRequest, StatusReport,
};
use tokio::sync::mpsc::UnboundedSender;

use crate::buffer::{AudioRing, PeakRing, RingBuffer};
use crate::capture::{fit_output, window, BgraFrame, CaptureDevice, CaptureSession, Converter};
use crate::encoder::{
    video::TIME_BASE_DEN, EncoderSettings, HwFramePool, PoolFrame, VideoEncoder,
};
use crate::writer::{write_mp4, TrackInfo};

const STATUS_INTERVAL: Duration = Duration::from_secs(1);
const ENCODE_QUEUE_DEPTH: usize = 4;

const PROGRESS_EVERY: Duration = Duration::from_millis(150);

const MIN_CAPTURE_SIDE: u32 = 128;
const ATTACH_TIMEOUT: Duration = Duration::from_secs(60);

pub struct Engine {
    config: CaptureConfig,
    events: UnboundedSender<CaptureToLauncher>,
    active: Option<Pipeline>,
    pending_attach: Option<window::WindowSearch>,
    resize_settling: Option<((u32, u32), Instant)>,
    retired: Option<Retired>,
    buffering_enabled: bool,
    last_status: Instant,
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

    fn window_pid(&self) -> u32 {
        match self {
            Self::Window(session) => session.window_pid(),
            Self::Hook(hook) => hook.pid(),
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
    source: FrameSource,
    encode_thread: Option<std::thread::JoinHandle<()>>,
    frames_tx: Option<SyncSender<PoolFrame>>,
    ring: Arc<Mutex<RingBuffer>>,
    extradata: Vec<u8>,
    dropped: Arc<AtomicU64>,
    settings: EncoderSettings,
    encoder: norisk_ipc::EncoderPreference,
    audio: Option<AudioPipeline>,
    target: window::GameWindow,
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
            last_status: Instant::now(),
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
            self.step_resize_watch();

            if self.retired.as_ref().is_some_and(|r| r.at.elapsed() >= RETAIN_FOR) {
                log::debug!("Releasing the buffer kept across the last rebuild");
                self.retired = None;
            }

            if self.last_status.elapsed() >= STATUS_INTERVAL {
                self.last_status = Instant::now();
                self.emit_status();
            }
        }

        log::info!("Engine shutting down");
        self.detach();
    }

    fn announce_ready(&self) {
        let matrix = crate::encoder::capabilities();
        let encoders = crate::encoder::available_for(norisk_ipc::ClipCodec::H264, &matrix);
        let adapter = self
            .active
            .as_ref()
            .map(|p| p.source.adapter().to_string())
            .or_else(|| {
                CaptureDevice::new_default()
                    .ok()
                    .map(|device| device.adapter_name.clone())
            })
            .unwrap_or_default();

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

        let _ = self.events.send(CaptureToLauncher::Ready(ReadyInfo {
            protocol_version: norisk_ipc::PROTOCOL_VERSION,
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
            available_encoders: encoders,
            capabilities: matrix,
            adapter,
            audio_devices,
            microphones,
            supports_game_only_audio: crate::audio::wasapi::supports_process_capture(),
        }));
    }

    fn handle(&mut self, command: LauncherToCapture) -> Result<()> {
        match command {
            LauncherToCapture::Configure(config) => {
                let restart = self.active.is_some() && needs_restart(&self.config, &config);
                self.config = config;
                if restart {
                    log::info!("Configuration changed materially; restarting the pipeline");
                    if let Some(pid) = self.attached_pid() {
                        self.detach();
                        self.begin_attach(pid);
                    }
                }
            }
            LauncherToCapture::AttachWindow { pid } => {
                self.detach();
                self.begin_attach(pid);
            }
            LauncherToCapture::DetachWindow => self.detach(),
            LauncherToCapture::SetBufferEnabled { enabled } => {
                self.buffering_enabled = enabled;
                log::info!("Buffering {}", if enabled { "resumed" } else { "paused" });
            }
            LauncherToCapture::SaveClip(request) => self.save_clip(request)?,
            LauncherToCapture::TrimClip(request) => self.trim_clip(request),
            LauncherToCapture::ExportVertical(request) => self.export_vertical(request),
            LauncherToCapture::PrepareAudioPreview(request) => self.prepare_preview(request),
            LauncherToCapture::Ping { seq } => {
                let _ = self.events.send(CaptureToLauncher::Pong { seq });
            }
            LauncherToCapture::Shutdown => {}
        }
        Ok(())
    }

    fn audio_plan(&self, pid: u32) -> AudioPlan {
        use crate::audio::wasapi::AudioSource;
        use crate::audio::Track;
        use norisk_ipc::AudioSourceChoice;

        let device = match self.config.audio_device_id.as_deref() {
            Some(id) if !id.is_empty() => AudioSource::Device(id.to_string()),
            _ => AudioSource::DefaultDevice,
        };

        let mut plan = match self.config.audio_source {
            AudioSourceChoice::System => {
                AudioPlan::single(device, gain(self.config.other_volume))
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

    fn attached_pid(&self) -> Option<u32> {
        self.active
            .as_ref()
            .map(|p| p.source.window_pid())
            .or_else(|| self.pending_attach.as_ref().map(|s| s.pid()))
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
                self.pending_attach = None;
                if let Err(e) = self.attach(target) {
                    log::error!("Could not start capturing process {pid}: {e:#}");
                    self.emit_error(ErrorCode::Internal, format!("{e:#}"), true);
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

    fn step_resize_watch(&mut self) {
        const SETTLE: Duration = Duration::from_secs(2);

        let Some(pipeline) = self.active.as_ref() else {
            self.resize_settling = None;
            return;
        };

        let Some(source) = window::client_size(pipeline.target.hwnd) else {
            self.resize_settling = None;
            return;
        };

        let wanted = fit_output(source, (self.config.width, self.config.height));
        if wanted == (pipeline.settings.width, pipeline.settings.height) {
            self.resize_settling = None;
            return;
        }

        match self.resize_settling {
            Some((pending, since)) if pending == wanted => {
                if since.elapsed() < SETTLE {
                    return;
                }
                let pid = pipeline.target.pid;
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
                self.detach_retaining_buffer();
                self.pending_attach = Some(window::WindowSearch::new(pid, ATTACH_TIMEOUT));
            }
            _ => self.resize_settling = Some((wanted, Instant::now())),
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
            let message = format!(
                "{requested:?} cannot be encoded on this machine; recording in {codec:?} instead"
            );
            log::warn!("{message}");
            self.emit_error(ErrorCode::EncoderUnavailable, message, true);
        }
        if encoder != self.config.encoder && self.config.encoder != norisk_ipc::EncoderPreference::Auto
        {
            let message = format!(
                "{:?} is not usable on this machine; recording with {encoder:?} instead",
                self.config.encoder
            );
            log::warn!("{message}");
            self.emit_error(ErrorCode::EncoderUnavailable, message, true);
        }

        log::info!("Recording {codec:?} with {encoder:?}");
        Ok((codec, encoder))
    }

    fn attach(&mut self, target: window::GameWindow) -> Result<()> {
        log::info!("Attaching to '{}' (pid {})", target.title, target.pid);

        let device = CaptureDevice::new_for_window(target.hwnd)?;
        let (codec, chosen) = self.choose_encoder()?;

        let source = window::client_size(target.hwnd)
            .unwrap_or(((target.width.max(0)) as u32, (target.height.max(0)) as u32));

        if source.0 < MIN_CAPTURE_SIDE || source.1 < MIN_CAPTURE_SIDE {
            anyhow::bail!(
                "'{}' is only {}x{} on screen, too small to record — it is probably minimised",
                target.title,
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

        let pool = HwFramePool::new(&device, settings.width, settings.height)?;

        let name = crate::encoder::encoder_name(codec, chosen)
            .with_context(|| format!("no encoder is known for {codec:?} on {chosen:?}"))?;
        let encoder = VideoEncoder::open(name, &pool, settings)?;
        let extradata = encoder.extradata();
        if extradata.is_empty() {
            anyhow::bail!("encoder produced no global header; clips would not decode");
        }

        let hooked = hook_handshake(&target, settings.fps);

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
                Some(target.hwnd),
            )?
        };

        let ring = Arc::new(Mutex::new(RingBuffer::new(
            self.config.buffer_seconds as f32,
            TIME_BASE_DEN as i64,
        )));
        let dropped = Arc::new(AtomicU64::new(0));
        let fps = self.config.fps.max(1);
        let (frames_tx, frames_rx) = std::sync::mpsc::sync_channel::<PoolFrame>(ENCODE_QUEUE_DEPTH);

        let encode_thread = {
            let ring = Arc::clone(&ring);
            let events = self.events.clone();
            std::thread::Builder::new()
                .name("nrc-encode".into())
                .spawn(move || encode_loop(encoder, frames_rx, ring, events, fps))
                .context("could not start the encode thread")?
        };

        let epoch = Arc::new(AtomicI64::new(i64::MIN));
        let epoch_for_audio = Arc::clone(&epoch);
        let sink_dropped = Arc::clone(&dropped);
        let sink_tx = frames_tx.clone();

        let sink = move |frame: BgraFrame<'_>| {
                let _ = epoch.compare_exchange(
                    i64::MIN,
                    frame.timestamp_100ns,
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                );
                let base = epoch.load(Ordering::Relaxed);

                let Ok(mut pool_frame) = pool.acquire() else {
                    sink_dropped.fetch_add(1, Ordering::Relaxed);
                    return;
                };
                {
                    let (texture, slice) = pool_frame.target();
                    if converter.convert(frame.texture, (frame.width, frame.height), texture, slice).is_err() {
                        sink_dropped.fetch_add(1, Ordering::Relaxed);
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
                log::warn!("Graphics hook unavailable, falling back to window capture: {e:#}");
                FrameSource::Window(CaptureSession::start(
                    device,
                    target.hwnd,
                    settings.fps,
                    sink,
                )?)
            }
        };

        let audio = if self.config.capture_audio {
            match start_audio(
                self.config.buffer_seconds as f32,
                self.audio_plan(target.pid),
                Arc::clone(&epoch_for_audio),
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

        log::info!(
            "Attached to '{}' ({}x{}) via {}",
            target.title,
            target.width,
            target.height,
            source.describe()
        );

        self.active = Some(Pipeline {
            target,
            audio,
            source,
            encode_thread: Some(encode_thread),
            frames_tx: Some(frames_tx),
            ring,
            extradata,
            dropped,
            settings,
            encoder: chosen,
        });
        Ok(())
    }

    fn detach_retaining_buffer(&mut self) {
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
        });

        self.detach();

        if let Some(retired) = retired {
            let held = retired
                .ring
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .duration_seconds();
            log::info!("Keeping {held:.1}s of the previous buffer across the rebuild");
            self.retired = Some(retired);
        }
    }

    fn detach(&mut self) {
        self.pending_attach = None;

        self.retired = None;

        let Some(mut pipeline) = self.active.take() else {
            return;
        };
        log::info!("Detaching");

        drop(pipeline.source);
        pipeline.frames_tx.take();
        if let Some(handle) = pipeline.encode_thread.take() {
            let _ = handle.join();
        }
    }

    fn save_clip(&mut self, request: SaveClipRequest) -> Result<()> {
        let Some(pipeline) = self.active.as_ref() else {
            self.emit_error(
                ErrorCode::BufferEmpty,
                "nothing is being captured".into(),
                true,
            );
            return Ok(());
        };

        if let Some(audio) = pipeline.audio.as_ref() {
            audio.drain_mixer();
        }

        let ring = pipeline.ring.lock().unwrap_or_else(|e| e.into_inner());
        let now = ring.newest_pts();
        let clip = ring.extract_around(
            now,
            request.pre_roll_seconds as f32,
            request.post_roll_seconds as f32,
        );
        let live_seconds = clip
            .as_ref()
            .map_or(0.0, |c| c.duration_seconds(TIME_BASE_DEN as i64));
        drop(ring);

        let mut extradata = pipeline.extradata.clone();
        let mut settings = pipeline.settings;
        let mut audio = pipeline.audio.as_ref().map(AudioSelection::from);
        let mut clip = clip;

        if let Some(retired) = self.retired.as_ref().filter(|r| r.at.elapsed() < RETAIN_FOR) {
            let older = {
                let ring = retired.ring.lock().unwrap_or_else(|e| e.into_inner());
                let now = ring.newest_pts();
                ring.extract_around(
                    now,
                    request.pre_roll_seconds as f32,
                    request.post_roll_seconds as f32,
                )
            };

            let older_seconds = older
                .as_ref()
                .map_or(0.0, |c| c.duration_seconds(TIME_BASE_DEN as i64));

            if older_seconds > live_seconds + 0.1 {
                log::info!(
                    "Cutting from the buffer kept across the rebuild: {older_seconds:.1}s there against {live_seconds:.1}s live"
                );
                clip = older;
                extradata = retired.extradata.clone();
                settings = retired.settings;
                audio = retired.audio.as_ref().map(AudioSelection::from);
            }
        }

        let Some(clip) = clip else {
            self.emit_error(
                ErrorCode::BufferEmpty,
                "the replay buffer holds nothing to cut".into(),
                true,
            );
            return Ok(());
        };

        let created = chrono_now();
        let file_name = format!("{}_{}.mp4", created.replace(':', "-"), request.reason.slug());
        let path = self.config.output_dir.join(&file_name);

        let (audio_track, audio_tracks) = match audio.as_ref() {
            Some(selection) => selection.cut(&clip),
            None => (Vec::new(), Vec::new()),
        };

        let written = write_mp4(
            &clip,
            &path,
            &TrackInfo {
                width: settings.width,
                height: settings.height,
                fps: settings.fps,
                time_base_den: TIME_BASE_DEN as i64,
                codec: settings.codec,
                extradata,
            },
            audio_track.as_slice(),
        )?;

        log::info!(
            "Saved {:.1}s clip to {}",
            written.duration_seconds,
            path.display()
        );

        let _ = self
            .events
            .send(CaptureToLauncher::ClipSaved(ClipManifest {
                path: written.path,
                thumbnail: None,
                duration_seconds: written.duration_seconds as f32,
                width: written.width,
                height: written.height,
                fps: pipeline.settings.fps,
                bitrate_kbps: pipeline.settings.bitrate_kbps,
                size_bytes: written.size_bytes,
                reason: request.reason,
                created_at: created,
                audio_tracks,
            }));

        Ok(())
    }

    fn emit_status(&self) {
        let Some(pipeline) = self.active.as_ref() else {
            let _ = self.events.send(CaptureToLauncher::Status(StatusReport {
                state: if self.pending_attach.is_some() {
                    CaptureState::Attaching
                } else {
                    CaptureState::Idle
                },
                buffer_fill_seconds: 0.0,
                buffer_bytes: 0,
                capture_fps: 0.0,
                encode_fps: 0.0,
                dropped_frames: 0,
                encode_latency_ms_p99: 0.0,
                active_codec: None,
                active_encoder: None,
            }));
            return;
        };

        let stats = pipeline.source.stats();
        let ring = pipeline.ring.lock().unwrap_or_else(|e| e.into_inner());

        let state = if !self.buffering_enabled {
            CaptureState::Paused
        } else {
            pipeline.source.state()
        };

        let _ = self.events.send(CaptureToLauncher::Status(StatusReport {
            state,
            buffer_fill_seconds: ring.duration_seconds() as f32,
            buffer_bytes: ring.bytes(),
            capture_fps: stats.received as f32,
            encode_fps: stats.delivered as f32,
            dropped_frames: pipeline.dropped.load(Ordering::Relaxed),
            encode_latency_ms_p99: 0.0,
            active_codec: Some(pipeline.settings.codec),
            active_encoder: Some(pipeline.encoder),
        }));
    }

    fn prepare_preview(&self, request: norisk_ipc::AudioPreviewRequest) {
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

    fn export_vertical(&self, request: norisk_ipc::ExportVerticalRequest) {
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

                match crate::vertical::to_vertical(
                    &request.source,
                    &request.destination,
                    report,
                ) {
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

    fn trim_clip(&self, request: norisk_ipc::TrimClipRequest) {
        let started = Instant::now();
        match crate::trim::trim(
            &request.source,
            &request.destination,
            request.start_seconds,
            request.end_seconds,
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

        let microphone_format = plan
            .sources
            .iter()
            .find(|source| source.track == Track::Microphone)
            .and_then(|source| crate::audio::wasapi::probe_source(&source.source).ok())
            .map(|(_, format)| format)
            .unwrap_or(format);

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

        captures.push(LoopbackCapture::start_from(
            source,
            move |samples: &[f32], timestamp: i64| {
                let relative = rebase(&epoch, timestamp);
                for destination in &destinations {
                    destination.accept(samples, relative, &mut scratch);
                }
            },
        )?);

        log::info!("Recording {track:?} audio at {:.0}%", gain * 100.0);
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
    events: UnboundedSender<CaptureToLauncher>,
    fps: u32,
) {
    use std::sync::mpsc::RecvTimeoutError;

    let fps = fps.max(1) as i64;
    let step = (TIME_BASE_DEN as i64 / fps).max(1);
    let wait =
        std::time::Duration::from_nanos((1_000_000_000 / fps as u64) * REPEAT_AFTER_FRAMES as u64);

    let mut last: Option<PoolFrame> = None;
    let mut last_pts = i64::MIN;
    let mut repeats: u64 = 0;

    let emit = |encoder: &mut VideoEncoder, frame: &PoolFrame| -> bool {
        match encoder.encode(frame) {
            Ok(packets) => {
                let mut guard = ring.lock().unwrap_or_else(|e| e.into_inner());
                for packet in packets {
                    guard.push(packet);
                }
                true
            }
            Err(e) => {
                log::error!("Encoding failed: {e:#}");
                let _ = events.send(CaptureToLauncher::Error(CaptureError {
                    code: ErrorCode::EncoderUnavailable,
                    message: format!("{e:#}"),
                    recoverable: false,
                }));
                false
            }
        }
    };

    loop {
        match frames.recv_timeout(wait) {
            Ok(mut frame) => {
                if repeats > 0 {
                    log::debug!("The source drew again after {repeats} repeated frame(s)");
                    repeats = 0;
                }

                if frame.pts() <= last_pts {
                    frame.set_pts(last_pts + 1);
                }

                if !emit(&mut encoder, &frame) {
                    return;
                }
                last_pts = frame.pts();
                last = Some(frame);
            }
            Err(RecvTimeoutError::Timeout) => {
                let Some(frame) = last.as_mut() else { continue };

                last_pts += step;
                frame.set_pts(last_pts);
                if !emit(&mut encoder, frame) {
                    return;
                }

                repeats += 1;
                if repeats == 1 {
                    log::debug!("The source stopped drawing; holding the last frame");
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
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn hook_handshake(
    target: &window::GameWindow,
    fps: u32,
) -> Result<(
    crate::capture::hook::HookSession,
    crate::capture::hook::HookTexture,
)> {
    use crate::capture::hook::{self, HookStep};
    const BUDGET: Duration = Duration::from_millis(2_500);

    let dll = hook::locate_hook_dll()?;

    let mut session = hook::HookSession::new(target.pid, target.hwnd, fps)?;

    let started = Instant::now();
    let injected = hook::inject(target.pid, &dll)
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
