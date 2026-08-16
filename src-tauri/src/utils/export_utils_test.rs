use super::*;
use async_zip::tokio::read::seek::ZipFileReader;
use tokio::io::BufReader;

#[tokio::test]
async fn trailing_manifest_is_found_by_name() {
    let dir = tempfile::tempdir().unwrap();
    let archive_path = dir.path().join("pack.noriskpack");

    let mut file = fs::File::create(&archive_path).await.unwrap();
    let mut writer = ZipFileWriter::with_tokio(&mut file);
    for name in ["overrides/config/a.txt", "overrides/mods/b.jar"] {
        writer
            .write_entry_whole(
                ZipEntryBuilder::new(name.to_string().into(), Compression::Deflate),
                b"payload",
            )
            .await
            .unwrap();
    }
    writer
        .write_entry_whole(
            ZipEntryBuilder::new("profile.json".to_string().into(), Compression::Deflate),
            br#"{"name":"trailing"}"#,
        )
        .await
        .unwrap();
    writer.close().await.unwrap();

    let opened = fs::File::open(&archive_path).await.unwrap();
    let mut reader = ZipFileReader::with_tokio(BufReader::new(opened))
        .await
        .unwrap();

    let index = reader
        .file()
        .entries()
        .iter()
        .position(|entry| {
            entry
                .filename()
                .as_str()
                .map_or(false, |name| name == "profile.json")
        })
        .expect("profile.json must be locatable even as the last entry");

    let mut buffer = Vec::new();
    reader
        .reader_with_entry(index)
        .await
        .unwrap()
        .read_to_end_checked(&mut buffer)
        .await
        .unwrap();
    assert_eq!(String::from_utf8(buffer).unwrap(), r#"{"name":"trailing"}"#);
}

#[tokio::test]
async fn no_selection_exports_no_files() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("options.txt"), "x").await.unwrap();

    let selected = select_export_files(dir.path(), None).await.unwrap();
    assert!(selected.is_empty());
}

#[tokio::test]
async fn selection_covers_ticked_subtrees_only() {
    let dir = tempfile::tempdir().unwrap();
    let instance = dir.path();
    fs::create_dir_all(instance.join("config/sodium"))
        .await
        .unwrap();
    fs::create_dir_all(instance.join("logs")).await.unwrap();
    fs::write(instance.join("config/sodium/opts.json"), "{}")
        .await
        .unwrap();
    fs::write(instance.join("logs/latest.log"), "log")
        .await
        .unwrap();
    fs::write(instance.join("options.txt"), "opts")
        .await
        .unwrap();

    let include = vec![instance.join("config"), instance.join("options.txt")];
    let mut selected = select_export_files(instance, Some(&include))
        .await
        .unwrap()
        .iter()
        .filter_map(|path| relative_zip_path(instance, path))
        .collect::<Vec<_>>();
    selected.sort();

    assert_eq!(selected, vec!["config/sodium/opts.json", "options.txt"]);
}

#[cfg(unix)]
fn link_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn link_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link)
}

#[tokio::test]
async fn linked_in_content_is_still_collected() {
    let dir = tempfile::tempdir().unwrap();
    let instance = dir.path().join("instance");
    let shared = dir.path().join("shared");
    fs::create_dir_all(&instance).await.unwrap();
    fs::create_dir_all(&shared).await.unwrap();
    fs::write(shared.join("sodium.jar"), "jar").await.unwrap();
    fs::write(instance.join("options.txt"), "opts").await.unwrap();

    if link_dir(&shared, &instance.join("mods")).is_err() {
        return;
    }

    let mut files = Vec::new();
    collect_all_files_recursive(&instance, &mut files).await.unwrap();

    let mut collected: Vec<String> = files
        .iter()
        .filter_map(|path| relative_zip_path(&instance, path))
        .collect();
    collected.sort();
    assert_eq!(collected, vec!["mods/sodium.jar", "options.txt"]);
}

#[tokio::test]
async fn symlink_loop_terminates() {
    let dir = tempfile::tempdir().unwrap();
    let instance = dir.path().join("instance");
    fs::create_dir_all(instance.join("nested")).await.unwrap();
    fs::write(instance.join("nested/a.txt"), "a").await.unwrap();

    if link_dir(&instance, &instance.join("nested").join("loop")).is_err() {
        return;
    }

    let mut files = Vec::new();
    collect_all_files_recursive(&instance, &mut files).await.unwrap();

    assert!(files.iter().any(|p| p.ends_with("a.txt")));
}

