mod error;
mod files;
mod handler;
mod handlers;
mod no_profile;
mod registry;
mod service;
mod snapshot;
mod temp_profile;
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
        profile: Some(profile),
        instance_path: Some(instance.to_path_buf()),
        file_byte_budget,
        session: None,
        choice: None,
    }
}

pub fn test_ctx_without_profile(file_byte_budget: u64) -> SupportContext {
    SupportContext {
        profile: None,
        instance_path: None,
        file_byte_budget,
        session: None,
        choice: None,
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
fn accepts_and_uppercases_the_code_from_the_link() {
    assert_eq!(
        normalize_code(" 0123456789abcdefghjkmnpqrs "),
        Some("0123456789ABCDEFGHJKMNPQRS".to_string())
    );
}

#[test]
fn rejects_short_codes_and_anything_that_is_not_a_link_code() {
    assert_eq!(normalize_code("K7QM-2XPA"), None);
    assert_eq!(normalize_code("K7QM2XPA"), None);
    assert_eq!(normalize_code(&"A".repeat(25)), None);
    assert_eq!(normalize_code(&"A".repeat(27)), None);
    assert_eq!(normalize_code("0123456789ABCD-FGHJKMNPQRS"), None);
    assert_eq!(normalize_code("0123456789ABCD/../HJKMNPQR"), None);
    assert_eq!(normalize_code("0123456789ABCDÄFGHJKMNPQR"), None);
}
