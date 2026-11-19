use noriskclient_launcher_v3_lib::utils::file_utils::scan_object_store;
use std::fs;

#[tokio::test]
async fn object_store_lists_nested_files_by_name_and_size() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("a/b")).unwrap();
    fs::write(root.join("top.txt"), b"1234").unwrap();
    fs::write(root.join("a/b/deep.bin"), b"12").unwrap();

    let files = scan_object_store(root).await;

    assert_eq!(files.len(), 2);
    assert_eq!(files["top.txt"], 4);
    assert_eq!(files["deep.bin"], 2);
}

#[tokio::test]
async fn missing_object_store_is_empty() {
    let dir = tempfile::tempdir().unwrap();

    let files = scan_object_store(&dir.path().join("missing")).await;

    assert!(files.is_empty());
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
