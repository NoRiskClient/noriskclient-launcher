use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use norisk_ipc::{
    decode_line, encode_line, CaptureState, CaptureToLauncher, LauncherToCapture, ReadyInfo,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(windows)]
use tokio::net::windows::named_pipe::ClientOptions;
use tokio::sync::{mpsc, RwLock};

#[cfg(windows)]
use crate::config::ProjectDirsExt;
use crate::error::{AppError, Result};

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
    buffering_enabled: Option<bool>,
}

pub struct CaptureSupervisor {
    session_id: String,
    commands: mpsc::UnboundedSender<LauncherToCapture>,
    commands_rx: tokio::sync::Mutex<Option<mpsc::UnboundedReceiver<LauncherToCapture>>>,
    session: std::sync::Mutex<Session>,
    state: Arc<RwLock<CaptureState>>,
    ready: Arc<RwLock<Option<ReadyInfo>>>,
    active: Arc<RwLock<Option<(norisk_ipc::ClipCodec, norisk_ipc::EncoderPreference)>>>,
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
                LauncherToCapture::DetachWindow => session.attached_pid = None,
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

        let receiver = self.take_command_receiver().await?;
        let exe = locate_engine()?;
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
        let _ = self.commands.send(LauncherToCapture::Shutdown);
        *self.running.write().await = false;
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
            .creation_flags(CREATE_NO_WINDOW)
            .kill_on_drop(true);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(e) => return Outcome::Lost(format!("could not start {}: {e}", exe.display())),
        };
        log::info!("Capture engine started (pid {:?})", child.id());

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
                *self.ready.write().await = Some(info);
            }
            CaptureToLauncher::Status(status) => {
                {
                    let mut current = self.state.write().await;
                    if *current != status.state {
                        log::debug!("Capture state: {:?} -> {:?}", *current, status.state);
                        *current = status.state;
                    }
                }

                *self.active.write().await = match (status.active_codec, status.active_encoder) {
                    (Some(codec), Some(encoder)) => Some((codec, encoder)),
                    _ => None,
                };
            }
            CaptureToLauncher::ClipSaved(manifest) => {
                log::info!(
                    "Clip saved: {} ({:.1}s, {:.1} MB)",
                    manifest.path.display(),
                    manifest.duration_seconds,
                    manifest.size_bytes as f64 / 1e6
                );

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
            CaptureToLauncher::ClipTrimmed(trimmed) => {
                log::info!(
                    "Trimmed clip written: {} ({:.1}s, {:.1} MB)",
                    trimmed.path.display(),
                    trimmed.duration_seconds,
                    trimmed.size_bytes as f64 / 1e6
                );

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


