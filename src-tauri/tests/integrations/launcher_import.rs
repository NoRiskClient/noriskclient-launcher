use noriskclient_launcher_v3_lib::integrations::launcher_import::adapter::LauncherAdapter;
use noriskclient_launcher_v3_lib::integrations::launcher_import::adapters::{
    atlauncher::AtLauncherAdapter, curseforge_app::CurseForgeAppAdapter, mmc::MmcAdapter,
    modrinth_app::ModrinthAppAdapter,
};
use noriskclient_launcher_v3_lib::integrations::launcher_import::cfg::{decode_text, CfgFile};
use noriskclient_launcher_v3_lib::integrations::launcher_import::copy;
use noriskclient_launcher_v3_lib::integrations::launcher_import::detect;
use noriskclient_launcher_v3_lib::integrations::launcher_import::loader_map;
use noriskclient_launcher_v3_lib::integrations::launcher_import::model::*;
use noriskclient_launcher_v3_lib::integrations::launcher_import::resolve;
use noriskclient_launcher_v3_lib::state::profile_state::{Mod, ModLoader, ModSource};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use tempfile::TempDir;
use uuid::Uuid;

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, contents).unwrap();
}

fn write_jar(path: &Path) {
    write(path, "PK\u{3}\u{4}fake jar payload");
}

fn prism_root(base: &Path, instance_dir_line: Option<&str>) -> PathBuf {
    let root = base.join("PrismLauncher");
    let mut cfg = String::from("[General]\nConfigVersion=1.2\n");
    if let Some(line) = instance_dir_line {
        cfg.push_str(line);
        cfg.push('\n');
    }
    write(&root.join("prismlauncher.cfg"), &cfg);
    std::fs::create_dir_all(root.join("instances")).unwrap();
    root
}

fn prism_instance(root: &Path, folder: &str, name: &str, mc: &str, uid: &str, lv: &str) -> PathBuf {
    let dir = root.join("instances").join(folder);
    write(
        &dir.join("instance.cfg"),
        &format!(
            "[General]\nname={}\niconKey=default\nlastLaunchTime=1700000000000\n",
            name
        ),
    );
    write(
        &dir.join("mmc-pack.json"),
        &format!(
            r#"{{"formatVersion":1,"components":[
                {{"uid":"net.minecraft","version":"{mc}"}},
                {{"uid":"{uid}","version":"{lv}"}}
            ]}}"#
        ),
    );
    std::fs::create_dir_all(dir.join(".minecraft")).unwrap();
    dir
}

fn curseforge_root(base: &Path) -> PathBuf {
    let root = base.join("curseforge").join("minecraft");
    std::fs::create_dir_all(root.join("Instances")).unwrap();
    root
}

fn curseforge_instance(root: &Path, folder: &str, manifest: &str) -> PathBuf {
    let dir = root.join("Instances").join(folder);
    write(&dir.join("minecraftinstance.json"), manifest);
    dir
}

fn atlauncher_root(base: &Path) -> PathBuf {
    let root = base.join("ATLauncher");
    std::fs::create_dir_all(root.join("instances")).unwrap();
    root
}

fn atlauncher_instance(root: &Path, folder: &str, manifest: &str) -> PathBuf {
    let dir = root.join("instances").join(folder);
    write(&dir.join("instance.json"), manifest);
    dir
}

#[test]
fn a_general_section_header_is_tolerated() {
    let cfg = CfgFile::parse("[General]\nname=Test\n");

    assert_eq!(cfg.get("name"), Some("Test"));
}

#[test]
fn comments_blank_lines_and_crlf_are_ignored() {
    let cfg = CfgFile::parse("# a comment\r\n; another\r\n\r\nname=Test\r\n");

    assert_eq!(cfg.get("name"), Some("Test"));
}

#[test]
fn a_value_may_contain_an_equals_sign() {
    let cfg = CfgFile::parse("JvmArgs=-Dfoo=bar -Xmx4G\n");

    assert_eq!(cfg.get("JvmArgs"), Some("-Dfoo=bar -Xmx4G"));
}

#[test]
fn booleans_and_numbers_are_parsed() {
    let cfg = CfgFile::parse("OverrideMemory=true\nMaxMemAlloc=8192\nManagedPack=0\n");

    assert_eq!(cfg.get_bool("OverrideMemory"), Some(true));
    assert_eq!(cfg.get_u32("MaxMemAlloc"), Some(8192));
    assert_eq!(cfg.get_bool("ManagedPack"), Some(false));
}

#[test]
fn a_windows_1252_config_still_decodes() {
    let mut bytes = b"name=Gr".to_vec();
    bytes.push(0xFC); // u umlaut in CP1252
    bytes.extend_from_slice(b"sse\n");

    let cfg = CfgFile::parse(&decode_text(&bytes));

    assert_eq!(cfg.get("name"), Some("Grüsse"));
}

#[test]
fn a_utf8_bom_is_stripped() {
    let bytes = "\u{FEFF}name=Test\n".as_bytes();

    assert_eq!(
        CfgFile::parse(&decode_text(bytes)).get("name"),
        Some("Test")
    );
}

#[tokio::test]
async fn a_missing_config_reads_as_empty() {
    let dir = TempDir::new().unwrap();

    let cfg = noriskclient_launcher_v3_lib::integrations::launcher_import::cfg::read_cfg(
        &dir.path().join("nope.cfg"),
    )
    .await
    .unwrap();

    assert!(cfg.is_empty());
}

