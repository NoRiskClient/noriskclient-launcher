use super::*;
use crate::utils::profile_utils::{ContentType, GenericModrinthInfo, LocalContentItem};

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

    let payload = crate::commands::content_command::InstallContentPayload {
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
        source: crate::integrations::unified_mod::ModPlatform::Modrinth,
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
    }];

    assert!(find_mod_by_project_id(&mods, "7P86n6Vg").is_none());
}
