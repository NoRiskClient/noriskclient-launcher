use crate::error::AppError;
use crate::minecraft::api::norisk_api::NoRiskApi;
use crate::state::state_manager::State;
use crate::utils::deep_link_utils::{
    is_main_window, AuthBridgeResult, PendingDeepLinkEvent, PendingDeepLinks,
};
use log::info;

/// Tauri command called by the frontend after user confirms the auth bridge request.
#[tauri::command]
pub async fn confirm_auth_bridge(session_id: String) -> Result<AuthBridgeResult, crate::error::CommandError> {
    info!(
        "[DeepLink] User confirmed auth bridge for sessionId: {}",
        crate::utils::security_utils::mask_identifier(&session_id)
    );

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;

    let account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or(AppError::AccountError(
            "No active account found".to_string(),
        ))?;

    let token = account
        .norisk_credentials
        .get_token_for_mode(is_experimental)?;

    NoRiskApi::confirm_auth_bridge(&token, &session_id, is_experimental).await?;

    Ok(AuthBridgeResult {
        success: true,
        message: "success".to_string(),
    })
}

#[tauri::command]
pub fn take_pending_deep_links(
    app_handle: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Vec<PendingDeepLinkEvent> {
    use tauri::Manager;
    if !is_main_window(&window) {
        log::warn!(
            "[DeepLink] take_pending_deep_links rejected for window '{}'",
            window.label()
        );
        return Vec::new();
    }
    let pending = app_handle
        .try_state::<PendingDeepLinks>()
        .map(|p| p.take())
        .unwrap_or_default();
    info!("[DeepLink] Frontend ready, handing over {} pending event(s)", pending.len());
    pending
}
