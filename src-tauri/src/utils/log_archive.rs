use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

const MAX_SESSIONS: usize = 10;
const STARTUP_PURGE_THRESHOLD: u64 = 500 * 1024 * 1024;

pub struct SessionInfo<'a> {
    pub process_id: Uuid,
    pub profile_id: Uuid,
    pub profile_name: Option<&'a str>,
    pub minecraft_version: Option<&'a str>,
    pub modloader: Option<&'a str>,
    pub modloader_version: Option<&'a str>,
    pub norisk_pack: Option<&'a str>,
    pub account_name: Option<&'a str>,
    pub start_time: DateTime<Utc>,
}

#[derive(Serialize, Deserialize)]
struct SessionRecord {
    session_id: String,
    process_id: String,
    profile_id: String,
    profile_name: Option<String>,
    minecraft_version: Option<String>,
    modloader: Option<String>,
    modloader_version: Option<String>,
    norisk_pack: Option<String>,
    account_name: Option<String>,
    start_time: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    end_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    success: Option<bool>,
}

pub fn archive_root() -> PathBuf {
    LAUNCHER_DIRECTORY.root_dir().join("logs").join("game")
}

pub fn build_session_id(
    profile_name: Option<&str>,
    process_id: Uuid,
    start_time: DateTime<Utc>,
) -> String {
    let stamp = start_time
        .with_timezone(&chrono::Local)
        .format("%Y-%m-%d_%H-%M-%S");
    let mut safe = sanitize_filename::sanitize(profile_name.unwrap_or("session"));
    if safe.is_empty() {
        safe = "session".to_string();
    }
    let id = process_id.to_string();
    let short = &id[..8.min(id.len())];
    format!("{stamp}_{safe}_{short}")
}

pub fn create_session(info: &SessionInfo) -> std::io::Result<(String, PathBuf)> {
    let session_id = build_session_id(info.profile_name, info.process_id, info.start_time);
    let session_dir = archive_root().join(&session_id);
    std::fs::create_dir_all(&session_dir)?;

    let record = SessionRecord {
        session_id: session_id.clone(),
        process_id: info.process_id.to_string(),
        profile_id: info.profile_id.to_string(),
        profile_name: info.profile_name.map(str::to_string),
        minecraft_version: info.minecraft_version.map(str::to_string),
        modloader: info.modloader.map(str::to_string),
        modloader_version: info.modloader_version.map(str::to_string),
        norisk_pack: info.norisk_pack.map(str::to_string),
        account_name: info.account_name.map(str::to_string),
        start_time: info.start_time.to_rfc3339(),
        end_time: None,
        exit_code: None,
        success: None,
    };
    if let Ok(json) = serde_json::to_string_pretty(&record) {
        let _ = std::fs::write(session_dir.join("session.json"), json);
    }

    Ok((session_id, session_dir.join("nrc-process.log")))
}

pub async fn finalize_game_session(session_id: &str, exit_code: Option<i32>, success: bool) {
    let json_path = archive_root().join(session_id).join("session.json");

    if let Ok(text) = fs::read_to_string(&json_path).await {
        if let Ok(mut record) = serde_json::from_str::<SessionRecord>(&text) {
            record.end_time = Some(Utc::now().to_rfc3339());
            record.exit_code = exit_code;
            record.success = Some(success);
            if let Ok(json) = serde_json::to_string_pretty(&record) {
                if let Err(e) = fs::write(&json_path, json).await {
                    log::warn!(
                        "[Log Archive] Could not update {}: {}",
                        json_path.display(),
                        e
                    );
                }
            }
        }
    }

    prune_old_sessions().await;
}

// Issue #130: pre-fix sessions could grow unbounded (137 GB observed). Replace
// any leftover oversized log with a marker so users recover disk on next boot.
pub async fn cleanup_oversized_logs() {
    let root = archive_root();
    let mut entries = match fs::read_dir(&root).await {
        Ok(e) => e,
        Err(_) => return,
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        if !entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let session_path = entry.path();

        let mut candidates: Vec<String> = vec!["nrc-process.log".to_string()];
        for i in 1..=crate::utils::bounded_log_writer::ROTATED_BACKUP_COUNT {
            candidates.push(format!("nrc-process.log.{}.gz", i));
        }
        for log_name in candidates {
            let log_path = session_path.join(log_name);
            let size = match fs::metadata(&log_path).await {
                Ok(m) if m.is_file() => m.len(),
                _ => continue,
            };
            if size <= STARTUP_PURGE_THRESHOLD {
                continue;
            }

            let size_mb = size / (1024 * 1024);
            log::warn!(
                "[Log Archive] {} is {} MB on startup -- purging (runaway stdout/stderr spam, issue #130)",
                log_path.display(),
                size_mb
            );
            let marker = format!(
                "[NRC] log was {} MB on launcher start -- contents purged to recover disk space.\n\
                 A mod spammed stdout/stderr during a previous session. Check installed mods for log spam.\n",
                size_mb
            );
            match tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&log_path)
                .await
            {
                Ok(mut f) => {
                    if let Err(e) = f.write_all(marker.as_bytes()).await {
                        log::warn!(
                            "[Log Archive] Could not write purge marker to {}: {}",
                            log_path.display(),
                            e
                        );
                    }
                }
                Err(e) => log::warn!(
                    "[Log Archive] Could not truncate oversized log {}: {}",
                    log_path.display(),
                    e
                ),
            }
        }
    }
}

async fn prune_old_sessions() {
    let root = archive_root();
    let mut entries = match fs::read_dir(&root).await {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut dirs: Vec<String> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
            dirs.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    if dirs.len() <= MAX_SESSIONS {
        return;
    }
    dirs.sort();
    let remove_count = dirs.len() - MAX_SESSIONS;
    for name in dirs.into_iter().take(remove_count) {
        let path = root.join(&name);
        if let Err(e) =
            crate::utils::trash_utils::move_path_to_trash(&path, Some("game-logs")).await
        {
            log::warn!(
                "[Log Archive] Could not move old session {} to trash: {}",
                path.display(),
                e
            );
        }
    }
}
