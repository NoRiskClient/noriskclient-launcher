use crate::error::{AppError, CommandError};
use crate::state::process_state::ProcessMetadata;
use crate::state::state_manager::State;
use chrono::{DateTime, Utc};
use std::path::PathBuf;
use tauri::Manager;
use uuid::Uuid;

const PROCESS_LOG_FILE_NAME: &str = "nrc-process.log";
const MAX_LOG_RANGE_BYTES: u64 = 512 * 1024;

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

#[derive(serde::Serialize)]
pub struct ProcessLogRange {
    pub start: u64,
    pub cursor: u64,
    pub total_bytes: u64,
    pub output: String,
    pub truncated: bool,
}

fn validate_log_session_id(session_id: &str) -> Result<(), CommandError> {
    if session_id.is_empty()
        || session_id.contains('/')
        || session_id.contains('\\')
        || session_id.contains("..")
    {
        return Err(CommandError::from(AppError::Other(format!(
            "Invalid log session id: {session_id}"
        ))));
    }

    Ok(())
}

fn process_log_path(session_id: &str) -> PathBuf {
    crate::utils::log_archive::archive_root()
        .join(session_id)
        .join(PROCESS_LOG_FILE_NAME)
}

fn clamp_log_read_len(requested: u64) -> u64 {
    requested.clamp(1, MAX_LOG_RANGE_BYTES)
}

#[tauri::command]
pub async fn get_process_log_cursor(
    session_id: String,
    cursor: u64,
) -> Result<ProcessLogCursor, CommandError> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    validate_log_session_id(&session_id)?;
    let path = process_log_path(&session_id);

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
pub async fn get_process_log_range(
    session_id: String,
    start: u64,
    max_bytes: Option<u64>,
) -> Result<ProcessLogRange, CommandError> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    validate_log_session_id(&session_id)?;
    let path = process_log_path(&session_id);

    if !path.exists() {
        return Ok(ProcessLogRange {
            start: 0,
            cursor: 0,
            total_bytes: 0,
            output: String::new(),
            truncated: false,
        });
    }

    let mut file = tokio::fs::File::open(&path).await.map_err(AppError::Io)?;
    let total_bytes = file.metadata().await.map_err(AppError::Io)?.len();
    let read_start = start.min(total_bytes);
    let read_len = clamp_log_read_len(max_bytes.unwrap_or(MAX_LOG_RANGE_BYTES));
    let available = total_bytes.saturating_sub(read_start);
    let bounded_read_len = read_len.min(available);

    file.seek(std::io::SeekFrom::Start(read_start))
        .await
        .map_err(AppError::Io)?;

    let mut buf = Vec::with_capacity(bounded_read_len as usize);
    let mut reader = file.take(bounded_read_len);
    let read = reader.read_to_end(&mut buf).await.map_err(AppError::Io)?;
    let cursor = read_start + read as u64;
    let output =
        crate::utils::security_utils::mask_sensitive_data(&String::from_utf8_lossy(&buf));

    Ok(ProcessLogRange {
        start: read_start,
        cursor,
        total_bytes,
        output,
        truncated: cursor < total_bytes,
    })
}

#[tauri::command]
pub async fn get_process_log_tail(
    session_id: String,
    max_bytes: Option<u64>,
) -> Result<ProcessLogRange, CommandError> {
    validate_log_session_id(&session_id)?;
    let path = process_log_path(&session_id);

    if !path.exists() {
        return Ok(ProcessLogRange {
            start: 0,
            cursor: 0,
            total_bytes: 0,
            output: String::new(),
            truncated: false,
        });
    }

    let total_bytes = tokio::fs::metadata(&path).await.map_err(AppError::Io)?.len();
    let read_len = clamp_log_read_len(max_bytes.unwrap_or(MAX_LOG_RANGE_BYTES));
    let start = total_bytes.saturating_sub(read_len);

    get_process_log_range(session_id, start, Some(read_len)).await
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
