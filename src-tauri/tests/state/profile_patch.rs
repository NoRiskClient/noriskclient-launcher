use noriskclient_launcher_v3_lib::state::profile_patch::ProfilePatch;
use noriskclient_launcher_v3_lib::state::profile_state::{ModLoader, Profile, ProfileSettings};
use serde_json::{json, Value};
use uuid::Uuid;

fn profile() -> Profile {
    serde_json::from_value(json!({
        "id": "00000000-0000-0000-0000-000000000007",
        "name": "Survival",
        "path": "survival",
        "game_version": "1.21.11",
        "loader": "fabric",
        "loader_version": "0.17.2",
        "group": "Friends",
        "selected_norisk_pack_id": "norisk-prod",
        "description": "with the boys",
        "settings": {
            "java_path": "C:/java/bin/java.exe",
            "use_custom_java_path": true,
            "memory": { "min": 1024, "max": 4096 },
            "fullscreen": false,
            "use_custom_jvm_args": true,
            "jvm_args": "-XX:+UseZGC"
        }
    }))
    .unwrap()
}

fn patched(patch: Value) -> Profile {
    let mut profile = profile();
    serde_json::from_value::<ProfilePatch>(patch)
        .unwrap()
        .apply(&mut profile);
    profile
}

fn as_json(profile: &Profile) -> Value {
    serde_json::to_value(profile).unwrap()
}

#[test]
fn an_empty_patch_changes_nothing() {
    assert_eq!(as_json(&patched(json!({}))), as_json(&profile()));
}

#[test]
fn one_setting_changes_and_every_other_setting_stays() {
    let profile = patched(json!({ "settings": { "memory": { "min": 1024, "max": 8192 } } }));

    let mut expected = as_json(&self::profile());
    expected["settings"]["memory"]["max"] = json!(8192);
    assert_eq!(as_json(&profile), expected);
}

#[test]
fn null_clears_a_field_and_a_missing_field_is_left_alone() {
    let profile = patched(json!({
        "group": null,
        "selected_norisk_pack_id": null,
        "settings": { "use_custom_jvm_args": false }
    }));

    assert_eq!(profile.group, None);
    assert_eq!(profile.selected_norisk_pack_id, None);
    assert!(!profile.settings.use_custom_jvm_args);
    assert_eq!(profile.settings.jvm_args, "-XX:+UseZGC");
    assert_eq!(profile.description.as_deref(), Some("with the boys"));
    assert_eq!(
        profile.settings.java_path.as_deref(),
        Some("C:/java/bin/java.exe")
    );
}

#[test]
fn top_level_fields_are_set() {
    let account = Uuid::from_u128(42);
    let profile = patched(json!({
        "name": "Hardcore",
        "game_version": "26.1",
        "loader": "neoforge",
        "loader_version": null,
        "group": "Solo",
        "description": "alone",
        "use_shared_minecraft_folder": true,
        "preferred_account_id": account,
    }));

    assert_eq!(profile.name, "Hardcore");
    assert_eq!(profile.game_version, "26.1");
    assert_eq!(profile.loader, ModLoader::NeoForge);
    assert_eq!(profile.loader_version, None);
    assert_eq!(profile.group.as_deref(), Some("Solo"));
    assert_eq!(profile.description.as_deref(), Some("alone"));
    assert!(profile.use_shared_minecraft_folder);
    assert_eq!(profile.preferred_account_id, Some(account));
}

#[test]
fn a_pinned_loader_version_is_remembered_for_the_current_loader() {
    let profile = patched(json!({
        "settings": { "use_overwrite_loader_version": true, "overwrite_loader_version": "0.16.0" }
    }));

    assert_eq!(
        profile
            .settings
            .overwrite_loader_versions
            .get("fabric")
            .map(String::as_str),
        Some("0.16.0")
    );
}

#[test]
fn unknown_fields_are_refused() {
    assert!(serde_json::from_value::<ProfilePatch>(json!({ "nmae": "typo" })).is_err());
    assert!(
        serde_json::from_value::<ProfilePatch>(json!({ "settings": { "memroy": {} } })).is_err()
    );
}

#[test]
fn an_unknown_loader_is_refused() {
    assert!(serde_json::from_value::<ProfilePatch>(json!({ "loader": "bukkit" })).is_err());
}

fn settings(json: Value) -> ProfileSettings {
    serde_json::from_value(json).unwrap()
}

#[test]
fn old_jvm_args_become_enabled_custom_args() {
    let migrated = settings(json!({ "memory": { "min": 1024, "max": 4096 }, "custom_jvm_args": "-XX:+UseZGC" }));

    assert!(migrated.use_custom_jvm_args);
    assert_eq!(migrated.jvm_args, "-XX:+UseZGC");
}

#[test]
fn old_empty_jvm_args_stay_switched_off() {
    for legacy in [json!(null), json!(""), json!("   ")] {
        let migrated = settings(json!({ "memory": { "min": 1024, "max": 4096 }, "custom_jvm_args": legacy }));
        assert!(!migrated.use_custom_jvm_args);
        assert_eq!(migrated.enabled_jvm_args(), None);
    }
}

#[test]
fn switched_off_args_are_kept_but_not_used() {
    let stored = settings(json!({ "memory": { "min": 1024, "max": 4096 }, "use_custom_jvm_args": false, "jvm_args": "-XX:+UseZGC" }));

    assert_eq!(stored.jvm_args, "-XX:+UseZGC");
    assert_eq!(stored.enabled_jvm_args(), None);
}

#[test]
fn the_old_field_is_never_written_back() {
    let saved = serde_json::to_value(settings(json!({ "memory": { "min": 1024, "max": 4096 }, "custom_jvm_args": "-Xss2M" }))).unwrap();

    assert!(saved.get("custom_jvm_args").is_none());
    assert_eq!(saved["jvm_args"], json!("-Xss2M"));
    assert_eq!(saved["use_custom_jvm_args"], json!(true));
}
