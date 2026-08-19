use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::minecraft::dto::piston_meta::DownloadInfo;
use crate::minecraft::launch::launch_summary::DownloadStats;
use crate::utils::download_utils::{DownloadConfig, DownloadUtils};
use log::debug;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;

const VERSIONS_DIR: &str = "versions";

pub struct MinecraftClientDownloadService {
    base_path: PathBuf,
    stats: Option<Arc<DownloadStats>>,
}

impl MinecraftClientDownloadService {
    pub fn new() -> Self {
        let base_path = LAUNCHER_DIRECTORY.meta_dir().join(VERSIONS_DIR);
        Self {
            base_path,
            stats: None,
        }
    }

    pub fn with_stats(mut self, stats: Arc<DownloadStats>) -> Self {
        self.stats = Some(stats);
        self
    }

    pub async fn download_client(
        &self,
        client_info: &DownloadInfo,
        version_id: &str,
    ) -> Result<()> {
        let version_dir = self.base_path.join(version_id);
        let target_path = version_dir.join(format!("{}.jar", version_id));

        fs::create_dir_all(&version_dir).await?;

        debug!("Ensuring client jar for version: {}", version_id);

        // Use the new centralized download utility with size verification
        let config = DownloadConfig::new()
            .with_size(client_info.size as u64)  // Size verification prevents corruption
            .with_streaming(true)  // Client JARs are large files
            .with_retries(3)  // Built-in retry logic for network issues
            .with_stats(self.stats.clone());

        DownloadUtils::download_file(&client_info.url, &target_path, config).await?;

        debug!("Client jar ready at: {}", target_path.display());
        Ok(())
    }
}
