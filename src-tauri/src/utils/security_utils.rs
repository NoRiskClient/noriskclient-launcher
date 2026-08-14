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
        static ref WINDOWS_USER_PATH_REGEX: Regex = Regex::new(r#"(?i)([A-Z]:[/\\]Users[/\\])[^/\\"'\s]+"#).unwrap();
        // Mask the OS username in Unix/macOS home paths (/home/<name>/..., /Users/<name>/...)
        static ref UNIX_USER_PATH_REGEX: Regex = Regex::new(r#"(/(?:home|Users)/)[^/"'\s]+"#).unwrap();
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

#[cfg(test)]
mod tests {
    use super::{mask_identifier, mask_sensitive_data};

    #[test]
    fn shortens_long_identifiers_and_hides_short_ones() {
        assert_eq!(mask_identifier("abcdefghijklmnop"), "abcdefgh...");
        assert_eq!(mask_identifier("short"), "*****");
    }

    #[test]
    fn masks_json_token_fields_and_jwt() {
        let masked = mask_sensitive_data(r#"{"value":"eyJhbGciOi.eyJzdWIi.SflKxw"}"#);
        assert!(!masked.contains("eyJ"));
        assert!(masked.contains(r#""value":"*****""#));
    }

    #[test]
    fn masks_truncated_jwt() {
        let masked = mask_sensitive_data("body: eyJhbGciOi.eyJzdWIiLCJ...");
        assert!(!masked.contains("eyJ"));
    }

    #[test]
    fn masks_bearer_header() {
        let masked = mask_sensitive_data("Authorization: Bearer abc123.def-456");
        assert_eq!(masked, "Authorization: Bearer *****");
    }

    #[test]
    fn masks_launch_args() {
        let masked = mask_sensitive_data("-Dnorisk.token=secret --accessToken topsecret --width 800");
        assert_eq!(masked, "-Dnorisk.token=***** --accessToken ***** --width 800");
    }

    #[test]
    fn masks_microsoft_identifiers() {
        let masked = mask_sensitive_data("--clientId c4502edb-1111 --xuid 2535123 --width 800");
        assert_eq!(masked, "--clientId ***** --xuid ***** --width 800");
    }

    #[test]
    fn masks_registered_player_name_and_uuid_in_every_spelling() {
        super::set_known_accounts(&[(
            "ZzTestPlayerZz".to_string(),
            "A1B2C3D4-1111-2222-3333-444455556666".to_string(),
        )]);

        let masked = mask_sensitive_data(
            "--username ZzTestPlayerZz --uuid a1b2c3d4-1111-2222-3333-444455556666 \
             compact a1b2c3d41111222233334444555566 66 upper A1B2C3D4-1111-2222-3333-444455556666",
        );

        assert!(!masked.contains("ZzTestPlayerZz"), "name leaked: {}", masked);
        assert!(!masked.to_lowercase().contains("a1b2c3d4-1111"), "uuid leaked: {}", masked);
        assert!(masked.contains("<PLAYER>"));
        assert!(masked.contains("<PLAYER_UUID>"));

        let untouched = mask_sensitive_data("profile 99999999-8888-7777-6666-555544443333 sodium");
        assert_eq!(untouched, "profile 99999999-8888-7777-6666-555544443333 sodium");

        super::set_known_accounts(&[]);
    }

    #[test]
    fn ignores_accounts_with_a_too_short_name() {
        super::set_known_accounts(&[("ab".to_string(), "".to_string())]);
        assert_eq!(mask_sensitive_data("about a cab"), "about a cab");
        super::set_known_accounts(&[]);
    }

    #[test]
    fn masks_os_username_in_paths() {
        let masked = mask_sensitive_data(r"Loading C:\Users\sheesh\AppData\Roaming\NoRiskClientV3\mods");
        assert_eq!(masked, r"Loading C:\Users\*****\AppData\Roaming\NoRiskClientV3\mods");

        let masked = mask_sensitive_data("path: C:/Users/sheesh/Desktop/test.jar");
        assert_eq!(masked, "path: C:/Users/*****/Desktop/test.jar");

        let masked = mask_sensitive_data("/home/sheesh/.minecraft and /Users/sheesh/Library");
        assert_eq!(masked, "/home/*****/.minecraft and /Users/*****/Library");
    }

    #[test]
    fn masks_email_addresses() {
        let masked = mask_sensitive_data("account email: some.user+mc@gmail.com logged in");
        assert_eq!(masked, "account email: *****@***** logged in");
    }

    #[test]
    fn leaves_normal_content_untouched() {
        let input = r#"{"name":"sodium","version":"0.5.8"}"#;
        assert_eq!(mask_sensitive_data(input), input);
    }
}
