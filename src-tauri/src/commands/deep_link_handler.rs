use crate::error::AppError;
use crate::minecraft::api::norisk_api::NoRiskApi;
use crate::state::state_manager::State;
use crate::utils::deep_link_utils::AuthBridgeResult;
use log::info;

/// Tauri command called by the frontend after user confirms the auth bridge request.
#[tauri::command]
pub async fn confirm_auth_bridge(session_id: String) -> Result<AuthBridgeResult, crate::error::CommandError> {
    info!("[DeepLink] User confirmed auth bridge for sessionId: {}", session_id);

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
