use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::sync::model::SyncTargetKind;
use crate::utils::import_safety::safe_relative_path;
use log::warn;
use std::path::PathBuf;
use uuid::Uuid;

pub const SYNC_PACKS_DIR_NAME: &str = "sync_packs";

const DENIED_ROOTS: [&str; 4] = ["mods", "versions", "libraries", "assets"];
const DISCOURAGED_ROOTS: [&str; 2] = ["logs", "crash-reports"];

pub fn sync_packs_root() -> PathBuf {
    LAUNCHER_DIRECTORY.meta_dir().join(SYNC_PACKS_DIR_NAME)
}

pub fn strip_unc_prefix(path: &str) -> String {
    path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
}

pub fn pack_dir(pack_id: Uuid) -> PathBuf {
    sync_packs_root().join(pack_id.to_string())
}

pub fn pack_master_dir(pack_id: Uuid) -> PathBuf {
    pack_dir(pack_id).join("master")
}

pub fn pack_mods_dir(pack_id: Uuid) -> PathBuf {
    pack_dir(pack_id).join("mods")
}

pub async fn ensure_pack_dirs(pack_id: Uuid) -> Result<()> {
    tokio::fs::create_dir_all(pack_master_dir(pack_id)).await?;
    tokio::fs::create_dir_all(pack_mods_dir(pack_id)).await?;
    Ok(())
}

pub fn normalize_target_path(path: &str) -> Result<String> {
    let normalized = safe_relative_path(path)?;
    let joined = normalized
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/");

    if joined.is_empty() {
        return Err(AppError::Other(format!(
            "Sync target path '{}' resolves to no path segments",
            path
        )));
    }

    Ok(joined)
}

pub fn validate_target_path(path: &str, kind: &SyncTargetKind) -> Result<String> {
    let normalized = normalize_target_path(path)?;

    if matches!(kind, SyncTargetKind::Mods) {
        return Ok(normalized);
    }

    let root = normalized.split('/').next().unwrap_or_default().to_ascii_lowercase();

    if DENIED_ROOTS.contains(&root.as_str()) {
        return Err(AppError::Other(format!(
            "Sync target path '{}' is not allowed: '{}' is managed by the launcher",
            path, root
        )));
    }

    if DISCOURAGED_ROOTS.contains(&root.as_str()) {
        warn!(
            "Sync target path '{}' points at '{}', which is rewritten by the game on every launch",
            path, root
        );
    }

    Ok(normalized)
}

pub fn master_path_for(pack_id: Uuid, target_path: &str) -> Result<PathBuf> {
    let normalized = normalize_target_path(target_path)?;
    let mut out = pack_master_dir(pack_id);
    for segment in normalized.split('/') {
        out.push(segment);
    }
    Ok(out)
}

pub fn instance_path_for(instance_dir: &std::path::Path, target_path: &str) -> Result<PathBuf> {
    let normalized = normalize_target_path(target_path)?;
    let mut out = instance_dir.to_path_buf();
    for segment in normalized.split('/') {
        out.push(segment);
    }
    Ok(out)
}

pub fn is_temp_profile_path(profile_path: &str) -> bool {
    let normalized = profile_path.replace('\\', "/").to_ascii_lowercase();
    normalized.starts_with("noriskclient/temp/")
        || normalized.starts_with("temp/")
        || normalized.contains("/noriskclient/temp/")
}

pub async fn list_pack_local_jars(pack_id: Uuid) -> Result<Vec<PathBuf>> {
    let dir = pack_mods_dir(pack_id);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    let mut entries = tokio::fs::read_dir(&dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let is_jar = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("jar"))
            .unwrap_or(false);
        if is_jar && path.is_file() {
            out.push(path);
        }
    }

    out.sort();
    Ok(out)
}
