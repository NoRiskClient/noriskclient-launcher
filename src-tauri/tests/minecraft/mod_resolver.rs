use noriskclient_launcher_v3_lib::minecraft::downloads::mod_resolver::*;
use noriskclient_launcher_v3_lib::state::profile_state::{Mod, ModLoader, ModSource};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

fn jar_with(dir: &Path, name: &str, entries: &[&str]) -> PathBuf {
    let path = dir.join(name);
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
    for entry in entries {
        zip.start_file(*entry, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"{}").unwrap();
    }
    zip.finish().unwrap();
    path
}

const DH: &str = "DistantHorizons-3.3.3-1.21.1-fabric-neoforge.jar";
const BOTH: &[&str] = &["fabric.mod.json", "META-INF/neoforge.mods.toml"];

#[allow(deprecated)]
fn dh_mod(associated_loader: Option<ModLoader>, mod_loaders: Vec<ModLoader>) -> Mod {
    Mod {
        id: Uuid::new_v4(),
        source: ModSource::Modrinth {
            project_id: "uCdwusMi".to_string(),
            version_id: "dh".to_string(),
            file_name: DH.to_string(),
            download_url: String::new(),
            file_hash_sha1: None,
        },
        enabled: true,
        display_name: Some("Distant Horizons".to_string()),
        version: None,
        game_versions: Some(vec!["1.21.1".to_string()]),
        file_name_override: None,
        associated_loader,
        mod_loaders,
        modpack_origin: None,
        updates_enabled: true,
        force_include_versions: Vec::new(),
        extra: Default::default(),
    }
}

async fn resolve_on_neoforge(entry: &Mod, cache: &Path) -> (ModOutcome, usize) {
    let mut final_mods = HashMap::new();
    let outcome = resolve_profile_mod(
        entry,
        ModLoader::NeoForge,
        "1.21.1",
        &cache.to_path_buf(),
        &mut final_mods,
        false,
    )
    .await;
    (outcome, final_mods.len())
}

#[test]
fn parse_all_keeps_order_and_drops_unknown_and_duplicates() {
    assert_eq!(
        ModLoader::parse_all(&["minecraft", "fabric", "NeoForge", "fabric"]),
        vec![ModLoader::Fabric, ModLoader::NeoForge]
    );
    assert!(ModLoader::parse_all::<&str>(&[]).is_empty());
}

#[test]
fn mod_loaders_win_over_the_legacy_tag() {
    let legacy = dh_mod(Some(ModLoader::Fabric), Vec::new());
    assert_eq!(legacy.supports_loader(ModLoader::NeoForge), Some(false));
    assert_eq!(dh_mod(None, Vec::new()).supports_loader(ModLoader::NeoForge), None);

    let mut entry = dh_mod(Some(ModLoader::Fabric), Vec::new());
    entry.set_mod_loaders(vec![ModLoader::Fabric, ModLoader::NeoForge]);
    assert_eq!(entry.supports_loader(ModLoader::NeoForge), Some(true));
    assert_eq!(entry.primary_loader(), Some(ModLoader::Fabric));
}

#[test]
fn a_tag_changed_by_an_older_launcher_overrides_a_stale_list() {
    let entry = dh_mod(
        Some(ModLoader::Forge),
        vec![ModLoader::Fabric, ModLoader::NeoForge],
    );
    assert!(entry.known_mod_loaders().is_none());
    assert_eq!(entry.supports_loader(ModLoader::NeoForge), Some(false));
    assert_eq!(entry.supports_loader(ModLoader::Forge), Some(true));
    assert_eq!(entry.primary_loader(), Some(ModLoader::Forge));
}

