use crate::error::CommandError;
use crate::state::process_state::ProcessMetadata;
use crate::state::state_manager::State;
use tauri::Manager;
use uuid::Uuid;

#[tauri::command]
pub async fn get_processes() -> Result<Vec<ProcessMetadata>, CommandError> {
    let state = State::get().await?;
    let processes = state.process_manager.list_processes().await;
    Ok(processes)
}

#[tauri::command]
pub async fn get_process(process_id: Uuid) -> Result<Option<ProcessMetadata>, CommandError> {
    let state = State::get().await?;
    let process = state.process_manager.get_process_metadata(process_id).await;
    Ok(process)
}

#[tauri::command]
pub async fn get_processes_by_profile(
    profile_id: Uuid,
) -> Result<Vec<ProcessMetadata>, CommandError> {
    let state = State::get().await?;
    let processes = state
        .process_manager
        .get_process_metadata_by_profile(profile_id)
        .await;
    Ok(processes)
}

#[tauri::command]
pub async fn stop_process(process_id: Uuid) -> Result<(), CommandError> {
    let state = State::get().await?;
    state.process_manager.stop_process(process_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_full_log(process_id: Uuid) -> Result<String, CommandError> {
    let state = State::get().await?;
    let log_content = state
        .process_manager
        .get_full_log_content(process_id)
        .await?;
    Ok(log_content)
}

#[tauri::command]
pub async fn open_log_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    process_id: Uuid,
    is_live_logs: Option<bool>,
) -> Result<(), CommandError> {
    let window_label = format!("log_window_{}", process_id);

    if let Some(window) = app.get_webview_window(&window_label) {
        window.set_focus().map_err(|e| {
            CommandError::from(crate::error::AppError::Other(format!(
                "Failed to focus existing log window {}: {}",
                window_label, e
            )))
        })?;
        return Ok(());
    }

    let is_live = is_live_logs.unwrap_or(false);

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        &window_label,
        tauri::WebviewUrl::App(
            format!(
                "log-window.html?processId={}&isLiveLogs={}",
                process_id, is_live
            )
            .into(),
        ),
    )
    .title(format!("Minecraft Logs ({})", process_id))
    .inner_size(1200.0, 800.0)
    .center()
    .build()
    .map_err(|e| CommandError::from(crate::error::AppError::Other(e.to_string())))?;

    Ok(())
}

#[tauri::command]
pub async fn fetch_crash_report(profile_id: Uuid, process_id: Option<Uuid>) -> Result<Option<String>, CommandError> {
    let state = State::get().await?;
    let crash_content = state
        .process_manager
        .fetch_latest_crash_report(profile_id, process_id)
        .await?;
    Ok(crash_content)
}

#[tauri::command]
pub async fn set_discord_state(
    state_type: String,
    profile_name: Option<String>,
) -> Result<(), CommandError> {
    let state = State::get().await?;
    //TODO
    Ok(())
}
