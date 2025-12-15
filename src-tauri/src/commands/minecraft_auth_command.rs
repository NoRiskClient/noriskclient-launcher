use crate::error::{AppError, CommandError};
use crate::minecraft::minecraft_auth::Credentials;
use crate::state::state_manager::State;
use chrono::{Duration, Utc};
use tauri::plugin::TauriPlugin;
use tauri::{Manager, WindowEvent};
use tauri::{Runtime, UserAttentionType};
use uuid::Uuid;
use tokio::sync::oneshot;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

//TODO das wäre geiler aber habs noch nicht hinbekommen
//Error during login: minecraft_auth.begin_login not allowed. Plugin not found
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("minecraft_auth")
        .invoke_handler(tauri::generate_handler![
            begin_login,
            remove_account,
            get_active_account,
            set_active_account,
            get_accounts,
        ])
        .build()
}

fn extract_code(u: &url::Url) -> Option<String> {
    let is_callback = u.as_str().starts_with("https://login.live.com/oauth20_desktop.srf");
    if !is_callback {
        return None;
    }

    u.query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.into_owned())
}

/// Begin the Minecraft login flow
/// Returns Some(Credentials) if login was successful, None if cancelled or timed out
#[tauri::command]
pub async fn begin_login<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<Credentials>, CommandError> {
    let flow = State::get()
        .await?
        .minecraft_account_manager_v2
        .login_begin()
        .await?;

    // Close any existing sign-in window
    if let Some(window) = app.get_webview_window("signin") {
        window.close().map_err(|e| AppError::Other(e.to_string()))?;
    }

    // We can try creating a fancy oneshot cancellation system, but I was too stupid to get it working. 50ms polling is fine ig
    // https://gist.github.com/brentspine/c6335b53b529edba94755d8e9947e43c
    // Oneshot->Send Once; Mutex->Safe sharing; Arc->Multiple ownership
    // let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    // let cancel_tx = Arc::new(Mutex::new(Some(cancel_tx)));

    // Create a new window for the sign-in process
    let window =
        tauri::WebviewWindowBuilder::new(
            &app,
            "signin",
            tauri::WebviewUrl::External(flow.redirect_uri.parse().map_err(|_| {
                AppError::AccountError("Error parsing auth redirect URL".to_string())
            })?),
        )
            .title("Sign into Minecraft")
            .always_on_top(true)
            .center()
            .build()
            .map_err(|e| AppError::Other(e.to_string()))?;

    let cancelled = Arc::new(AtomicBool::new(false));
    let cancelled2 = Arc::clone(&cancelled);

    window.on_window_event(move |e| {
        let is_close =
            matches!(e, WindowEvent::CloseRequested { .. }) ||
                matches!(e, WindowEvent::Destroyed);

        if is_close {
            cancelled2.store(true, Ordering::Relaxed);
        }
    });

    window
        .request_user_attention(Some(UserAttentionType::Critical))
        .map_err(|e| AppError::Other(e.to_string()))?;

    let start = Utc::now();

    while (Utc::now() - start) < Duration::seconds(600) {
        if cancelled.load(Ordering::Relaxed) {
            return Ok(None);
        }

        let url = window.url().ok();
        let code = url.as_ref().and_then(extract_code);

        if let Some(code) = code {
            let _ = window.close();
            let account = State::get()
                .await?
                .minecraft_account_manager_v2
                .login_finish(&code, flow)
                .await?;

            return Ok(Some(account));
        }

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let _ = window.close();
    Ok(None)
}

/// Remove a Minecraft account
#[tauri::command]
pub async fn remove_account(account_id: Uuid) -> Result<(), CommandError> {
    let state = State::get().await?;
    state
        .minecraft_account_manager_v2
        .remove_account(account_id)
        .await?;
    Ok(())
}

/// Get the currently active Minecraft account
#[tauri::command]
pub async fn get_active_account() -> Result<Option<Credentials>, CommandError> {
    let state = State::get().await?;
    let account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?;
    Ok(account)
}

/// Set the active Minecraft account
#[tauri::command]
pub async fn set_active_account(account_id: Uuid) -> Result<(), CommandError> {
    let state = State::get().await?;
    state
        .minecraft_account_manager_v2
        .set_active_account(account_id)
        .await?;
    Ok(())
}

/// Get all Minecraft accounts
#[tauri::command]
pub async fn get_accounts() -> Result<Vec<Credentials>, CommandError> {
    let state = State::get().await?;
    let accounts = state
        .minecraft_account_manager_v2
        .get_all_accounts()
        .await?;
    Ok(accounts)
}
