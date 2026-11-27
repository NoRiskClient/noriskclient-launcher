use noriskclient_launcher_v3_lib::utils::file_names::{rename_beside, sanitise_name, MAX_NAME};
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

#[test]
fn the_renamed_path_is_a_plain_windows_path() {
    let root = sandbox("plain");
    let shot = root.join("a.png");
    fs::write(&shot, b"a").unwrap();
    let renamed = rename_beside(&root, &shot, "b").unwrap();
    assert!(!renamed.to_string_lossy().starts_with("\\?\\"), "{}", renamed.display());
}

#[test]
fn changing_only_the_case_renames_the_file() {
    let root = sandbox("case");
    let shot = root.join("shot.png");
    fs::write(&shot, b"a").unwrap();
    let renamed = rename_beside(&root, &shot, "Shot").unwrap();
    assert_eq!(renamed.file_name().unwrap(), "Shot.png");
    let names: Vec<_> = fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .filter(|name| name.to_string_lossy().ends_with(".png"))
        .collect();
    assert_eq!(names, vec![std::ffi::OsString::from("Shot.png")]);
}

#[test]
fn an_ordinary_name_is_kept_exactly() {
    assert_eq!(sanitise_name("insane clutch").unwrap(), "insane clutch");
    assert_eq!(sanitise_name("  bed rush  ").unwrap(), "bed rush");
}

#[test]
fn names_people_actually_type_are_allowed() {
    for name in ["1v5 ace!", "clip #3", "wtf... how", "Räuber & Gendarm", "近距離", "console wars"] {
        assert!(sanitise_name(name).is_ok(), "{name} should be allowed");
    }
}

#[test]
fn device_names_are_refused_however_they_are_written() {
    for name in ["CON", "con", "NUL", "com1", "LPT9", "aux.mp4", "...", ".."] {
        assert!(sanitise_name(name).is_err(), "{name} should be refused");
    }
}

#[test]
fn a_name_longer_than_the_limit_is_refused() {
    assert!(sanitise_name(&"a".repeat(MAX_NAME)).is_ok());
    assert!(sanitise_name(&"a".repeat(MAX_NAME + 1)).is_err());
}

#[test]
fn a_trailing_dot_is_dropped_because_windows_drops_it_anyway() {
    assert_eq!(sanitise_name("clip.").unwrap(), "clip");
}
