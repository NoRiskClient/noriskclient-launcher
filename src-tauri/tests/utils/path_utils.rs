use noriskclient_launcher_v3_lib::utils::path_utils::*;

#[test]
fn keeps_names_the_jvm_can_receive() {
    assert_eq!(to_launchable_ascii("Create+ 6.0"), "Create+ 6.0");
    assert_eq!(
        to_launchable_ascii("BattleArmory TACZ"),
        "BattleArmory TACZ"
    );
}

#[test]
fn transliterates_other_scripts() {
    assert_eq!(
        to_launchable_ascii("\u{7ea2}\u{77f3}\u{751f}\u{7535}\u{4f18}\u{5316}26.2"),
        "Hong Shi Sheng Dian You Hua 26.2"
    );
    assert!(to_launchable_ascii("\u{041c}\u{043e}\u{0439}").starts_with("Moi"));
}

#[test]
fn derives_a_stable_name_when_nothing_is_left() {
    let empty = to_launchable_ascii("");
    assert!(empty.starts_with("profile-"), "got {empty}");
    assert_eq!(empty, to_launchable_ascii(""));
}

#[cfg(windows)]
fn junction(link: &std::path::Path, target: &std::path::Path) {
    let status = std::process::Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .expect("mklink");
    assert!(status.status.success(), "{}", String::from_utf8_lossy(&status.stderr));
}

#[cfg(windows)]
#[tokio::test]
async fn a_folder_linking_back_into_the_profile_is_listed_once() {
    let root = tempfile::tempdir().expect("temp dir");
    let profile = root.path().join("profile");
    std::fs::create_dir_all(profile.join("mods")).expect("mods");
    std::fs::write(profile.join("mods").join("a.jar"), b"x").expect("jar");
    junction(&profile.join("loop"), &profile);

    let tree = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        get_directory_structure(&profile, false),
    )
    .await
    .expect("the scan must not walk the loop")
    .expect("scan");

    let looped = tree.children.iter().find(|c| c.name == "loop").expect("loop listed");
    assert!(looped.children.is_empty());
    let mods = tree.children.iter().find(|c| c.name == "mods").expect("mods listed");
    assert_eq!(mods.children.len(), 1);
}

#[cfg(windows)]
#[tokio::test]
async fn a_folder_linked_from_elsewhere_still_shows_its_files() {
    let root = tempfile::tempdir().expect("temp dir");
    let shared = root.path().join("shared-config");
    std::fs::create_dir_all(&shared).expect("shared");
    std::fs::write(shared.join("options.txt"), b"x").expect("file");
    let profile = root.path().join("profile");
    std::fs::create_dir_all(&profile).expect("profile");
    junction(&profile.join("config"), &shared);

    let tree = get_directory_structure(&profile, false).await.expect("scan");

    let config = tree.children.iter().find(|c| c.name == "config").expect("config listed");
    assert_eq!(config.children.len(), 1);
}

#[cfg(windows)]
#[tokio::test]
async fn duplicating_a_profile_that_links_back_into_itself_finishes() {
    let root = tempfile::tempdir().expect("temp dir");
    let profile = root.path().join("profile");
    std::fs::create_dir_all(profile.join("mods")).expect("mods");
    std::fs::write(profile.join("mods").join("a.jar"), b"x").expect("jar");
    junction(&profile.join("loop"), &profile);
    let copy = root.path().join("copy");

    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        copy_dir_recursively(&profile, &copy, std::sync::Arc::new(tokio::sync::Semaphore::new(4))),
    )
    .await
    .expect("the copy must not walk the loop")
    .expect("copy");

    assert!(copy.join("mods").join("a.jar").is_file());
    assert_eq!(std::fs::read_dir(copy.join("loop")).expect("loop copied").count(), 0);
}

#[cfg(windows)]
#[tokio::test]
async fn duplicating_a_profile_keeps_files_of_folders_linked_from_elsewhere() {
    let root = tempfile::tempdir().expect("temp dir");
    let shared = root.path().join("shared-config");
    std::fs::create_dir_all(&shared).expect("shared");
    std::fs::write(shared.join("options.txt"), b"x").expect("file");
    let profile = root.path().join("profile");
    std::fs::create_dir_all(&profile).expect("profile");
    junction(&profile.join("config"), &shared);
    let copy = root.path().join("copy");

    copy_dir_recursively(&profile, &copy, std::sync::Arc::new(tokio::sync::Semaphore::new(4)))
        .await
        .expect("copy");

    assert!(copy.join("config").join("options.txt").is_file());
}