#[tokio::test]
async fn an_oversized_config_is_refused() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("huge.cfg");
    write(&path, &"x=1\n".repeat(600_000));

    let result =
        noriskclient_launcher_v3_lib::integrations::launcher_import::cfg::read_cfg(&path).await;

    assert!(result.is_err());
}

#[test]
fn neoforge_and_quilt_never_fall_back_to_forge_or_vanilla() {
    let cases: Vec<(&str, ModLoader)> = vec![
        ("neoforge-21.1.65", ModLoader::NeoForge),
        ("NeoForge-21.1.65", ModLoader::NeoForge),
        ("quilt-0.26.0-1.21", ModLoader::Quilt),
        ("forge-47.2.0", ModLoader::Forge),
        ("fabric-0.15.7-1.20.1", ModLoader::Fabric),
    ];

    for (raw, expected) in cases {
        let pick = loader_map::loader_from_curseforge_name(raw);
        assert_eq!(pick.loader, expected, "curseforge name '{}'", raw);
        assert!(
            pick.unrecognized.is_none(),
            "'{}' should be recognized",
            raw
        );
    }
}

#[test]
fn a_curseforge_loader_version_is_split_off() {
    let pick = loader_map::loader_from_curseforge_name("fabric-0.15.7-1.20.1");

    assert_eq!(pick.loader_version.as_deref(), Some("0.15.7-1.20.1"));
}

#[test]
fn an_unknown_curseforge_loader_is_reported_not_silently_vanilla() {
    let pick = loader_map::loader_from_curseforge_name("rift-1.0.4");

    assert_eq!(pick.loader, ModLoader::Vanilla);
    assert_eq!(pick.unrecognized.as_deref(), Some("rift-1.0.4"));
}

#[test]
fn mmc_component_uids_map_exactly() {
    assert_eq!(
        loader_map::loader_from_mmc_uid("net.neoforged"),
        Some(ModLoader::NeoForge)
    );
    assert_eq!(
        loader_map::loader_from_mmc_uid("net.minecraftforge"),
        Some(ModLoader::Forge)
    );
    assert_eq!(
        loader_map::loader_from_mmc_uid("org.quiltmc.quilt-loader"),
        Some(ModLoader::Quilt)
    );
    assert_eq!(
        loader_map::loader_from_mmc_uid("net.fabricmc.fabric-loader"),
        Some(ModLoader::Fabric)
    );
    assert_eq!(loader_map::loader_from_mmc_uid("org.lwjgl3"), None);
    assert_eq!(loader_map::loader_from_mmc_uid("net.minecraft"), None);
}

#[test]
fn plain_loader_names_cover_the_spellings_launchers_use() {
    for (raw, expected) in [
        ("Forge", ModLoader::Forge),
        ("fabric", ModLoader::Fabric),
        ("LegacyFabric", ModLoader::Fabric),
        ("QuiltMC", ModLoader::Quilt),
        ("NeoForge", ModLoader::NeoForge),
        ("", ModLoader::Vanilla),
        ("vanilla", ModLoader::Vanilla),
    ] {
        assert_eq!(
            loader_map::loader_from_name(raw),
            Some(expected),
            "'{}'",
            raw
        );
    }
    assert_eq!(loader_map::loader_from_name("rift"), None);
}

#[test]
fn vanilla_launcher_version_ids_are_decoded() {
    let fabric = loader_map::loader_from_vanilla_version_id("fabric-loader-0.15.7-1.20.1");
    assert_eq!(fabric.loader, ModLoader::Fabric);
    assert_eq!(fabric.loader_version.as_deref(), Some("0.15.7"));
    assert_eq!(fabric.game_version.as_deref(), Some("1.20.1"));

    let forge = loader_map::loader_from_vanilla_version_id("1.20.1-forge-47.2.0");
    assert_eq!(forge.loader, ModLoader::Forge);
    assert_eq!(forge.game_version.as_deref(), Some("1.20.1"));

    let neoforge = loader_map::loader_from_vanilla_version_id("neoforge-21.1.65");
    assert_eq!(neoforge.loader, ModLoader::NeoForge);

    let plain = loader_map::loader_from_vanilla_version_id("1.21.1");
    assert_eq!(plain.loader, ModLoader::Vanilla);
    assert_eq!(plain.game_version.as_deref(), Some("1.21.1"));

    let custom = loader_map::loader_from_vanilla_version_id("my-custom-build");
    assert!(custom.game_version.is_none());
    assert!(custom.unrecognized.is_some());
}

#[tokio::test]
async fn a_prism_root_is_recognized() {
    let temp = TempDir::new().unwrap();
    let root = prism_root(temp.path(), None);
    prism_instance(
        &root,
        "atm9",
        "All the Mods 9",
        "1.20.1",
        "net.minecraftforge",
        "47.2.0",
    );

    let found = detect::identify_launcher_at(&root).await.expect("root");

    assert_eq!(found.launcher, ExternalLauncher::PrismLauncher);
    assert_eq!(found.instance_count, 1);
    assert!(!found.auto_detected);
}

#[tokio::test]
async fn picking_the_instances_folder_still_finds_the_launcher() {
    let temp = TempDir::new().unwrap();
    let root = prism_root(temp.path(), None);
    prism_instance(
        &root,
        "atm9",
        "All the Mods 9",
        "1.20.1",
        "net.neoforged",
        "21.1.65",
    );

    let found = detect::identify_launcher_at(&root.join("instances"))
        .await
        .expect("parent probe");

    assert_eq!(found.launcher, ExternalLauncher::PrismLauncher);
}

