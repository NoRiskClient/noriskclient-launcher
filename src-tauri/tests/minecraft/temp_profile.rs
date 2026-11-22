use noriskclient_launcher_v3_lib::minecraft::temp_profile::{
    build_temp_profile, mod_references, validate_args, TempLaunchArgs,
};
use noriskclient_launcher_v3_lib::state::profile_state::{should_persist, Profile};
use serde_json::json;
use std::collections::HashSet;

fn args() -> TempLaunchArgs {
    TempLaunchArgs {
        game_version: "1.21.4".into(),
        loader: "fabric".into(),
        loader_version: None,
        pack: Some("norisk-prod".into()),
        name: None,
        quick_play_singleplayer: None,
        quick_play_multiplayer: None,
        local_mods: Vec::new(),
        account: None,
        jvm_args: Vec::new(),
    }
}

fn real_profile() -> Profile {
    serde_json::from_value(json!({
        "name": "Survival",
        "path": "Survival",
        "game_version": "1.21.4",
        "loader": "fabric",
        "mods": [
            { "source": { "type": "modrinth", "project_id": "AANobbMI", "version_id": "tFw0iWAk",
                          "file_name": "sodium.jar", "download_url": "https://cdn.modrinth.com/x.jar",
                          "file_hash_sha1": null }, "enabled": true },
            { "source": { "type": "local", "file_name": "private.jar" }, "enabled": true }
        ]
    }))
    .unwrap()
}

#[test]
fn a_temp_profile_is_marked_temporary_and_never_saved() {
    let profile = build_temp_profile(&args(), "test").unwrap();
    assert!(profile.path.starts_with("noriskclient/temp/"));
    assert!(!should_persist(&profile, &HashSet::new()));
    assert_eq!(profile.extra.get("is_temporary"), Some(&json!(true)));
    assert_eq!(profile.selected_norisk_pack_id.as_deref(), Some("norisk-prod"));
}

#[test]
fn copied_mods_are_only_platform_references_with_new_ids() {
    let real = real_profile();
    let before = serde_json::to_value(&real).unwrap();
    let mods = mod_references(&real);
    assert_eq!(mods.len(), 1);
    assert_ne!(mods[0].id, real.mods[0].id);
    assert_eq!(serde_json::to_value(&real).unwrap(), before);
}

#[test]
fn launch_args_are_checked_before_anything_is_built() {
    assert!(validate_args(&args()).is_ok());
    let bad = [
        TempLaunchArgs { game_version: "../1".into(), ..args() },
        TempLaunchArgs { loader: "liteloader".into(), ..args() },
        TempLaunchArgs { loader_version: Some("x;rm".into()), ..args() },
        TempLaunchArgs { pack: Some("Bad Pack".into()), ..args() },
    ];
    for a in bad {
        assert!(validate_args(&a).is_err(), "{:?}", a);
    }
}
