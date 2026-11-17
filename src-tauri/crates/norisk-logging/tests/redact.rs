use norisk_logging::redact::{self, mask_identifier, mask_sensitive_data};

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
    let masked =
        mask_sensitive_data("-Dnorisk.token=secret --accessToken topsecret --width 800");
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
    redact::set_known_accounts(&[(
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

    redact::set_known_accounts(&[]);
}

#[test]
fn ignores_accounts_with_a_too_short_name() {
    let _guard = lock_account_state();
    redact::set_known_accounts(&[("ab".to_string(), "".to_string())]);
    assert_eq!(mask_sensitive_data("about a cab"), "about a cab");
    redact::set_known_accounts(&[]);
}

#[test]
fn masks_os_username_in_paths() {
    let masked =
        mask_sensitive_data(r"Loading C:\Users\steve\AppData\Roaming\NoRiskClientV3\mods");
    assert_eq!(
        masked,
        r"Loading C:\Users\*****\AppData\Roaming\NoRiskClientV3\mods"
    );

    let masked = mask_sensitive_data("path: C:/Users/steve/Desktop/test.jar");
    assert_eq!(masked, "path: C:/Users/*****/Desktop/test.jar");

    let masked = mask_sensitive_data("/home/steve/.minecraft and /Users/steve/Library");
    assert_eq!(masked, "/home/*****/.minecraft and /Users/*****/Library");
}

#[test]
fn masks_os_username_in_debug_escaped_paths() {
    let masked = mask_sensitive_data(
        r#"Successfully saved config to "C:\\Users\\steve\\AppData\\Roaming\\norisk""#,
    );
    assert!(!masked.contains("steve"), "os username leaked: {}", masked);
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
fn masks_ipv4_but_keeps_loopback_and_unspecified() {
    let masked = mask_sensitive_data("Connecting to /203.0.113.42:25565, local 192.168.1.10");
    assert_eq!(masked, "Connecting to /<IP>:25565, local <IP>");

    let input = "bind 127.0.0.1:8080 and 0.0.0.0:25565";
    assert_eq!(mask_sensitive_data(input), input);
}

#[test]
fn keeps_version_strings_that_look_like_ipv4() {
    let input =
        "Loading sodium-fabric-0.5.8+mc1.20.1 and mod-1.2.3.4.jar v1.2.3.4 lib 1.2.3.4-beta";
    assert_eq!(mask_sensitive_data(input), input);
}

#[test]
fn masks_ipv6_but_keeps_loopback_and_clock_times() {
    let masked = mask_sensitive_data(
        "peer [2001:db8:85a3::8a2e:370:7334]:25565 full 2001:0db8:0000:0000:0000:ff00:0042:8329",
    );
    assert_eq!(masked, "peer [<IP>]:25565 full <IP>");

    let input = "[12:34:56] [Render thread/INFO]: bound to ::1 and :: via Foo::bar";
    assert_eq!(mask_sensitive_data(input), input);
}

#[test]
fn masks_session_uuid_args_and_legacy_session_token() {
    let masked = mask_sensitive_data(
        "--session abc.def --uuid 0123abcd --width 800 token:ey123secret:0123abcd",
    );
    assert_eq!(
        masked,
        "--session ***** --uuid ***** --width 800 token:*****"
    );
}

#[test]
fn masks_local_hostname_and_os_username() {
    let _guard = lock_account_state();
    redact::set_local_hostname(Some("ZZ-TESTHOST-42.example.lan"));
    redact::set_local_username(Some("zzlocaluser"));
    let masked = mask_sensitive_data(
        "Host zz-testhost-42 aka ZZ-TESTHOST-42.example.lan started by ZZLocalUser",
    );
    assert_eq!(masked, "Host <HOST> aka <HOST> started by <USER>");

    redact::set_local_hostname(None);
    redact::set_local_username(None);
    assert_eq!(
        mask_sensitive_data("zz-testhost-42 zzlocaluser"),
        "zz-testhost-42 zzlocaluser"
    );

    redact::set_local_username(Some("admin"));
    assert_eq!(mask_sensitive_data("admin panel"), "admin panel");
    redact::set_local_username(None);
}

#[test]
fn redacts_hs_err_log() {
    let _guard = lock_account_state();
    redact::set_local_hostname(Some("ZZ-GAMING-PC"));
    redact::set_local_username(Some("zzgamer"));
    let input = "\
#
# A fatal error has been detected by the Java Runtime Environment:
#
#  EXCEPTION_ACCESS_VIOLATION (0xc0000005) at pc=0x00007ffb1c2a4d17, pid=15624, tid=4711
#
# Problematic frame:
# V  [jvm.dll+0x464d17]
#
Command Line: -Xmx4G -Dnorisk.token=eyJabc.def.ghi -Djava.library.path=C:\\Users\\zzgamer\\AppData\\Roaming\\natives net.minecraft.client.main.Main --username Steve --uuid 0123456789abcdef --accessToken secret123 --session sess456

---------------  S Y S T E M  ---------------

jvm_args: -Xmx4G -Dnorisk.token=eyJabc.def.ghi
java_command: net.minecraft.client.main.Main --accessToken secret123 --uuid 0123456789abcdef
Environment Variables:
PATH=C:\\Windows\\system32;C:\\Users\\zzgamer\\bin
USERNAME=zzgamer
COMPUTERNAME=ZZ-GAMING-PC
USERDOMAIN=ZZ-GAMING-PC
OS=Windows_NT

Signal Handlers:
host ZZ-GAMING-PC connected to 198.51.100.7
";
    let out = redact::redact_hs_err(input);
    redact::set_local_hostname(None);
    redact::set_local_username(None);

    assert!(out.contains(redact::HS_ERR_ENV_REMOVED_MARKER));
    assert!(!out.contains("USERDOMAIN"), "env leaked: {}", out);
    assert!(!out.contains("PATH="), "env leaked: {}", out);
    assert!(!out.contains("zzgamer"), "user leaked: {}", out);
    assert!(
        !out.to_lowercase().contains("zz-gaming-pc"),
        "host leaked: {}",
        out
    );
    assert!(!out.contains("secret123") && !out.contains("sess456") && !out.contains("eyJ"));
    assert!(!out.contains("0123456789abcdef"));
    assert!(!out.contains("198.51.100.7"));
    assert!(out.contains("# V  [jvm.dll+0x464d17]"));
    assert!(out.contains("EXCEPTION_ACCESS_VIOLATION"));
    assert!(out.contains("Signal Handlers:"));
    assert!(out.contains("host <HOST> connected to <IP>"));
}

#[test]
fn masks_url_and_form_secrets() {
    let masked = mask_sensitive_data(
        "GET https://login.live.com/oauth?code=M123abc&state=ok&access_token=xyz password=hunter2 sig=abc%3D",
    );
    assert_eq!(
        masked,
        "GET https://login.live.com/oauth?code=*****&state=ok&access_token=***** password=***** sig=*****"
    );
}

#[test]
fn masks_rust_debug_tokens() {
    let masked = mask_sensitive_data(
        r#"Token { access_token: "abc.def", refresh_token: Some("M.C507_BAY.0.U.-Cxyz"), id_token: None }"#,
    );
    assert_eq!(
        masked,
        r#"Token { access_token: "*****", refresh_token: Some("*****"), id_token: None }"#
    );
}

#[test]
fn masks_microsoft_and_discord_tokens() {
    let ms = mask_sensitive_data("refresh M.C507_BAY.0.U.-CkSecretStuff!x access EwAoA8l6BAAUbDba3x2OMJElkF7gJ4z/VbCPEz0AAZkzzz end");
    assert_eq!(ms, "refresh ***** access ***** end");

    let fake_token = ["MTA4NjQ1NjY1ODEyNDQ4ODcwNA", "GhIjKl", "abcdefghijklmnopqrstuvwxyz0123456"].join(".");
    let discord = mask_sensitive_data(&format!("token {} used", fake_token));
    assert_eq!(discord, "token ***** used");
}

#[test]
fn masks_real_shaped_microsoft_refresh_token() {
    let masked = mask_sensitive_data("rt M.C512_BAY.0.U.-CgZ4!kq*Xv9$Lm~2 next");
    assert_eq!(masked, "rt ***** next");
    let masked = mask_sensitive_data("rt=M.C5.abcdef");
    assert!(!masked.contains("abcdef"), "{}", masked);
}

#[test]
fn masks_mac_addresses_and_basic_auth() {
    let masked = mask_sensitive_data("nic 00:1A:2b:3C:4d:5E and 00-1a-2b-3c-4d-5e");
    assert_eq!(masked, "nic <MAC> and <MAC>");

    let masked =
        mask_sensitive_data("Authorization: Basic dXNlcjpwYXNz and Basic dXNlcjpwYXNzd29yZA==");
    assert_eq!(masked, "Authorization: Basic ***** and Basic *****");

    let prose = "Basic settings loaded";
    assert_eq!(mask_sensitive_data(prose), prose);
}

#[test]
fn masks_onedrive_org_and_user_dirs_with_spaces() {
    let masked =
        mask_sensitive_data(r"C:\Users\John Doe\OneDrive - Contoso Ltd\Minecraft\mods");
    assert_eq!(masked, r"C:\Users\*****\OneDrive - *****\Minecraft\mods");
}

#[test]
fn masks_chat_password_commands() {
    let masked = mask_sensitive_data(
        "[12:00:00] [Render thread/INFO]: /login hunter2\n> /REGISTER pw pw\n[CHAT] /changepw old new\n/l secret\nsee /lib/x",
    );
    assert_eq!(
        masked,
        "[12:00:00] [Render thread/INFO]: /login ***\n> /REGISTER ***\n[CHAT] /changepw ***\n/l ***\nsee /lib/x"
    );
}

#[test]
fn os_username_matching_handles_non_word_names_and_short_names() {
    let _guard = lock_account_state();
    redact::set_local_username(Some("-zz.user-"));
    assert_eq!(mask_sensitive_data("by -zz.user- now"), "by <USER> now");
    redact::set_local_username(Some("Zz Long Name"));
    assert_eq!(
        mask_sensitive_data("short ZZLONG~1 and full zz long name"),
        "short <USER> and full <USER>"
    );
    redact::set_local_username(None);
}

#[test]
fn account_names_are_case_insensitive() {
    let _guard = lock_account_state();
    redact::set_known_accounts(&[("ZzCasePlayer".to_string(), "".to_string())]);
    assert_eq!(
        mask_sensitive_data("hi zzcaseplayer and ZZCASEPLAYER"),
        "hi <PLAYER> and <PLAYER>"
    );
    redact::set_known_accounts(&[]);
}

#[test]
fn large_inputs_are_redacted_chunkwise_with_identical_results() {
    let line = "[12:00:00] user C:\\Users\\bob\\x --accessToken abc 203.0.113.9 Bearer zz\n";
    let big: String = line.repeat(20_000);
    assert!(big.len() > 1024 * 1024);
    let masked = mask_sensitive_data(&big);
    assert_eq!(masked, mask_sensitive_data(line).repeat(20_000));
}

#[test]
fn leaves_normal_content_untouched() {
    let input = r#"{"name":"sodium","version":"0.5.8"}"#;
    assert_eq!(mask_sensitive_data(input), input);
}

#[test]
fn masks_secrets_glued_to_non_ascii_letters() {
    let masked = mask_sensitive_data("Größe:eyJhbGciOi.eyJzdWIi.SflKxw ümax@example.com äBearer abc.def");
    assert!(!masked.contains("eyJ"), "{}", masked);
    assert!(!masked.contains("max@example.com"), "{}", masked);
    assert!(!masked.contains("abc.def"), "{}", masked);
}

#[test]
fn a_large_log_with_umlauts_is_redacted_within_a_second() {
    let line = "[21:22:26] [Render thread/INFO]: Größe geändert für Spieler äöü 🎮 von 10.0.0.1 an C:\\Users\\Max\\x\n";
    let log = line.repeat(2 * 1024 * 1024 / line.len());
    let started = std::time::Instant::now();
    let masked = mask_sensitive_data(&log);
    assert!(!masked.contains("10.0.0.1") && !masked.contains("\\Max\\"));
    assert!(started.elapsed() < std::time::Duration::from_secs(1), "took {:?}", started.elapsed());
}
