use noriskclient_launcher_v3_lib::utils::security_utils::{
    mask_identifier, mask_sensitive_data, set_known_accounts,
};

static ACCOUNT_STATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn lock_account_state() -> std::sync::MutexGuard<'static, ()> {
    ACCOUNT_STATE.lock().unwrap_or_else(|e| e.into_inner())
}

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
    assert_eq!(
        masked,
        "-Dnorisk.token=***** --accessToken ***** --width 800"
    );
}

#[test]
fn masks_microsoft_identifiers() {
    let masked = mask_sensitive_data("--clientId c4502edb-1111 --xuid 2535123 --width 800");
    assert_eq!(masked, "--clientId ***** --xuid ***** --width 800");
}

#[test]
fn masks_registered_player_name_and_uuid_in_every_spelling() {
    let _guard = lock_account_state();
    set_known_accounts(&[(
        "ZzTestPlayerZz".to_string(),
        "A1B2C3D4-1111-2222-3333-444455556666".to_string(),
    )]);

    let masked = mask_sensitive_data(
        "--username ZzTestPlayerZz --uuid a1b2c3d4-1111-2222-3333-444455556666 \
         compact a1b2c3d41111222233334444555566 66 upper A1B2C3D4-1111-2222-3333-444455556666",
    );

    assert!(
        !masked.contains("ZzTestPlayerZz"),
        "name leaked: {}",
        masked
    );
    assert!(
        !masked.to_lowercase().contains("a1b2c3d4-1111"),
        "uuid leaked: {}",
        masked
    );
    assert!(masked.contains("<PLAYER>"));
    assert!(masked.contains("<PLAYER_UUID>"));

    let untouched = mask_sensitive_data("profile 99999999-8888-7777-6666-555544443333 sodium");
    assert_eq!(
        untouched,
        "profile 99999999-8888-7777-6666-555544443333 sodium"
    );

    set_known_accounts(&[]);
}

#[test]
fn ignores_accounts_with_a_too_short_name() {
    let _guard = lock_account_state();
    set_known_accounts(&[("ab".to_string(), "".to_string())]);
    assert_eq!(mask_sensitive_data("about a cab"), "about a cab");
    set_known_accounts(&[]);
}

#[test]
fn masks_os_username_in_paths() {
    let masked =
        mask_sensitive_data(r"Loading C:\Users\sheesh\AppData\Roaming\NoRiskClientV3\mods");
    assert_eq!(
        masked,
        r"Loading C:\Users\*****\AppData\Roaming\NoRiskClientV3\mods"
    );

    let masked = mask_sensitive_data("path: C:/Users/sheesh/Desktop/test.jar");
    assert_eq!(masked, "path: C:/Users/*****/Desktop/test.jar");

    let masked = mask_sensitive_data("/home/sheesh/.minecraft and /Users/sheesh/Library");
    assert_eq!(masked, "/home/*****/.minecraft and /Users/*****/Library");
}

#[test]
fn masks_os_username_in_debug_escaped_paths() {
    let masked = mask_sensitive_data(
        r#"Successfully saved config to "C:\\Users\\sheesh\\AppData\\Roaming\\norisk""#,
    );
    assert!(!masked.contains("sheesh"), "os username leaked: {}", masked);
    assert_eq!(
        masked,
        r#"Successfully saved config to "C:\\Users\\*****\\AppData\\Roaming\\norisk""#
    );
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
