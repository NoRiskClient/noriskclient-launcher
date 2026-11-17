use noriskclient_launcher_v3_lib::minecraft::modloader::{ModloaderFactory, LATEST_LOADER_VERSION};
use noriskclient_launcher_v3_lib::state::profile_state::{Profile, ProfileSettings};

fn profile(overwrite: serde_json::Value) -> Profile {
    let mut settings = serde_json::to_value(ProfileSettings::default()).unwrap();
    for (key, value) in overwrite.as_object().unwrap() {
        settings[key] = value.clone();
    }
    serde_json::from_value(serde_json::json!({
        "name": "test",
        "path": "test",
        "game_version": "1.21.11",
        "loader": "fabric",
        "settings": settings,
    }))
    .expect("fixture must deserialize")
}

#[test]
fn without_the_switch_there_is_no_overwrite() {
    let p = profile(serde_json::json!({
        "use_overwrite_loader_version": false,
        "overwrite_loader_versions": { "fabric": "0.16.0" },
    }));
    assert_eq!(ModloaderFactory::user_overwrite(&p), None);
}

#[test]
fn the_entry_for_the_current_loader_wins_over_the_legacy_field() {
    let p = profile(serde_json::json!({
        "use_overwrite_loader_version": true,
        "overwrite_loader_version": "0.15.0",
        "overwrite_loader_versions": { "fabric": "0.16.0", "forge": "52.0.1" },
    }));
    assert_eq!(ModloaderFactory::user_overwrite(&p), Some("0.16.0"));
}

#[test]
fn the_legacy_field_counts_only_while_no_loader_has_an_entry() {
    let virgin = profile(serde_json::json!({
        "use_overwrite_loader_version": true,
        "overwrite_loader_version": "0.15.0",
    }));
    assert_eq!(ModloaderFactory::user_overwrite(&virgin), Some("0.15.0"));

    let other_loader = profile(serde_json::json!({
        "use_overwrite_loader_version": true,
        "overwrite_loader_version": "0.15.0",
        "overwrite_loader_versions": { "forge": "52.0.1" },
    }));
    assert_eq!(ModloaderFactory::user_overwrite(&other_loader), None);
}

#[test]
fn always_latest_is_kept_as_its_own_choice() {
    let p = profile(serde_json::json!({
        "use_overwrite_loader_version": true,
        "overwrite_loader_versions": { "fabric": LATEST_LOADER_VERSION },
    }));
    assert_eq!(ModloaderFactory::user_overwrite(&p), Some(LATEST_LOADER_VERSION));
}

#[test]
fn an_empty_entry_is_no_overwrite() {
    let p = profile(serde_json::json!({
        "use_overwrite_loader_version": true,
        "overwrite_loader_versions": { "fabric": "" },
    }));
    assert_eq!(ModloaderFactory::user_overwrite(&p), None);
}