#[tokio::test]
async fn an_empty_folder_is_not_a_launcher() {
    let temp = TempDir::new().unwrap();

    assert!(detect::identify_launcher_at(temp.path()).await.is_none());
}

#[tokio::test]
async fn an_instance_dir_that_escapes_the_root_is_refused() {
    let temp = TempDir::new().unwrap();
    let root = prism_root(temp.path(), Some("InstanceDir=../../evil"));
    prism_instance(
        &root,
        "atm9",
        "All the Mods 9",
        "1.20.1",
        "net.minecraftforge",
        "47.2.0",
    );

    let resolved = detect::resolve_root(ExternalLauncher::PrismLauncher, &root)
        .await
        .unwrap();

    assert_eq!(resolved.instances_dir, root.join("instances"));
}

#[tokio::test]
async fn a_custom_instance_dir_inside_the_root_is_honoured() {
    let temp = TempDir::new().unwrap();
    let root = prism_root(temp.path(), Some("InstanceDir=myinstances"));
    std::fs::create_dir_all(root.join("myinstances")).unwrap();

    let resolved = detect::resolve_root(ExternalLauncher::PrismLauncher, &root)
        .await
        .unwrap();

    assert_eq!(resolved.instances_dir, root.join("myinstances"));
}

#[tokio::test]
async fn a_prism_instance_reads_name_version_and_loader() {
    let temp = TempDir::new().unwrap();
    let root = prism_root(temp.path(), None);
    let dir = prism_instance(
        &root,
        "atm9",
        "All the Mods 9",
        "1.21.1",
        "net.neoforged",
        "21.1.65",
    );

    let adapter = MmcAdapter::prism();
    let resolved = adapter.probe(&root).await.unwrap();
    let instance = adapter.read_instance(&resolved, &dir).await.unwrap();

    assert_eq!(instance.reference.name, "All the Mods 9");
    assert_eq!(instance.reference.game_version.as_deref(), Some("1.21.1"));
    assert_eq!(instance.loader(), ModLoader::NeoForge);
    assert_eq!(
        instance.reference.loader_version.as_deref(),
        Some("21.1.65")
    );
    assert_eq!(instance.game_dir, dir.join(".minecraft"));
    assert!(instance.reference.unsupported.is_none());
}

#[tokio::test]
async fn a_prism_instance_without_a_minecraft_version_is_flagged() {
    let temp = TempDir::new().unwrap();
    let root = prism_root(temp.path(), None);
    let dir = root.join("instances").join("broken");
    write(&dir.join("instance.cfg"), "name=Broken\n");
    write(
        &dir.join("mmc-pack.json"),
        r#"{"formatVersion":1,"components":[]}"#,
    );
    std::fs::create_dir_all(dir.join(".minecraft")).unwrap();

    let adapter = MmcAdapter::prism();
    let resolved = adapter.probe(&root).await.unwrap();
    let reference = adapter
        .read_instance(&resolved, &dir)
        .await
        .unwrap()
        .reference;

    assert_eq!(
        reference.unsupported,
        Some(UnsupportedReason::NoGameVersion)
    );
}

#[tokio::test]
async fn a_traversing_icon_key_never_leaves_the_icons_folder() {
    let temp = TempDir::new().unwrap();
    let root = prism_root(temp.path(), None);
    let dir = root.join("instances").join("evil");
    write(
        &dir.join("instance.cfg"),
        "name=Evil\niconKey=../../../../etc/passwd\n",
    );
    write(
        &dir.join("mmc-pack.json"),
        r#"{"formatVersion":1,"components":[{"uid":"net.minecraft","version":"1.20.1"}]}"#,
    );
    std::fs::create_dir_all(dir.join(".minecraft")).unwrap();

    let adapter = MmcAdapter::prism();
    let resolved = adapter.probe(&root).await.unwrap();
    let instance = adapter.read_instance(&resolved, &dir).await.unwrap();

    assert!(instance.icon.is_none());
}

#[tokio::test]
async fn java_settings_of_a_foreign_instance_are_recorded_not_adopted() {
    let temp = TempDir::new().unwrap();
    let root = prism_root(temp.path(), None);
    let dir = root.join("instances").join("sneaky");
    write(
        &dir.join("instance.cfg"),
        "name=Sneaky\nOverrideJavaLocation=true\nJavaPath=C:\\Windows\\System32\\calc.exe\nOverrideJavaArgs=true\nJvmArgs=-javaagent:evil.jar\n",
    );
    write(
        &dir.join("mmc-pack.json"),
        r#"{"formatVersion":1,"components":[{"uid":"net.minecraft","version":"1.20.1"}]}"#,
    );
    std::fs::create_dir_all(dir.join(".minecraft")).unwrap();

    let adapter = MmcAdapter::prism();
    let resolved = adapter.probe(&root).await.unwrap();
    let instance = adapter.read_instance(&resolved, &dir).await.unwrap();

    assert!(instance.untrusted_java_path.is_some());
    assert!(instance.untrusted_jvm_args.is_some());

    let report =
        noriskclient_launcher_v3_lib::integrations::launcher_import::preview::security_report_for(
            &instance,
        );
    assert!(report.stripped_java_path.is_some());
    assert!(report.stripped_jvm_args.is_some());
    assert!(report.has_critical_findings());
}