#[test]
fn loader_versions_lose_the_game_version_maven_prefix() {
    assert_eq!(normalize_loader_version("1.21.1-52.1.0", "1.21.1"), "52.1.0");
    assert_eq!(
        normalize_loader_version("1.8.9-11.15.1.2318-1.8.9", "1.8.9"),
        "11.15.1.2318"
    );
    assert_eq!(
        normalize_loader_version("  1.20.1-47.4.20  ", "1.20.1"),
        "47.4.20"
    );
}

#[test]
fn loader_versions_lose_the_stable_annotation() {
    assert_eq!(
        normalize_loader_version("0.19.3 (stable)", "1.21.11"),
        "0.19.3"
    );
    assert_eq!(
        normalize_loader_version("0.17.0 (stable)", "1.20.1"),
        "0.17.0"
    );
}

#[test]
fn loader_versions_without_a_prefix_are_untouched() {
    assert_eq!(normalize_loader_version("52.1.0", "1.21.1"), "52.1.0");
    assert_eq!(normalize_loader_version("0.15.11", "1.21.1"), "0.15.11");
    assert_eq!(normalize_loader_version("21.1.203", "1.21.1"), "21.1.203");
    assert_eq!(normalize_loader_version("1.20.1", "1.20.1"), "1.20.1");
}

#[test]
fn relative_zip_path_normalises_separators_and_rejects_outsiders() {
    let base = Path::new("/instances/foo");
    assert_eq!(
        relative_zip_path(base, &base.join("config").join("a.json")).as_deref(),
        Some("config/a.json")
    );
    assert_eq!(relative_zip_path(base, Path::new("/instances/bar/a.json")), None);
}

#[test]
fn flattens_managed_mod_dirs_into_overrides_mods() {
    assert_eq!(
        override_zip_path("mods/nrc-1.21.1-fabric/sodium-0.6.jar").as_deref(),
        Some("overrides/mods/sodium-0.6.jar")
    );
    assert_eq!(
        override_zip_path("mods/nrc-1.21.1-neoforge-ab12/jei.jar").as_deref(),
        Some("overrides/mods/jei.jar")
    );
    assert_eq!(
        override_zip_path("custom_mods/my-mod.jar").as_deref(),
        Some("overrides/mods/my-mod.jar")
    );
}

#[test]
fn keeps_regular_paths_verbatim() {
    assert_eq!(
        override_zip_path("mods/local-mod.jar").as_deref(),
        Some("overrides/mods/local-mod.jar")
    );
    assert_eq!(
        override_zip_path("config/sodium-options.json").as_deref(),
        Some("overrides/config/sodium-options.json")
    );
    assert_eq!(
        override_zip_path("options.txt").as_deref(),
        Some("overrides/options.txt")
    );
    assert_eq!(
        override_zip_path("saves/world/level.dat").as_deref(),
        Some("overrides/saves/world/level.dat")
    );
}

#[test]
fn drops_launcher_internal_and_runtime_junk() {
    assert_eq!(override_zip_path("profile.json"), None);
    assert_eq!(override_zip_path("logs/latest.log"), None);
    assert_eq!(override_zip_path("crash-reports/crash-2026.txt"), None);
    assert_eq!(override_zip_path(".fabric/remappedJars/a.jar"), None);
    assert_eq!(override_zip_path(".mixin.out/class.json"), None);
    assert_eq!(override_zip_path("config/.DS_Store"), None);
}

#[test]
fn nested_mod_folders_still_resolve_to_the_bare_filename() {
    assert_eq!(
        override_zip_path("mods/1.21.1/sodium.jar").as_deref(),
        Some("overrides/mods/1.21.1/sodium.jar")
    );

    let zip_path = override_zip_path("mods/1.21.1/sodium.jar").unwrap();
    let rest = zip_path.strip_prefix(OVERRIDES_MODS_PREFIX).unwrap();
    assert_eq!(rest.rsplit('/').next().unwrap(), "sodium.jar");
}
