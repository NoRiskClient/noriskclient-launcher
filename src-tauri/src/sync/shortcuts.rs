use crate::sync::model::{SyncTarget, SyncTargetKind};
use crate::sync::paths;
use crate::utils::symlink_utils;
use log::{info, warn};
use std::path::PathBuf;
use uuid::Uuid;

pub async fn refresh(pack_id: Uuid, target: &SyncTarget) {
    let Some(external) = target.external_path.as_deref().filter(|p| !p.is_empty()) else {
        return;
    };
    if !matches!(target.kind, SyncTargetKind::DirLink { .. }) {
        return;
    }

    let Ok(shortcut) = paths::master_path_for(pack_id, &target.path) else {
        return;
    };

    if symlink_utils::is_symlink(&shortcut).await.unwrap_or(false) {
        if symlink_utils::remove_symlink(&shortcut).await.is_err() {
            return;
        }
    } else if shortcut.exists() {
        return;
    }

    if let Some(parent) = shortcut.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    match symlink_utils::create_symlink(&PathBuf::from(external), &shortcut, true).await {
        Ok(()) => info!(
            "Pack {} now shows '{}' as a shortcut to {}",
            pack_id, target.path, external
        ),
        Err(e) => warn!(
            "Could not create the shortcut for '{}' in pack {}: {}",
            target.path, pack_id, e
        ),
    }
}

pub async fn remove(pack_id: Uuid, target: &SyncTarget) {
    if target.external_path.is_none() {
        return;
    }
    let Ok(shortcut) = paths::master_path_for(pack_id, &target.path) else {
        return;
    };
    if symlink_utils::is_symlink(&shortcut).await.unwrap_or(false) {
        let _ = symlink_utils::remove_symlink(&shortcut).await;
    }
}
