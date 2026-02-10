use crate::commands::oauth_error_html::ERROR_HTML;
use crate::commands::oauth_success_html::SUCCESS_HTML;
use crate::error::{AppError, CommandError};
use crate::minecraft::minecraft_auth::Credentials;
use crate::state::event_state::{EventPayload, EventType};
use crate::state::state_manager::State;
use crate::utils::referral_utils;
use crate::utils::updater_utils;
use chrono::{Duration, Utc};
use log::{error, info, warn};
use tauri::plugin::TauriPlugin;
use tauri::Manager;
use tauri::{Runtime, UserAttentionType};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

//TODO das wäre geiler aber habs noch nicht hinbekommen
//Error during login: minecraft_auth.begin_login not allowed. Plugin not found
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("minecraft_auth")
        .invoke_handler(tauri::generate_handler![
            begin_login,
            cancel_login,
            remove_account,
            get_active_account,
            set_active_account,
            get_accounts
        ])
        .build()
}

/// Begin the Minecraft login flow
/// Returns a URL that the user needs to visit to sign in
#[tauri::command]
pub async fn begin_login<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<Credentials>, CommandError> {
    let state = State::get().await?;
    let config = state.config_manager.get_config().await;
    let use_browser_based_login = updater_utils::is_flatpak() || config.use_browser_based_login;

    if use_browser_based_login {
        // Flatpak: Use external browser with local HTTP server
        info!("[Login] Using external browser flow (Flatpak detected)");

        // Find an available port (try 25585 first, then random)
        let port = find_available_port(25585).await.unwrap_or_else(|| {
            // Fallback to random port if 25585 is not available
            use rand::Rng;
            let mut rng = rand::thread_rng();
            rng.gen_range(25565..=25600)
        });

        let redirect_uri = format!("http://localhost:{}/callback", port);
        info!("[Login] Using redirect URI: {}", redirect_uri);

        // Use embedded HTML templates (works on all platforms including Flatpak)
        let success_html = SUCCESS_HTML.to_string();
        let error_html = ERROR_HTML.to_string();

        // Start the OAuth callback server
        let (server_handle, mut code_rx) = crate::minecraft::auth::minecraft_auth::start_oauth_callback_server(
            port,
            success_html,
            error_html,
        )
        .await
        .map_err(|e| CommandError::from(AppError::Other(format!("Failed to start OAuth server: {}", e))))?;

        // Store the server handle in state for cancellation
        {
            let mut handle_guard = state.login_server_handle.lock().await;
            *handle_guard = Some(server_handle);
        }

        // Emit login started event
        let login_event_id = Uuid::new_v4();
        state.emit_event(EventPayload {
            event_id: login_event_id,
            event_type: EventType::AccountLoginStarted,
            target_id: None,
            message: "Starting browser-based login process".to_string(),
            progress: Some(0.0),
            error: None,
        }).await?;

        // Start the direct OAuth2 flow (for localhost redirect)
        let flow = State::get()
            .await?
            .minecraft_account_manager_v2
            .login_begin_direct_oauth(&redirect_uri)
            .await?;

        // Emit waiting for browser event
        state.emit_event(EventPayload {
            event_id: login_event_id,
            event_type: EventType::AccountLoginWaitingForBrowser,
            target_id: None,
            message: "Opening browser window for authentication".to_string(),
            progress: Some(10.0),
            error: None,
        }).await?;

        // Open the browser with the authorization URL
        info!("[Login] Opening browser with URL: {}", flow.authorize_url);
        app.opener()
            .open_url(&flow.authorize_url, None::<&str>)
            .map_err(|e| CommandError::from(AppError::Other(format!("Failed to open browser: {}", e))))?;

        // Wait for the callback (with timeout)
        let start = Utc::now();
        let timeout = Duration::seconds(600); // 10 minutes

        loop {
            if (Utc::now() - start) >= timeout {
                info!("[Login] Timeout waiting for OAuth callback");
                // Abort server via state
                if let Some(handle) = state.login_server_handle.lock().await.take() {
                    handle.abort();
                }
                let error_msg = "Login timeout: No response from browser after 10 minutes".to_string();
                state.emit_event(EventPayload {
                    event_id: login_event_id,
                    event_type: EventType::Error,
                    target_id: None,
                    message: error_msg.clone(),
                    progress: None,
                    error: Some(error_msg),
                }).await?;
                return Ok(None);
            }

            // Check if we received the code
            match code_rx.try_recv() {
                Ok(Ok(code)) => {
                    info!("[Login] Received authorization code");
                    // Abort server via state
                    if let Some(handle) = state.login_server_handle.lock().await.take() {
                        handle.abort();
                    }
                    
                    // Emit exchanging token event
                    state.emit_event(EventPayload {
                        event_id: login_event_id,
                        event_type: EventType::AccountLoginExchangingToken,
                        target_id: None,
                        message: "Exchanging authorization code for access token".to_string(),
                        progress: Some(30.0),
                        error: None,
                    }).await?;
                    
                    // Complete the direct OAuth2 login flow with the code
                    match State::get()
                        .await?
                        .minecraft_account_manager_v2
                        .login_finish_direct_oauth_with_events(&code, flow, login_event_id)
                        .await
                    {
                        Ok(account) => {
                            // Emit completed event
                            state.emit_event(EventPayload {
                                event_id: login_event_id,
                                event_type: EventType::AccountLoginCompleted,
                                target_id: None,
                                message: format!("Login completed successfully for {}", account.username),
                                progress: Some(100.0),
                                error: None,
                            }).await?;

                            // Report referral code with account if available
                            if let Err(e) = referral_utils::report_referral_after_login(account.id).await {
                                warn!("[Login] Failed to report referral: {}", e);
                            }

                            return Ok(Some(account));
                        }
                        Err(e) => {
                            error!("[Login] Error during login flow: {:?}", e);
                            let error_msg = format!("Login failed: {}", e);
                            state.emit_event(EventPayload {
                                event_id: login_event_id,
                                event_type: EventType::Error,
                                target_id: None,
                                message: error_msg.clone(),
                                progress: None,
                                error: Some(error_msg),
                            }).await?;
                            return Err(CommandError::from(e));
                        }
                    }
                }
                Ok(Err(e)) => {
                    error!("[Login] OAuth callback error: {:?}", e);
                    // Abort server via state
                    if let Some(handle) = state.login_server_handle.lock().await.take() {
                        handle.abort();
                    }
                    let error_msg = format!("OAuth callback error: {}", e);
                    state.emit_event(EventPayload {
                        event_id: login_event_id,
                        event_type: EventType::Error,
                        target_id: None,
                        message: error_msg.clone(),
                        progress: None,
                        error: Some(error_msg),
                    }).await?;
                    return Err(CommandError::from(e));
                }
                Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {
                    // Still waiting, continue
                }
                Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                    error!("[Login] OAuth callback channel closed unexpectedly");
                    // Clear the server handle
                    {
                        let mut handle_guard = state.login_server_handle.lock().await;
                        *handle_guard = None;
                    }
                    let error_msg = "Login connection closed unexpectedly".to_string();
                    state.emit_event(EventPayload {
                        event_id: login_event_id,
                        event_type: EventType::Error,
                        target_id: None,
                        message: error_msg.clone(),
                        progress: None,
                        error: Some(error_msg),
                    }).await?;
                    return Ok(None);
                }
            }

            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    } else {
        // Non-Flatpak: Use Tauri webview window (existing behavior)
        info!("[Login] Using Tauri webview flow (non-Flatpak)");

        let flow = State::get()
            .await?
            .minecraft_account_manager_v2
            .login_begin(None)
            .await?;

        // Close any existing sign-in window
        if let Some(window) = app.get_webview_window("signin") {
            window.close().map_err(|e| AppError::Other(e.to_string()))?;
        }

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

        window
            .request_user_attention(Some(UserAttentionType::Critical))
            .map_err(|e| AppError::Other(e.to_string()))?;

        let start = Utc::now();

        // Wait for the user to complete the login (10 minutes = 600 seconds)
        while (Utc::now() - start) < Duration::seconds(600) {
            if window.title().is_err() {
                // User closed the window, cancelling flow
                window.close().map_err(|e| AppError::Other(e.to_string()))?;
                return Ok(None);
            }

            if let Ok(url) = window.url() {
                if url
                    .as_str()
                    .starts_with("https://login.live.com/oauth20_desktop.srf")
                {
                    if let Some((_, code)) = url.query_pairs().find(|x| x.0 == "code") {
                        window.close().map_err(|e| AppError::Other(e.to_string()))?;

                        // Complete the login flow with the code
                        let account = State::get()
                            .await?
                            .minecraft_account_manager_v2
                            .login_finish(&code, flow)
                            .await?;

                        // Report referral code with account if available
                        if let Err(e) = referral_utils::report_referral_after_login(account.id).await {
                            warn!("[Login] Failed to report referral: {}", e);
                        }

                        return Ok(Some(account));
                    }
                }
            }

            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }

        window.close().map_err(|e| AppError::Other(e.to_string()))?;
        Ok(None)
    }
}

/// Finds an available port starting from the given port number
async fn find_available_port(start_port: u16) -> Option<u16> {
    for port in start_port..=start_port + 100 {
        if tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port))
            .await
            .is_ok()
        {
            return Some(port);
        }
    }
    None
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

/// Cancel an ongoing browser-based login
#[tauri::command]
pub async fn cancel_login() -> Result<(), CommandError> {
    let state = State::get().await?;
    let mut handle_guard = state.login_server_handle.lock().await;
    
    if let Some(handle) = handle_guard.take() {
        info!("[Login] Cancelling browser-based login");
        handle.abort();
        Ok(())
    } else {
        Err(CommandError::from(AppError::Other("No active login to cancel".to_string())))
    }
}

/// Check if the application is running in a Flatpak environment
#[tauri::command]
pub fn is_flatpak() -> bool {
    updater_utils::is_flatpak()
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
