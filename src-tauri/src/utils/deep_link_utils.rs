use crate::state::state_manager::State;
use log::{error, info, warn};
use serde::Serialize;
use std::sync::Mutex;
use crate::utils::window_focus::bring_to_front;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use url::Url;

pub const MAIN_WINDOW_LABEL: &str = "main";

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
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportDeepLinkRequest {
    pub code: String,
}

pub const SUPPORT_REQUEST_EVENT: &str = "deep-link-support-request";

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PendingDeepLinkEvent {
    pub event: String,
    pub payload: serde_json::Value,
}

#[derive(Default)]
struct PendingDeepLinksInner {
    frontend_ready: bool,
    events: Vec<PendingDeepLinkEvent>,
}

#[derive(Default)]
pub struct PendingDeepLinks {
    inner: Mutex<PendingDeepLinksInner>,
}

impl PendingDeepLinks {
    pub fn take(&self) -> Vec<PendingDeepLinkEvent> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.frontend_ready = true;
        std::mem::take(&mut guard.events)
    }

    pub fn queue_if_not_ready(&self, event: &str, payload: serde_json::Value) -> bool {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if guard.frontend_ready {
            return false;
        }
        guard.events.retain(|e| e.event != event);
        guard.events.push(PendingDeepLinkEvent {
            event: event.to_string(),
            payload,
        });
        true
    }
}

fn deliver<S: Serialize + Clone>(app_handle: &AppHandle, event: &str, payload: S) {
    if let Some(pending) = app_handle.try_state::<PendingDeepLinks>() {
        match serde_json::to_value(&payload) {
            Ok(value) => {
                if pending.queue_if_not_ready(event, value) {
                    info!("[DeepLink] Frontend not ready yet, queued '{}'", event);
                    return;
                }
            }
            Err(e) => warn!("[DeepLink] Could not serialize '{}' payload: {}", event, e),
        }
    }
    if let Err(e) = app_handle.emit(event, payload) {
        warn!("[DeepLink] Failed to emit '{}': {}", event, e);
    }
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
            Some("support") => {
                if url.path() == "/request" {
                    handle_support_request(app_handle, &url);
                } else {
                    warn!("[DeepLink] Unknown support path: {}", url.path());
                }
            }
            Some(host) => {
                warn!("[DeepLink] Unknown deep link host: {}", host);
            }
            None => {
                warn!(
                    "[DeepLink] Deep link URL has no host (scheme {}, path {})",
                    url.scheme(),
                    url.path()
                );
            }
        }
    }
}

fn handle_support_request(app_handle: &AppHandle, url: &Url) {
    let raw_code = url
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.to_string());

    let Some(code) = raw_code.as_deref().and_then(crate::support::normalize_code) else {
        warn!("[DeepLink] Support request link with missing or invalid code ignored");
        return;
    };

    info!("[DeepLink] Support request received");
    focus_main_window(app_handle);
    deliver(app_handle, SUPPORT_REQUEST_EVENT, SupportDeepLinkRequest { code });
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
    focus_main_window(app_handle);
    info!("[DeepLink] Twitch {} request received", action);
    deliver(
        app_handle,
        "deep-link-twitch-request",
        TwitchDeepLinkRequest {
            action: action.to_string(),
        },
    );
}

pub fn is_deep_link_launch(argv: &[String]) -> bool {
    argv.iter()
        .skip(1)
        .any(|arg| url::Url::parse(arg).is_ok_and(|u| u.scheme() == "norisk"))
}

pub fn is_main_window(window: &WebviewWindow) -> bool {
    window.label() == MAIN_WINDOW_LABEL
}

fn focus_main_window(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    if let Err(error) = bring_to_front(&window) {
        warn!("[DeepLink] Could not focus main window: {}", error);
    }
}

/// Handles `norisk://auth/bridge?sessionId=xxx` deep links.
/// Emits a confirmation request to the frontend before proceeding.
async fn handle_auth_bridge(app_handle: &AppHandle, url: &Url) {
    focus_main_window(app_handle);

    let session_id = match url
        .query_pairs()
        .find(|(key, _)| key == "sessionId")
        .map(|(_, value)| value.to_string())
    {
        Some(id) if !id.is_empty() => id,
        _ => {
            error!("[DeepLink] Auth bridge URL missing sessionId parameter");
            deliver(app_handle, "deep-link-auth-result", AuthBridgeResult {
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
            deliver(app_handle, "deep-link-auth-result", AuthBridgeResult {
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
            deliver(app_handle, "deep-link-auth-result", AuthBridgeResult {
                success: false,
                message: "not_logged_in".to_string(),
            });
            return;
        }
        Err(e) => {
            error!("[DeepLink] Failed to get active account: {}", e);
            deliver(app_handle, "deep-link-auth-result", AuthBridgeResult {
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
    deliver(
        app_handle,
        "deep-link-auth-request",
        AuthBridgeRequest {
            session_id: session_id.clone(),
            username: account.username.clone(),
        },
    );
}
