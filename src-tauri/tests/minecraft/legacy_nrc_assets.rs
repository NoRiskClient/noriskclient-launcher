use noriskclient_launcher_v3_lib::minecraft::downloads::norisk_assets_download::remove_legacy_asset_copy;
use std::fs;

#[tokio::test]
async fn removes_old_asset_copy_and_keeps_everything_else() {
    let dir = tempfile::tempdir().unwrap();
    let instance = dir.path().join("profile");
    let nrc = instance.join("NoRiskClient");
    fs::create_dir_all(nrc.join("assets/nrc/textures")).unwrap();
    fs::write(nrc.join("assets/nrc/textures/a.png"), b"x").unwrap();
    fs::create_dir_all(nrc.join("designer")).unwrap();
    fs::write(nrc.join("optionsNRC.json"), b"{}").unwrap();
    fs::create_dir_all(instance.join("assets")).unwrap();

    let removed = remove_legacy_asset_copy(&instance).await;

    assert!(removed);
    assert!(!nrc.join("assets").exists());
    assert!(nrc.join("designer").exists());
    assert!(nrc.join("optionsNRC.json").exists());
    assert!(instance.join("assets").exists());
}

#[tokio::test]
async fn profiles_without_old_copy_are_left_alone() {
    let dir = tempfile::tempdir().unwrap();
    let instance = dir.path().join("fresh");
    fs::create_dir_all(&instance).unwrap();

    assert!(!remove_legacy_asset_copy(&instance).await);
    assert!(!remove_legacy_asset_copy(&dir.path().join("missing")).await);
    assert!(instance.exists());
}
