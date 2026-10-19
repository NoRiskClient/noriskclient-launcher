use crate::error::CommandError;
use crate::support::error::{SupportError, SupportErrorKind};
use crate::support::handler::ActionOutcome;
use crate::support::service;
use crate::support::types::{PrepareResult, SubmitResponse, SupportRequestInfo};
use crate::utils::deep_link_utils::is_main_window;
use tauri::{AppHandle, Emitter, WebviewWindow};
use uuid::Uuid;

fn require_main_window(window: &WebviewWindow) -> Result<(), CommandError> {
    if is_main_window(window) {
        Ok(())
    } else {
        log::warn!(
            "[Support] Rejected support command from window '{}'",
            window.label()
        );
        Err(SupportError::new(SupportErrorKind::Forbidden).into())
    }
}

#[tauri::command]
pub async fn support_request_fetch(
    window: WebviewWindow,
    code: String,
    try_other_accounts: Option<bool>,
) -> Result<SupportRequestInfo, CommandError> {
    require_main_window(&window)?;
    Ok(service::fetch(&code, try_other_accounts.unwrap_or(false)).await?)
}

#[tauri::command]
pub async fn support_request_prepare(
    window: WebviewWindow,
    app: AppHandle,
    code: String,
    profile_id: Uuid,
    account_id: Uuid,
) -> Result<PrepareResult, CommandError> {
    require_main_window(&window)?;
    let step = |step| {
        let _ = app.emit("support:prepare_step", step);
    };
    Ok(service::prepare(&code, profile_id, account_id, step).await?)
}

#[tauri::command]
pub async fn support_request_execute_action(
    window: WebviewWindow,
    code: String,
    index: usize,
) -> Result<ActionOutcome, CommandError> {
    require_main_window(&window)?;
    Ok(service::execute_action(&code, index).await?)
}

#[tauri::command]
pub async fn support_request_submit(
    window: WebviewWindow,
    app: AppHandle,
    code: String,
    selection: Vec<usize>,
) -> Result<SubmitResponse, CommandError> {
    require_main_window(&window)?;
    let launcher_version = app.package_info().version.to_string();
    Ok(service::submit(&code, selection, launcher_version).await?)
}

#[tauri::command]
pub async fn support_request_decline(
    window: WebviewWindow,
    code: String,
) -> Result<(), CommandError> {
    require_main_window(&window)?;
    Ok(service::decline(&code).await?)
}

#[tauri::command]
pub async fn support_request_close(
    window: WebviewWindow,
    code: String,
) -> Result<(), CommandError> {
    require_main_window(&window)?;
    Ok(service::close(&code).await?)
}
