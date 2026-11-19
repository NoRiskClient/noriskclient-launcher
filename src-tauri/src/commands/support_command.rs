use crate::error::CommandError;
use crate::support::error::{SupportError, SupportErrorKind};
use crate::support::handler::ActionOutcome;
use crate::support::service;
use crate::support::types::{PrepareResult, SubmitResponse, SupportRequestInfo};
use crate::utils::deep_link_utils::is_main_window;
use tauri::{AppHandle, Emitter, Webview};
use uuid::Uuid;

fn require_main_window(webview: &Webview) -> Result<(), CommandError> {
    if is_main_window(webview) {
        Ok(())
    } else {
        log::warn!(
            "[Support] Rejected support command from webview '{}'",
            webview.label()
        );
        Err(SupportError::new(SupportErrorKind::Forbidden).into())
    }
}

#[tauri::command]
pub async fn support_request_fetch(
    webview: Webview,
    code: String,
    try_other_accounts: Option<bool>,
) -> Result<SupportRequestInfo, CommandError> {
    require_main_window(&webview)?;
    Ok(service::fetch(&code, try_other_accounts.unwrap_or(false)).await?)
}

#[tauri::command]
pub async fn support_request_prepare(
    webview: Webview,
    app: AppHandle,
    code: String,
    profile_id: Uuid,
    account_id: Uuid,
) -> Result<PrepareResult, CommandError> {
    require_main_window(&webview)?;
    let step = |step| {
        let _ = app.emit("support:prepare_step", step);
    };
    Ok(service::prepare(&code, profile_id, account_id, step).await?)
}

#[tauri::command]
pub async fn support_request_execute_action(
    webview: Webview,
    code: String,
    index: usize,
) -> Result<ActionOutcome, CommandError> {
    require_main_window(&webview)?;
    Ok(service::execute_action(&code, index).await?)
}

#[tauri::command]
pub async fn support_request_submit(
    webview: Webview,
    app: AppHandle,
    code: String,
    selection: Vec<usize>,
) -> Result<SubmitResponse, CommandError> {
    require_main_window(&webview)?;
    let launcher_version = app.package_info().version.to_string();
    Ok(service::submit(&code, selection, launcher_version).await?)
}

#[tauri::command]
pub async fn support_request_decline(
    webview: Webview,
    code: String,
) -> Result<(), CommandError> {
    require_main_window(&webview)?;
    Ok(service::decline(&code).await?)
}

#[tauri::command]
pub async fn support_request_close(
    webview: Webview,
    code: String,
) -> Result<(), CommandError> {
    require_main_window(&webview)?;
    Ok(service::close(&code).await?)
}
