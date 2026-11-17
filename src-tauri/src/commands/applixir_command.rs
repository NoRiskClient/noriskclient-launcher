use crate::commands::request_context::account_ctx_mode;
use crate::error::{AppError, CommandError};
use crate::minecraft::api::cape_api::CapeApi;
use crate::minecraft::api::core_api::CoreApi;
use crate::minecraft::dto::afkpoints::{
    AfkPointsBalance, AfkShopCatalogResponse, AfkShopPurchaseResponse, DailyClaimResult,
    DailyClaimState,
};
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
pub async fn afk_daily_state() -> Result<Option<DailyClaimState>, CommandError> {
    let is_experimental = true;
    let token = match account_ctx_mode(None, Some(is_experimental), true).await {
        Ok(ctx) => ctx.token,
        Err(_) => return Ok(None),
    };
    match CoreApi::new().get_daily_claim_state(&token, is_experimental).await {
        Ok(state) => Ok(Some(state)),
        Err(e) => {
            warn!("AFK daily state fetch failed: {}", e);
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn afk_daily_claim() -> Result<DailyClaimResult, CommandError> {
    let is_experimental = true;
    let token = account_ctx_mode(None, Some(is_experimental), true).await?.token;
    Ok(CoreApi::new().claim_daily(&token, is_experimental).await?)
}

#[tauri::command]
pub async fn afk_shop_catalog() -> Result<Option<AfkShopCatalogResponse>, CommandError> {
    let is_experimental = true;
    let token = match account_ctx_mode(None, Some(is_experimental), true).await {
        Ok(ctx) => ctx.token,
        Err(_) => return Ok(None),
    };
    match CapeApi::new().get_afk_shop_catalog(&token, is_experimental).await {
        Ok(catalog) => Ok(Some(catalog)),
        Err(e) => {
            warn!("AFK shop catalog fetch failed: {}", e);
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn afk_shop_purchase(
    item_id: String,
    purchase_id: String,
) -> Result<AfkShopPurchaseResponse, CommandError> {
    let is_experimental = true;
    let token = account_ctx_mode(None, Some(is_experimental), true).await?.token;
    Ok(CapeApi::new()
        .purchase_afk_shop_item(&token, &item_id, &purchase_id, is_experimental)
        .await?)
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

    if let Some(window) = app.get_webview_window("applixir_window") {
        let _ = window.destroy();
        for _ in 0..40 {
            if app.get_webview_window("applixir_window").is_none() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }

    let mut url = format!("applixir-window.html?base={}", urlencoding::encode(base));
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
