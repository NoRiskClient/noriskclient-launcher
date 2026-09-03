use chrono::{DateTime, Duration, Utc};
use log::{info, warn};
use serde::{Deserialize, Serialize};

use reqwest::StatusCode;

use crate::config::HTTP_CLIENT;
use crate::error::{AppError, Result};

pub const TWITCH_CLIENT_ID: &str = "p60nwofs8at0mc615hsbgxu7psdluk";

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

const REFRESH_SKEW: Duration = Duration::hours(2);

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TwitchToken {
    pub access_token: String,
    pub refresh_token: String,
    pub expires: DateTime<Utc>,
    #[serde(default)]
    pub scopes: Vec<String>,
}

impl TwitchToken {
    pub fn needs_refresh(&self) -> bool {
        self.expires <= Utc::now() + REFRESH_SKEW
    }

    pub fn is_expired(&self) -> bool {
        self.expires <= Utc::now()
    }
}

#[derive(Deserialize, Debug, Clone)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: i64,
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

pub enum RefreshOutcome {
    Refreshed(Box<TwitchToken>),
    Rejected(String),
    Transient(String),
}

pub async fn refresh_token(refresh_token: &str) -> RefreshOutcome {
    info!("[Twitch] Refreshing access token");

    let response = match HTTP_CLIENT
        .post(TOKEN_URL)
        .form(&[
            ("client_id", TWITCH_CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => return RefreshOutcome::Transient(format!("Twitch refresh request failed: {}", e)),
    };

    let status = response.status();
    let body = match response.text().await {
        Ok(body) => body,
        Err(e) => return RefreshOutcome::Transient(format!("Twitch refresh read failed: {}", e)),
    };

    if !status.is_success() {
        let message = error_message(&body);
        let rejected = is_terminal_refresh_failure(status, &message);

        let detail = format!("Twitch refresh rejected ({}): {}", status, message);
        return if rejected {
            warn!("[Twitch] {}", detail);
            RefreshOutcome::Rejected(detail)
        } else {
            warn!("[Twitch] {} (treating as transient)", detail);
            RefreshOutcome::Transient(detail)
        };
    }

    let parsed: TokenResponse = match serde_json::from_str(&body) {
        Ok(parsed) => parsed,
        Err(e) => {
            return RefreshOutcome::Transient(format!("Invalid Twitch refresh response: {}", e))
        }
    };

    let mut token = token_from_response(parsed);
    if token.refresh_token.is_empty() {
        token.refresh_token = refresh_token.to_string();
    }
    RefreshOutcome::Refreshed(Box::new(token))
}

fn is_terminal_refresh_failure(status: StatusCode, message: &str) -> bool {
    if !status.is_client_error() || status == StatusCode::TOO_MANY_REQUESTS {
        return false;
    }

    let lowered = message.to_lowercase();
    lowered.contains("invalid refresh token")
        || lowered.contains("invalid_grant")
        || lowered.contains("invalid client")
        || lowered.contains("invalid_client")
}

fn error_message(body: &str) -> String {
    serde_json::from_str::<TwitchErrorResponse>(body)
        .ok()
        .map(|e| e.message)
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| body.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_refresh_token_is_terminal() {
        assert!(is_terminal_refresh_failure(
            StatusCode::BAD_REQUEST,
            "Invalid refresh token"
        ));
    }

    #[test]
    fn rate_limit_is_not_terminal() {
        assert!(!is_terminal_refresh_failure(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many requests"
        ));
    }

    #[test]
    fn server_error_is_not_terminal() {
        assert!(!is_terminal_refresh_failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Internal server error"
        ));
        assert!(!is_terminal_refresh_failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Service unavailable"
        ));
    }

    #[test]
    fn unrecognised_client_error_is_not_terminal() {
        assert!(!is_terminal_refresh_failure(
            StatusCode::BAD_REQUEST,
            "Something we have never seen before"
        ));
    }

    #[test]
    fn needs_refresh_fires_before_actual_expiry() {
        let token = TwitchToken {
            access_token: "a".to_string(),
            refresh_token: "r".to_string(),
            expires: Utc::now() + Duration::minutes(30),
            scopes: Vec::new(),
        };
        assert!(token.needs_refresh());
        assert!(!token.is_expired());
    }

    #[test]
    fn expired_token_reports_both() {
        let token = TwitchToken {
            access_token: "a".to_string(),
            refresh_token: "r".to_string(),
            expires: Utc::now() - Duration::minutes(1),
            scopes: Vec::new(),
        };
        assert!(token.needs_refresh());
        assert!(token.is_expired());
    }
}
