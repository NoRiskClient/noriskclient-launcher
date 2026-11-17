use noriskclient_launcher_v3_lib::utils::disk_space_utils::*;

#[test]
fn sizes_are_shown_in_the_largest_unit_that_fits() {
    assert_eq!(format_bytes(0), "0 B");
    assert_eq!(format_bytes(512), "512 B");
    assert_eq!(format_bytes(1024), "1.0 KB");
    assert_eq!(format_bytes(1536), "1.5 KB");
    assert_eq!(format_bytes(1048576), "1.0 MB");
    assert_eq!(format_bytes(1073741824), "1.0 GB");
}

#[test]
fn a_reserve_fraction_shrinks_what_a_download_may_use() {
    let disk_info = DiskSpaceInfo {
        available_bytes: 1000,
        total_bytes: 2000,
        used_bytes: 1000,
    };

    assert!(disk_info.has_enough_space(800, 0.0));
    assert!(disk_info.has_enough_space(800, 0.25));
    assert!(!disk_info.has_enough_space(850, 0.25));
}

#[tokio::test]
async fn existing_path_reports_plausible_space() {
    let dir = tempfile::tempdir().unwrap();

    let info = DiskSpaceUtils::get_disk_space(dir.path())
        .await
        .expect("a real directory must resolve to a disk");

    assert!(info.total_bytes > 0, "total must be known");
    assert!(
        info.available_bytes <= info.total_bytes,
        "available {} exceeds total {}",
        info.available_bytes,
        info.total_bytes
    );
}

#[tokio::test]
async fn not_yet_created_path_still_resolves() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("does/not/exist/yet/artifact.jar");

    let info = DiskSpaceUtils::get_disk_space(&target)
        .await
        .expect("an unborn path must still resolve via its filesystem");

    assert!(info.total_bytes > 0);
}
