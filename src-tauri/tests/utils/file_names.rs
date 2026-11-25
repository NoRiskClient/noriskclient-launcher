use noriskclient_launcher_v3_lib::utils::file_names::rename_beside;
use std::fs;
use std::path::PathBuf;

fn sandbox(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nrc-rename-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("mcreal")).unwrap();
    dir
}

#[test]
fn renaming_keeps_the_folder_and_the_extension() {
    let root = sandbox("keeps");
    let shot = root.join("mcreal").join("2026-11-25_09.15.51.png");
    fs::write(&shot, b"png").unwrap();
    let renamed = rename_beside(&root, &shot, "  sunset on spawn  ").unwrap();
    assert_eq!(renamed.file_name().unwrap(), "sunset on spawn.png");
    assert_eq!(renamed.parent().unwrap().file_name().unwrap(), "mcreal");
    assert!(renamed.is_file());
    assert!(!shot.exists());
}

#[test]
fn renaming_onto_an_existing_file_is_refused() {
    let root = sandbox("exists");
    fs::write(root.join("a.png"), b"a").unwrap();
    fs::write(root.join("b.png"), b"b").unwrap();
    assert!(rename_beside(&root, &root.join("a.png"), "b").is_err());
    assert_eq!(fs::read(root.join("b.png")).unwrap(), b"b");
}

#[test]
fn files_outside_the_root_are_never_touched() {
    let root = sandbox("outside");
    let other = sandbox("outside-other");
    let stray = other.join("x.png");
    fs::write(&stray, b"x").unwrap();
    assert!(rename_beside(&root, &stray, "y").is_err());
    assert!(stray.is_file());
}

#[test]
fn names_that_escape_the_folder_or_windows_rejects_are_refused() {
    let root = sandbox("bad");
    let shot = root.join("a.png");
    fs::write(&shot, b"a").unwrap();
    for name in ["", "   ", "../evil", "a/b", "c:d", "CON", "line\nbreak"] {
        assert!(rename_beside(&root, &shot, name).is_err(), "{name:?} should be refused");
    }
    assert!(shot.is_file());
}

#[test]
fn keeping_the_same_name_is_a_no_op() {
    let root = sandbox("same");
    let shot = root.join("a.png");
    fs::write(&shot, b"a").unwrap();
    assert_eq!(rename_beside(&root, &shot, "a").unwrap().file_name().unwrap(), "a.png");
    assert!(shot.is_file());
}
