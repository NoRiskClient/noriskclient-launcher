use crate::commands::request_context::account_ctx_mode;
use crate::error::{AppError, CommandError};
use crate::minecraft::api::core_api::CoreApi;
use crate::minecraft::dto::afkpoints::AfkPointsBalance;
use log::{debug, warn};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

async fn mint_session_token(is_experimental: bool) -> Option<String> {
    let token = match account_ctx_mode(None, Some(is_experimental), true).await {
        Ok(ctx) => ctx.token,
        Err(e) => {
            warn!("AppLixir: no account/token: {:?}", e);
            return None;
        }
    };
    match CoreApi::new()
        .mint_applixir_session(&token, is_experimental)
        .await
    {
        Ok(session_token) => Some(session_token),
        Err(e) => {
            warn!("AppLixir session mint failed: {}", e);
            None
        }
    }
}

#[tauri::command]
pub async fn applixir_mint_session() -> Result<Option<String>, CommandError> {
    // TODO: revert to is_experimental_mode() once /core/applixir is deployed to prod.
    let is_experimental = true;
    Ok(mint_session_token(is_experimental).await)
}

#[tauri::command]
pub async fn get_afkpoints_balance() -> Result<Option<AfkPointsBalance>, CommandError> {
    // TODO: revert to is_experimental_mode() once /core/afkpoints is deployed to prod.
    let is_experimental = true;

    let token = match account_ctx_mode(None, Some(is_experimental), true).await {
        Ok(ctx) => ctx.token,
        Err(_) => return Ok(None),
    };
    match CoreApi::new().get_afkpoints_balance(&token, is_experimental).await {
        Ok(balance) => Ok(Some(balance)),
        Err(e) => {
            warn!("AFK Points balance fetch failed: {}", e);
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn applixir_show_ad(
    app: AppHandle,
    reset_consent: Option<bool>,
) -> Result<(), CommandError> {
    debug!("Executing applixir_show_ad command");
    // TODO: revert to is_experimental_mode() once /core/applixir is deployed to prod.
    let is_experimental = true;
    let base = CoreApi::get_api_base(is_experimental);

    let session_token = mint_session_token(is_experimental).await;

    if let Some(window) = app.get_webview_window("applixir_window") {
        let _ = window.destroy();
    }

    let mut url = match &session_token {
        Some(session_token) => format!(
            "applixir-window.html?token={}&base={}",
            urlencoding::encode(session_token),
            urlencoding::encode(base)
        ),
        None => format!("applixir-window.html?base={}", urlencoding::encode(base)),
    };
    if reset_consent.unwrap_or(false) {
        url.push_str("&resetConsent=1");
    }

    WebviewWindowBuilder::new(&app, "applixir_window", WebviewUrl::App(url.into()))
        .title("NoRisk Ad")
        .inner_size(1200.0, 720.0)
        .min_inner_size(900.0, 560.0)
        .decorations(false)
        .center()
        .visible(false)
        .build()
        .map_err(|e| {
            CommandError::from(AppError::Other(format!(
                "Failed to build AppLixir window: {}",
                e
            )))
        })?;

    Ok(())
}
