use super::{prepare_item, sent_file as sent};
use crate::temp_dir;
use noriskclient_launcher_v3_lib::support::handler::PreparedItem;
use std::path::Path;

fn prepare_options(instance: &Path) -> PreparedItem {
    prepare_item("MC_SETTINGS", instance, 1024 * 1024)
}

#[test]
fn the_whole_options_file_is_sent_with_the_last_server_hidden() {
    let dir = temp_dir("settings");
    std::fs::write(
        dir.join("options.txt"),
        "version:4903\nlastServer:play.secret.net\nrenderDistance:32\nsoundDevice:Headset (max@example.com)\nresourcePacks:[\"vanilla\"]\n",
    )
    .unwrap();

    let item = prepare_options(&dir);

    assert!(item.available);
    assert_eq!(
        sent(&item).lines().collect::<Vec<_>>(),
        vec![
            "version:4903",
            "lastServer:*****",
            "renderDistance:32",
            "soundDevice:Headset (*****@*****)",
            "resourcePacks:[\"vanilla\"]",
        ]
    );
}

#[test]
fn an_empty_last_server_stays_empty() {
    let dir = temp_dir("settings-empty-server");
    std::fs::write(dir.join("options.txt"), "lastServer:\nfov:0.5\n").unwrap();

    assert_eq!(sent(&prepare_options(&dir)), "lastServer:\nfov:0.5\n");
}

#[test]
fn settings_are_missing_when_minecraft_never_wrote_any() {
    let item = prepare_options(&temp_dir("settings-none"));
    assert!(!item.available && item.error.is_none());
}

#[test]
fn a_big_options_file_is_cut_to_the_file_limit_of_the_request() {
    let dir = temp_dir("settings-limit");
    let options: String = (0..2_000).map(|i| format!("key{}:value
", i)).collect();
    std::fs::write(dir.join("options.txt"), &options).unwrap();

    let item = prepare_item("MC_SETTINGS", &dir, 4096);

    assert!(item.truncated);
    assert!(sent(&item).len() <= 4096, "{} bytes", sent(&item).len());
}