#[test]
fn setting_loaders_keeps_the_legacy_tag_in_step() {
    let mut entry = dh_mod(Some(ModLoader::Fabric), Vec::new());
    entry.set_mod_loaders(Vec::new());
    assert_eq!(entry.supports_loader(ModLoader::Fabric), None);

    entry.set_mod_loaders_with_primary(
        vec![ModLoader::Fabric, ModLoader::NeoForge],
        ModLoader::NeoForge,
    );
    assert_eq!(entry.known_mod_loaders(), Some(&[ModLoader::NeoForge, ModLoader::Fabric][..]));

    entry.set_mod_loaders_with_primary(vec![ModLoader::Fabric], ModLoader::Forge);
    assert_eq!(entry.known_mod_loaders(), Some(&[ModLoader::Forge, ModLoader::Fabric][..]));
}

#[tokio::test]
async fn a_stale_list_is_read_again_from_the_jar() {
    let dir = tempfile::tempdir().unwrap();
    jar_with(dir.path(), DH, BOTH);
    let (outcome, delivered) = resolve_on_neoforge(
        &dh_mod(Some(ModLoader::Fabric), vec![ModLoader::Forge]),
        dir.path(),
    )
    .await;
    assert_eq!(outcome.status, ModResolutionStatus::Included);
    assert_eq!(outcome.jar_loaders, vec![ModLoader::Fabric, ModLoader::NeoForge]);
    assert_eq!(delivered, 1);
}

#[tokio::test]
async fn jar_loaders_reads_every_manifest() {
    let dir = tempfile::tempdir().unwrap();
    let all = jar_with(
        dir.path(),
        "all.jar",
        &[
            "fabric.mod.json",
            "quilt.mod.json",
            "META-INF/mods.toml",
            "META-INF/neoforge.mods.toml",
        ],
    );
    assert_eq!(jar_loaders(&all).await, ModLoader::MODDED.to_vec());
    let dh = jar_with(dir.path(), DH, BOTH);
    assert_eq!(jar_loaders(&dh).await, vec![ModLoader::Fabric, ModLoader::NeoForge]);
    assert!(jar_loaders(&dir.path().join("missing.jar")).await.is_empty());
}

#[tokio::test]
async fn legacy_fabric_tag_loads_on_neoforge_and_remembers_the_jar() {
    let dir = tempfile::tempdir().unwrap();
    jar_with(dir.path(), DH, BOTH);
    let (outcome, delivered) =
        resolve_on_neoforge(&dh_mod(Some(ModLoader::Fabric), Vec::new()), dir.path()).await;
    assert_eq!(outcome.status, ModResolutionStatus::Included);
    assert_eq!(outcome.jar_loaders, vec![ModLoader::Fabric, ModLoader::NeoForge]);
    assert_eq!(delivered, 1);
}

#[tokio::test]
async fn stored_mod_loaders_decide_without_the_jar() {
    let dir = tempfile::tempdir().unwrap();
    jar_with(dir.path(), DH, BOTH);
    let (outcome, delivered) =
        resolve_on_neoforge(&dh_mod(None, vec![ModLoader::Fabric]), dir.path()).await;
    assert_eq!(outcome.status, ModResolutionStatus::LoaderMismatch);
    assert!(outcome.jar_loaders.is_empty());
    assert_eq!(delivered, 0);

    let (outcome, delivered) = resolve_on_neoforge(
        &dh_mod(None, vec![ModLoader::Fabric, ModLoader::NeoForge]),
        dir.path(),
    )
    .await;
    assert_eq!(outcome.status, ModResolutionStatus::Included);
    assert!(outcome.jar_loaders.is_empty());
    assert_eq!(delivered, 1);
}

#[tokio::test]
async fn legacy_fabric_only_jar_is_skipped_and_remembered() {
    let dir = tempfile::tempdir().unwrap();
    jar_with(dir.path(), DH, &["fabric.mod.json"]);
    let (outcome, delivered) =
        resolve_on_neoforge(&dh_mod(Some(ModLoader::Fabric), Vec::new()), dir.path()).await;
    assert_eq!(outcome.status, ModResolutionStatus::LoaderMismatch);
    assert_eq!(outcome.jar_loaders, vec![ModLoader::Fabric]);
    assert_eq!(delivered, 0);
}
