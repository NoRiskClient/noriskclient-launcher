mod error;
mod files;
mod handler;
mod handlers;
mod registry;
mod service;
mod types;

use noriskclient_launcher_v3_lib::state::profile_state::Profile;
use noriskclient_launcher_v3_lib::support::handler::SupportContext;
use noriskclient_launcher_v3_lib::support::normalize_code;
use std::path::{Path, PathBuf};

pub fn test_ctx(instance: &Path, file_byte_budget: u64) -> SupportContext {
    let profile: Profile = serde_json::from_value(serde_json::json!({
        "name": "test",
        "path": "test",
        "game_version": "1.21.1",
        "loader": "fabric",
    }))
    .unwrap();
    SupportContext {
        profile,
        instance_path: instance.to_path_buf(),
        file_byte_budget,
    }
}

pub fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "nrc-support-test-{}-{}",
        name,
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn accepts_and_uppercases_valid_codes() {
    assert_eq!(normalize_code("k7qm-2xpa"), Some("K7QM-2XPA".to_string()));
    assert_eq!(normalize_code(" ABCDEFGH "), Some("ABCDEFGH".to_string()));
    assert!(normalize_code(&"A".repeat(40)).is_some());
}

#[test]
fn rejects_invalid_codes() {
    assert_eq!(normalize_code("short"), None);
    assert_eq!(normalize_code(&"A".repeat(41)), None);
    assert_eq!(normalize_code("ABCD/../EFGH"), None);
    assert_eq!(normalize_code("ABCD EFGH"), None);
    assert_eq!(normalize_code("ABCDEFGH?x=1"), None);
    assert_eq!(normalize_code("ÄBCDEFGHI"), None);
}