const CF_MANIFEST: &str = r#"{
  "name": "All the Mods 9",
  "gameVersion": "1.21.1",
  "baseModLoader": { "name": "neoforge-21.1.65", "minecraftVersion": "1.21.1" },
  "installedAddons": [
    {
      "addonID": 238222,
      "installedFile": {
        "id": 5432100,
        "fileName": "jei-1.21.1.jar",
        "downloadUrl": "https://edge.forgecdn.net/files/5432/100/jei-1.21.1.jar",
        "fileFingerprint": 123456789,
        "displayName": "Just Enough Items",
        "hashes": [{ "value": "abc123", "algo": 1 }],
        "gameVersions": ["1.21.1", "NeoForge"]
      }
    },
    {
      "addonID": 999,
      "installedFile": {
        "id": 111,
        "fileName": "../../startup/evil.bat",
        "downloadUrl": "http://evil.example.com/evil.bat"
      }
    }
  ]
}"#;

#[tokio::test]
async fn a_curseforge_instance_maps_neoforge_and_its_addons() {
    let temp = TempDir::new().unwrap();
    let root = curseforge_root(temp.path());
    let dir = curseforge_instance(&root, "atm9", CF_MANIFEST);

    let adapter = CurseForgeAppAdapter;
    let resolved = adapter.probe(&root).await.unwrap();
    let instance = adapter.read_instance(&resolved, &dir).await.unwrap();

    assert_eq!(instance.loader(), ModLoader::NeoForge);
    assert_eq!(instance.reference.game_version.as_deref(), Some("1.21.1"));
    assert_eq!(
        instance.declared_mods.len(),
        1,
        "the traversing entry must be dropped"
    );
    assert_eq!(instance.declared_mods[0].file_name, "jei-1.21.1.jar");
    assert_eq!(
        instance.declared_mods[0].curseforge,
        Some((238222, 5432100))
    );
    assert_eq!(instance.game_dir, dir);
}

#[tokio::test]
async fn an_unknown_curseforge_loader_produces_a_warning() {
    let temp = TempDir::new().unwrap();
    let root = curseforge_root(temp.path());
    let dir = curseforge_instance(
        &root,
        "weird",
        r#"{"name":"Weird","gameVersion":"1.12.2","baseModLoader":{"name":"rift-1.0.4"}}"#,
    );

    let adapter = CurseForgeAppAdapter;
    let resolved = adapter.probe(&root).await.unwrap();
    let instance = adapter.read_instance(&resolved, &dir).await.unwrap();

    assert_eq!(instance.loader(), ModLoader::Vanilla);
    assert!(instance
        .warnings
        .iter()
        .any(|warning| warning.starts_with("unknown_loader:")));
    assert_eq!(
        instance.reference.unsupported,
        Some(UnsupportedReason::UnknownLoader)
    );
}

#[tokio::test]
async fn an_atlauncher_instance_reads_its_pack_metadata() {
    let temp = TempDir::new().unwrap();
    let root = atlauncher_root(temp.path());
    let dir = atlauncher_instance(
        &root,
        "vanilla-plus",
        r#"{
          "id": "1.20.1",
          "launcher": {
            "name": "Vanilla Plus",
            "pack": "Vanilla Plus",
            "loaderVersion": { "type": "fabric", "version": "0.15.7" },
            "mods": [
              { "file": "sodium.jar", "disabled": false, "curseForgeProjectId": 394468, "curseForgeFileId": 4560000 },
              { "file": "../evil.jar", "disabled": false, "curseForgeProjectId": 1, "curseForgeFileId": 2 }
            ]
          }
        }"#,
    );

    let adapter = AtLauncherAdapter;
    let resolved = adapter.probe(&root).await.unwrap();
    let instance = adapter.read_instance(&resolved, &dir).await.unwrap();

    assert_eq!(instance.loader(), ModLoader::Fabric);
    assert_eq!(instance.reference.game_version.as_deref(), Some("1.20.1"));
    assert_eq!(instance.reference.loader_version.as_deref(), Some("0.15.7"));
    assert_eq!(instance.declared_mods.len(), 1);
    assert_eq!(instance.declared_mods[0].file_name, "sodium.jar");
}

#[test]
fn a_disabled_jar_keeps_its_real_name() {
    assert_eq!(
        resolve::strip_disabled("sodium.jar.disabled"),
        Some(("sodium.jar".to_string(), false))
    );
    assert_eq!(
        resolve::strip_disabled("sodium.jar"),
        Some(("sodium.jar".to_string(), true))
    );
    assert_eq!(resolve::strip_disabled("notes.txt"), None);
    assert_eq!(resolve::strip_disabled("readme.txt.disabled"), None);
}

#[tokio::test]
async fn jars_are_found_one_directory_deep() {
    let temp = TempDir::new().unwrap();
    let game_dir = temp.path().join("instance");
    write_jar(&game_dir.join("mods").join("sodium.jar"));
    write_jar(&game_dir.join("mods").join("iris.jar.disabled"));
    write_jar(&game_dir.join("mods").join("1.20.1").join("jei.jar"));
    write_jar(&game_dir.join("mods").join(".index").join("hidden.jar"));
    write(&game_dir.join("mods").join("notes.txt"), "not a mod");

    let (jars, truncated) = resolve::discover_jars(&game_dir).await;

    assert!(!truncated);
    let names: Vec<&str> = jars.iter().map(|jar| jar.file_name.as_str()).collect();
    assert_eq!(names, vec!["iris.jar", "jei.jar", "sodium.jar"]);
    assert!(
        !jars
            .iter()
            .find(|jar| jar.file_name == "iris.jar")
            .unwrap()
            .enabled
    );
}

