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

    Ok(bring_up(&app, &clips).await?)
}

pub fn start_on_launch(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Ok(state) = State::get().await else {
            return;
        };
        let clips = state.config_manager.get_config().await.clips;
        if !clips.enabled {
            log::debug!("Clip system disabled; not starting the capture engine");
            return;
        }

        let clip_dir = clips.resolved_output_dir();
        let _ = tokio::task::spawn_blocking(move || {
            crate::utils::clip_library::tidy_clip_folder(&clip_dir)
        })
        .await;

        match bring_up(&app, &clips).await {
            Ok(keys) => log::info!("Clip system ready, hotkeys: {keys:?}"),
            Err(e) => log::error!("Clip system could not be started: {e}"),
        }
    });
}

pub async fn bring_up(
    app: &tauri::AppHandle,
    clips: &crate::state::config_state::ClipConfig,
) -> crate::error::Result<Vec<String>> {
    let state = State::get().await?;

    state.capture_supervisor.attach_app(app.clone()).await;

    if let Err(e) = crate::utils::clip_overlay::create(app) {
        log::error!("Could not create the clip overlay: {e}");
    }

    state.capture_supervisor.start().await?;
    state
        .capture_supervisor
        .send(LauncherToCapture::Configure(clips.to_capture_config()))?;

    adopt_running_game(&state);

    #[cfg(windows)]
    let registered = crate::utils::hotkey_manager::apply(app, clips)?;
    #[cfg(not(windows))]
    let registered = Vec::new();

    crate::utils::game_watch::spawn();

    Ok(registered)
}

fn adopt_running_game(state: &crate::state::State) {
    if state.capture_supervisor.attached().is_some() {
        return;
    }

    let Some(pid) = crate::utils::window_finder::find_running_game() else {
        log::debug!("No game running; the engine will wait for one");
        return;
    };

    log::info!("Found a game already running (pid {pid}); attaching");
    if let Err(e) = state
        .capture_supervisor
        .attach_game(pid, "Minecraft".to_string())
    {
        log::warn!("Could not attach to the running game: {e}");
    }
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
    crate::commands::analytics_command::track("clip_deleted", serde_json::json!({}));
    Ok(())
}

#[tauri::command]
pub async fn clip_reveal(app: tauri::AppHandle, path: std::path::PathBuf) -> Result<(), CommandError> {
    use tauri_plugin_opener::OpenerExt;

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

    app.opener()
        .reveal_item_in_dir(&canonical)
        .map_err(|e| crate::error::AppError::Other(format!("could not reveal the clip: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn clip_prepare_preview(path: std::path::PathBuf) -> Result<(), CommandError> {
    let dir = clip_dir().await?;
    crate::utils::clip_library::guard_inside(&dir, &path)?;

    let state = State::get().await?;
    state
        .capture_supervisor
        .send(LauncherToCapture::PrepareAudioPreview(
            norisk_ipc::AudioPreviewRequest { source: path },
        ))?;
    Ok(())
}

#[tauri::command]
pub async fn clip_export_vertical(
    path: std::path::PathBuf,
) -> Result<std::path::PathBuf, CommandError> {
    let dir = clip_dir().await?;
    let destination = crate::utils::clip_library::vertical_destination(&dir, &path)?;

    let state = State::get().await?;
    state.capture_supervisor.send(LauncherToCapture::ExportVertical(
        norisk_ipc::ExportVerticalRequest {
            source: path,
            destination: destination.clone(),
        },
    ))?;

    Ok(destination)
}

#[tauri::command]
pub async fn clip_trim(
    path: std::path::PathBuf,
    start_seconds: f64,
    end_seconds: f64,
    levels: Option<Vec<norisk_ipc::TrackLevel>>,
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
            levels: levels.unwrap_or_default(),
        }))?;

    Ok(destination)
}

async fn clip_dir() -> Result<std::path::PathBuf, CommandError> {
    let state = State::get().await?;
    let config = state.config_manager.get_config().await;
    Ok(config.clips.resolved_output_dir())
}

#[tauri::command]
pub async fn clip_details(
    path: std::path::PathBuf,
) -> Result<Option<crate::utils::clip_library::ClipDetails>, CommandError> {
    let dir = clip_dir().await?;
    crate::utils::clip_library::guard_inside(&dir, &path)?;
    Ok(tokio::task::spawn_blocking(move || {
        crate::utils::clip_library::read_details(&path)
    })
    .await
    .map_err(|e| crate::error::AppError::Other(format!("reading the clip's details failed: {e}")))?)
}

#[tauri::command]
pub async fn clip_save_thumbnail(
    path: std::path::PathBuf,
    jpeg: Vec<u8>,
) -> Result<std::path::PathBuf, CommandError> {
    let dir = clip_dir().await?;
    Ok(tokio::task::spawn_blocking(move || {
        crate::utils::clip_library::write_thumbnail(&dir, &path, &jpeg)
    })
    .await
    .map_err(|e| crate::error::AppError::Other(format!("writing the still failed: {e}")))??)
}

#[tauri::command]
pub async fn clip_open_apps() -> Result<Vec<crate::utils::game_detect::OpenApp>, CommandError> {
    Ok(tokio::task::spawn_blocking(crate::utils::game_detect::open_apps)
        .await
        .map_err(|e| crate::error::AppError::Other(format!("listing open apps failed: {e}")))?)
}

#[tauri::command]
pub async fn clip_set_favourite(
    path: std::path::PathBuf,
    favourite: bool,
) -> Result<(), CommandError> {
    let dir = clip_dir().await?;
    crate::utils::clip_library::set_favourite(&dir, &path, favourite)?;
    crate::commands::analytics_command::track(
        "clip_favourited",
        serde_json::json!({ "favourite": favourite }),
    );
    Ok(())
}

#[tauri::command]
pub async fn clip_rename(
    path: std::path::PathBuf,
    name: String,
) -> Result<std::path::PathBuf, CommandError> {
    let dir = clip_dir().await?;
    let renamed = crate::utils::clip_library::rename(&dir, &path, &name)?;
    log::info!("Renamed {} to {}", path.display(), renamed.display());
    crate::commands::analytics_command::track("clip_renamed", serde_json::json!({}));
    Ok(renamed)
}

#[tauri::command]
pub async fn clip_open_folder(app: tauri::AppHandle) -> Result<(), CommandError> {
    use tauri_plugin_opener::OpenerExt;

    let dir = clip_dir().await?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| {
            crate::error::AppError::Other(format!(
                "could not create the clip folder {}: {e}",
                dir.display()
            ))
        })?;
    }

    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| crate::error::AppError::Other(format!("could not open the clip folder: {e}")))?;
    Ok(())
}
