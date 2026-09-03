use std::time::Duration;

use chrono::{DateTime, Utc};
use log::{error, info, warn};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::error::{AppError, CommandError};
use crate::minecraft::auth::twitch_auth::{self, PollOutcome};
use crate::state::state_manager::State;

pub const TWITCH_LOGIN_EVENT: &str = "twitch:device_login";

const DEFAULT_POLL_INTERVAL_SECS: i64 = 5;

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TwitchLoginStage {
    Starting,
    AwaitingUser,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Serialize, Clone)]
pub struct TwitchLoginPayload {
    pub stage: TwitchLoginStage,
    pub message: String,
    pub user_code: Option<String>,
    pub verification_uri: Option<String>,
    pub progress: Option<f64>,
    pub expires_in: Option<i64>,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct TwitchStatus {
    pub linked: bool,
    pub expires: Option<DateTime<Utc>>,
    pub scopes: Vec<String>,
}

static ACTIVE_LOGIN: Mutex<Option<JoinHandle<()>>> = Mutex::const_new(None);

fn emit(app: &AppHandle, payload: TwitchLoginPayload) {
    if let Err(e) = app.emit(TWITCH_LOGIN_EVENT, payload) {
        warn!("[Twitch] Failed to emit login event: {}", e);
    }
}

async fn active_account_id() -> Result<Uuid, AppError> {
    let state = State::get().await?;
    state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .map(|account| account.id)
        .ok_or_else(|| AppError::AccountError("No active account to link Twitch to.".to_string()))
}

#[derive(Serialize, Clone)]
pub struct TwitchDeviceLogin {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: i64,
}

#[tauri::command]
pub async fn twitch_begin_device_login(app: AppHandle) -> Result<TwitchDeviceLogin, CommandError> {
    begin_device_login(app).await
}

async fn begin_device_login(app: AppHandle) -> Result<TwitchDeviceLogin, CommandError> {
    info!("[Twitch] Starting device code login");

    if let Some(handle) = ACTIVE_LOGIN.lock().await.take() {
        handle.abort();
    }

    emit(
        &app,
        TwitchLoginPayload {
            stage: TwitchLoginStage::Starting,
            message: "Requesting a Twitch device code".to_string(),
            user_code: None,
            verification_uri: None,
            progress: Some(0.0),
            expires_in: None,
            error: None,
        },
    );

    let account_id = active_account_id().await?;
    let device = twitch_auth::request_device_code().await.map_err(|e| {
        emit(
            &app,
            TwitchLoginPayload {
                stage: TwitchLoginStage::Failed,
                message: "Could not start Twitch linking".to_string(),
                user_code: None,
                verification_uri: None,
                progress: None,
                expires_in: None,
                error: Some(e.to_string()),
            },
        );
        CommandError::from(e)
    })?;

    let interval = device.interval.unwrap_or(DEFAULT_POLL_INTERVAL_SECS).max(1);
    let user_code = device.user_code.clone();
    let verification_uri = device.verification_uri.clone();
    let total_secs = device.expires_in.max(1);

    emit(
        &app,
        TwitchLoginPayload {
            stage: TwitchLoginStage::AwaitingUser,
            message: "Enter the code on Twitch to finish linking".to_string(),
            user_code: Some(user_code.clone()),
            verification_uri: Some(verification_uri.clone()),
            progress: Some(0.0),
            expires_in: Some(total_secs),
            error: None,
        },
    );

    let poll_user_code = user_code.clone();
    let poll_verification_uri = verification_uri.clone();
    let handle = tokio::spawn(async move {
        let deadline = Utc::now() + chrono::Duration::seconds(total_secs);
        let mut poll_interval = interval;

        loop {
            tokio::time::sleep(Duration::from_secs(poll_interval as u64)).await;

            let remaining = (deadline - Utc::now()).num_seconds();
            if remaining <= 0 {
                emit(
                    &app,
                    TwitchLoginPayload {
                        stage: TwitchLoginStage::Failed,
                        message: "The Twitch code expired".to_string(),
                        user_code: Some(poll_user_code.clone()),
                        verification_uri: Some(poll_verification_uri.clone()),
                        progress: Some(100.0),
                        expires_in: Some(0),
                        error: Some("The Twitch code expired. Please try again.".to_string()),
                    },
                );
                return;
            }

            let progress =
                ((total_secs - remaining) as f64 / total_secs as f64 * 100.0).clamp(0.0, 100.0);

            match twitch_auth::poll_device_token(&device.device_code).await {
                Ok(PollOutcome::Token(token)) => {
                    let persisted = async {
                        let state = State::get().await?;
                        state
                            .minecraft_account_manager_v2
                            .set_twitch_token(account_id, Some(token))
                            .await
                    }
                    .await;

                    match persisted {
                        Ok(()) => {
                            info!("[Twitch] Linked account {}", account_id);
                            emit(
                                &app,
                                TwitchLoginPayload {
                                    stage: TwitchLoginStage::Completed,
                                    message: "Twitch account linked".to_string(),
                                    user_code: None,
                                    verification_uri: None,
                                    progress: Some(100.0),
                                    expires_in: None,
                                    error: None,
                                },
                            );
                        }
                        Err(e) => {
                            error!("[Twitch] Failed to persist token: {}", e);
                            emit(
                                &app,
                                TwitchLoginPayload {
                                    stage: TwitchLoginStage::Failed,
                                    message: "Could not save the Twitch token".to_string(),
                                    user_code: None,
                                    verification_uri: None,
                                    progress: None,
                                    expires_in: None,
                                    error: Some(e.to_string()),
                                },
                            );
                        }
                    }
                    return;
                }
                Ok(PollOutcome::SlowDown) => {
                    poll_interval += 1;
                }
                Ok(PollOutcome::Pending) => {
                    emit(
                        &app,
                        TwitchLoginPayload {
                            stage: TwitchLoginStage::AwaitingUser,
                            message: "Waiting for confirmation on Twitch".to_string(),
                            user_code: Some(poll_user_code.clone()),
                            verification_uri: Some(poll_verification_uri.clone()),
                            progress: Some(progress),
                            expires_in: Some(remaining),
                            error: None,
                        },
                    );
                }
                Err(e) => {
                    error!("[Twitch] Device flow failed: {}", e);
                    emit(
                        &app,
                        TwitchLoginPayload {
                            stage: TwitchLoginStage::Failed,
                            message: "Twitch linking failed".to_string(),
                            user_code: None,
                            verification_uri: None,
                            progress: None,
                            expires_in: None,
                            error: Some(e.to_string()),
                        },
                    );
                    return;
                }
            }
        }
    });

    *ACTIVE_LOGIN.lock().await = Some(handle);
    Ok(TwitchDeviceLogin {
        user_code,
        verification_uri,
        expires_in: total_secs,
    })
}

#[tauri::command]
pub async fn twitch_cancel_login(app: AppHandle) -> Result<(), CommandError> {
    if let Some(handle) = ACTIVE_LOGIN.lock().await.take() {
        handle.abort();
        info!("[Twitch] Device code login cancelled");
    }

    emit(
        &app,
        TwitchLoginPayload {
            stage: TwitchLoginStage::Cancelled,
            message: "Twitch linking cancelled".to_string(),
            user_code: None,
            verification_uri: None,
            progress: None,
            expires_in: None,
            error: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn twitch_unlink() -> Result<(), CommandError> {
    if let Some(handle) = ACTIVE_LOGIN.lock().await.take() {
        handle.abort();
    }

    let account_id = active_account_id().await?;
    let state = State::get().await?;
    state
        .minecraft_account_manager_v2
        .set_twitch_token(account_id, None)
        .await?;

    info!("[Twitch] Unlinked account {}", account_id);
    Ok(())
}

#[tauri::command]
pub async fn twitch_get_status() -> Result<TwitchStatus, CommandError> {
    let state = State::get().await?;
    let token = match state.minecraft_account_manager_v2.get_active_account().await? {
        Some(account) => account.twitch_token,
        None => None,
    };

    Ok(match token {
        Some(token) => TwitchStatus {
            linked: true,
            expires: Some(token.expires),
            scopes: token.scopes,
        },
        None => TwitchStatus {
            linked: false,
            expires: None,
            scopes: Vec::new(),
        },
    })
}
