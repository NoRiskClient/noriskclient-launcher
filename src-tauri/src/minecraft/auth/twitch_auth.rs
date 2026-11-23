use chrono::{DateTime, Duration, Utc};
use log::{info, warn};
use serde::{Deserialize, Serialize};

use reqwest::StatusCode;

use crate::config::HTTP_CLIENT;
use crate::error::{AppError, Result};

pub const TWITCH_CLIENT_ID: &str = "ea4f0mik4kzwc8e2r42aqj0h4kbnb1";

pub const TWITCH_SCOPES: &[&str] = &[
    "user:read:follows",
    "user:write:chat",
    "moderator:read:followers",
    "channel:read:subscriptions",
    "bits:read",
    "channel:read:redemptions",
    "channel:read:goals",
];

const DEVICE_CODE_URL: &str = "https://id.twitch.tv/oauth2/device";
const TOKEN_URL: &str = "https://id.twitch.tv/oauth2/token";
const REVOKE_URL: &str = "https://id.twitch.tv/oauth2/revoke";

const REFRESH_SKEW: Duration = Duration::minutes(15);

const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

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

pub fn requested_scopes(selected: &[String]) -> Result<String> {
    if let Some(unknown) = selected.iter().find(|scope| !TWITCH_SCOPES.contains(&scope.as_str())) {
        return Err(AppError::Other(format!("Unsupported Twitch scope: {}", unknown)));
    }
    Ok(TWITCH_SCOPES
        .iter()
        .filter(|scope| selected.iter().any(|chosen| chosen == *scope))
        .copied()
        .collect::<Vec<_>>()
        .join(" "))
}

pub async fn request_device_code(scopes: &str) -> Result<DeviceCodeResponse> {
    let response = HTTP_CLIENT
        .post(DEVICE_CODE_URL)
        .form(&[("client_id", TWITCH_CLIENT_ID), ("scopes", scopes)])
        .timeout(REQUEST_TIMEOUT)
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

pub async fn poll_device_token(device_code: &str, scopes: &str) -> Result<PollOutcome> {
    let response = HTTP_CLIENT
        .post(TOKEN_URL)
        .form(&[
            ("client_id", TWITCH_CLIENT_ID),
            ("device_code", device_code),
            ("scopes", scopes),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await;
    let response = match response {
        Ok(response) => response,
        Err(e) => return Ok(retry(format!("token poll failed: {}", e))),
    };
    let status = response.status();
    let body = match response.text().await {
        Ok(body) => body,
        Err(e) => return Ok(retry(format!("token poll read failed: {}", e))),
    };

    if status.is_success() {
        let parsed: TokenResponse = serde_json::from_str(&body)
            .map_err(|e| AppError::Other(format!("Invalid Twitch token response: {}", e)))?;
        return Ok(PollOutcome::Token(token_from_response(parsed)));
    }
    if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS {
        return Ok(retry(format!("token poll answered {}", status)));
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
        return Err(AppError::Other("Twitch authorization was denied.".to_string()));
    }

    Err(AppError::Other(format!(
        "Twitch token request failed ({}): {}",
        status,
        error_message(&body)
    )))
}

fn retry(reason: String) -> PollOutcome {
    warn!("[Twitch] {}, polling again", reason);
    PollOutcome::Pending
}

pub async fn revoke(access_token: &str) {
    let result = HTTP_CLIENT
        .post(REVOKE_URL)
        .form(&[("client_id", TWITCH_CLIENT_ID), ("token", access_token)])
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await;
    match result {
        Ok(response) if response.status().is_success() => info!("[Twitch] Revoked unlinked token"),
        Ok(response) => warn!("[Twitch] Token revoke answered {}", response.status()),
        Err(e) => warn!("[Twitch] Token revoke failed: {}", e),
    }
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
        .timeout(REQUEST_TIMEOUT)
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
    fn keeps_only_known_scopes_in_canonical_order() {
        let selected = vec!["bits:read".to_string(), "user:write:chat".to_string()];
        assert_eq!(requested_scopes(&selected).unwrap(), "user:write:chat bits:read");
        assert_eq!(requested_scopes(&[]).unwrap(), "");
    }

    #[test]
    fn rejects_scopes_we_never_offer() {
        assert!(requested_scopes(&["channel:manage:raids".to_string()]).is_err());
    }

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

    fn token_expiring_in(minutes: i64) -> TwitchToken {
        TwitchToken {
            access_token: "a".to_string(),
            refresh_token: "r".to_string(),
            expires: Utc::now() + Duration::minutes(minutes),
            scopes: Vec::new(),
        }
    }

    #[test]
    fn refreshes_shortly_before_expiry() {
        assert!(token_expiring_in(10).needs_refresh());
        assert!(token_expiring_in(-1).needs_refresh());
    }

    #[test]
    fn keeps_a_token_with_time_left() {
        assert!(!token_expiring_in(60).needs_refresh());
    }
}
