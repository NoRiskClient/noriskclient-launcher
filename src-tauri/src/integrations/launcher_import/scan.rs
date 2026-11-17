use super::adapter::{exists, LauncherAdapter};
use super::model::{ExternalInstanceRef, LauncherRoot};
use crate::error::{AppError, Result};
use log::{debug, warn};
use std::path::{Path, PathBuf};

const MAX_INSTANCES_PER_LAUNCHER: usize = 500;

async fn has_any_marker(markers: &[&str], dir: &Path) -> bool {
    for marker in markers {
        if exists(&dir.join(marker)).await {
            return true;
        }
    }
    false
}

pub async fn instance_dirs(markers: &[&str], instances_dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();

    let mut entries = match tokio::fs::read_dir(instances_dir).await {
        Ok(entries) => entries,
        Err(e) => {
            debug!(
                "Cannot read instances directory '{}': {}",
                instances_dir.display(),
                e
            );
            return found;
        }
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        if found.len() >= MAX_INSTANCES_PER_LAUNCHER {
            warn!(
                "Stopped listing '{}' at {} instances",
                instances_dir.display(),
                MAX_INSTANCES_PER_LAUNCHER
            );
            break;
        }

        let path = entry.path();
        let is_dir = entry
            .file_type()
            .await
            .map(|kind| kind.is_dir())
            .unwrap_or(false);

        if is_dir && has_any_marker(markers, &path).await {
            found.push(path);
        }
    }

    found.sort();
    found
}

pub async fn all_dirs(instances_dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();

    let Ok(mut entries) = tokio::fs::read_dir(instances_dir).await else {
        return found;
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        if found.len() >= MAX_INSTANCES_PER_LAUNCHER {
            break;
        }
        let is_dir = entry
            .file_type()
            .await
            .map(|kind| kind.is_dir())
            .unwrap_or(false);
        if is_dir {
            found.push(entry.path());
        }
    }

    found.sort();
    found
}

pub async fn count_by_markers(markers: &[&str], instances_dir: &Path) -> usize {
    instance_dirs(markers, instances_dir).await.len()
}

pub async fn list_by_markers<A: LauncherAdapter + ?Sized>(
    adapter: &A,
    root: &LauncherRoot,
) -> Result<Vec<ExternalInstanceRef>> {
    if !exists(&root.instances_dir).await {
        return Err(AppError::Other(format!(
            "'{}' has no instances folder at {}",
            root.launcher.display_name(),
            root.instances_dir.display()
        )));
    }

    let mut refs = Vec::new();

    for dir in instance_dirs(adapter.instance_markers(), &root.instances_dir).await {
        match adapter.read_ref(root, &dir).await {
            Ok(reference) => refs.push(reference),
            Err(e) => warn!("Skipping unreadable instance '{}': {}", dir.display(), e),
        }
    }

    Ok(refs)
}
