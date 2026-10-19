use crate::temp_dir;
use noriskclient_launcher_v3_lib::support::files::*;
use std::path::{Path, PathBuf};
use std::time::Duration;

fn identity(s: &str) -> Result<String, String> {
    Ok(s.to_string())
}

#[test]
fn resolves_files_under_root_and_rejects_traversal_and_types() {
    let root = temp_dir("resolve");
    std::fs::create_dir_all(root.join("logs")).unwrap();
    std::fs::write(root.join("logs/latest.log"), "hello").unwrap();
    std::fs::write(root.join("logs/evil.exe"), "x").unwrap();

    let ok = resolve_safe_file(&root, Path::new("logs/latest.log")).unwrap();
    assert!(ok.is_some());
    assert_eq!(
        resolve_safe_file(&root, Path::new("logs/debug.log")).unwrap(),
        None
    );
    assert!(resolve_safe_file(&root, Path::new("../logs/latest.log")).is_err());
    assert!(resolve_safe_file(&root, Path::new("logs/evil.exe")).is_err());
    assert_eq!(
        resolve_safe_file(&root.join("nope"), Path::new("a.log")).unwrap(),
        None
    );
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn rejects_symlinks() {
    let root = temp_dir("symlink");
    let outside = temp_dir("outside");
    std::fs::write(outside.join("secret.log"), "secret").unwrap();
    std::os::unix::fs::symlink(outside.join("secret.log"), root.join("latest.log")).unwrap();
    assert!(resolve_safe_file(&root, Path::new("latest.log")).is_err());
    let _ = std::fs::remove_dir_all(root);
    let _ = std::fs::remove_dir_all(outside);
}

#[test]
fn truncates_large_files_to_head_and_tail_with_marker() {
    let root = temp_dir("truncate");
    let path = root.join("big.log");
    let mut content = String::new();
    for i in 0..20_000 {
        content.push_str(&format!("line {:05} some log text\n", i));
    }
    std::fs::write(&path, &content).unwrap();

    let (out, truncated) = read_redacted(&path, 16 * 1024, identity).unwrap();
    assert!(truncated);
    assert!(out.len() <= 16 * 1024, "len {}", out.len());
    assert!(out.starts_with("line 00000"));
    assert!(out.trim_end().ends_with("line 19999 some log text"));
    assert!(out.contains("NoRisk Launcher:"));

    let (small, truncated) = read_redacted(&path, 10 * 1024 * 1024, identity).unwrap();
    assert!(!truncated);
    assert_eq!(small, content);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn rejects_gzip_logs() {
    let root = temp_dir("gz");
    std::fs::write(root.join("2026-10-12-1.log.gz"), b"x").unwrap();
    assert!(resolve_safe_file(&root, Path::new("2026-10-12-1.log.gz")).is_err());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn newest_matching_picks_latest_allowed_file() {
    let root = temp_dir("newest");
    std::fs::create_dir_all(root.join("crash-reports")).unwrap();
    std::fs::write(root.join("crash-reports/crash-a.txt"), "a").unwrap();
    std::fs::write(root.join("crash-reports/crash-b.txt"), "b").unwrap();
    let older = std::time::SystemTime::now() - Duration::from_secs(60);
    std::fs::File::options()
        .write(true)
        .open(root.join("crash-reports/crash-a.txt"))
        .unwrap()
        .set_modified(older)
        .unwrap();
    std::fs::write(root.join("crash-reports/other.txt"), "c").unwrap();
    let found = newest_matching(
        &root,
        Path::new("crash-reports"),
        |n| n.starts_with("crash-") && n.ends_with(".txt"),
        Some(MAX_CRASH_AGE),
    );
    assert_eq!(
        found,
        Some(PathBuf::from("crash-reports").join("crash-b.txt"))
    );
    let _ = std::fs::remove_dir_all(root);
}