fn modrinth_mod(game_versions: Vec<&str>, loader: Option<ModLoader>) -> Mod {
    Mod {
        id: Uuid::new_v4(),
        source: ModSource::Modrinth {
            project_id: "u6dRKJwZ".to_string(),
            version_id: "abc".to_string(),
            file_name: "jei.jar".to_string(),
            download_url: "https://cdn.modrinth.com/data/u6dRKJwZ/jei.jar".to_string(),
            file_hash_sha1: None,
        },
        enabled: true,
        display_name: Some("Just Enough Items".to_string()),
        version: None,
        game_versions: Some(game_versions.into_iter().map(str::to_string).collect()),
        file_name_override: None,
        associated_loader: loader,
        modpack_origin: None,
        updates_enabled: true,
        extra: Default::default(),
        force_include_versions: Vec::new(),
    }
}

#[test]
fn an_imported_mod_is_pinned_to_the_loader_it_actually_ran_on() {
    let mut entry = modrinth_mod(vec!["1.20.1"], Some(ModLoader::Forge));

    resolve::pin_to_profile(&mut entry, ModLoader::NeoForge, "1.21.1");

    assert_eq!(entry.associated_loader, Some(ModLoader::NeoForge));
    assert_eq!(entry.force_include_versions, vec!["1.21.1".to_string()]);
}

#[test]
fn a_matching_game_version_needs_no_force_include() {
    let mut entry = modrinth_mod(vec!["1.21.1", "1.21"], None);

    resolve::pin_to_profile(&mut entry, ModLoader::Fabric, "1.21.1");

    assert_eq!(entry.associated_loader, Some(ModLoader::Fabric));
    assert!(entry.force_include_versions.is_empty());
}

#[test]
fn pinning_twice_does_not_duplicate_the_forced_version() {
    let mut entry = modrinth_mod(vec!["1.20.1"], None);

    resolve::pin_to_profile(&mut entry, ModLoader::Fabric, "1.21.1");
    resolve::pin_to_profile(&mut entry, ModLoader::Fabric, "1.21.1");

    assert_eq!(entry.force_include_versions, vec!["1.21.1".to_string()]);
}

#[tokio::test]
async fn the_copy_plan_skips_runtime_folders_and_launcher_metadata() {
    let temp = TempDir::new().unwrap();
    let game_dir = temp.path().join("instance");
    write(&game_dir.join("options.txt"), "fov:90");
    write(&game_dir.join("config").join("sodium.json"), "{}");
    write(&game_dir.join("saves").join("world").join("level.dat"), "x");
    write(&game_dir.join("libraries").join("lib.jar"), "x");
    write(&game_dir.join("logs").join("latest.log"), "x");
    write(&game_dir.join("minecraftinstance.json"), "{}");

    let plan = copy::build_plan(
        &game_dir,
        &ImportSelection::default(),
        &ImportSelection::default(),
    )
    .await;

    let copied: Vec<String> = plan
        .files
        .iter()
        .map(|file| file.relative.display().to_string().replace('\\', "/"))
        .collect();

    assert!(copied.contains(&"options.txt".to_string()));
    assert!(copied.contains(&"config/sodium.json".to_string()));
    assert!(copied.contains(&"saves/world/level.dat".to_string()));
    assert!(!copied.iter().any(|path| path.starts_with("libraries")));
    assert!(!copied.iter().any(|path| path.starts_with("logs")));
    assert!(!copied.iter().any(|path| path.contains("minecraftinstance")));
}

#[tokio::test]
async fn worlds_are_counted_as_worlds_not_files() {
    let temp = TempDir::new().unwrap();
    let game_dir = temp.path().join("instance");
    write(&game_dir.join("saves").join("one").join("level.dat"), "x");
    write(
        &game_dir
            .join("saves")
            .join("one")
            .join("region")
            .join("r.mca"),
        "x",
    );
    write(&game_dir.join("saves").join("two").join("level.dat"), "x");

    let plan = copy::build_plan(
        &game_dir,
        &ImportSelection::default(),
        &ImportSelection::default(),
    )
    .await;

    let saves = plan
        .per_bucket
        .iter()
        .find(|bucket| bucket.key == "saves")
        .unwrap();
    assert_eq!(saves.entry_count, 2);
}

#[tokio::test]
async fn deselecting_worlds_leaves_them_behind() {
    let temp = TempDir::new().unwrap();
    let game_dir = temp.path().join("instance");
    write(&game_dir.join("options.txt"), "fov:90");
    write(&game_dir.join("saves").join("world").join("level.dat"), "x");

    let selection = ImportSelection {
        saves: false,
        ..ImportSelection::default()
    };
    let plan = copy::build_plan(&game_dir, &selection, &ImportSelection::default()).await;

    assert!(!plan
        .files
        .iter()
        .any(|file| file.relative.starts_with("saves")));
    assert!(plan
        .per_bucket
        .iter()
        .any(|bucket| bucket.key == "saves" && bucket.entry_count == 1));
}

