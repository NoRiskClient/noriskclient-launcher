use crate::error::{AppError, CommandError};
use crate::utils::api_utils::api_error_from_body;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupportErrorKind {
    NotLoggedIn,
    NotFound,
    Gone,
    Offline,
    RateLimited,
    TooLarge,
    InvalidCode,
    Busy,
    Forbidden,
    DiscordNotLinked,
    Unknown,
}

impl SupportErrorKind {
    pub fn key(self) -> &'static str {
        match self {
            Self::NotLoggedIn => "not_logged_in",
            Self::NotFound => "not_found",
            Self::Gone => "gone",
            Self::Offline => "offline",
            Self::RateLimited => "rate_limited",
            Self::TooLarge => "too_large",
            Self::InvalidCode => "invalid_code",
            Self::Busy => "busy",
            Self::Forbidden => "forbidden",
            Self::DiscordNotLinked => "discord_not_linked",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SupportError {
    pub kind: SupportErrorKind,
    pub detail: Option<String>,
}

impl SupportError {
    pub fn new(kind: SupportErrorKind) -> Self {
        Self { kind, detail: None }
    }

    pub fn with_detail(kind: SupportErrorKind, detail: impl Into<String>) -> Self {
        Self {
            kind,
            detail: Some(detail.into()),
        }
    }

    pub fn unknown(detail: impl Into<String>) -> Self {
        Self::with_detail(SupportErrorKind::Unknown, detail)
    }

    pub fn not_loaded() -> Self {
        Self::unknown("request not loaded, open the link again")
    }

    pub fn not_prepared() -> Self {
        Self::unknown("request not prepared")
    }

    pub fn from_response(status: u16, body: &str, retry_after_secs: Option<u64>) -> Self {
        let status_code =
            reqwest::StatusCode::from_u16(status).unwrap_or(reqwest::StatusCode::BAD_GATEWAY);
        let key = match api_error_from_body(status_code, body.to_string()) {
            AppError::ApiError {
                translatable_key, ..
            } => Some(translatable_key),
            _ => None,
        };
        if key
            .as_deref()
            .is_some_and(|k| k.ends_with("discord_not_linked"))
        {
            return Self::new(SupportErrorKind::DiscordNotLinked);
        }
        if status == 503 {
            let last = key
                .as_deref()
                .and_then(|k| k.rsplit('.').next())
                .unwrap_or("unavailable")
                .to_string();
            if last == "busy" {
                return match retry_after_secs {
                    Some(secs) => Self::with_detail(SupportErrorKind::Busy, secs.to_string()),
                    None => Self::new(SupportErrorKind::Busy),
                };
            }
            return Self::with_detail(SupportErrorKind::Unknown, last);
        }
        if status == 404 && key.is_none() {
            return Self::with_detail(SupportErrorKind::Unknown, "HTTP 404");
        }
        Self::from_status(status, key)
    }

    pub fn from_status(status: u16, detail: Option<String>) -> Self {
        let kind = match status {
            401 | 403 => SupportErrorKind::NotLoggedIn,
            408 => SupportErrorKind::Offline,
            404 => SupportErrorKind::NotFound,
            410 => SupportErrorKind::Gone,
            413 => SupportErrorKind::TooLarge,
            429 => SupportErrorKind::RateLimited,
            _ => SupportErrorKind::Unknown,
        };
        Self {
            kind,
            detail: detail.or_else(|| Some(format!("HTTP {}", status))),
        }
    }
}

impl fmt::Display for SupportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.detail {
            Some(detail) => write!(f, "support:{}: {}", self.kind.key(), detail),
            None => write!(f, "support:{}", self.kind.key()),
        }
    }
}

impl From<AppError> for SupportError {
    fn from(error: AppError) -> Self {
        match &error {
            AppError::RequestError(_) => {
                SupportError::with_detail(SupportErrorKind::Offline, error.to_string())
            }
            AppError::NoCredentialsError => SupportError::new(SupportErrorKind::NotLoggedIn),
            _ => SupportError::unknown(error.to_string()),
        }
    }
}

impl From<SupportError> for CommandError {
    fn from(error: SupportError) -> Self {
        CommandError {
            message: crate::utils::security_utils::mask_sensitive_data(&error.to_string()),
            kind: "SupportRequestError".to_string(),
            translatable_key: None,
            args: None,
            status: None,
        }
    }
}

pub type SupportResult<T> = std::result::Result<T, SupportError>;
