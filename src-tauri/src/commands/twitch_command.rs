use std::time::Duration;

use chrono::Utc;
use log::{error, info, warn};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::error::{AppError, CommandError};
use crate::minecraft::auth::twitch_auth::{self, DeviceCodeResponse, PollOutcome, TwitchToken};
use crate::state::state_manager::State;

pub const TWITCH_LOGIN_EVENT: &str = "twitch:device_login";

const DEFAULT_POLL_INTERVAL_SECS: i64 = 5;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TwitchLoginStage {
    #[default]
    Starting,
    AwaitingUser,
    Completed,
    Cancelled,
    Expired,
    Failed,
}

#[derive(Serialize, Clone, Default)]
pub struct TwitchLoginPayload {
    pub stage: TwitchLoginStage,
    pub user_code: Option<String>,
    pub verification_uri: Option<String>,
    pub progress: Option<f64>,
    pub expires_in: Option<i64>,
    pub error: Option<String>,
}

static ACTIVE_LOGIN: Mutex<Option<JoinHandle<()>>> = Mutex::const_new(None);

fn emit(app: &AppHandle, payload: TwitchLoginPayload) {
    if let Err(e) = app.emit(TWITCH_LOGIN_EVENT, payload) {
        warn!("[Twitch] Failed to emit login event: {}", e);
    }
}

fn emit_failure(app: &AppHandle, error: impl ToString) {
    emit(
        app,
        TwitchLoginPayload {
            stage: TwitchLoginStage::Failed,
            error: Some(error.to_string()),
            ..Default::default()
        },
    );
}

fn emit_awaiting(app: &AppHandle, device: &DeviceCodeResponse, remaining: i64) {
    let total = device.expires_in.max(1);
    let elapsed = (total - remaining) as f64 / total as f64 * 100.0;
    emit(
        app,
        TwitchLoginPayload {
            stage: TwitchLoginStage::AwaitingUser,
            user_code: Some(device.user_code.clone()),
            verification_uri: Some(device.verification_uri.clone()),
            progress: Some(elapsed.clamp(0.0, 100.0)),
            expires_in: Some(remaining),
            ..Default::default()
        },
    );
}

async fn stop_active_login() {
    if let Some(handle) = ACTIVE_LOGIN.lock().await.take() {
        handle.abort();
    }
}

async fn active_account_id() -> Result<Uuid, AppError> {
    State::get()
        .await?
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .map(|account| account.id)
        .ok_or_else(|| AppError::AccountError("No active account to link Twitch to.".to_string()))
}

#[tauri::command]
pub fn twitch_available_scopes() -> Vec<&'static str> {
    twitch_auth::TWITCH_SCOPES.to_vec()
}

#[tauri::command]
pub async fn twitch_begin_device_login(
    app: AppHandle,
    scopes: Vec<String>,
) -> Result<(), CommandError> {
    info!("[Twitch] Starting device code login");
    stop_active_login().await;

    let account_id = active_account_id().await?;
    let scopes = twitch_auth::requested_scopes(&scopes)?;
    let device = twitch_auth::request_device_code(&scopes)
        .await
        .inspect_err(|e| emit_failure(&app, e))?;
    emit_awaiting(&app, &device, device.expires_in);

    let handle = tokio::spawn(async move {
        match poll_until_linked(&app, &device, &scopes).await {
            Ok(Some(token)) => complete_login(&app, account_id, token).await,
            Ok(None) => emit(
                &app,
                TwitchLoginPayload {
                    stage: TwitchLoginStage::Expired,
                    ..Default::default()
                },
            ),
            Err(e) => {
                error!("[Twitch] Device flow failed: {}", e);
                emit_failure(&app, e);
            }
        }
    });
    *ACTIVE_LOGIN.lock().await = Some(handle);
    Ok(())
}

async fn poll_until_linked(
    app: &AppHandle,
    device: &DeviceCodeResponse,
    scopes: &str,
) -> Result<Option<TwitchToken>, AppError> {
    let deadline = Utc::now() + chrono::Duration::seconds(device.expires_in);
    let mut interval = device.interval.unwrap_or(DEFAULT_POLL_INTERVAL_SECS).max(1);

    loop {
        tokio::time::sleep(Duration::from_secs(interval as u64)).await;
        let remaining = (deadline - Utc::now()).num_seconds();
        if remaining <= 0 {
            return Ok(None);
        }
        match twitch_auth::poll_device_token(&device.device_code, scopes).await? {
            PollOutcome::Token(token) => return Ok(Some(token)),
            PollOutcome::SlowDown => interval += 1,
            PollOutcome::Pending => emit_awaiting(app, device, remaining),
        }
    }
}

async fn complete_login(app: &AppHandle, account_id: Uuid, token: TwitchToken) {
    let persisted = match State::get().await {
        Ok(state) => {
            state
                .minecraft_account_manager_v2
                .set_twitch_token(account_id, Some(token))
                .await
        }
        Err(e) => Err(e),
    };
    match persisted {
        Ok(()) => {
            info!("[Twitch] Linked account {}", account_id);
            emit(
                app,
                TwitchLoginPayload {
                    stage: TwitchLoginStage::Completed,
                    progress: Some(100.0),
                    ..Default::default()
                },
            );
        }
        Err(e) => {
            error!("[Twitch] Failed to persist token: {}", e);
            emit_failure(app, e);
        }
    }
}

#[tauri::command]
pub async fn twitch_cancel_login(app: AppHandle) -> Result<(), CommandError> {
    stop_active_login().await;
    info!("[Twitch] Device code login cancelled");
    emit(
        &app,
        TwitchLoginPayload {
            stage: TwitchLoginStage::Cancelled,
            ..Default::default()
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn twitch_unlink() -> Result<(), CommandError> {
    stop_active_login().await;

    let account_id = active_account_id().await?;
    let state = State::get().await?;
    let accounts = &state.minecraft_account_manager_v2;
    let previous = accounts
        .get_account_by_id(account_id)
        .await?
        .and_then(|account| account.twitch_token);
    accounts.set_twitch_token(account_id, None).await?;
    info!("[Twitch] Unlinked account {}", account_id);

    if let Some(token) = previous {
        tokio::spawn(async move { twitch_auth::revoke(&token.access_token).await });
    }
    Ok(())
}

#[tauri::command]
pub async fn twitch_is_linked() -> Result<bool, CommandError> {
    Ok(State::get()
        .await?
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .is_some_and(|account| account.twitch_token.is_some()))
}