#[tokio::test]
async fn executables_are_reported_and_left_out_without_an_opt_in() {
    let temp = TempDir::new().unwrap();
    let game_dir = temp.path().join("instance");
    write(&game_dir.join("config").join("install.bat"), "echo hi");
    write(&game_dir.join("config").join("sodium.json"), "{}");

    let plan = copy::build_plan(
        &game_dir,
        &ImportSelection::default(),
        &ImportSelection::default(),
    )
    .await;

    assert!(plan
        .executable_paths
        .iter()
        .any(|path| path.ends_with("install.bat")));
    assert!(!plan.files.iter().any(|file| file
        .relative
        .display()
        .to_string()
        .ends_with("install.bat")));

    let with_opt_in = copy::build_plan(
        &game_dir,
        &ImportSelection {
            allow_executable_content: true,
            ..ImportSelection::default()
        },
        &ImportSelection::default(),
    )
    .await;
    assert!(with_opt_in.files.iter().any(|file| file
        .relative
        .display()
        .to_string()
        .ends_with("install.bat")));
}

#[cfg(unix)]
#[tokio::test]
async fn symlinks_are_skipped_and_reported() {
    let temp = TempDir::new().unwrap();
    let game_dir = temp.path().join("instance");
    std::fs::create_dir_all(game_dir.join("config")).unwrap();
    write(&temp.path().join("outside.txt"), "secret");
    std::os::unix::fs::symlink(
        temp.path().join("outside.txt"),
        game_dir.join("config").join("link.txt"),
    )
    .unwrap();

    let plan = copy::build_plan(
        &game_dir,
        &ImportSelection::default(),
        &ImportSelection::default(),
    )
    .await;

    assert!(plan.files.is_empty());
    assert_eq!(plan.skipped_symlinks.len(), 1);
}

#[tokio::test]
async fn copying_writes_the_planned_files_and_nothing_else() {
    let temp = TempDir::new().unwrap();
    let game_dir = temp.path().join("instance");
    write(&game_dir.join("options.txt"), "fov:90");
    write(&game_dir.join("config").join("sodium.json"), "{}");

    let plan = copy::build_plan(
        &game_dir,
        &ImportSelection::default(),
        &ImportSelection::default(),
    )
    .await;
    let staging = temp.path().join("staging");
    std::fs::create_dir_all(&staging).unwrap();

    let cancel = AtomicBool::new(false);
    let copied = copy::copy_planned(&plan, &staging, &cancel, |_, _| async {})
        .await
        .unwrap();

    assert_eq!(copied, plan.total_bytes);
    assert!(staging.join("options.txt").exists());
    assert!(staging.join("config").join("sodium.json").exists());
}

#[tokio::test]
async fn a_cancelled_copy_stops_immediately() {
    let temp = TempDir::new().unwrap();
    let game_dir = temp.path().join("instance");
    write(&game_dir.join("options.txt"), "fov:90");

    let plan = copy::build_plan(
        &game_dir,
        &ImportSelection::default(),
        &ImportSelection::default(),
    )
    .await;
    let staging = temp.path().join("staging");
    std::fs::create_dir_all(&staging).unwrap();

    let cancel = AtomicBool::new(true);
    let result = copy::copy_planned(&plan, &staging, &cancel, |_, _| async {}).await;

    assert!(result.is_err());
    assert!(!staging.join("options.txt").exists());
}

async fn vanilla_instance_with(jars: &[&str], base: &Path) -> ExternalInstance {
    let root = prism_root(base, None);
    let dir = prism_instance(
        &root,
        "vanilla",
        "Vanilla",
        "1.21.1",
        "net.minecraft",
        "1.21.1",
    );
    for jar in jars {
        write_jar(&dir.join(".minecraft").join("mods").join(jar));
    }

    let adapter = MmcAdapter::prism();
    let resolved = adapter.probe(&root).await.unwrap();
    adapter.read_instance(&resolved, &dir).await.unwrap()
}

#[tokio::test]
async fn resolving_the_same_unchanged_instance_twice_reuses_the_first_result() {
    let temp = TempDir::new().unwrap();
    let instance = vanilla_instance_with(&["sodium.jar", "iris.jar"], temp.path()).await;

    let first = resolve::resolve_instance_mods(&instance, "1.21.1").await;
    let second = resolve::resolve_instance_mods(&instance, "1.21.1").await;

    assert!(
        std::sync::Arc::ptr_eq(&first, &second),
        "an unchanged instance must not be resolved twice"
    );
}

#[tokio::test]
async fn adding_a_jar_makes_the_next_resolve_see_it() {
    let temp = TempDir::new().unwrap();
    let instance = vanilla_instance_with(&["sodium.jar"], temp.path()).await;

    let first = resolve::resolve_instance_mods(&instance, "1.21.1").await;
    assert_eq!(first.jars.len(), 1);

    write_jar(&instance.game_dir.join("mods").join("iris.jar"));
    let second = resolve::resolve_instance_mods(&instance, "1.21.1").await;

    assert_eq!(second.jars.len(), 2);
    assert!(!std::sync::Arc::ptr_eq(&first, &second));
}

#[tokio::test]
async fn a_resolution_carries_the_jars_it_discovered() {
    let temp = TempDir::new().unwrap();
    let instance = vanilla_instance_with(&["sodium.jar", "iris.jar.disabled"], temp.path()).await;

    let resolved = resolve::resolve_instance_mods(&instance, "1.21.1").await;

    let names: Vec<&str> = resolved
        .jars
        .iter()
        .map(|jar| jar.file_name.as_str())
        .collect();
    assert_eq!(names, vec!["iris.jar", "sodium.jar"]);
    assert_eq!(resolved.local.len(), 2);
}

