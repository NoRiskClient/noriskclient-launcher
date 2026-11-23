use crate::error::CommandError;
use crate::support::handler::ActionOutcome;
use crate::support::{require_main_window, service};
use tauri::Webview;

#[tauri::command]
pub async fn support_request_share_profile(
    webview: Webview,
    code: String,
    index: usize,
    choice: serde_json::Value,
) -> Result<ActionOutcome, CommandError> {
    require_main_window(webview.label())?;
    Ok(service::execute_action_with(&code, index, Some(choice)).await?)
}
