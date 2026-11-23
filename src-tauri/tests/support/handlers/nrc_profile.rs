use super::prepare_item;
use crate::temp_dir;
use noriskclient_launcher_v3_lib::support::handler::PreparedItem;
use serde_json::Value;
use std::path::Path;

fn prepare_nrc_profile(instance: &Path) -> PreparedItem {
    prepare_item("NRC_PROFILE", instance, 1024 * 1024)
}

const ACTIVE: &str = r#"{"version":3,"servers":{"play.secret.net":{"zoom":2},"hidden.example.org:25566":{"zoom":4}},"modules":[{"name":"Autotext","values":[{"name":"isEnabled","value":true},{"name":"server","value":"play.secret.net"},{"name":"text","value":"/login hunter2"}]},{"name":"Zoom","values":[{"name":"isEnabled","value":false}]}]}"#;

fn norisk_dir(instance: &Path, current: &str) {
    let profiles = instance.join("NoRiskClient").join("profiles");
    std::fs::create_dir_all(&profiles).unwrap();
    std::fs::write(
        instance.join("NoRiskClient").join("profiles.json"),
        format!(r#"{{"current":"{}"}}"#, current),
    )
    .unwrap();
    std::fs::write(profiles.join("Main.json"), ACTIVE).unwrap();
    std::fs::write(
        profiles.join("Other.json"),
        r#"{"modules":[{"name":"OTHER_MARKER"}]}"#,
    )
    .unwrap();
}

#[test]
fn the_active_profile_is_sent_whole_with_server_addresses_replaced_and_secrets_masked() {
    let dir = temp_dir("nrc-profile");
    norisk_dir(&dir, "Main");

    let item = prepare_nrc_profile(&dir);
    let text = item.file.as_ref().map(|f| f.to_string()).unwrap_or_default();
    let sent: Value = serde_json::from_str(&text).unwrap();

    let servers: Vec<&String> = sent["servers"].as_object().unwrap().keys().collect();
    assert_eq!(servers, vec!["server-1", "server-2"]);
    assert_eq!(sent["servers"]["server-1"]["zoom"], 2);
    assert!(text.contains("Autotext") && text.contains("Zoom") && text.contains("\"server-1\""));
    for leaked in ["hunter2", "secret.net", "hidden.example.org", "OTHER_MARKER"] {
        assert!(!text.contains(leaked), "{} leaked: {}", leaked, text);
    }
}

#[test]
fn a_big_profile_with_many_servers_is_anonymized_within_a_second() {
    let dir = temp_dir("nrc-profile-big");
    norisk_dir(&dir, "Main");
    let servers: Vec<String> = (0..40)
        .map(|i| format!(r#""play{}.server.net":{{"zoom":{}}}"#, i, i))
        .collect();
    let values: Vec<String> = (0..3000)
        .map(|i| format!(r#"{{"name":"setting{}","value":"join play{}.server.net now"}}"#, i, i % 40))
        .collect();
    let profile = format!(
        r#"{{"servers":{{{}}},"modules":[{{"name":"Big","values":[{}]}}]}}"#,
        servers.join(","),
        values.join(",")
    );
    std::fs::write(dir.join("NoRiskClient").join("profiles").join("Main.json"), profile).unwrap();

    let started = std::time::Instant::now();
    let item = prepare_nrc_profile(&dir);
    let elapsed = started.elapsed();

    let text = item.file.as_ref().map(|f| f.to_string()).unwrap_or_default();
    assert!(!text.contains("server.net"), "a server address leaked");
    assert!(text.contains("join server-40 now"));
    assert!(elapsed < std::time::Duration::from_secs(1), "took {:?}", elapsed);
}

#[test]
fn an_active_profile_pointing_outside_the_profiles_folder_is_refused() {
    let dir = temp_dir("nrc-profile-escape");
    norisk_dir(&dir, "../../escape");
    std::fs::write(dir.join("escape.json"), r#"{"modules":[{"name":"ESCAPED"}]}"#).unwrap();

    let item = prepare_nrc_profile(&dir);

    assert!(!item.available && item.error.is_some(), "{:?}", item.error);
    assert!(item.file.is_none());
}

#[test]
fn without_a_norisk_folder_the_profile_is_missing() {
    let item = prepare_nrc_profile(&temp_dir("nrc-profile-none"));
    assert!(!item.available && item.error.is_none());
}
