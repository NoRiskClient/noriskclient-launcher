use crate::{temp_dir, test_ctx_without_profile};
use noriskclient_launcher_v3_lib::error::AppError;
use noriskclient_launcher_v3_lib::integrations::pack_preview::{preview_pack, ORIGIN_ENTRY};
use noriskclient_launcher_v3_lib::support::error::{SupportError, SupportErrorKind};
use noriskclient_launcher_v3_lib::support::handler::NO_PROFILE;
use noriskclient_launcher_v3_lib::support::handlers::profile_snapshot::{pack_fits, requested_paths, share_error};
use noriskclient_launcher_v3_lib::support::registry::REGISTRY;
use noriskclient_launcher_v3_lib::support::service::prepare_item;
use noriskclient_launcher_v3_lib::utils::file_utils::remove_older_than;
use noriskclient_launcher_v3_lib::support::types::{ItemParams, ProfileLimits, RemoteSupportRequest};
use serde_json::json;
use std::io::Write;
use std::path::Path;
use std::time::Duration;

fn zip_with(path: &Path, entries: &[(&str, &[u8])]) {
    let mut writer = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    for (name, bytes) in entries {
        writer
            .start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap();
}

#[tokio::test]
async fn sharing_a_profile_asks_for_a_profile_first() {
    let handler = REGISTRY.get("PROFILE_SNAPSHOT").unwrap();
    assert!(handler.needs_profile());
    assert!(handler.runs_on_confirm());
    let item = prepare_item(handler, &test_ctx_without_profile(1024), &ItemParams::default()).await;
    assert!(!item.available);
    assert_eq!(item.summary.as_deref(), Some(NO_PROFILE));
}

#[tokio::test]
async fn a_downloaded_support_pack_shows_its_origin_in_the_normal_preview() {
    let dir = temp_dir("import-pack");
    let pack = dir.join("Ticket #7 – Main.noriskpack");
    let profile = json!({
        "name": "Ticket #7 – Main",
        "path": "",
        "game_version": "1.21.4",
        "loader": "fabric",
        "mods": [
            {"source": {"type": "modrinth", "project_id": "AANobbMI", "version_id": "tFw0iWAk", "file_name": "sodium.jar",
                "download_url": "https://cdn.modrinth.com/data/AANobbMI/versions/tFw0iWAk/sodium.jar", "file_hash_sha1": "a".repeat(40)},
             "enabled": true},
            {"source": {"type": "modrinth", "project_id": "x", "version_id": "y", "file_name": "evil.jar",
                "download_url": "https://evil.example/evil.jar", "file_hash_sha1": null},
             "enabled": true}
        ]
    })
    .to_string();
    let info = json!({
        "requestId": "r", "ticketNumber": 7, "owner": "Spieler", "profileName": "Ticket #7 – Main",
        "notTransferred": [{"path": "mods/unknown.jar", "reason": "UNKNOWN_MOD"}],
        "localMods": [{"fileName": "mine.jar", "size": 3, "sha256": "ab"}],
        "addedByPlayer": ["options.txt"]
    })
    .to_string();
    zip_with(
        &pack,
        &[
            ("profile.json", profile.as_bytes()),
            (ORIGIN_ENTRY, info.as_bytes()),
            ("overrides/options.txt", b"fov:0.5"),
        ],
    );

    let preview = preview_pack(&pack).await.unwrap();
    let origin = preview.origin.clone().unwrap();
    assert_eq!(origin.ticket_number, 7);
    assert_eq!(origin.owner, "Spieler");
    assert_eq!(origin.not_transferred.len(), 1);
    assert_eq!(origin.local_mods[0].file_name, "mine.jar");
    assert_eq!(origin.added_by_player, ["options.txt"]);
    assert_eq!(preview.mod_count, 1);
    assert_eq!(preview.security.rejected_mods.len(), 1);
    assert_eq!(preview.override_file_count, 1);
}

#[test]
fn a_pack_over_the_backend_limit_is_stopped_before_upload() {
    let request: RemoteSupportRequest = serde_json::from_value(json!({
        "requestId": "r", "ticketId": "t", "ticketNumber": 1, "category": "c", "createdAt": 0,
        "requestedBy": {"displayName": "Sup"}, "items": [], "expiresAt": 0,
        "maxUploadBytes": 1, "profileLimits": {"maxPackBytes": 100, "maxPackEntries": 5}
    }))
    .unwrap();
    let limits = request.profile_limits;
    assert!(pack_fits(100, limits.as_ref()));
    assert!(!pack_fits(101, limits.as_ref()));
    assert!(pack_fits(u64::MAX, None));
    assert!(pack_fits(u64::MAX, Some(&ProfileLimits::default())));
}

#[test]
fn every_size_refusal_reads_as_too_large_to_the_player() {
    assert_eq!(share_error(&SupportError::new(SupportErrorKind::TooLarge)), "too_large");
    for key in ["profile_too_many_entries", "data_too_large", "upload_too_large", "file_too_large", "suspicious_compression"] {
        let body = format!(r#"{{"translatableKey":"message.ticket.support_request.error.{}","args":[]}}"#, key);
        assert_eq!(share_error(&SupportError::from_response(400, &body, None)), "too_large", "{key}");
    }
    let export = SupportError::from(AppError::Other("too_large".to_string()));
    assert_eq!(share_error(&export), "too_large");
    assert_ne!(share_error(&SupportError::new(SupportErrorKind::Busy)), "too_large");
}

#[tokio::test]
async fn files_older_than_the_max_age_are_swept_and_fresh_ones_kept() {
    let root = temp_dir("sweep");
    std::fs::create_dir_all(root.join("old")).unwrap();
    std::fs::write(root.join("old/pack.noriskpack"), b"x").unwrap();
    assert_eq!(remove_older_than(&root, Duration::from_secs(3600)).await, 0);
    assert!(root.join("old").exists());
    assert_eq!(remove_older_than(&root, Duration::ZERO).await, 1);
    assert!(!root.join("old").exists());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn only_what_support_asked_for_is_offered() {
    let limits: ProfileLimits = serde_json::from_value(json!({
        "maxPackBytes": 1,
        "categoryPaths": {
            "configs": ["config"],
            "options": ["options.txt", "optionsNRC.json"],
            "noriskclient": ["NoRiskClient"]
        }
    }))
    .unwrap();
    let params = serde_json::from_value(json!({
        "include": "configs, options,noriskclient,unknown",
        "paths": "kubejs/**
NoRiskClient/**
config/foo.json"
    }))
    .unwrap();
    assert_eq!(
        requested_paths(&params, Some(&limits)),
        ["config", "options.txt", "optionsNRC.json", "NoRiskClient", "kubejs", "config/foo.json"]
    );
    assert_eq!(requested_paths(&params, None), ["kubejs", "NoRiskClient", "config/foo.json"]);
    assert!(requested_paths(&serde_json::Map::new(), Some(&limits)).is_empty());
}

#[test]
fn share_failures_name_the_reason() {
    let owner = r#"{"translatableKey":"message.ticket.support_request.error.profile_owner_only","args":[]}"#;
    let error = SupportError::from_response(403, owner, None);
    assert_eq!(share_error(&error), "forbidden");
    assert_eq!(share_error(&SupportError::new(SupportErrorKind::Offline)), "offline");
}
