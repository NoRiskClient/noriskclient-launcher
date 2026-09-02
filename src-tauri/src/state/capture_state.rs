#[cfg(windows)]
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use norisk_ipc::{CaptureState, CaptureToLauncher, LauncherToCapture, ReadyInfo};
#[cfg(windows)]
use norisk_ipc::{decode_line, encode_line};
#[cfg(windows)]
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(windows)]
use tokio::net::windows::named_pipe::ClientOptions;
use tokio::sync::{mpsc, RwLock};

#[cfg(windows)]
use crate::config::ProjectDirsExt;
use crate::commands::analytics_command::track;
use crate::error::{AppError, Result};
use serde_json::json;

const PING_INTERVAL: Duration = Duration::from_secs(2);

const MISSED_PONGS_ALLOWED: u32 = 3;

const BACKOFF: &[Duration] = &[
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(5),
    Duration::from_secs(15),
];

#[derive(Clone, Default)]
struct Session {
    config: Option<norisk_ipc::CaptureConfig>,
    attached_pid: Option<u32>,
    attached_game: Option<String>,
    buffering_enabled: Option<bool>,
    attached_at: Option<std::time::Instant>,
    buffering_since: Option<std::time::Instant>,
}

fn gpu_vendor(adapter: &str) -> &'static str {
    let lower = adapter.to_ascii_lowercase();
    if lower.contains("nvidia") || lower.contains("geforce") {
        "nvidia"
    } else if lower.contains("amd") || lower.contains("radeon") {
        "amd"
    } else if lower.contains("intel") {
        "intel"
    } else {
        "other"
    }
}

fn game_kind(game: Option<&str>) -> &'static str {
    match game {
        Some("Minecraft") => "minecraft",
        Some(_) => "other",
        None => "none",
    }
}

