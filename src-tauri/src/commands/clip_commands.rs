use serde::Serialize;

use crate::error::CommandError;
use crate::state::State;
use norisk_ipc::{
    AudioDeviceInfo, CaptureState, ClipCodec, EncoderCapability, EncoderPreference,
    LauncherToCapture,
};

#[derive(Serialize)]
pub struct CaptureStatus {
    pub running: bool,
    pub state: CaptureState,
    pub blocked_by_fullscreen: bool,
    pub engine_version: Option<String>,
    pub adapter: Option<String>,
    pub available_encoders: Vec<EncoderPreference>,
    pub capabilities: Vec<EncoderCapability>,
    pub active_codec: Option<ClipCodec>,
    pub active_encoder: Option<EncoderPreference>,
    pub audio_devices: Vec<AudioDeviceInfo>,
    pub microphones: Vec<AudioDeviceInfo>,
    pub supports_game_only_audio: bool,
}

#[tauri::command]
pub async fn capture_release_hotkeys(#[allow(unused)] app: tauri::AppHandle) -> Result<(), CommandError> {
    #[cfg(windows)]
    crate::utils::hotkey_manager::clear();
    Ok(())
}

#[tauri::command]
pub async fn capture_apply_settings(app: tauri::AppHandle) -> Result<Vec<String>, CommandError> {
    let state = State::get().await?;
    let clips = state.config_manager.get_config().await.clips;

    if !clips.enabled {
        #[cfg(windows)]
        crate::utils::hotkey_manager::clear();
        state.capture_supervisor.stop().await;
        return Ok(Vec::new());
    }

    state.capture_supervisor.attach_app(app.clone()).await;
    state.capture_supervisor.start().await?;
    state
        .capture_supervisor
        .send(LauncherToCapture::Configure(clips.to_capture_config()))?;

    #[cfg(windows)]
    let registered = crate::utils::hotkey_manager::apply(&app, &clips)?;
    #[cfg(not(windows))]
    let registered = Vec::new();

    Ok(registered)
}

#[tauri::command]
pub async fn capture_status() -> Result<CaptureStatus, CommandError> {
    let state = State::get().await?;
    let supervisor = &state.capture_supervisor;

    let current = supervisor.state().await;
    let ready = supervisor.ready_info().await;
    let active = supervisor.active_encoder().await;
    let audio = ready
        .as_ref()
        .map(|r| {
            (
                r.audio_devices.clone(),
                r.microphones.clone(),
                r.supports_game_only_audio,
            )
        })
        .unwrap_or_default();

    Ok(CaptureStatus {
        running: supervisor.is_running().await,
        state: current,
        blocked_by_fullscreen: current == CaptureState::BlockedFullscreenExclusive,
        engine_version: ready.as_ref().map(|r| r.engine_version.clone()),
        adapter: ready.as_ref().map(|r| r.adapter.clone()),
        available_encoders: ready
            .as_ref()
            .map(|r| r.available_encoders.clone())
            .unwrap_or_default(),
        capabilities: ready.map(|r| r.capabilities).unwrap_or_default(),
        active_codec: active.map(|(codec, _)| codec),
        active_encoder: active.map(|(_, encoder)| encoder),
        audio_devices: audio.0,
        microphones: audio.1,
        supports_game_only_audio: audio.2,
    })
}

#[tauri::command]
pub async fn capture_encoder_capabilities() -> Result<Vec<EncoderCapability>, CommandError> {
    use std::time::Duration;

    let state = State::get().await?;
    let supervisor = &state.capture_supervisor;

    if let Some(ready) = supervisor.ready_info().await {
        if !ready.capabilities.is_empty() {
            return Ok(ready.capabilities);
        }
    }

    let was_running = supervisor.is_running().await;
    supervisor.start().await?;

    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    let mut capabilities = Vec::new();
    while std::time::Instant::now() < deadline {
        if let Some(ready) = supervisor.ready_info().await {
            if !ready.capabilities.is_empty() {
                capabilities = ready.capabilities;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    if !was_running && !state.config_manager.get_config().await.clips.enabled {
        supervisor.stop().await;
    }

    if capabilities.is_empty() {
        log::warn!("The capture engine did not report its encoder capabilities in time");
    }
    Ok(capabilities)
}

#[tauri::command]
pub async fn capture_show_overlay(app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::utils::clip_overlay::show(&app);
    Ok(())
}

#[tauri::command]
pub async fn capture_hide_overlay(app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::utils::clip_overlay::hide(&app);
    Ok(())
}

#[tauri::command]
pub async fn clip_list() -> Result<Vec<crate::utils::clip_library::ClipEntry>, CommandError> {
    let dir = clip_dir().await?;
    Ok(crate::utils::clip_library::list(&dir)?)
}

#[tauri::command]
pub async fn clip_storage_usage() -> Result<crate::utils::clip_library::StorageUsage, CommandError> {
    let state = State::get().await?;
    let config = state.config_manager.get_config().await;
    let clips = &config.clips;
    Ok(crate::utils::clip_library::usage(
        &clips.resolved_output_dir(),
        clips.max_storage_gb,
    )?)
}

#[tauri::command]
pub async fn clip_delete(path: std::path::PathBuf) -> Result<(), CommandError> {
    let dir = clip_dir().await?;
    crate::utils::clip_library::delete(&dir, &path)?;
    log::info!("Deleted clip {}", path.display());
    Ok(())
}

#[tauri::command]
pub async fn clip_reveal(path: std::path::PathBuf) -> Result<(), CommandError> {
    let dir = clip_dir().await?;
    let canonical = path
        .canonicalize()
        .map_err(|e| crate::error::AppError::Other(format!("that clip no longer exists: {e}")))?;
    if !canonical.starts_with(
        dir.canonicalize()
            .map_err(|e| crate::error::AppError::Other(format!("clip folder is unreadable: {e}")))?,
    ) {
        return Err(crate::error::AppError::Other(
            "refusing to reveal a file outside the clip folder".into(),
        )
        .into());
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", canonical.display()))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| crate::error::AppError::Other(format!("could not open Explorer: {e}")))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn clip_trim(
    path: std::path::PathBuf,
    start_seconds: f64,
    end_seconds: f64,
) -> Result<std::path::PathBuf, CommandError> {
    if !start_seconds.is_finite() || !end_seconds.is_finite() || end_seconds <= start_seconds {
        return Err(crate::error::AppError::Other(
            "the end of a clip has to come after its start".into(),
        )
        .into());
    }

    let dir = clip_dir().await?;
    let destination = crate::utils::clip_library::trimmed_destination(&dir, &path)?;

    let state = State::get().await?;
    state
        .capture_supervisor
        .send(LauncherToCapture::TrimClip(norisk_ipc::TrimClipRequest {
            source: path,
            destination: destination.clone(),
            start_seconds,
            end_seconds,
        }))?;

    Ok(destination)
}

async fn clip_dir() -> Result<std::path::PathBuf, CommandError> {
    let state = State::get().await?;
    let config = state.config_manager.get_config().await;
    Ok(config.clips.resolved_output_dir())
}

#[tauri::command]
pub async fn clip_open_folder() -> Result<(), CommandError> {
    let dir = clip_dir().await?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| {
            crate::error::AppError::Other(format!(
                "could not create the clip folder {}: {e}",
                dir.display()
            ))
        })?;
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("explorer.exe")
            .arg(&dir)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| crate::error::AppError::Other(format!("could not open Explorer: {e}")))?;
    }
    Ok(())
}