enum ModrinthSchema {
    None,
    Legacy,
    Current,
}

async fn modrinth_root(base: &Path, schema: ModrinthSchema) -> PathBuf {
    let root = base.join("ModrinthApp");
    std::fs::create_dir_all(
        root.join("profiles")
            .join("fabulously-optimized")
            .join("mods"),
    )
    .unwrap();
    std::fs::create_dir_all(root.join("profiles").join("orphan")).unwrap();
    write(&root.join("caches").join("icons").join("fo.png"), "png");
    let icon = root
        .join("caches")
        .join("icons")
        .join("fo.png")
        .display()
        .to_string()
        .replace('\\', "/");

    let statements: Vec<String> = match schema {
 ModrinthSchema::None => Vec::new(),
 ModrinthSchema::Legacy => vec![
            "CREATE TABLE profiles (path TEXT NOT NULL, install_stage TEXT NOT NULL, name TEXT NOT NULL, icon_path TEXT NULL, game_version TEXT NOT NULL, mod_loader TEXT NOT NULL, mod_loader_version TEXT NULL, groups TEXT NOT NULL, linked_project_id TEXT NULL, linked_version_id TEXT NULL, locked INTEGER NULL, created INTEGER NOT NULL, modified INTEGER NOT NULL, last_played INTEGER NULL, override_java_path TEXT NULL, override_extra_launch_args TEXT NOT NULL)".to_string(),
 format!(
                "INSERT INTO profiles VALUES ('fabulously-optimized', 'installed', 'Fabulously Optimized', '{icon}', '1.21.1', 'fabric', '0.16.5', '[]', 'AANobbMI', 'abc123', NULL, 0, 0, 1700000000, 'C:/evil/java.exe', '[\"-javaagent:x.jar\"]')"
            ),
        ],
 ModrinthSchema::Current => vec![
            "CREATE TABLE instances (id TEXT PRIMARY KEY, path TEXT NOT NULL, applied_content_set_id TEXT NULL, install_stage TEXT NOT NULL, name TEXT NOT NULL, icon_path TEXT NULL, created INTEGER NOT NULL, modified INTEGER NOT NULL, last_played INTEGER NULL)".to_string(),
            "CREATE TABLE instance_content_sets (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, name TEXT, source_kind TEXT, status TEXT, game_version TEXT NOT NULL, protocol_version INTEGER, loader TEXT NOT NULL, loader_version TEXT NULL)".to_string(),
            "CREATE TABLE instance_links (instance_id TEXT NOT NULL, link_kind TEXT NOT NULL, modrinth_project_id TEXT NULL, modrinth_version_id TEXT NULL)".to_string(),
            "CREATE TABLE instance_launch_overrides (instance_id TEXT PRIMARY KEY, overrides BLOB NOT NULL)".to_string(),
            "CREATE TABLE instance_files (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, relative_path TEXT NOT NULL,  file_name TEXT NOT NULL, enabled INTEGER NOT NULL, sha1 TEXT NULL, size INTEGER, missing INTEGER NOT NULL DEFAULT 0)".to_string(),
            "CREATE TABLE instance_content_entries (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, content_set_id TEXT,  file_id TEXT NOT NULL, project_type TEXT, project_id TEXT NULL, version_id TEXT NULL)".to_string(),
            "INSERT INTO instance_files VALUES ('file:sodium', 'legacy:fo', 'mods/sodium.jar', 'sodium.jar', 1,  '4c224606a963bce223db5b27edb4959ecf40d4ee', 100, 0)".to_string(),
            "INSERT INTO instance_files VALUES ('file:iris', 'legacy:fo', 'mods/iris.jar.disabled', 'iris.jar', 0,  '07425f2321600143113f02a3cc19900d6560244f', 100, 0)".to_string(),
            "INSERT INTO instance_files VALUES ('file:evil', 'legacy:fo', 'mods/../evil.jar', '../evil.jar', 1, 'ff', 1, 0)".to_string(),
            "INSERT INTO instance_content_entries VALUES ('entry:sodium', 'legacy:fo', 'legacy:fo:default', 'file:sodium', 'mod', 'AANobbMI', 'v1')".to_string(),
 format!(
                "INSERT INTO instances VALUES ('legacy:fo', 'fabulously-optimized', 'legacy:fo:default', 'installed', 'Fabulously Optimized', '{icon}', 0, 0, 1700000000)"
            ),
            "INSERT INTO instance_content_sets VALUES ('legacy:fo:default', 'legacy:fo', 'Default', 'modrinth_modpack', 'available', '1.21.1', 767, 'fabric', '0.16.5')".to_string(),
            "INSERT INTO instance_links VALUES ('legacy:fo', 'modrinth_modpack', 'AANobbMI', 'abc123')".to_string(),
            "INSERT INTO instance_launch_overrides VALUES ('legacy:fo', jsonb('{\"java_path\":\"C:/evil/java.exe\",\"extra_launch_args\":[\"-javaagent:x.jar\"]}'))".to_string(),
        ],
    };

    if !statements.is_empty() {
        let url = format!("sqlite:{}?mode=rwc", root.join("app.db").display());
        let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
        for statement in statements {
            sqlx::query(&statement).execute(&pool).await.unwrap();
        }
        pool.close().await;
    }

    root
}

