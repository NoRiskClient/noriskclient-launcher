use noriskclient_launcher_v3_lib::state::profile_state::{Mod, ModLoader, ModSource};
use noriskclient_launcher_v3_lib::sync::model::{
    jar_exclusion_key, mod_exclusion_key, SyncPack, SyncPackModEntry,
};
use noriskclient_launcher_v3_lib::sync::profile_mods::{
    profile_pack_mods, ProfilePackInput, ProfileSyncModStatus, ProfileSyncPackMod,
};
use std::collections::HashSet;
use uuid::Uuid;

const MC: &str = "1.21.11";

fn modrinth_mod(project_id: &str, enabled: bool) -> Mod {
    Mod {
        id: Uuid::new_v4(),
        source: ModSource::Modrinth {
            project_id: project_id.to_string(),
            version_id: format!("{}-v1", project_id),
            file_name: format!("{}.jar", project_id),
            download_url: format!("https://example.invalid/{}.jar", project_id),
            file_hash_sha1: None,
        },
        enabled,
        display_name: Some(project_id.to_string()),
        version: None,
        game_versions: None,
        file_name_override: None,
        associated_loader: None,
        modpack_origin: None,
        updates_enabled: true,
        force_include_versions: Vec::new(),
        extra: Default::default(),
    }
}

fn pack(name: &str, mods: Vec<Mod>) -> SyncPack {
    let mut pack: SyncPack = serde_json::from_value(serde_json::json!({ "name": name })).unwrap();
    pack.mods = mods
        .into_iter()
        .map(|info| SyncPackModEntry {
            info,
            version_overrides: Default::default(),
        })
        .collect();
    pack
}

fn input(pack: SyncPack) -> ProfilePackInput {
    ProfilePackInput {
        pack,
        cache: Default::default(),
        local_jars: Vec::new(),
        excluded: HashSet::new(),
    }
}

fn view(inputs: &[ProfilePackInput], profile_mods: &[Mod]) -> Vec<ProfileSyncPackMod> {
    profile_pack_mods(inputs, profile_mods, MC, ModLoader::Fabric)
}

#[test]
fn a_mod_the_profile_already_has_is_shadowed_by_the_profile() {
    let inputs = [input(pack(
        "Performance",
        vec![modrinth_mod("sodium", true)],
    ))];

    let out = view(&inputs, &[modrinth_mod("sodium", true)]);

    assert_eq!(out[0].status, ProfileSyncModStatus::Shadowed);
    assert_eq!(out[0].shadowed_by_pack, None);
}

#[test]
fn a_disabled_profile_copy_does_not_shadow_the_pack() {
    let inputs = [input(pack(
        "Performance",
        vec![modrinth_mod("sodium", true)],
    ))];

    let out = view(&inputs, &[modrinth_mod("sodium", false)]);

    assert_eq!(out[0].status, ProfileSyncModStatus::Pending);
}

#[test]
fn a_profile_copy_for_another_version_does_not_shadow_the_pack() {
    let inputs = [input(pack(
        "Performance",
        vec![modrinth_mod("sodium", true)],
    ))];
    let mut other_version = modrinth_mod("sodium", true);
    other_version.game_versions = Some(vec!["1.20.1".to_string()]);

    let out = view(&inputs, &[other_version]);

    assert_eq!(out[0].status, ProfileSyncModStatus::Pending);
}

#[test]
fn the_later_pack_wins_when_two_packs_share_a_mod() {
    let inputs = [
        input(pack("First", vec![modrinth_mod("sodium", true)])),
        input(pack("Second", vec![modrinth_mod("sodium", true)])),
    ];

    let out = view(&inputs, &[]);

    assert_eq!(out[0].status, ProfileSyncModStatus::Shadowed);
    assert_eq!(out[0].shadowed_by_pack.as_deref(), Some("Second"));
    assert_eq!(out[1].status, ProfileSyncModStatus::Pending);
}

#[test]
fn a_mod_turned_off_here_hands_the_slot_back_to_the_other_pack() {
    let second = pack("Second", vec![modrinth_mod("sodium", true)]);
    let excluded_key = mod_exclusion_key(second.mods[0].info.id);
    let mut second = input(second);
    second.excluded.insert(excluded_key);
    let inputs = [
        input(pack("First", vec![modrinth_mod("sodium", true)])),
        second,
    ];

    let out = view(&inputs, &[]);

    assert_eq!(out[0].status, ProfileSyncModStatus::Pending);
    assert_eq!(out[1].status, ProfileSyncModStatus::ExcludedHere);
}

#[test]
fn a_mod_off_in_the_pack_shows_as_disabled() {
    let mut info = modrinth_mod("sodium", false);
    info.display_name = Some("Sodium".to_string());
    let inputs = [input(pack("Performance", vec![info]))];

    let out = view(&inputs, &[]);

    assert_eq!(out[0].status, ProfileSyncModStatus::Disabled);
    assert_eq!(out[0].display_name, "Sodium");
}

#[test]
fn local_jars_are_listed_and_can_be_turned_off_here() {
    let mut performance = input(pack("Performance", Vec::new()));
    performance.local_jars = vec!["a.jar".to_string(), "b.jar".to_string()];
    performance.excluded.insert(jar_exclusion_key("b.jar"));

    let out = view(&[performance], &[]);

    assert_eq!(out.len(), 2);
    assert_eq!(out[0].status, ProfileSyncModStatus::Active);
    assert_eq!(out[0].mod_id, None);
    assert_eq!(out[1].status, ProfileSyncModStatus::ExcludedHere);
    assert_eq!(out[1].mod_key, jar_exclusion_key("b.jar"));
}
