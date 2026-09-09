use super::model::{ExternalInstance, ExternalInstanceRef, ExternalLauncher, IconRef, LauncherRoot};
use super::scan;
use crate::error::Result;
use async_trait::async_trait;
use std::path::{Path, PathBuf};

#[async_trait]
pub trait LauncherAdapter: Send + Sync {
    fn kind(&self) -> ExternalLauncher;

    fn candidate_roots(&self) -> Vec<PathBuf>;

    async fn probe(&self, root: &Path) -> Option<LauncherRoot>;

    fn instance_markers(&self) -> &'static [&'static str];

    async fn read_instance(&self, root: &LauncherRoot, dir: &Path) -> Result<ExternalInstance>;

    async fn read_ref(&self, root: &LauncherRoot, dir: &Path) -> Result<ExternalInstanceRef> {
        let instance = self.read_instance(root, dir).await?;
        let mut reference = instance.reference;
        reference.icon_path = instance.icon.as_ref().and_then(IconRef::file_path);
        Ok(reference)
    }

    async fn list_instances(&self, root: &LauncherRoot) -> Result<Vec<ExternalInstanceRef>> {
        scan::list_by_markers(self, root).await
    }

    async fn count_instances(&self, root: &LauncherRoot) -> usize {
        scan::count_by_markers(self.instance_markers(), &root.instances_dir).await
    }
}

pub async fn resolve_game_dir(instance_dir: &Path) -> Option<PathBuf> {
    for candidate in [
        instance_dir.join("minecraft"),
        instance_dir.join(".minecraft"),
    ] {
        if is_dir(&candidate).await {
            return Some(candidate);
        }
    }

    is_dir(instance_dir)
        .await
        .then(|| instance_dir.to_path_buf())
}

pub async fn is_dir(path: &Path) -> bool {
    tokio::fs::metadata(path)
        .await
        .map(|meta| meta.is_dir())
        .unwrap_or(false)
}

pub async fn exists(path: &Path) -> bool {
    tokio::fs::try_exists(path).await.unwrap_or(false)
}

pub async fn first_existing(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    for candidate in candidates {
        if exists(&candidate).await {
            return Some(candidate);
        }
    }
    None
}
