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

use crate::buffer::{AudioRing, RingBuffer};
use crate::capture::{fit_output, window, BgraFrame, CaptureDevice, CaptureSession, Converter};
use crate::encoder::{
    video::TIME_BASE_DEN, EncoderSettings, HwFramePool, PoolFrame, VideoEncoder,
};
use crate::writer::{write_mp4, TrackInfo};

const STATUS_INTERVAL: Duration = Duration::from_secs(1);
const ENCODE_QUEUE_DEPTH: usize = 4;
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
    ring: Arc<Mutex<AudioRing>>,
    extradata: Arc<Mutex<Vec<u8>>>,
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

struct AudioPipeline {
    _captures: Vec<crate::audio::LoopbackCapture>,
    ring: Arc<Mutex<AudioRing>>,
    extradata: Arc<Mutex<Vec<u8>>>,
    sample_rate: u32,
    channels: u32,
    mixer: Option<crate::audio::Mixer>,
    sink: AudioSink,
}

type AudioSink = Arc<Mutex<dyn FnMut(&[f32], i64) + Send>>;

impl AudioPipeline {
    fn drain_mixer(&self) {
        let Some(mixer) = self.mixer.as_ref() else {
            return;
        };

        let mut sink = self.sink.lock().unwrap_or_else(|e| e.into_inner());

        let tail = mixer.flush();
        if tail.is_empty() {
            return;
        }

        let samples: usize = tail.iter().map(|block| block.samples.len()).sum();
        for block in tail {
            (*sink)(&block.samples, block.timestamp_100ns);
        }
        drop(sink);

        log::debug!(
            "Drained {:.0} ms of held audio out of the mixer",
            mixer.span_100ns(samples) as f64 / 10_000.0
        );
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
        let (frames_tx, frames_rx) = std::sync::mpsc::sync_channel::<PoolFrame>(ENCODE_QUEUE_DEPTH);

        let encode_thread = {
            let ring = Arc::clone(&ring);
            let events = self.events.clone();
            std::thread::Builder::new()
                .name("nrc-encode".into())
                .spawn(move || encode_loop(encoder, frames_rx, ring, events))
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
                ring: Arc::clone(&audio.ring),
                extradata: Arc::clone(&audio.extradata),
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
        let mut audio = pipeline
            .audio
            .as_ref()
            .map(|a| (Arc::clone(&a.ring), Arc::clone(&a.extradata), a.sample_rate, a.channels));
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
                audio = retired
                    .audio
                    .as_ref()
                    .map(|a| (Arc::clone(&a.ring), Arc::clone(&a.extradata), a.sample_rate, a.channels));
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

        let audio_track = audio.as_ref().and_then(|(audio_ring, audio_header, rate, channels)| {
            let ring = audio_ring.lock().unwrap_or_else(|e| e.into_inner());
            log::debug!(
                "Clip range {}..{} ticks; audio ring holds {} packets over {:.1}s",
                clip.start_pts,
                clip.end_pts,
                ring.len(),
                ring.duration_seconds()
            );
            let packets = ring.extract(clip.start_pts, clip.end_pts);
            drop(ring);

            if let (Some(first), Some(last)) = (packets.first(), packets.last()) {
                log::debug!(
                    "Audio selected {}..{} ticks ({:.1}s of {} packets)",
                    first.pts,
                    last.pts,
                    (last.pts - first.pts) as f64 / TIME_BASE_DEN as f64,
                    packets.len()
                );
            }

            if packets.is_empty() {
                log::warn!("No audio covered the clip's range; writing video only");
                return None;
            }
            Some(crate::writer::AudioTrack {
                sample_rate: *rate,
                channels: *channels,
                extradata: audio_header
                    .lock()
                    .map(|header| header.clone())
                    .unwrap_or_default(),
                packets,
            })
        });

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
            audio_track.as_ref(),
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

    fn trim_clip(&self, request: norisk_ipc::TrimClipRequest) {
        let started = Instant::now();
        match crate::trim::trim(
            &request.source,
            &request.destination,
            request.start_seconds,
            request.end_seconds,
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

fn start_audio(
    window_seconds: f32,
    plan: AudioPlan,
    epoch: Arc<AtomicI64>,
) -> Result<AudioPipeline> {
    use crate::audio::{encoder::DEFAULT_BITRATE, AudioEncoder, LoopbackCapture, Mixer};

    if plan.sources.is_empty() {
        anyhow::bail!("no audio source to record");
    }

    let ring = Arc::new(Mutex::new(AudioRing::new(
        window_seconds,
        TIME_BASE_DEN as i64,
    )));

    let (primary, format) = crate::audio::wasapi::probe_source(&plan.sources[0].source)?;
    let mut encoder = AudioEncoder::open(format, DEFAULT_BITRATE)?;

    let header = encoder.extradata();
    if header.is_empty() {
        anyhow::bail!("the AAC encoder produced no header; the audio track would not decode");
    }
    let extradata = Arc::new(Mutex::new(header));

    let sink_ring = Arc::clone(&ring);
    let encode: AudioSink = Arc::new(Mutex::new(move |samples: &[f32], relative: i64| {
        match encoder.push(samples, relative) {
            Ok(packets) if !packets.is_empty() => {
                let mut ring = sink_ring.lock().unwrap_or_else(|e| e.into_inner());
                for packet in packets {
                    ring.push(packet);
                }
            }
            Ok(_) => {}
            Err(e) => log::warn!("Audio encoding failed: {e:#}"),
        }
    }));

    fn rebase(epoch: &AtomicI64, timestamp: i64) -> i64 {
        let _ = epoch.compare_exchange(i64::MIN, timestamp, Ordering::Relaxed, Ordering::Relaxed);
        timestamp
            .saturating_sub(epoch.load(Ordering::Relaxed))
            .max(0)
    }

    let mut captures = Vec::new();
    let mut held_mixer = None;

    if plan.sources.len() == 1 {
        let gain = plan.sources[0].gain;
        let encode = Arc::clone(&encode);
        let mut scaled = Vec::new();

        captures.push(LoopbackCapture::start_from(
            primary,
            move |samples: &[f32], timestamp: i64| {
                let relative = rebase(&epoch, timestamp);
                let mut encode = encode.lock().unwrap_or_else(|e| e.into_inner());

                if (gain - 1.0).abs() < f32::EPSILON {
                    (*encode)(samples, relative);
                } else {
                    crate::audio::mix::apply_gain(samples, gain, &mut scaled);
                    (*encode)(&scaled, relative);
                }
            },
        )?);

        if (gain - 1.0).abs() >= f32::EPSILON {
            log::info!("Recording audio at {:.0}%", gain * 100.0);
        }
    } else {
        let tracks: Vec<crate::audio::Track> =
            plan.sources.iter().map(|source| source.track).collect();
        let mixer = Mixer::new(format.sample_rate, format.channels, &tracks);
        held_mixer = Some(mixer.clone());

        for (index, planned) in plan.sources.into_iter().enumerate() {
            let source = if index == 0 {
                primary.clone()
            } else {
                planned.source
            };

            let mixer = mixer.clone();
            let encode = Arc::clone(&encode);
            let epoch = Arc::clone(&epoch);
            let track = planned.track;
            let gain = planned.gain;

            captures.push(LoopbackCapture::start_from(
                source,
                move |samples: &[f32], timestamp: i64| {
                    let relative = rebase(&epoch, timestamp);
                    for block in mixer.push(track, samples, relative, gain) {
                        let mut encode = encode.lock().unwrap_or_else(|e| e.into_inner());
                        (*encode)(&block.samples, block.timestamp_100ns);
                    }
                },
            )?);

            log::info!("Mixing {track:?} audio at {:.0}%", gain * 100.0);
        }
    }

    log::info!(
        "Desktop audio attached: {} source(s), {} Hz {}ch",
        captures.len(),
        format.sample_rate,
        format.channels
    );

    Ok(AudioPipeline {
        _captures: captures,
        ring,
        extradata,
        sample_rate: crate::audio::encoder::OUTPUT_SAMPLE_RATE as u32,
        channels: crate::audio::encoder::OUTPUT_CHANNELS as u32,
        mixer: held_mixer,
        sink: encode,
    })
}

fn encode_loop(
    mut encoder: VideoEncoder,
    frames: Receiver<PoolFrame>,
    ring: Arc<Mutex<RingBuffer>>,
    events: UnboundedSender<CaptureToLauncher>,
) {
    while let Ok(frame) = frames.recv() {
        match encoder.encode(&frame) {
            Ok(packets) => {
                let mut guard = ring.lock().unwrap_or_else(|e| e.into_inner());
                for packet in packets {
                    guard.push(packet);
                }
            }
            Err(e) => {
                log::error!("Encoding failed: {e:#}");
                let _ = events.send(CaptureToLauncher::Error(CaptureError {
                    code: ErrorCode::EncoderUnavailable,
                    message: format!("{e:#}"),
                    recoverable: false,
                }));
                return;
            }
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
