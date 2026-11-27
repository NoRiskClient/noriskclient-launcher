use crate::error::{AppError, CommandError};
use crate::state::{config_state::LauncherConfig, State};
use tauri::command;
use tauri::AppHandle;

type Result<T> = std::result::Result<T, CommandError>;

#[command]
pub async fn get_launcher_config() -> Result<LauncherConfig> {
    let state = State::get().await?;
    let config = state.config_manager.get_config().await;
    Ok(config)
}

#[command]
pub async fn set_launcher_config(config: LauncherConfig) -> Result<LauncherConfig> {
    let state = State::get().await?;

    // Validate concurrent downloads value
    if config.concurrent_downloads == 0 || config.concurrent_downloads > 10 {
        return Err(CommandError::from(AppError::Other(format!(
            "Concurrent downloads must be between 1 and 10 (got: {})",
            config.concurrent_downloads
        ))));
    }

    let previous_clips = state.config_manager.get_config().await.clips.resolved_output_dir();

    // Set the entire configuration
    state.config_manager.set_config(config.clone()).await?;

    let next_clips = config.clips.resolved_output_dir();
    if previous_clips != next_clips {
        tauri::async_runtime::spawn_blocking(move || {
            crate::utils::clip_library::adopt_folder(&next_clips, &previous_clips)
        });
    }

    // Return the updated config
    Ok(config)
}

#[command]
pub fn get_app_version(app_handle: AppHandle) -> Result<String> {
    Ok(app_handle.package_info().version.to_string())
}