async fn assert_fabulously_optimized(root: &Path) {
    let adapter = ModrinthAppAdapter;
    let resolved = adapter.probe(root).await.unwrap();
    let listed = adapter.list_instances(&resolved).await.unwrap();
    assert_eq!(listed.len(), 2);

    let dir = root.join("profiles").join("fabulously-optimized");
    let instance = adapter.read_instance(&resolved, &dir).await.unwrap();

    assert_eq!(instance.reference.name, "Fabulously Optimized");
    assert_eq!(instance.reference.game_version.as_deref(), Some("1.21.1"));
    assert_eq!(instance.loader(), ModLoader::Fabric);
    assert_eq!(instance.reference.loader_version.as_deref(), Some("0.16.5"));
    assert_eq!(instance.game_dir, dir);
    assert!(instance.reference.last_played.is_some());
    assert!(matches!(instance.icon, Some(IconRef::File(_))));
    assert!(matches!(
    instance.managed_pack,
    Some(ManagedPackRef::Modrinth { ref project_id, .. }) if project_id == "AANobbMI"
       ));
    assert_eq!(
        instance.untrusted_java_path.as_deref(),
        Some("C:/evil/java.exe")
    );
    assert_eq!(
        instance.untrusted_game_args,
        vec!["-javaagent:x.jar".to_string()]
    );

    let orphan = listed
        .iter()
        .find(|entry| entry.folder_name == "orphan")
        .unwrap();
    assert_eq!(orphan.unsupported, Some(UnsupportedReason::NoGameVersion));
}

#[tokio::test]
async fn a_modrinth_app_instance_is_read_from_the_current_schema() {
    let temp = TempDir::new().unwrap();
    let root = modrinth_root(temp.path(), ModrinthSchema::Current).await;

    let found = detect::identify_launcher_at(&root)
        .await
        .expect("modrinth root");
    assert_eq!(found.launcher, ExternalLauncher::ModrinthApp);
    assert_eq!(found.instance_count, 2);

    assert_fabulously_optimized(&root).await;
}

#[tokio::test]
async fn a_modrinth_app_profile_is_read_from_the_legacy_schema() {
    let temp = TempDir::new().unwrap();
    let root = modrinth_root(temp.path(), ModrinthSchema::Legacy).await;

    assert_fabulously_optimized(&root).await;
}

#[tokio::test]
async fn a_modrinth_app_without_database_still_lists_but_cannot_import() {
    let temp = TempDir::new().unwrap();
    let root = modrinth_root(temp.path(), ModrinthSchema::None).await;

    let adapter = ModrinthAppAdapter;
    let resolved = adapter.probe(&root).await.unwrap();
    let listed = adapter.list_instances(&resolved).await.unwrap();

    assert_eq!(listed.len(), 2);
    assert!(listed
        .iter()
        .all(|entry| entry.unsupported == Some(UnsupportedReason::NoGameVersion)));
}

#[tokio::test]
async fn hundreds_of_small_files_all_arrive_and_progress_ends_at_the_total() {
    let temp = TempDir::new().unwrap();
    let game_dir = temp.path().join("instance");
    for index in 0..300 {
        write(
            &game_dir
                .join("config")
                .join(format!("dir-{}", index % 7))
                .join(format!("file-{}.json", index)),
            "{}",
        );
    }

    let plan = copy::build_plan(
        &game_dir,
        &ImportSelection::default(),
        &ImportSelection::default(),
    )
    .await;
    let staging = temp.path().join("staging");
    std::fs::create_dir_all(&staging).unwrap();

    let last = std::sync::Arc::new(std::sync::Mutex::new((0u64, 0u64)));
    let sink = last.clone();
    let cancel = AtomicBool::new(false);
    let copied = copy::copy_planned(&plan, &staging, &cancel, move |done, total| {
        let sink = sink.clone();
        async move {
            *sink.lock().unwrap() = (done, total);
        }
    })
    .await
    .unwrap();

    assert_eq!(copied, plan.total_bytes);
    assert_eq!(*last.lock().unwrap(), (plan.total_bytes, plan.total_bytes));

    let arrived = walkdir_count(&staging.join("config"));
    assert_eq!(arrived, 300);
}

fn walkdir_count(dir: &Path) -> usize {
    let mut count = 0;
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            count += walkdir_count(&path);
        } else {
            count += 1;
        }
    }
    count
}

#[tokio::test]
async fn modrinth_app_hands_over_hashes_and_project_ids_so_nothing_needs_hashing() {
    let temp = TempDir::new().unwrap();
    let root = modrinth_root(temp.path(), ModrinthSchema::Current).await;

    let adapter = ModrinthAppAdapter;
    let resolved = adapter.probe(&root).await.unwrap();
    let dir = root.join("profiles").join("fabulously-optimized");
    let instance = adapter.read_instance(&resolved, &dir).await.unwrap();

    let names: Vec<&str> = instance
        .declared_mods
        .iter()
        .map(|m| m.file_name.as_str())
        .collect();
    assert_eq!(
        names,
        vec!["sodium.jar", "iris.jar"],
        "the traversing entry must be dropped"
    );

    let sodium = &instance.declared_mods[0];
    assert_eq!(
        sodium.sha1.as_deref(),
        Some("4c224606a963bce223db5b27edb4959ecf40d4ee")
    );
    assert_eq!(
        sodium.modrinth.as_ref().map(|(p, _)| p.as_str()),
        Some("AANobbMI")
    );
    assert!(sodium.enabled);

    let iris = &instance.declared_mods[1];
    assert!(iris.sha1.is_some());
    assert!(iris.modrinth.is_none());
    assert!(!iris.enabled);
}
