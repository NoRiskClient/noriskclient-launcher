use noriskclient_launcher_v3_lib::state::profile_state::*;
use noriskclient_launcher_v3_lib::utils::profile_utils::{
    ContentType, GenericModrinthInfo, LocalContentItem,
};
use std::collections::HashSet;
use uuid::Uuid;

fn modrinth_mod(project_id: &str, version_id: &str, file_name: &str, enabled: bool) -> Mod {
    Mod {
        id: Uuid::new_v4(),
        source: ModSource::Modrinth {
            project_id: project_id.to_string(),
            version_id: version_id.to_string(),
            file_name: file_name.to_string(),
            download_url: format!("https://example.invalid/{}", file_name),
            file_hash_sha1: None,
        },
        enabled,
        display_name: Some(file_name.to_string()),
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

fn item_for(id: Option<String>, project_id: Option<&str>) -> LocalContentItem {
    LocalContentItem {
        filename: "whatever.jar".to_string(),
        path_str: "whatever.jar".to_string(),
        sha1_hash: None,
        file_size: 0,
        is_disabled: false,
        is_directory: false,
        content_type: ContentType::Mod,
        modrinth_info: project_id.map(|pid| GenericModrinthInfo {
            project_id: pid.to_string(),
            version_id: String::new(),
            name: String::new(),
            version_number: String::new(),
            download_url: None,
            icon_url: None,
        }),
        curseforge_info: None,
        platform: None,
        source_type: None,
        norisk_info: None,
        fallback_version: None,
        id,
        associated_loader: None,
        modpack_origin: None,
        updates_enabled: None,
    }
}

#[test]
fn version_switch_targets_the_requested_entry_not_the_first_of_that_project() {
    let mods = vec![
        modrinth_mod("HfLFMeJe", "yYDMcr06", "ShieldFixes-2.0.3+26.1.jar", false),
        modrinth_mod("7P86n6Vg", "vFc9U3Fy", "WalksyLib-1.0.11+26.1.jar", false),
        modrinth_mod("7P86n6Vg", "XoYFvwqe", "WalksyLib-1.0.12+26.2.jar", false),
        modrinth_mod("7P86n6Vg", "MtfON55Y", "WalksyLib-1.0.10+26.1.jar", true),
    ];

    let wanted = mods[2].id.to_string();
    let item = item_for(Some(wanted.clone()), Some("7P86n6Vg"));

    let idx = find_mod_for_version_switch(&mods, &item).expect("entry must be found");
    assert_eq!(mods[idx].id.to_string(), wanted);
}

#[test]
fn version_switch_falls_back_to_project_when_no_id_is_given() {
    let mods = vec![
        modrinth_mod("HfLFMeJe", "yYDMcr06", "ShieldFixes-2.0.3+26.1.jar", true),
        modrinth_mod("7P86n6Vg", "vFc9U3Fy", "WalksyLib-1.0.11+26.1.jar", true),
    ];

    let item = item_for(None, Some("7P86n6Vg"));
    let idx = find_mod_for_version_switch(&mods, &item).expect("fallback must still work");
    assert_eq!(idx, 1);
}

#[test]
fn version_switch_reports_missing_instead_of_hitting_a_sibling() {
    let mods = vec![modrinth_mod(
        "7P86n6Vg",
        "vFc9U3Fy",
        "WalksyLib-1.0.11+26.1.jar",
        true,
    )];

    let item = item_for(Some(Uuid::new_v4().to_string()), Some("7P86n6Vg"));
    assert!(find_mod_for_version_switch(&mods, &item).is_none());
}

#[test]
fn a_disabled_dependency_counts_as_installed() {
    let mods = vec![modrinth_mod(
        "7P86n6Vg",
        "vFc9U3Fy",
        "WalksyLib-1.0.11+26.1.jar",
        false,
    )];

    assert!(find_mod_by_project_id(&mods, "7P86n6Vg").is_some());
}

#[test]
fn same_project_in_another_version_is_recognised_as_present() {
    let mods = vec![modrinth_mod(
        "7P86n6Vg",
        "vFc9U3Fy",
        "WalksyLib-1.0.11+26.1.jar",
        true,
    )];

    let incoming = ModSource::Modrinth {
        project_id: "7P86n6Vg".to_string(),
        version_id: "MtfON55Y".to_string(),
        file_name: "WalksyLib-1.0.10+26.1.jar".to_string(),
        download_url: "https://example.invalid/WalksyLib-1.0.10+26.1.jar".to_string(),
        file_hash_sha1: None,
    };

    assert_eq!(find_mod_by_project(&mods, &incoming), Some(0));
}

#[test]
fn different_projects_stay_separate() {
    let mods = vec![modrinth_mod(
        "HfLFMeJe",
        "yYDMcr06",
        "ShieldFixes-2.0.3+26.1.jar",
        true,
    )];

    let incoming = ModSource::Modrinth {
        project_id: "7P86n6Vg".to_string(),
        version_id: "MtfON55Y".to_string(),
        file_name: "WalksyLib-1.0.10+26.1.jar".to_string(),
        download_url: "https://example.invalid/WalksyLib-1.0.10+26.1.jar".to_string(),
        file_hash_sha1: None,
    };

    assert!(find_mod_by_project(&mods, &incoming).is_none());
}

#[test]
fn replacing_keeps_the_entry_identity_and_user_choices() {
    let mut existing = modrinth_mod("7P86n6Vg", "vFc9U3Fy", "WalksyLib-1.0.11+26.1.jar", false);
    existing.updates_enabled = false;
    existing.modpack_origin = Some("modrinth:abc".to_string());
    let original_id = existing.id;

    let payload = noriskclient_launcher_v3_lib::commands::content_command::InstallContentPayload {
        profile_id: Uuid::new_v4(),
        project_id: "7P86n6Vg".to_string(),
        version_id: "MtfON55Y".to_string(),
        file_name: "WalksyLib-1.0.10+26.1.jar".to_string(),
        download_url: "https://example.invalid/WalksyLib-1.0.10+26.1.jar".to_string(),
        file_hash_sha1: None,
        file_fingerprint: None,
        content_name: Some("WalksyLib".to_string()),
        version_number: Some("1.0.10+26.1".to_string()),
        content_type: ContentType::Mod,
        loaders: Some(vec!["fabric".to_string()]),
        game_versions: Some(vec!["26.1".to_string()]),
        source: noriskclient_launcher_v3_lib::integrations::unified_mod::ModPlatform::Modrinth,
    };

    let new_source = ModSource::Modrinth {
        project_id: "7P86n6Vg".to_string(),
        version_id: "MtfON55Y".to_string(),
        file_name: "WalksyLib-1.0.10+26.1.jar".to_string(),
        download_url: "https://example.invalid/WalksyLib-1.0.10+26.1.jar".to_string(),
        file_hash_sha1: None,
    };

    replace_mod_with_payload(&mut existing, &payload, new_source.clone());

    assert_eq!(existing.id, original_id);
    assert_eq!(existing.source, new_source);
    assert!(existing.enabled);
    assert!(!existing.updates_enabled);
    assert_eq!(existing.modpack_origin.as_deref(), Some("modrinth:abc"));
}

#[test]
fn local_mods_never_match_a_platform_project() {
    let mods = vec![Mod {
        id: Uuid::new_v4(),
        source: ModSource::Local {
            file_name: "custom.jar".to_string(),
        },
        enabled: true,
        display_name: None,
        version: None,
        game_versions: None,
        file_name_override: None,
        associated_loader: None,
        modpack_origin: None,
        updates_enabled: true,
        force_include_versions: Vec::new(),
        extra: Default::default(),
    }];

    assert!(find_mod_by_project_id(&mods, "7P86n6Vg").is_none());
}

#[test]
fn a_field_from_a_newer_launcher_survives_a_load_and_save() {
    let raw = serde_json::json!({
        "name": "test",
        "path": "test",
        "game_version": "1.20.1",
        "loader": "forge",
        "sync_pack_ids": ["8f14e45f-ceea-467a-9575-4a1a0d0b2c33"],
        "from_an_even_newer_build": 42,
    });

    let profile: Profile =
        serde_json::from_value(raw.clone()).expect("profile fixture must deserialize");
    let round_tripped = serde_json::to_value(&profile).expect("profile must serialize");

    assert_eq!(
        round_tripped.get("sync_pack_ids"),
        raw.get("sync_pack_ids"),
        "sync_pack_ids is present on all 423 live profiles and must not be dropped"
    );
    assert_eq!(
        round_tripped.get("from_an_even_newer_build"),
        raw.get("from_an_even_newer_build"),
        "an unknown key must round-trip so a downgrade cannot destroy newer data"
    );
}

#[test]
fn a_field_from_a_newer_launcher_survives_on_a_mod() {
    let raw = serde_json::json!({
        "id": "8f14e45f-ceea-467a-9575-4a1a0d0b2c33",
        "source": { "type": "local", "file_name": "custom.jar" },
        "enabled": true,
        "display_name": null,
        "version": null,
        "game_versions": null,
        "file_name_override": null,
        "associated_loader": null,
        "modpack_origin": null,
        "pinned_by_a_newer_build": true,
    });

    let entry: Mod = serde_json::from_value(raw.clone()).expect("mod fixture must deserialize");
    let round_tripped = serde_json::to_value(&entry).expect("mod must serialize");

    assert_eq!(
        round_tripped.get("pinned_by_a_newer_build"),
        raw.get("pinned_by_a_newer_build"),
        "an unknown key on a mod must round-trip"
    );
}

const REAL_CORPUS: &str = include_str!("../../fixtures/profile_corpus_real.json");

fn canonical(profile: &Profile) -> serde_json::Value {
    let mut value = serde_json::to_value(profile).expect("profile must serialize");
    if let Some(set) = value
        .get_mut("disabled_norisk_mods_detailed")
        .and_then(|v| v.as_array_mut())
    {
        set.sort_by_key(|entry| entry.to_string());
    }
    value
}

const SYNTHETIC_CORPUS: &str = include_str!("../../fixtures/profile_corpus_synthetic.json");

fn corpus() -> Vec<serde_json::Value> {
    let mut all: Vec<serde_json::Value> =
        serde_json::from_str(REAL_CORPUS).expect("real corpus must be a JSON array");
    let synthetic: Vec<serde_json::Value> =
        serde_json::from_str(SYNTHETIC_CORPUS).expect("synthetic corpus must be a JSON array");
    all.extend(synthetic);
    all
}

#[test]
fn every_corpus_profile_deserializes() {
    let entries = corpus();
    assert_eq!(entries.len(), 23, "the corpus lost profiles");

    for (index, raw) in entries.iter().enumerate() {
        let name = raw.get("name").and_then(|v| v.as_str()).unwrap_or("?");
        serde_json::from_value::<Profile>(raw.clone())
            .unwrap_or_else(|e| panic!("corpus entry {} ({}) must parse: {}", index, name, e));
    }
}

#[test]
fn the_corpus_round_trips_through_serde_without_loss() {
    for (index, raw) in corpus().iter().enumerate() {
        let profile: Profile = serde_json::from_value(raw.clone())
            .unwrap_or_else(|e| panic!("corpus entry {} must parse: {}", index, e));

        let mut expected = raw.clone();
        if let Some(set) = expected
            .get_mut("disabled_norisk_mods_detailed")
            .and_then(|v| v.as_array_mut())
        {
            set.sort_by_key(|entry| entry.to_string());
        }

        assert_eq!(
            canonical(&profile),
            expected,
            "corpus entry {} changed shape on a serde round trip",
            index
        );
    }
}

#[test]
fn the_corpus_covers_every_tagged_variant() {
    let mut sources = std::collections::HashSet::new();
    let mut images = std::collections::HashSet::new();
    let mut loaders = std::collections::HashSet::new();
    let mut states = std::collections::HashSet::new();
    let mut packs = std::collections::HashSet::new();

    for raw in corpus() {
        let profile: Profile = serde_json::from_value(raw).expect("corpus entry must parse");
        loaders.insert(profile.loader);
        states.insert(format!("{:?}", profile.state));
        if let Some(info) = &profile.modpack_info {
            packs.insert(std::mem::discriminant(&info.source));
        }
        for entry in &profile.mods {
            sources.insert(std::mem::discriminant(&entry.source));
        }
        for slot in [&profile.banner, &profile.background] {
            if let Some(banner) = slot {
                images.insert(std::mem::discriminant(&banner.source));
            }
        }
    }

    assert_eq!(
        sources.len(),
        6,
        "every ModSource variant needs a corpus entry"
    );
    assert_eq!(
        images.len(),
        5,
        "every ImageSource variant needs a corpus entry"
    );
    assert_eq!(
        packs.len(),
        2,
        "both ModPackSource variants need a corpus entry"
    );
    assert_eq!(loaders.len(), 5, "every ModLoader needs a corpus entry");
    assert_eq!(states.len(), 5, "every ProfileState needs a corpus entry");
}

#[test]
fn adding_a_field_to_profile_must_break_this_test() {
    let profile: Profile = serde_json::from_value(serde_json::json!({
        "name": "t", "path": "t", "game_version": "1.20.1", "loader": "forge",
    }))
    .expect("profile fixture must deserialize");

    let Profile {
        sync_pack_ids: _,
        id: _,
        name: _,
        path: _,
        game_version: _,
        loader: _,
        loader_version: _,
        created: _,
        last_played: _,
        settings: _,
        state: _,
        mods: _,
        selected_norisk_pack_id: _,
        disabled_norisk_mods_detailed: _,
        source_standard_profile_id: _,
        group: _,
        use_shared_minecraft_folder: _,
        is_standard_version: _,
        description: _,
        banner: _,
        background: _,
        norisk_information: _,
        modpack_info: _,
        preferred_account_id: _,
        playtime_seconds: _,
        extra: _,
    } = profile;
}

#[test]
fn adding_a_field_to_mod_must_break_this_test() {
    let entry = Mod {
        id: Uuid::new_v4(),
        source: ModSource::Local {
            file_name: "a.jar".to_string(),
        },
        enabled: true,
        display_name: None,
        version: None,
        game_versions: None,
        file_name_override: None,
        associated_loader: None,
        modpack_origin: None,
        updates_enabled: true,
        force_include_versions: Vec::new(),
        extra: Default::default(),
    };

    let Mod {
        id: _,
        source: _,
        enabled: _,
        display_name: _,
        version: _,
        game_versions: _,
        file_name_override: _,
        associated_loader: _,
        modpack_origin: _,
        updates_enabled: _,
        force_include_versions: _,
        extra: _,
    } = entry;
}

#[test]
fn adding_an_enum_variant_must_break_this_test() {
    fn mod_source_tag(source: &ModSource) -> &'static str {
        match source {
            ModSource::Local { .. } => "local",
            ModSource::Url { .. } => "url",
            ModSource::Maven { .. } => "maven",
            ModSource::Embedded { .. } => "embedded",
            ModSource::Modrinth { .. } => "modrinth",
            ModSource::CurseForge { .. } => "curse_forge",
        }
    }

    fn image_tag(source: &ImageSource) -> &'static str {
        match source {
            ImageSource::Url { .. } => "url",
            ImageSource::RelativePath { .. } => "relativePath",
            ImageSource::RelativeProfile { .. } => "relativeProfile",
            ImageSource::AbsolutePath { .. } => "absolutePath",
            ImageSource::Base64 { .. } => "base64",
        }
    }

    fn pack_tag(source: &ModPackSource) -> &'static str {
        match source {
            ModPackSource::Modrinth { .. } => "modrinth",
            ModPackSource::CurseForge { .. } => "curse_forge",
        }
    }

    fn state_tag(state: &ProfileState) -> &'static str {
        match state {
            ProfileState::NotInstalled => "not_installed",
            ProfileState::Installing => "installing",
            ProfileState::Installed => "installed",
            ProfileState::Running => "running",
            ProfileState::Error => "error",
        }
    }

    assert_eq!(
        mod_source_tag(&ModSource::Local {
            file_name: "a".into()
        }),
        serde_json::to_value(ModSource::Local {
            file_name: "a".into()
        })
        .unwrap()["type"]
    );
    assert_eq!(
        image_tag(&ImageSource::RelativeProfile { path: "a".into() }),
        serde_json::to_value(ImageSource::RelativeProfile { path: "a".into() }).unwrap()["type"]
    );
    assert_eq!(
        pack_tag(&ModPackSource::CurseForge {
            project_id: 1,
            file_id: 2
        }),
        serde_json::to_value(ModPackSource::CurseForge {
            project_id: 1,
            file_id: 2
        })
        .unwrap()["source"]
    );
    assert_eq!(
        state_tag(&ProfileState::NotInstalled),
        serde_json::to_value(ProfileState::NotInstalled).unwrap()
    );
}

