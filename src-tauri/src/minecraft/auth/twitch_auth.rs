use chrono::{DateTime, Duration, Utc};
use log::{info, warn};
use serde::{Deserialize, Serialize};

use crate::config::HTTP_CLIENT;
use crate::error::{AppError, Result};

/// Twitch public client id. Device Code Grant is a public-client flow, so no secret is required.
pub const TWITCH_CLIENT_ID: &str = "p60nwofs8at0mc615hsbgxu7psdluk";

/// Scopes requested for the in-game Twitch integration (drops/chat identity).
pub const TWITCH_SCOPES: &'static [&'static str] = &[
    "user:read:chat",
    "user:write:chat",
    "user:edit:follows",
    "moderator:read:followers",
    "channel:read:subscriptions",
    "bits:read",
    "channel:read:redemptions",
];

const DEVICE_CODE_URL: &str = "https://id.twitch.tv/oauth2/device";
const TOKEN_URL: &str = "https://id.twitch.tv/oauth2/token";

/// Refresh once the token is within this window of expiring.
const REFRESH_SKEW: Duration = Duration::hours(2);

/// Persisted Twitch credential attached to a launcher account in `accounts.json`.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TwitchToken {
    pub access_token: String,
    pub refresh_token: String,
    pub expires: DateTime<Utc>,
    #[serde(default)]
    pub scopes: Vec<String>,
}

impl TwitchToken {
    pub fn is_expired(&self) -> bool {
        self.expires <= Utc::now() + REFRESH_SKEW
    }
}

/// Response of the device authorization request.
#[derive(Deserialize, Debug, Clone)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: i64,
    /// Twitch omits this occasionally; callers fall back to 5s.
    #[serde(default)]
    pub interval: Option<i64>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    expires_in: i64,
    #[serde(default)]
    scope: Vec<String>,
}

#[derive(Deserialize)]
struct TwitchErrorResponse {
    #[serde(default)]
    message: String,
}

/// Outcome of a single token poll while the user is still authorizing.
pub enum PollOutcome {
    Pending,
    SlowDown,
    Token(TwitchToken),
}

fn token_from_response(res: TokenResponse) -> TwitchToken {
    TwitchToken {
        access_token: res.access_token,
        refresh_token: res.refresh_token,
        expires: Utc::now() + Duration::seconds(res.expires_in),
        scopes: res.scope,
    }
}

/// Step 1 of the device code grant: ask Twitch for a user code the player types on twitch.tv.
pub async fn request_device_code() -> Result<DeviceCodeResponse> {
    let response = HTTP_CLIENT
        .post(DEVICE_CODE_URL)
        .form(&[("client_id", TWITCH_CLIENT_ID), ("scopes", TWITCH_SCOPES.join(" ").as_str())])
        .send()
        .await
        .map_err(|e| AppError::RequestError(format!("Twitch device code request failed: {}", e)))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| AppError::RequestError(format!("Twitch device code read failed: {}", e)))?;

    if !status.is_success() {
        return Err(AppError::Other(format!(
            "Twitch device code request rejected ({}): {}",
            status,
            error_message(&body)
        )));
    }

    serde_json::from_str(&body)
        .map_err(|e| AppError::Other(format!("Invalid Twitch device code response: {}", e)))
}

/// Step 2: exchange the device code for a token. Returns `Pending` while the user has not
/// confirmed yet, so the caller can keep polling on the server-provided interval.
pub async fn poll_device_token(device_code: &str) -> Result<PollOutcome> {
    let response = HTTP_CLIENT
        .post(TOKEN_URL)
        .form(&[
            ("client_id", TWITCH_CLIENT_ID),
            ("device_code", device_code),
            ("scopes", TWITCH_SCOPES.join(" ").as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| AppError::RequestError(format!("Twitch token poll failed: {}", e)))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| AppError::RequestError(format!("Twitch token poll read failed: {}", e)))?;

    if status.is_success() {
        let parsed: TokenResponse = serde_json::from_str(&body)
            .map_err(|e| AppError::Other(format!("Invalid Twitch token response: {}", e)))?;
        return Ok(PollOutcome::Token(token_from_response(parsed)));
    }

    let message = error_message(&body).to_lowercase();
    if message.contains("authorization_pending") {
        return Ok(PollOutcome::Pending);
    }
    if message.contains("slow_down") {
        return Ok(PollOutcome::SlowDown);
    }
    if message.contains("expired") {
        return Err(AppError::Other(
            "The Twitch code expired. Please start the linking process again.".to_string(),
        ));
    }
    if message.contains("denied") {
        return Err(AppError::Other(
            "Twitch authorization was denied.".to_string(),
        ));
    }

    Err(AppError::Other(format!(
        "Twitch token request failed ({}): {}",
        status,
        error_message(&body)
    )))
}

/// Exchange a refresh token for a fresh access token.
pub async fn refresh_token(refresh_token: &str) -> Result<TwitchToken> {
    info!("[Twitch] Refreshing access token");

    let response = HTTP_CLIENT
        .post(TOKEN_URL)
        .form(&[
            ("client_id", TWITCH_CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|e| AppError::RequestError(format!("Twitch token refresh failed: {}", e)))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| AppError::RequestError(format!("Twitch refresh read failed: {}", e)))?;

    if !status.is_success() {
        warn!("[Twitch] Refresh rejected with status {}", status);
        return Err(AppError::Other(format!(
            "Twitch token refresh rejected ({}): {}",
            status,
            error_message(&body)
        )));
    }

    let parsed: TokenResponse = serde_json::from_str(&body)
        .map_err(|e| AppError::Other(format!("Invalid Twitch refresh response: {}", e)))?;

    let mut token = token_from_response(parsed);
    // Twitch may omit the refresh token on rotation-free responses — keep the existing one.
    if token.refresh_token.is_empty() {
        token.refresh_token = refresh_token.to_string();
    }
    Ok(token)
}

fn error_message(body: &str) -> String {
    serde_json::from_str::<TwitchErrorResponse>(body)
        .ok()
        .map(|e| e.message)
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| body.to_string())
}
