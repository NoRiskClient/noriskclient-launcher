use crate::error::{AppError, CommandError};
use crate::state::process_state::ProcessMetadata;
use crate::state::state_manager::State;
use chrono::{DateTime, Utc};
use std::path::PathBuf;
use tauri::Manager;
use uuid::Uuid;

const PROCESS_LOG_FILE_NAME: &str = "nrc-process.log";
pub const MAX_LOG_CURSOR_BYTES: u64 = 512 * 1024;
pub const LOG_TAIL_BYTES: u64 = 1024 * 1024;

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

pub fn validate_log_session_id(session_id: &str) -> Result<(), CommandError> {
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

pub fn clamp_log_read_len(requested: Option<u64>) -> u64 {
    requested
        .unwrap_or(MAX_LOG_CURSOR_BYTES)
        .clamp(1, MAX_LOG_CURSOR_BYTES)
}

pub fn log_read_start(cursor: u64, total_bytes: u64, follow: bool) -> u64 {
    if cursor != 0 && cursor <= total_bytes {
        cursor
    } else if follow {
        total_bytes.saturating_sub(LOG_TAIL_BYTES)
    } else {
        0
    }
}

pub fn line_aligned(buf: &[u8], starts_mid_line: bool, whole_budget: bool) -> std::ops::Range<usize> {
    let begin = if starts_mid_line {
        match buf.iter().position(|&b| b == b'\n') {
            Some(newline) => newline + 1,
            None if whole_budget => return buf.len()..buf.len(),
            None => return 0..0,
        }
    } else {
        0
    };
    let end = match buf.iter().rposition(|&b| b == b'\n') {
        Some(newline) if newline >= begin => newline + 1,
        _ if whole_budget => buf.len(),
        _ => return 0..0,
    };
    begin..end
}

#[tauri::command]
pub async fn get_process_log_cursor(
    session_id: String,
    cursor: u64,
    max_bytes: Option<u64>,
    follow: Option<bool>,
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
    let total_bytes = file.metadata().await.map_err(AppError::Io)?.len();

    let new_file = cursor > total_bytes;
    let follow = follow.unwrap_or(false);
    let read_start = log_read_start(cursor, total_bytes, follow);
    let starts_mid_line = read_start > 0 && read_start != cursor;

    let read_len = clamp_log_read_len(max_bytes);
    let available = total_bytes.saturating_sub(read_start);
    let bounded_read_len = read_len.min(available);

    file.seek(std::io::SeekFrom::Start(read_start))
        .await
        .map_err(AppError::Io)?;

    let mut buf = Vec::with_capacity(bounded_read_len as usize);
    let mut reader = file.take(bounded_read_len);
    let read = reader.read_to_end(&mut buf).await.map_err(AppError::Io)?;
    let lines = if follow {
        line_aligned(&buf, starts_mid_line, read as u64 == read_len)
    } else {
        0..buf.len()
    };
    let next_cursor = if lines.end == 0 {
        if new_file { 0 } else { cursor }
    } else {
        read_start + lines.end as u64
    };

    let output =
        crate::utils::security_utils::mask_sensitive_data(&String::from_utf8_lossy(&buf[lines]));

    Ok(ProcessLogCursor {
        cursor: next_cursor,
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
    log::trace!("[Discord RPC] set_discord_state called: state_type='{}', profile_name={:?}", state_type, profile_name);
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
        crate::utils::window_focus::bring_to_front(&window).map_err(|e| {
            CommandError::from(crate::error::AppError::Other(format!(
                "Failed to bring minecraft log window to front: {}",
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
        crate::utils::window_focus::bring_to_front(&window).map_err(|e| {
            CommandError::from(crate::error::AppError::Other(format!(
                "Failed to bring main window to front: {}",
                e
            )))
        })?;
    }
    Ok(())
}