fn persistence_fixture(path: &str) -> Profile {
    serde_json::from_value(serde_json::json!({
        "name": "test",
        "path": path,
        "game_version": "1.21.1",
        "loader": "fabric",
    }))
    .expect("fixture must deserialize")
}

#[test]
fn an_ordinary_profile_is_persisted() {
    let profile = persistence_fixture("some-profile");
    assert!(should_persist(&profile, &HashSet::new()));
}

#[test]
fn a_transient_profile_is_never_persisted() {
    let profile = persistence_fixture("some-profile");
    let transient = HashSet::from([profile.id]);
    assert!(
        !should_persist(&profile, &transient),
        "a CLI temp profile lives in memory only and must never reach the database"
    );
}

#[test]
fn a_temp_path_profile_is_never_persisted() {
    let profile = persistence_fixture("noriskclient/temp/whatever");
    assert!(
        !should_persist(&profile, &HashSet::new()),
        "the temp path alone must keep a profile out of the database"
    );
}

#[test]
fn a_standard_template_without_a_source_link_is_never_persisted() {
    let mut profile = persistence_fixture("standard");
    profile.is_standard_version = true;
    profile.source_standard_profile_id = None;
    assert!(!should_persist(&profile, &HashSet::new()));
}

#[test]
fn an_editable_copy_of_a_standard_profile_is_persisted() {
    let mut profile = persistence_fixture("standard-copy");
    profile.is_standard_version = true;
    profile.source_standard_profile_id = Some(Uuid::new_v4());
    assert!(
        should_persist(&profile, &HashSet::new()),
        "a user's editable copy carries their changes and must be written"
    );
}
