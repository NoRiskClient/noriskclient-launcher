use crate::error::{AppError, Result};
use log::warn;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub struct StagingDir {
    path: PathBuf,
    committed: bool,
}

impl StagingDir {
    pub async fn create(base: &Path) -> Result<Self> {
        let path = base.join(format!(".import-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&path)
            .await
            .map_err(AppError::Io)?;

        Ok(Self {
            path,
            committed: false,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub async fn commit_to(&mut self, target: &Path) -> Result<()> {
        tokio::fs::rename(&self.path, target)
            .await
            .map_err(AppError::Io)?;
        self.committed = true;
        Ok(())
    }
}

impl Drop for StagingDir {
    fn drop(&mut self) {
        if self.committed {
            return;
        }

        let path = self.path.clone();
        tokio::spawn(async move {
            if let Err(e) = tokio::fs::remove_dir_all(&path).await {
                warn!("Could not clean up staging dir '{}': {}", path.display(), e);
            }
        });
    }
}
