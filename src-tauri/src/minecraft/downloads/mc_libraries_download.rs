use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::minecraft::dto::piston_meta::{DownloadInfo, Library};
use crate::minecraft::launch::launch_summary::DownloadStats;
use crate::utils::download_utils::{DownloadConfig, DownloadUtils};
use futures::stream::{iter, StreamExt};
use std::path::PathBuf;
use std::sync::Arc;

const LIBRARIES_DIR: &str = "libraries";
const DEFAULT_CONCURRENT_DOWNLOADS: usize = 12;

pub struct MinecraftLibrariesDownloadService {
    base_path: PathBuf,
    concurrent_downloads: usize,
    stats: Option<Arc<DownloadStats>>,
    verify_hashes: bool,
}

impl MinecraftLibrariesDownloadService {
    pub fn new() -> Self {
        let base_path = LAUNCHER_DIRECTORY.meta_dir().join(LIBRARIES_DIR);
        Self {
            base_path,
            concurrent_downloads: DEFAULT_CONCURRENT_DOWNLOADS,
            stats: None,
            verify_hashes: false,
        }
    }

    pub fn with_stats(mut self, stats: Arc<DownloadStats>) -> Self {
        self.stats = Some(stats);
        self
    }

    pub fn with_verify_hashes(mut self, verify_hashes: bool) -> Self {
        self.verify_hashes = verify_hashes;
        self
    }

    pub fn with_concurrent_downloads(mut self, concurrent_downloads: usize) -> Self {
        self.concurrent_downloads = concurrent_downloads;
        self
    }

    pub async fn download_libraries(&self, libraries: &[Library]) -> Result<()> {
        let futures = libraries.iter().map(|library| {
            let self_clone = self;
            let library_clone = library;
            async move { self_clone.download_library(&library_clone).await }
        });

        let results: Vec<Result<()>> = futures::future::join_all(futures).await;
        for result in results {
            result?;
        }
        Ok(())
    }

    async fn download_library(&self, library: &Library) -> Result<()> {
        let mut downloads = Vec::new();

        if let Some(artifact) = &library.downloads.artifact {
            downloads.push(self.download_file(artifact));
        }

        if let Some(classifiers) = &library.downloads.classifiers {
            for (_, download_info) in classifiers {
                downloads.push(self.download_file(download_info));
            }
        }

        let results: Vec<Result<()>> = iter(downloads)
            .buffer_unordered(self.concurrent_downloads)
            .collect()
            .await;

        for result in results {
            result?;
        }

        Ok(())
    }

    async fn download_file(&self, download_info: &DownloadInfo) -> Result<()> {
        let target_path = self.get_library_path(download_info);

        let mut config = DownloadConfig::new()
            .with_size(download_info.size as u64)  // Size verification prevents corruption
            .with_hash_existing_files(self.verify_hashes)
            .with_streaming(false)  // Libraries are usually small files
            .with_retries(3)  // Built-in retry logic for network issues
            .with_stats(self.stats.clone());

        if !download_info.sha1.is_empty() {
            config = config.with_sha1(download_info.sha1.clone());
        }

        DownloadUtils::download_file(&download_info.url, &target_path, config).await
    }

    fn get_library_path(&self, download_info: &DownloadInfo) -> PathBuf {
        let url = &download_info.url;
        let path = url
            .split("libraries.minecraft.net/")
            .nth(1)
            .expect("Invalid library URL");

        self.base_path.join(path)
    }
}
