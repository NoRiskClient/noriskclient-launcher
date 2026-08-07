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

    // Creating links needs Developer Mode or admin on Windows; skip where it is unavailable.
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

    // Creating links needs Developer Mode or admin on Windows; skip where it is unavailable.
    if link_dir(&instance, &instance.join("nested").join("loop")).is_err() {
        return;
    }

    let mut files = Vec::new();
    collect_all_files_recursive(&instance, &mut files).await.unwrap();

    assert!(files.iter().any(|p| p.ends_with("a.txt")));
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
