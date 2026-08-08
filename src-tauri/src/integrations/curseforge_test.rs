use super::*;

#[test]
fn extracts_plain_loader_versions() {
    assert_eq!(
        extract_loader_version("forge-50.0.0", Some("1.21.1")).as_deref(),
        Some("50.0.0")
    );
    assert_eq!(
        extract_loader_version("fabric-0.15.11", Some("1.21.1")).as_deref(),
        Some("0.15.11")
    );
    assert_eq!(
        extract_loader_version("quilt-0.17.0", Some("1.20.1")).as_deref(),
        Some("0.17.0")
    );
    assert_eq!(
        extract_loader_version("neoforge-21.1.203", Some("1.21.1")).as_deref(),
        Some("21.1.203")
    );
}

#[test]
fn strips_the_neoforge_1_20_1_prefix() {
    assert_eq!(
        extract_loader_version("neoforge-1.20.1-47.1.106", Some("1.20.1")).as_deref(),
        Some("47.1.106")
    );
    assert_eq!(
        extract_loader_version("neoforge-1.20.1", Some("1.20.1")).as_deref(),
        Some("1.20.1")
    );
    assert_eq!(
        extract_loader_version("neoforge-1.20.1-47.1.106", None).as_deref(),
        Some("1.20.1-47.1.106")
    );
}

#[test]
fn tolerates_the_fabric_loader_spelling() {
    assert_eq!(
        extract_loader_version("fabric-loader-0.15.11", Some("1.21.1")).as_deref(),
        Some("0.15.11")
    );
}

#[test]
fn rejects_ids_without_a_known_loader() {
    assert_eq!(extract_loader_version("liteloader-1.12", Some("1.12")), None);
    assert_eq!(extract_loader_version("forge", Some("1.21.1")), None);
    assert_eq!(extract_loader_version("", Some("1.21.1")), None);
}

#[test]
fn primary_loader_wins_over_first_entry() {
    let loaders = vec![
        CurseForgeModLoader {
            id: "fabric-0.15.11".to_string(),
            primary: Some(false),
        },
        CurseForgeModLoader {
            id: "neoforge-1.20.1-47.1.106".to_string(),
            primary: Some(true),
        },
    ];

    let (loader, version) = determine_loader_from_curseforge_loaders(&loaders, Some("1.20.1"));
    assert_eq!(loader, ModLoader::NeoForge);
    assert_eq!(version.as_deref(), Some("47.1.106"));
}
