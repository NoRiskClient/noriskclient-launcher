use noriskclient_launcher_v3_lib::utils::file_utils::{scan_object_store, scan_tree};
use std::fs;

#[tokio::test]
async fn scan_tree_lists_files_with_sizes_and_every_directory() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("a/b")).unwrap();
    fs::write(root.join("top.txt"), b"1234").unwrap();
    fs::write(root.join("a/b/deep.bin"), b"12").unwrap();

    let listing = scan_tree(root).await;

    assert_eq!(listing.files.len(), 2);
    assert_eq!(listing.files[&root.join("top.txt")], 4);
    assert_eq!(listing.files[&root.join("a/b/deep.bin")], 2);
    let mut dirs = listing.dirs.clone();
    dirs.sort();
    assert_eq!(dirs, vec![root.join("a"), root.join("a/b")]);
}

#[tokio::test]
async fn scan_tree_of_missing_root_is_empty() {
    let dir = tempfile::tempdir().unwrap();

    let listing = scan_tree(&dir.path().join("missing")).await;

    assert!(listing.files.is_empty());
    assert!(listing.dirs.is_empty());
}

#[tokio::test]
async fn scan_object_store_maps_hash_to_size() {
    let dir = tempfile::tempdir().unwrap();
    let objects = dir.path().join("objects");
    fs::create_dir_all(objects.join("ab")).unwrap();
    fs::create_dir_all(objects.join("cd")).unwrap();
    fs::write(objects.join("ab/abcdef"), b"xyz").unwrap();
    fs::write(objects.join("cd/cd0123"), b"").unwrap();

    let store = scan_object_store(&objects).await;

    assert_eq!(store.len(), 2);
    assert_eq!(store["abcdef"], 3);
    assert_eq!(store["cd0123"], 0);
}
