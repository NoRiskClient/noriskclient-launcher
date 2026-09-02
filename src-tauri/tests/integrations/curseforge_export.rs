use noriskclient_launcher_v3_lib::integrations::curseforge;
use noriskclient_launcher_v3_lib::integrations::curseforge_export::*;
use noriskclient_launcher_v3_lib::state::profile_state::ModLoader;

fn entry(project_id: u32, file_name: &str, display_name: Option<&str>) -> IndexEntry {
    IndexEntry {
        project_id,
        file_id: 1,
        file_name: file_name.to_string(),
        display_name: display_name.map(|name| name.to_string()),
    }
}

#[test]
fn builds_curseforge_loader_ids() {
    assert_eq!(
        curseforge_loader_id(ModLoader::Forge, "1.21.1", "50.0.0"),
        "forge-50.0.0"
    );
    assert_eq!(
        curseforge_loader_id(ModLoader::Fabric, "1.21.1", "0.15.11"),
        "fabric-0.15.11"
    );
    assert_eq!(
        curseforge_loader_id(ModLoader::Quilt, "1.20.1", "0.17.0"),
        "quilt-0.17.0"
    );
    assert_eq!(
        curseforge_loader_id(ModLoader::NeoForge, "1.21.1", "21.1.203"),
        "neoforge-21.1.203"
    );
}

#[test]
fn neoforge_on_1_20_1_carries_the_game_version() {
    assert_eq!(
        curseforge_loader_id(ModLoader::NeoForge, "1.20.1", "47.1.106"),
        "neoforge-1.20.1-47.1.106"
    );
}

#[test]
fn loader_ids_round_trip_through_the_importer() {
    for (loader, game_version, loader_version) in [
        (ModLoader::Forge, "1.21.1", "50.0.0"),
        (ModLoader::Fabric, "1.21.1", "0.15.11"),
        (ModLoader::Quilt, "1.20.1", "0.17.0"),
        (ModLoader::NeoForge, "1.21.1", "21.1.203"),
        (ModLoader::NeoForge, "1.20.1", "47.1.106"),
    ] {
        let id = curseforge_loader_id(loader, game_version, loader_version);
        assert_eq!(
            curseforge::determine_loader_from_curseforge_string(&id),
            loader,
            "loader mismatch for {}",
            id
        );
        assert_eq!(
            curseforge::extract_loader_version(&id, Some(game_version)).as_deref(),
            Some(loader_version),
            "version mismatch for {}",
            id
        );
    }
}

#[test]
fn modlist_escapes_display_names() {
    let html = render_modlist(&[entry(238222, "jei.jar", Some("JEI <script>&\"'"))]);
    assert!(html.contains("https://www.curseforge.com/projects/238222"));
    assert!(html.contains("JEI &lt;script&gt;&amp;&quot;&#39;"));
    assert!(!html.contains("<script>"));
}

#[test]
fn modlist_falls_back_to_the_file_name() {
    let html = render_modlist(&[entry(1, "sodium-0.6.jar", None)]);
    assert!(html.contains("sodium-0.6.jar"));
}
