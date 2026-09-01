use noriskclient_launcher_v3_lib::state::profile_state::Profile;
use noriskclient_launcher_v3_lib::utils::import_safety::*;
use std::path::PathBuf;

#[test]
fn rejects_absolute_windows_path() {
    assert!(safe_file_component(r"C:\Users\x\Startup\evil.bat").is_err());
    assert!(safe_file_component("C:/Users/x/evil.bat").is_err());
}

#[test]
fn rejects_traversal_and_nesting() {
    assert!(safe_file_component("../../evil.jar").is_err());
    assert!(safe_file_component("..").is_err());
    assert!(safe_file_component("sub/dir/x.jar").is_err());
    assert!(safe_file_component("").is_err());
}

#[test]
fn accepts_plain_jar_names() {
    assert_eq!(
        safe_file_component("sodium-fabric-mc1.21.5-0.6.0.jar").unwrap(),
        "sodium-fabric-mc1.21.5-0.6.0.jar"
    );
}

#[test]
fn accepts_real_world_content_file_names() {
    for name in [
        "sodium-fabric-0.6.0.jar",
        "ComplementaryReimagined_r5.5.1.zip",
        "Icon Xaero's 1.21.zip",
        "ReShaded [v.1.4] 1.21.6-1.21.10 .zip",
        "Farmer's Delight Cutting Compat 1.0.zip",
        "§3Fresh §bFlower Pots.zip",
        "Animated+.zip",
    ] {
        assert!(safe_file_component(name).is_ok(), "should accept {name}");
        assert!(
            check_content_file_name(name).is_ok(),
            "should accept {name} as content"
        );
    }
}

#[test]
fn rejects_platform_specific_path_tricks() {
    for name in [
        r"C:evil.jar",
        r"\\attacker\share\evil.jar",
        r"//attacker/share/evil.jar",
        "evil.jar.",
        "evil.jar ",
        "CON.jar",
        "NUL.jar",
        "lpt1.jar",
        "..\\..\\evil.jar",
        "evil\u{0000}.jar",
        "evil\u{001b}.jar",
        ".",
        "...",
        "   ",
    ] {
        assert!(safe_file_component(name).is_err(), "should reject {name:?}");
    }
}

#[test]
fn rejects_executable_content_names() {
    assert!(check_content_file_name("payload.exe").is_err());
    assert!(check_content_file_name("payload.bat").is_err());
    assert!(check_content_file_name("payload").is_err());
}

#[test]
fn requires_https_and_known_cdn() {
    assert!(require_host(
        "https://cdn.modrinth.com/data/a/versions/b/c.jar",
        MODRINTH_HOSTS,
        "Modrinth"
    )
    .is_ok());
    assert!(require_host(
        "http://cdn.modrinth.com/data/a/versions/b/c.jar",
        MODRINTH_HOSTS,
        "Modrinth"
    )
    .is_err());
    assert!(require_host(
        "https://evil.cdn.modrinth.com.attacker.net/x.jar",
        MODRINTH_HOSTS,
        "Modrinth"
    )
    .is_err());
}

#[test]
fn neutralises_the_disclosed_noriskpack_payload() {
    let payload = r#"{
        "name": "Totally Legit Optimisation Pack",
        "path": "legit-pack",
        "game_version": "1.21.5",
        "loader": "fabric",
        "settings": {
            "java_path": "C:\\Windows\\System32\\calc.exe",
            "use_custom_java_path": true,
            "overwrite_loader_version": null,
            "custom_jvm_args": "-javaagent:C:/ProgramData/nrc.jar",
            "memory": { "min": 1024, "max": 4096 }
        },
        "mods": [
            {
                "source": {
                    "type": "modrinth",
                    "project_id": "AANobbMI",
                    "version_id": "tFw0iWAk",
                    "file_name": "C:/Users/x/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/nrc-poc.bat",
                    "download_url": "http://127.0.0.1:8000/calc.bat",
                    "file_hash_sha1": null
                },
                "enabled": true,
                "display_name": "Sodium",
                "version": "0.5.3",
                "game_versions": ["1.21.5"],
                "file_name_override": null,
                "associated_loader": "fabric",
                "modpack_origin": null
            }
        ]
    }"#;

    let mut profile: Profile = serde_json::from_str(payload).expect("payload should parse");
    let report = sanitize_imported_profile(&mut profile);

    assert_eq!(profile.settings.java_path, None);
    assert!(!profile.settings.use_custom_java_path);
    assert_eq!(profile.settings.custom_jvm_args, None);

    assert!(profile.mods.is_empty());

    assert!(report.stripped_java_path.is_some());
    assert!(report.stripped_jvm_args.is_some());
    assert_eq!(report.rejected_mods.len(), 1);
    assert!(report.has_critical_findings());
}

