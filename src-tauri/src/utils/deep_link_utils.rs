use crate::state::state_manager::State;
use log::{error, info, warn};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

#[derive(Clone, Serialize)]
pub struct AuthBridgeRequest {
    pub session_id: String,
    pub username: String,
}

#[derive(Clone, Serialize)]
pub struct AuthBridgeResult {
    pub success: bool,
    pub message: String,
}

#[derive(Clone, Serialize)]
pub struct TwitchDeepLinkRequest {
    pub action: String,
    pub export_key: Option<String>,
}

/// Handles incoming deep link URLs.
/// Parses the URL scheme and dispatches to the appropriate handler.
pub async fn handle_deep_link(app_handle: &AppHandle, urls: Vec<Url>) {
    for url in urls {
        info!(
            "[DeepLink] Received URL: {}://{}{}",
            url.scheme(),
            url.host_str().unwrap_or_default(),
            url.path()
        );

        if url.scheme() != "norisk" {
            warn!("[DeepLink] Ignoring URL with unknown scheme: {}", url.scheme());
            continue;
        }

        match url.host_str() {
            Some("auth") => {
                if url.path() == "/bridge" {
                    handle_auth_bridge(app_handle, &url).await;
                } else {
                    warn!("[DeepLink] Unknown auth path: {}", url.path());
                }
            }
            Some("twitch") => handle_twitch_deep_link(app_handle, &url).await,
            Some(host) => {
                warn!("[DeepLink] Unknown deep link host: {}", host);
            }
            None => {
                warn!("[DeepLink] Deep link URL has no host: {}", url);
            }
        }
    }
}

async fn handle_twitch_deep_link(app_handle: &AppHandle, url: &Url) {
    let action = match url.path() {
        "/link" => "link",
        "/unlink" => "unlink",
        "/change" => "change",
        path => {
            warn!("[DeepLink] Unknown Twitch path: {}", path);
            return;
        }
    };
    let export_key = url
        .query_pairs()
        .find(|(key, _)| key == "key")
        .map(|(_, value)| value.to_string());

    if action != "unlink" {
        match export_key.as_deref().and_then(|key| crate::minecraft::auth::twitch_auth::decode_export_key(key).ok()) {
            Some(_) => {}
            None => {
                warn!("[DeepLink] Twitch {} request missing a valid export key", action);
                return;
            }
        }
    }

    focus_main_window(app_handle);
    info!("[DeepLink] Twitch {} request received", action);
    let _ = app_handle.emit(
        "deep-link-twitch-request",
        TwitchDeepLinkRequest {
            action: action.to_string(),
            export_key,
        },
    );
}

fn focus_main_window(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window("main") else {
        return;
    };

    if let Err(error) = window.show() {
        warn!("[DeepLink] Could not show main window for Twitch request: {}", error);
    }
    if let Err(error) = window.unminimize() {
        warn!("[DeepLink] Could not restore main window for Twitch request: {}", error);
    }
    if let Err(error) = window.set_focus() {
        warn!("[DeepLink] Could not focus main window for Twitch request: {}", error);
    }
}

/// Handles `norisk://auth/bridge?sessionId=xxx` deep links.
/// Emits a confirmation request to the frontend before proceeding.
async fn handle_auth_bridge(app_handle: &AppHandle, url: &Url) {
    let session_id = match url
        .query_pairs()
        .find(|(key, _)| key == "sessionId")
        .map(|(_, value)| value.to_string())
    {
        Some(id) if !id.is_empty() => id,
        _ => {
            error!("[DeepLink] Auth bridge URL missing sessionId parameter");
            let _ = app_handle.emit("deep-link-auth-result", AuthBridgeResult {
                success: false,
                message: "Missing sessionId parameter".to_string(),
            });
            return;
        }
    };

    info!(
        "[DeepLink] Auth bridge request with sessionId: {}",
        crate::utils::security_utils::mask_identifier(&session_id)
    );

    // Check if user is logged in
    let state = match State::get().await {
        Ok(s) => s,
        Err(e) => {
            error!("[DeepLink] Failed to get state: {}", e);
            let _ = app_handle.emit("deep-link-auth-result", AuthBridgeResult {
                success: false,
                message: "Internal error".to_string(),
            });
            return;
        }
    };

    let account = match state
        .minecraft_account_manager_v2
        .get_active_account()
        .await
    {
        Ok(Some(acc)) => acc,
        Ok(None) => {
            warn!("[DeepLink] No active account for auth bridge");
            let _ = app_handle.emit("deep-link-auth-result", AuthBridgeResult {
                success: false,
                message: "not_logged_in".to_string(),
            });
            return;
        }
        Err(e) => {
            error!("[DeepLink] Failed to get active account: {}", e);
            let _ = app_handle.emit("deep-link-auth-result", AuthBridgeResult {
                success: false,
                message: "Failed to get account".to_string(),
            });
            return;
        }
    };

    // Emit confirmation request to the frontend
    info!(
        "[DeepLink] Emitting auth bridge confirmation request for user: {}",
        account.username
    );
    let _ = app_handle.emit(
        "deep-link-auth-request",
        AuthBridgeRequest {
            session_id: session_id.clone(),
            username: account.username.clone(),
        },
    );
}