fn tenths(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn megabytes(bytes: u64) -> f64 {
    tenths(bytes as f64 / 1e6)
}

fn settings_props(config: Option<&norisk_ipc::CaptureConfig>) -> serde_json::Value {
    match config {
        Some(c) => json!({
            "codec": c.codec,
            "encoder": c.encoder,
            "width": c.width,
            "height": c.height,
            "fps": c.fps,
            "bitrate_kbps": c.bitrate_kbps,
            "buffer_seconds": c.buffer_seconds,
            "capture_audio": c.capture_audio,
            "audio_source": c.audio_source,
            "capture_microphone": c.capture_microphone,
        }),
        None => json!({}),
    }
}

fn merged(mut base: serde_json::Value, extra: serde_json::Value) -> serde_json::Value {
    if let (Some(target), Some(source)) = (base.as_object_mut(), extra.as_object()) {
        target.extend(source.clone());
    }
    base
}

pub struct CaptureSupervisor {
    session_id: String,
    commands: mpsc::UnboundedSender<LauncherToCapture>,
    commands_rx: tokio::sync::Mutex<Option<mpsc::UnboundedReceiver<LauncherToCapture>>>,
    session: std::sync::Mutex<Session>,
    state: Arc<RwLock<CaptureState>>,
    ready: Arc<RwLock<Option<ReadyInfo>>>,
    active: Arc<RwLock<Option<(norisk_ipc::ClipCodec, norisk_ipc::EncoderPreference)>>>,
    last_status: Arc<RwLock<Option<norisk_ipc::StatusReport>>>,
    app: Arc<RwLock<Option<tauri::AppHandle>>>,
    running: Arc<RwLock<bool>>,
}

impl CaptureSupervisor {
    pub fn new() -> Self {
        let (commands, commands_rx) = mpsc::unbounded_channel();
        Self {
            session_id: uuid::Uuid::new_v4().to_string(),
            commands,
            commands_rx: tokio::sync::Mutex::new(Some(commands_rx)),
            session: std::sync::Mutex::new(Session::default()),
            state: Arc::new(RwLock::new(CaptureState::Idle)),
            ready: Arc::new(RwLock::new(None)),
            active: Arc::new(RwLock::new(None)),
            last_status: Arc::new(RwLock::new(None)),
            app: Arc::new(RwLock::new(None)),
            running: Arc::new(RwLock::new(false)),
        }
    }

    pub async fn state(&self) -> CaptureState {
        *self.state.read().await
    }

    pub async fn ready_info(&self) -> Option<ReadyInfo> {
        self.ready.read().await.clone()
    }

    pub async fn attach_app(&self, app: tauri::AppHandle) {
        *self.app.write().await = Some(app);
    }

    pub async fn active_encoder(
        &self,
    ) -> Option<(norisk_ipc::ClipCodec, norisk_ipc::EncoderPreference)> {
        *self.active.read().await
    }

    pub async fn is_running(&self) -> bool {
        *self.running.read().await
    }

    pub fn send(&self, command: LauncherToCapture) -> Result<()> {
        {
            let mut session = self
                .session
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            match &command {
                LauncherToCapture::Configure(config) => session.config = Some(config.clone()),
                LauncherToCapture::AttachWindow { pid } => session.attached_pid = Some(*pid),
                LauncherToCapture::DetachWindow => {
                    session.attached_pid = None;
                    session.attached_game = None;
                }
                LauncherToCapture::SetBufferEnabled { enabled } => {
                    session.buffering_enabled = Some(*enabled)
                }
                _ => {}
            }
        }

        self.commands
            .send(command)
            .map_err(|_| AppError::Other("the capture supervisor is not running".into()))
    }

    pub fn attached(&self) -> Option<u32> {
        self.session
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .attached_pid
    }

    pub fn attached_game(&self) -> Option<String> {
        self.session
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .attached_game
            .clone()
    }

    pub fn attach_game(&self, pid: u32, name: String) -> Result<()> {
        self.send(LauncherToCapture::AttachWindow { pid })?;
        let mut session = self
            .session
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        session.attached_game = Some(name);
        session.attached_at = Some(std::time::Instant::now());
        Ok(())
    }

    fn track_state_change(
        &self,
        from: CaptureState,
        to: CaptureState,
        status: &norisk_ipc::StatusReport,
    ) {
        use CaptureState::{Attaching, BlockedFullscreenExclusive, Buffering, Failed, Idle, Paused};

        let mut session = self
            .session
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let kind = game_kind(session.attached_game.as_deref());
        let method = status.capture_method.clone();

        if to == Buffering && session.buffering_since.is_none() {
            session.buffering_since = Some(std::time::Instant::now());
            if let Some(started) = session.attached_at.take() {
                track(
                    "clip_capture_attached",
                    json!({
                        "game": kind,
                        "capture_method": method,
                        "attach_ms": started.elapsed().as_millis() as u64,
                    }),
                );
            }
        }

        let was_live = matches!(from, Buffering | Paused | BlockedFullscreenExclusive);
        let now_off = matches!(to, Idle | Failed | Attaching);
        if was_live && now_off {
            if let Some(since) = session.buffering_since.take() {
                track(
                    "clip_capture_session",
                    json!({
                        "game": kind,
                        "capture_method": method,
                        "minutes": tenths(since.elapsed().as_secs_f64() / 60.0),
                        "dropped_frames": status.dropped_frames,
                        "encode_latency_ms_p99": status.encode_latency_ms_p99,
                        "ended_with": format!("{to:?}"),
                    }),
                );
            }
        }
    }

    pub fn detach(&self) -> Result<()> {
        self.send(LauncherToCapture::DetachWindow)
    }

    fn session_snapshot(&self) -> Session {
        self.session
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    #[cfg(windows)]
    pub async fn start(self: &Arc<Self>) -> Result<()> {
        if *self.running.read().await {
            return Ok(());
        }

        let mut receiver = self.take_command_receiver().await?;
        let exe = locate_engine()?;

        let mut stale = 0;
        while receiver.try_recv().is_ok() {
            stale += 1;
        }
        if stale > 0 {
            log::debug!("Dropped {stale} command(s) left over from the last capture engine");
        }

        *self.running.write().await = true;

        let supervisor = Arc::clone(self);
        tokio::spawn(async move {
            let receiver = supervisor.supervise(exe, receiver).await;
            *supervisor.running.write().await = false;
            *supervisor.state.write().await = CaptureState::Idle;
            *supervisor.commands_rx.lock().await = Some(receiver);
        });

        Ok(())
    }

    #[cfg(windows)]
    async fn take_command_receiver(
        &self,
    ) -> Result<mpsc::UnboundedReceiver<LauncherToCapture>> {
        const HANDOVER_TIMEOUT: Duration = Duration::from_secs(3);
        const POLL: Duration = Duration::from_millis(50);

        let deadline = tokio::time::Instant::now() + HANDOVER_TIMEOUT;
        loop {
            if let Some(receiver) = self.commands_rx.lock().await.take() {
                return Ok(receiver);
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(AppError::Other(
                    "the previous capture engine has not finished shutting down".into(),
                ));
            }
            tokio::time::sleep(POLL).await;
        }
    }

    #[cfg(not(windows))]
    pub async fn start(self: &Arc<Self>) -> Result<()> {
        log::debug!("Capture engine is unavailable on this platform");
        Ok(())
    }

    pub async fn stop(&self) {
        let mut running = self.running.write().await;
        if *running {
            let _ = self.commands.send(LauncherToCapture::Shutdown);
        }
        *running = false;
    }

    #[cfg(windows)]
    async fn supervise(
        &self,
        exe: PathBuf,
        mut commands: mpsc::UnboundedReceiver<LauncherToCapture>,
    ) -> mpsc::UnboundedReceiver<LauncherToCapture> {
        let mut attempt = 0usize;

        loop {
            match self.run_once(&exe, &mut commands).await {
                Outcome::Shutdown => {
                    log::info!("Capture engine shut down as requested");
                    return commands;
                }
                Outcome::Lost(reason) => {
                    log::warn!("Capture engine went away: {reason}");
                    *self.state.write().await = CaptureState::Attaching;
                    *self.ready.write().await = None;
                }
            }

            let Some(delay) = BACKOFF.get(attempt) else {
                log::error!(
                    "Capture engine failed {} times; giving up until it is started again",
                    BACKOFF.len()
                );
                *self.state.write().await = CaptureState::Failed;
                return commands;
            };
            attempt += 1;

            log::info!("Restarting the capture engine in {:.0}s", delay.as_secs_f32());
            *self.state.write().await = CaptureState::Attaching;
            tokio::time::sleep(*delay).await;
        }
    }

    #[cfg(windows)]
    async fn run_once(
        &self,
        exe: &PathBuf,
        commands: &mut mpsc::UnboundedReceiver<LauncherToCapture>,
    ) -> Outcome {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let pipe_name = norisk_ipc::pipe_name(&self.session_id);
        let log_dir = crate::config::LAUNCHER_DIRECTORY
            .root_dir()
            .join("logs");

        let mut command = tokio::process::Command::new(exe);
        command
            .arg("--pipe")
            .arg(&pipe_name)
            .arg("--log-dir")
            .arg(&log_dir)
            .arg("--parent-pid")
            .arg(std::process::id().to_string())
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(e) => return Outcome::Lost(format!("could not start {}: {e}", exe.display())),
        };
        log::info!("Capture engine started (pid {:?})", child.id());

        if let Some(out) = child.stdout.take() {
            forward_engine_output(out);
        }
        if let Some(err) = child.stderr.take() {
            forward_engine_output(err);
        }

        let client = match connect_with_retry(&pipe_name).await {
            Ok(client) => client,
            Err(e) => {
                let _ = child.kill().await;
                return Outcome::Lost(format!("could not connect to {pipe_name}: {e}"));
            }
        };

        let (reader, mut writer) = tokio::io::split(client);
        let mut lines = BufReader::new(reader).lines();

        let session = self.session_snapshot();
        let mut replay: Vec<LauncherToCapture> = Vec::new();
        if let Some(config) = session.config {
            replay.push(LauncherToCapture::Configure(config));
        }
        if let Some(pid) = session.attached_pid {
            replay.push(LauncherToCapture::AttachWindow { pid });
        }
        if let Some(enabled) = session.buffering_enabled {
            replay.push(LauncherToCapture::SetBufferEnabled { enabled });
        }
        if !replay.is_empty() {
            log::info!("Restoring {} session command(s) on the capture engine", replay.len());
            for command in replay {
                let Ok(line) = encode_line(&command) else {
                    continue;
                };
                if writer.write_all(line.as_bytes()).await.is_err() {
                    let _ = child.kill().await;
                    return Outcome::Lost("session restore failed".into());
                }
            }
            let _ = writer.flush().await;
        }

        let mut ping = tokio::time::interval(PING_INTERVAL);
        let mut sequence = 0u64;
        let mut unanswered = 0u32;

        loop {
            tokio::select! {
                line = lines.next_line() => match line {
                    Ok(Some(line)) if line.trim().is_empty() => {}
                    Ok(Some(line)) => match decode_line::<CaptureToLauncher>(&line) {
                        Ok(event) => {
                            if matches!(event, CaptureToLauncher::Pong { .. }) {
                                unanswered = 0;
                            }
                            self.absorb(event).await;
                        }
                        Err(e) => log::warn!("Undecodable message from the capture engine: {e}"),
                    },
                    Ok(None) => {
                        let _ = child.kill().await;
                        return Outcome::Lost("the engine closed the pipe".into());
                    }
                    Err(e) => {
                        let _ = child.kill().await;
                        return Outcome::Lost(format!("read failed: {e}"));
                    }
                },

                command = commands.recv() => {
                    let Some(command) = command else {
                        let _ = child.kill().await;
                        return Outcome::Shutdown;
                    };
                    let shutdown = matches!(command, LauncherToCapture::Shutdown);
                    if let Ok(line) = encode_line(&command) {
                        if writer.write_all(line.as_bytes()).await.is_err() {
                            let _ = child.kill().await;
                            return Outcome::Lost("write failed".into());
                        }
                        let _ = writer.flush().await;
                    }
                    if shutdown {
                        let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
                        return Outcome::Shutdown;
                    }
                }

                _ = ping.tick() => {
                    if unanswered >= MISSED_PONGS_ALLOWED {
                        let _ = child.kill().await;
                        return Outcome::Lost(format!("{unanswered} heartbeats went unanswered"));
                    }
                    sequence += 1;
                    unanswered += 1;
                    if let Ok(line) = encode_line(&LauncherToCapture::Ping { seq: sequence }) {
                        if writer.write_all(line.as_bytes()).await.is_err() {
                            let _ = child.kill().await;
                            return Outcome::Lost("heartbeat write failed".into());
                        }
                        let _ = writer.flush().await;
                    }
                }

                status = child.wait() => {
                    return Outcome::Lost(match status {
                        Ok(status) => format!("process exited with {status}"),
                        Err(e) => format!("could not wait on the process: {e}"),
                    });
                }
            }
        }
    }

    async fn absorb(&self, event: CaptureToLauncher) {
        match event {
            CaptureToLauncher::Ready(info) => {
                if info.protocol_version != norisk_ipc::PROTOCOL_VERSION {
                    log::error!(
                        "Capture engine speaks protocol {} but this launcher speaks {}",
                        info.protocol_version,
                        norisk_ipc::PROTOCOL_VERSION
                    );
                }
                log::info!(
                    "Capture engine {} ready on {} with {:?}",
                    info.engine_version,
                    info.adapter,
                    info.available_encoders
                );

                let config = self.session_snapshot().config;
                track(
                    "clip_engine_ready",
                    merged(
                        json!({
                            "engine_version": info.engine_version,
                            "gpu_vendor": gpu_vendor(&info.adapter),
                            "encoders": info.available_encoders,
                            "hardware_encoders": info
                                .capabilities
                                .iter()
                                .filter(|c| c.available && c.hardware)
                                .count(),
                            "game_only_audio": info.supports_game_only_audio,
                        }),
                        settings_props(config.as_ref()),
                    ),
                );

                *self.ready.write().await = Some(info);
            }
            CaptureToLauncher::Status(status) => {
                {
                    let mut current = self.state.write().await;
                    if *current != status.state {
                        log::debug!("Capture state: {:?} -> {:?}", *current, status.state);
                        self.track_state_change(*current, status.state, &status);
                        *current = status.state;
                    }
                }

                *self.active.write().await = match (status.active_codec, status.active_encoder) {
                    (Some(codec), Some(encoder)) => Some((codec, encoder)),
                    _ => None,
                };
                *self.last_status.write().await = Some(status);
            }
            CaptureToLauncher::ClipSaved(manifest) => {
                log::info!(
                    "Clip saved: {} ({:.1}s, {:.1} MB)",
                    manifest.path.display(),
                    manifest.duration_seconds,
                    manifest.size_bytes as f64 / 1e6
                );

                {
                    let status = self.last_status.read().await.clone();
                    let active = *self.active.read().await;
                    track(
                        "clip_saved",
                        json!({
                            "game": game_kind(self.attached_game().as_deref()),
                            "reason": manifest.reason,
                            "duration_s": tenths(manifest.duration_seconds as f64),
                            "size_mb": megabytes(manifest.size_bytes),
                            "width": manifest.width,
                            "height": manifest.height,
                            "fps": manifest.fps,
                            "bitrate_kbps": manifest.bitrate_kbps,
                            "audio_tracks": manifest.audio_tracks.len(),
                            "codec": active.map(|(codec, _)| codec),
                            "encoder": active.map(|(_, encoder)| encoder),
                            "capture_method": status.as_ref().and_then(|s| s.capture_method.clone()),
                            "capture_fps": status.as_ref().map(|s| s.capture_fps.round()),
                            "encode_fps": status.as_ref().map(|s| s.encode_fps.round()),
                            "dropped_frames": status.as_ref().map(|s| s.dropped_frames),
                            "encode_latency_ms_p99": status.as_ref().map(|s| s.encode_latency_ms_p99),
                            "buffer_fill_s": status.as_ref().map(|s| s.buffer_fill_seconds.round()),
                        }),
                    );
                }

                {
                    let mut details = crate::utils::clip_library::ClipDetails::from(&manifest);
                    details.game = self.attached_game();
                    let path = manifest.path.clone();
                    if let Err(e) = tokio::task::spawn_blocking(move || {
                        crate::utils::clip_library::write_details(&path, &details)
                    })
                    .await
                    .map_err(|e| format!("{e}"))
                    .and_then(|inner| inner.map_err(|e| format!("{e}")))
                    {
                        log::warn!("Could not describe the saved clip: {e}");
                    }
                }

                if let Some(dir) = self.clip_dir_for_cleanup().await {
                    let (dir, limit) = dir;
                    match tokio::task::spawn_blocking(move || {
                        crate::utils::clip_library::enforce_limit(&dir, limit)
                    })
                    .await
                    {
                        Ok(Ok(removed)) if !removed.is_empty() => {
                            log::info!("Storage limit: removed {} old clip(s)", removed.len());
                        }
                        Ok(Ok(_)) => {}
                        Ok(Err(e)) => log::warn!("Could not enforce the storage limit: {e}"),
                        Err(e) => log::warn!("Storage cleanup task failed: {e}"),
                    }
                }

                match self.app.read().await.as_ref() {
                    Some(app) => {
                        use tauri::Emitter;
                        match app.emit("clip_saved", &manifest) {
                            Ok(()) => log::debug!("Told the UI about the saved clip"),
                            Err(e) => {
                                log::warn!("Could not tell the UI about the saved clip: {e}")
                            }
                        }
                    }
                    None => log::warn!("No UI handle; the saved clip cannot be confirmed on screen"),
                }
            }
            CaptureToLauncher::AudioPreviewReady(preview) => {
                log::debug!(
                    "Audio preview ready for {}: {} track(s)",
                    preview.source.display(),
                    preview.tracks.len()
                );
                if let Some(app) = self.app.read().await.as_ref() {
                    use tauri::Emitter;
                    if let Err(e) = app.emit("clip_audio_preview", &preview) {
                        log::warn!("Could not hand the audio preview to the UI: {e}");
                    }
                }
            }
            CaptureToLauncher::ExportProgress(progress) => {
                if let Some(app) = self.app.read().await.as_ref() {
                    use tauri::Emitter;
                    let _ = app.emit("clip_export_progress", &progress);
                }
            }
            CaptureToLauncher::ClipExported(exported) => {
                log::info!(
                    "Vertical clip written: {} ({}x{}, {:.1} MB)",
                    exported.path.display(),
                    exported.width,
                    exported.height,
                    exported.size_bytes as f64 / 1e6
                );
                track(
                    "clip_exported_vertical",
                    json!({
                        "duration_s": tenths(exported.duration_seconds),
                        "size_mb": megabytes(exported.size_bytes),
                        "width": exported.width,
                        "height": exported.height,
                    }),
                );
                if let Some(app) = self.app.read().await.as_ref() {
                    use tauri::Emitter;
                    if let Err(e) = app.emit("clip_exported", &exported) {
                        log::warn!("Could not tell the UI about the export: {e}");
                    }
                }
            }
            CaptureToLauncher::ClipTrimmed(trimmed) => {
                log::info!(
                    "Trimmed clip written: {} ({:.1}s, {:.1} MB)",
                    trimmed.path.display(),
                    trimmed.duration_seconds,
                    trimmed.size_bytes as f64 / 1e6
                );
                track(
                    "clip_trimmed",
                    json!({
                        "duration_s": tenths(trimmed.duration_seconds),
                        "start_s": tenths(trimmed.start_seconds),
                        "size_mb": megabytes(trimmed.size_bytes),
                    }),
                );

                {
                    let source = trimmed.source.clone();
                    let path = trimmed.path.clone();
                    let (start, end) = (trimmed.start_seconds, trimmed.end_seconds);
                    let _ = tokio::task::spawn_blocking(move || {
                        let Some(details) = crate::utils::clip_library::read_details(&source) else {
                            return;
                        };
                        let cut = details.sliced(start, end);
                        if let Err(e) = crate::utils::clip_library::write_details(&path, &cut) {
                            log::warn!("Could not describe the trimmed clip: {e}");
                        }
                    })
                    .await;
                }

                if let Some(app) = self.app.read().await.as_ref() {
                    use tauri::Emitter;
                    if let Err(e) = app.emit("clip_trimmed", &trimmed) {
                        log::warn!("Could not tell the UI about the trimmed clip: {e}");
                    }
                }
            }
            CaptureToLauncher::Error(error) => {
                log::error!(
                    "Capture engine error [{:?}]: {} (recoverable: {})",
                    error.code,
                    error.message,
                    error.recoverable
                );
                track(
                    "clip_engine_error",
                    json!({
                        "code": error.code,
                        "recoverable": error.recoverable,
                        "game": game_kind(self.attached_game().as_deref()),
                        "capture_method": self.last_status.read().await.as_ref().and_then(|s| s.capture_method.clone()),
                    }),
                );
                if !error.recoverable {
                    *self.state.write().await = CaptureState::Failed;
                }

                if let Some(app) = self.app.read().await.as_ref() {
                    use tauri::Emitter;
                    if let Err(e) = app.emit("clip_error", &error) {
                        log::warn!("Could not tell the UI about the capture error: {e}");
                    }
                }
            }
            CaptureToLauncher::Pong { .. } => {}
        }
    }
}

impl Default for CaptureSupervisor {
    fn default() -> Self {
        Self::new()
    }
}

enum Outcome {
    Shutdown,
    Lost(String),
}

#[cfg(windows)]
fn locate_engine() -> Result<PathBuf> {
    let exe = std::env::current_exe()
        .map_err(|e| AppError::Other(format!("could not locate the launcher executable: {e}")))?;
    let dir = exe
        .parent()
        .ok_or_else(|| AppError::Other("the launcher executable has no parent directory".into()))?;

    for name in [
        "norisk-capture.exe",
        "norisk-capture-x86_64-pc-windows-msvc.exe",
    ] {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(AppError::Other(format!(
        "norisk-capture.exe was not found next to the launcher in {}. \
         Build it with: cargo build -p norisk-capture",
        dir.display()
    )))
}

#[cfg(windows)]
fn forward_engine_output<R>(reader: R)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim_end();
            if !line.is_empty() {
                log::debug!("Capture engine: {line}");
            }
        }
    });
}

#[cfg(windows)]
async fn connect_with_retry(
    pipe_name: &str,
) -> std::result::Result<tokio::net::windows::named_pipe::NamedPipeClient, std::io::Error> {
    const ATTEMPTS: u32 = 50;
    let mut last = None;

    for _ in 0..ATTEMPTS {
        match ClientOptions::new().open(pipe_name) {
            Ok(client) => return Ok(client),
            Err(e) => {
                last = Some(e);
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }

    Err(last.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::TimedOut, "pipe never became available")
    }))
}

impl CaptureSupervisor {
    async fn clip_dir_for_cleanup(&self) -> Option<(std::path::PathBuf, u32)> {
        let state = crate::state::State::get().await.ok()?;
        let config = state.config_manager.get_config().await;
        let clips = &config.clips;
        if clips.max_storage_gb == 0 {
            return None;
        }
        Some((clips.resolved_output_dir(), clips.max_storage_gb))
    }
}