#[test]
fn keeps_a_legitimate_pack_intact() {
    let payload = r#"{
        "name": "Performance Pack",
        "path": "performance-pack",
        "game_version": "1.21.5",
        "loader": "fabric",
        "settings": {
            "java_path": null,
            "overwrite_loader_version": "0.16.9",
            "use_overwrite_loader_version": true,
            "fullscreen": true,
            "memory": { "min": 1024, "max": 6144 }
        },
        "mods": [
            {
                "source": {
                    "type": "modrinth",
                    "project_id": "AANobbMI",
                    "version_id": "tFw0iWAk",
                    "file_name": "sodium-fabric-0.6.0.jar",
                    "download_url": "https://cdn.modrinth.com/data/AANobbMI/versions/tFw0iWAk/sodium-fabric-0.6.0.jar",
                    "file_hash_sha1": "0000000000000000000000000000000000000000"
                },
                "enabled": true,
                "display_name": "Sodium",
                "version": "0.6.0",
                "game_versions": ["1.21.5"],
                "file_name_override": null,
                "associated_loader": "fabric",
                "modpack_origin": null
            }
        ]
    }"#;

    let mut profile: Profile = serde_json::from_str(payload).expect("payload should parse");
    let report = sanitize_imported_profile(&mut profile);

    assert!(report.is_clean(), "unexpected findings: {:?}", report);
    assert_eq!(profile.mods.len(), 1);
    assert_eq!(profile.settings.memory.max, 6144);
    assert!(profile.settings.fullscreen);
    assert_eq!(
        profile.settings.overwrite_loader_version.as_deref(),
        Some("0.16.9")
    );
}

#[test]
fn strips_profile_flags_a_pack_has_no_business_setting() {
    let payload = r#"{
        "name": "Official Looking Pack",
        "path": "official",
        "game_version": "1.21.5",
        "loader": "fabric",
        "is_standard_version": true,
        "use_shared_minecraft_folder": true,
        "preferred_account_id": "11111111-2222-3333-4444-555555555555",
        "playtime_seconds": 999999,
        "banner": { "source": { "type": "absolutePath", "path": "C:/Users/x/.ssh/id_rsa" } },
        "background": { "source": { "type": "relativePath", "path": "../../../../etc/passwd" } },
        "settings": {
            "java_path": null,
            "overwrite_loader_version": null,
            "memory": { "min": 1024, "max": 4096 }
        }
    }"#;

    let mut profile: Profile = serde_json::from_str(payload).expect("payload should parse");
    let report = sanitize_imported_profile(&mut profile);

    assert!(!profile.is_standard_version);
    assert!(!profile.use_shared_minecraft_folder);
    assert_eq!(profile.preferred_account_id, None);
    assert_eq!(profile.playtime_seconds, 0);
    assert!(profile.banner.is_none());
    assert!(profile.background.is_none());
    assert_eq!(report.stripped_profile_flags.len(), 5);
}

#[test]
fn keeps_banners_a_pack_may_legitimately_ship() {
    for source in [
        r#"{ "type": "base64", "data": "iVBORw0KGgo=", "mimeType": "image/png" }"#,
        r#"{ "type": "url", "url": "https://cdn.modrinth.com/banner.png" }"#,
        r#"{ "type": "relativeProfile", "path": "banner.png" }"#,
    ] {
        let payload = format!(
            r#"{{
                "name": "Pack",
                "path": "pack",
                "game_version": "1.21.5",
                "loader": "fabric",
                "banner": {{ "source": {source} }},
                "settings": {{
                    "java_path": null,
                    "overwrite_loader_version": null,
                    "memory": {{ "min": 1024, "max": 4096 }}
                }}
            }}"#
        );

        let mut profile: Profile = serde_json::from_str(&payload).expect("payload should parse");
        sanitize_imported_profile(&mut profile);
        assert!(profile.banner.is_some(), "should keep banner {source}");
    }
}

#[test]
fn version_strings_reject_path_characters() {
    assert!(is_version_like("0.16.9"));
    assert!(is_version_like("1.21.5-build.4"));
    assert!(!is_version_like("../../evil"));
    assert!(!is_version_like(""));
}

#[test]
fn safe_relative_path_accepts_nested_segments() {
    assert_eq!(
        safe_relative_path("saves/world").unwrap(),
        PathBuf::from("saves").join("world")
    );
    assert_eq!(safe_relative_path("/mods/").unwrap(), PathBuf::from("mods"));
}

#[test]
fn safe_relative_path_keeps_folder_names_the_os_allows() {
    for good in [
        "resourcepacks",
        "My Packs",
        "CON",
        "shaders.backup",
        "a.b.c",
    ] {
        assert!(
            safe_relative_path(good).is_ok(),
            "expected '{}' to be accepted",
            good
        );
    }
}

#[test]
fn safe_relative_path_rejects_escapes_and_empties() {
    for bad in [
        "..",
        "../../etc",
        "saves/../../..",
        r"mods\..\x",
        "",
        "/",
        "///",
    ] {
        assert!(
            safe_relative_path(bad).is_err(),
            "expected '{}' to be rejected",
            bad
        );
    }
}
