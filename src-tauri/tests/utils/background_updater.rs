use noriskclient_launcher_v3_lib::utils::background_updater::{
    discard_downloaded, save_downloaded, take_downloaded, DownloadedUpdate,
};
use serde_json::json;
use std::fs;

fn release(version: &str) -> serde_json::Value {
    json!({ "version": version, "platforms": {} })
}

#[test]
fn a_downloaded_update_is_handed_out_for_its_channel() {
    let dir = tempfile::tempdir().unwrap();
    let pending = dir.path().join("pending_update");
    save_downloaded(&pending, true, &release("0.6.32"), b"installer").unwrap();

    let taken = take_downloaded(&pending, true);

    assert_eq!(
        taken,
        Some(DownloadedUpdate {
            release: release("0.6.32"),
            package: b"installer".to_vec(),
        })
    );
}

#[test]
fn a_downloaded_update_is_off_the_disk_before_anyone_installs_it() {
    let dir = tempfile::tempdir().unwrap();
    let pending = dir.path().join("pending_update");
    save_downloaded(&pending, false, &release("0.6.32"), b"installer").unwrap();

    take_downloaded(&pending, false).unwrap();

    assert!(!pending.exists());
    assert_eq!(take_downloaded(&pending, false), None);
}

#[test]
fn an_update_from_the_other_channel_is_thrown_away() {
    let dir = tempfile::tempdir().unwrap();
    let pending = dir.path().join("pending_update");
    save_downloaded(&pending, true, &release("0.6.32-beta.1"), b"installer").unwrap();

    assert_eq!(take_downloaded(&pending, false), None);
    assert!(!pending.exists());
}

#[test]
fn a_damaged_release_file_is_thrown_away() {
    let dir = tempfile::tempdir().unwrap();
    let pending = dir.path().join("pending_update");
    fs::create_dir_all(&pending).unwrap();
    fs::write(pending.join("release.json"), b"{not json").unwrap();
    fs::write(pending.join("package"), b"installer").unwrap();

    assert_eq!(take_downloaded(&pending, false), None);
    assert!(!pending.exists());
}

#[test]
fn a_release_without_its_package_is_thrown_away() {
    let dir = tempfile::tempdir().unwrap();
    let pending = dir.path().join("pending_update");
    save_downloaded(&pending, false, &release("0.6.32"), b"installer").unwrap();
    fs::remove_file(pending.join("package")).unwrap();

    assert_eq!(take_downloaded(&pending, false), None);
    assert!(!pending.exists());
}

#[test]
fn nothing_downloaded_means_nothing_to_install() {
    let dir = tempfile::tempdir().unwrap();
    let pending = dir.path().join("pending_update");

    assert_eq!(take_downloaded(&pending, false), None);
    discard_downloaded(&pending);
}

#[test]
fn a_newer_download_replaces_the_older_one() {
    let dir = tempfile::tempdir().unwrap();
    let pending = dir.path().join("pending_update");
    save_downloaded(&pending, false, &release("0.6.32"), b"old installer").unwrap();
    save_downloaded(&pending, false, &release("0.6.33"), b"new installer").unwrap();

    let taken = take_downloaded(&pending, false).unwrap();

    assert_eq!(taken.release, release("0.6.33"));
    assert_eq!(taken.package, b"new installer".to_vec());
}

#[test]
fn the_next_update_check_comes_after_five_to_fifteen_minutes() {
    use noriskclient_launcher_v3_lib::utils::background_updater::next_check_in;
    use std::time::Duration;

    for _ in 0..1000 {
        let wait = next_check_in();
        assert!(wait >= Duration::from_secs(5 * 60));
        assert!(wait <= Duration::from_secs(15 * 60));
    }
}
