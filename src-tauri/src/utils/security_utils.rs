use lazy_static::lazy_static;
use once_cell::sync::Lazy;
use regex::Regex;
use std::sync::{Arc, RwLock};

static KNOWN_ACCOUNTS: Lazy<RwLock<Arc<Vec<(String, &'static str)>>>> =
    Lazy::new(|| RwLock::new(Arc::new(Vec::new())));

const MIN_NEEDLE_LEN: usize = 3;

pub fn set_known_accounts(accounts: &[(String, String)]) {
    let mut needles: Vec<(String, &'static str)> = Vec::new();
    let mut push = |needle: String, placeholder: &'static str| {
        if needle.len() >= MIN_NEEDLE_LEN && !needles.iter().any(|(n, _)| *n == needle) {
            needles.push((needle, placeholder));
        }
    };

    for (username, uuid) in accounts {
        push(username.clone(), "<PLAYER>");
        push(uuid.clone(), "<PLAYER_UUID>");
        push(uuid.to_lowercase(), "<PLAYER_UUID>");
        push(uuid.replace('-', ""), "<PLAYER_UUID>");
        push(uuid.to_lowercase().replace('-', ""), "<PLAYER_UUID>");
    }

    needles.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

    if let Ok(mut guard) = KNOWN_ACCOUNTS.write() {
        *guard = Arc::new(needles);
    }
}

/// Masks sensitive information in log content and other strings.
/// This includes tokens, passwords, and other sensitive data that should not be exposed in logs or UI.
///
/// # Arguments
/// * `content` - The content string to mask
///
/// # Returns
/// A string with sensitive information masked with asterisks
pub fn mask_sensitive_data(content: &str) -> String {
    lazy_static! {
        // Mask NoRisk client tokens
        static ref NORISK_TOKEN_REGEX: Regex = Regex::new(r"-Dnorisk\.token=[^\s]+").unwrap();
        // Mask Minecraft access tokens
        static ref ACCESS_TOKEN_REGEX: Regex = Regex::new(r"--accessToken\s+[^\s]+").unwrap();
        static ref CLIENT_ID_ARG_REGEX: Regex = Regex::new(r"--clientId\s+[^\s]+").unwrap();
        static ref XUID_ARG_REGEX: Regex = Regex::new(r"--xuid\s+[^\s]+").unwrap();
        // Mask Bearer auth headers
        static ref BEARER_REGEX: Regex = Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+").unwrap();
        // Mask token-bearing JSON string fields (NoRiskToken.value, MS/MC/Xbox auth responses)
        static ref JSON_TOKEN_FIELD_REGEX: Regex = Regex::new(
            r#"(?i)"(value|token|access_token|accessToken|refresh_token|refreshToken|id_token|client_secret|DeviceToken|TitleToken|UserToken|XSTSToken|authorization)"\s*:\s*"[^"]*""#
        ).unwrap();
        // Mask JWT tokens (eyJ... format), including ones truncated mid-segment by log truncation
        static ref JWT_REGEX: Regex = Regex::new(r"\beyJ[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]*){0,2}").unwrap();
        // Mask the OS username in Windows paths (C:\Users\<name>\... or C:/Users/<name>/...)
        static ref WINDOWS_USER_PATH_REGEX: Regex = Regex::new(r#"(?i)([A-Z]:[/\\]+Users[/\\]+)[^/\\"'\s]+"#).unwrap();
        // Mask the OS username in Unix/macOS home paths (/home/<name>/..., /Users/<name>/...)
        static ref UNIX_USER_PATH_REGEX: Regex = Regex::new(r#"(/+(?:home|Users)/+)[^/"'\s]+"#).unwrap();
        // Mask email addresses
        static ref EMAIL_REGEX: Regex = Regex::new(r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b").unwrap();
    }

    let mut masked_content = NORISK_TOKEN_REGEX.replace_all(content, "-Dnorisk.token=*****").to_string();
    masked_content = ACCESS_TOKEN_REGEX.replace_all(&masked_content, "--accessToken *****").to_string();
    masked_content = CLIENT_ID_ARG_REGEX.replace_all(&masked_content, "--clientId *****").to_string();
    masked_content = XUID_ARG_REGEX.replace_all(&masked_content, "--xuid *****").to_string();
    masked_content = BEARER_REGEX.replace_all(&masked_content, "Bearer *****").to_string();
    masked_content = JSON_TOKEN_FIELD_REGEX.replace_all(&masked_content, "\"$1\":\"*****\"").to_string();
    masked_content = JWT_REGEX.replace_all(&masked_content, "*****").to_string();
    masked_content = WINDOWS_USER_PATH_REGEX.replace_all(&masked_content, "${1}*****").to_string();
    masked_content = UNIX_USER_PATH_REGEX.replace_all(&masked_content, "${1}*****").to_string();
    masked_content = EMAIL_REGEX.replace_all(&masked_content, "*****@*****").to_string();

    let known = KNOWN_ACCOUNTS.read().ok().map(|guard| guard.clone());
    if let Some(known) = known {
        for (needle, placeholder) in known.iter() {
            if masked_content.contains(needle.as_str()) {
                masked_content = masked_content.replace(needle.as_str(), placeholder);
            }
        }
    }

    masked_content
}

pub fn mask_identifier(value: &str) -> String {
    const KEEP: usize = 8;
    match value.char_indices().nth(KEEP) {
        Some((split, _)) => format!("{}...", &value[..split]),
        None => "*****".to_string(),
    }
}
