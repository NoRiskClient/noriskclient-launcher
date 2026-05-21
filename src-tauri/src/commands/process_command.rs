use crate::error::{AppError, CommandError};
use crate::state::process_state::ProcessMetadata;
use crate::state::state_manager::State;
use chrono::{DateTime, Utc};
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

#[derive(serde::Serialize)]
pub struct ProcessLogCursor {
    pub cursor: u64,
    pub output: String,
    pub new_file: bool,
}

#[tauri::command]
pub async fn get_process_log_cursor(
    session_id: String,
    cursor: u64,
) -> Result<ProcessLogCursor, CommandError> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    if session_id.is_empty()
        || session_id.contains('/')
        || session_id.contains('\\')
        || session_id.contains("..")
    {
        return Err(CommandError::from(AppError::Other(format!(
            "Invalid log session id: {session_id}"
        ))));
    }

    let path = crate::utils::log_archive::archive_root()
        .join(&session_id)
        .join("nrc-process.log");

    if !path.exists() {
        return Ok(ProcessLogCursor {
            cursor: 0,
            output: String::new(),
            new_file: false,
        });
    }

    let mut file = tokio::fs::File::open(&path).await.map_err(AppError::Io)?;
    let len = file.metadata().await.map_err(AppError::Io)?.len();

    let mut cursor = cursor;
    let mut new_file = false;
    if cursor > len {
        cursor = 0;
        new_file = true;
    }

    file.seek(std::io::SeekFrom::Start(cursor))
        .await
        .map_err(AppError::Io)?;
    let mut buf = Vec::new();
    let read = file.read_to_end(&mut buf).await.map_err(AppError::Io)?;

    let output =
        crate::utils::security_utils::mask_sensitive_data(&String::from_utf8_lossy(&buf));

    Ok(ProcessLogCursor {
        cursor: cursor + read as u64,
        output,
        new_file,
    })
}

#[tauri::command]
pub async fn fetch_crash_report(profile_id: Uuid, process_id: Option<Uuid>, process_start_time: Option<String>) -> Result<Option<String>, CommandError> {
    let state = State::get().await?;

    // Parse the ISO 8601 timestamp if provided
    let parsed_start_time: Option<DateTime<Utc>> = process_start_time
        .as_ref()
        .and_then(|ts| ts.parse::<DateTime<Utc>>().ok());

    let crash_content = state
        .process_manager
        .fetch_latest_crash_report(profile_id, process_id, parsed_start_time)
        .await?;
    Ok(crash_content)
}

#[tauri::command]
pub async fn set_discord_state(
    state_type: String,
    profile_name: Option<String>,
) -> Result<(), CommandError> {
    log::info!("[Discord RPC] set_discord_state called: state_type='{}', profile_name={:?}", state_type, profile_name);
    let state = State::get().await?;
    state.discord_manager.set_custom_state(state_type).await;
    Ok(())
}

#[tauri::command]
pub async fn open_minecraft_log_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    crashed_process: Option<String>, // JSON-encoded ProcessMetadata for crashed process
) -> Result<(), CommandError> {
    let window_label = "minecraft_log_window";

    if let Some(window) = app.get_webview_window(window_label) {
        window.show().map_err(|e| {
            CommandError::from(crate::error::AppError::Other(format!(
                "Failed to show minecraft log window: {}",
                e
            )))
        })?;
        window.unminimize().map_err(|e| {
            CommandError::from(crate::error::AppError::Other(format!(
                "Failed to unminimize minecraft log window: {}",
                e
            )))
        })?;
        // Trick to bring window to front on Windows: temporarily set always on top
        let _ = window.set_always_on_top(true);
        let _ = window.set_always_on_top(false);
        window.set_focus().map_err(|e| {
            CommandError::from(crate::error::AppError::Other(format!(
                "Failed to focus minecraft log window: {}",
                e
            )))
        })?;
        return Ok(());
    }

    let url = match &crashed_process {
        Some(json) => format!(
            "minecraft-log-window.html?crashedProcess={}",
            urlencoding::encode(json)
        ),
        None => "minecraft-log-window.html".to_string(),
    };

    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        window_label,
        tauri::WebviewUrl::App(url.into()),
    )
    .title("Minecraft Logs")
    .inner_size(1200.0, 800.0)
    .decorations(false)
    .center()
    .visible(false)
    .build()
    .map_err(|e| CommandError::from(crate::error::AppError::Other(e.to_string())))?;

    Ok(())
}

#[tauri::command]
pub async fn open_single_log_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    instance_id: String,
    instance_name: String,
    profile_id: String,
    account_name: Option<String>,
    start_time: Option<i64>,
) -> Result<(), CommandError> {
    let window_label = format!("single_log_window_{}", instance_id);

    if let Some(window) = app.get_webview_window(&window_label) {
        window.set_focus().map_err(|e| {
            CommandError::from(crate::error::AppError::Other(format!(
                "Failed to focus single log window: {}",
                e
            )))
        })?;
        return Ok(());
    }

    let account_param = account_name
        .as_ref()
        .map(|n| format!("&accountName={}", urlencoding::encode(n)))
        .unwrap_or_default();

    let start_time_param = start_time
        .map(|t| format!("&startTime={}", t))
        .unwrap_or_default();

    let window_title = match &account_name {
        Some(name) => format!("Logs - {} - {}", instance_name, name),
        None => format!("Logs - {}", instance_name),
    };

    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        &window_label,
        tauri::WebviewUrl::App(
            format!(
                "single-log-window.html?instanceId={}&instanceName={}&profileId={}{}{}",
                instance_id,
                urlencoding::encode(&instance_name),
                profile_id,
                account_param,
                start_time_param
            )
            .into(),
        ),
    )
    .title(window_title)
    .inner_size(900.0, 600.0)
    .decorations(false)
    .center()
    .visible(false)
    .build()
    .map_err(|e| CommandError::from(crate::error::AppError::Other(e.to_string())))?;

    Ok(())
}

#[tauri::command]
pub async fn focus_main_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), CommandError> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| {
            CommandError::from(crate::error::AppError::Other(format!(
                "Failed to show main window: {}",
                e
            )))
        })?;
        window.unminimize().map_err(|e| {
            CommandError::from(crate::error::AppError::Other(format!(
                "Failed to unminimize main window: {}",
                e
            )))
        })?;
        // Trick to bring window to front on Windows: temporarily set always on top
        let _ = window.set_always_on_top(true);
        let _ = window.set_always_on_top(false);
        window.set_focus().map_err(|e| {
            CommandError::from(crate::error::AppError::Other(format!(
                "Failed to focus main window: {}",
                e
            )))
        })?;
    }
    Ok(())
}
