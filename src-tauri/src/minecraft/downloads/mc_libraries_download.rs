use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::dto::piston_meta::{DownloadInfo, Library};
use futures::stream::{iter, StreamExt};
use log::info;
use reqwest;
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncWriteExt;

const LIBRARIES_DIR: &str = "libraries";
const DEFAULT_CONCURRENT_DOWNLOADS: usize = 12;
const DEFAULT_CONCURRENT_LIBRARIES: usize = 12;

pub struct MinecraftLibrariesDownloadService {
    base_path: PathBuf,
    concurrent_downloads: usize,
    concurrent_libraries: usize,
}

impl MinecraftLibrariesDownloadService {
    pub fn new() -> Self {
        let base_path = LAUNCHER_DIRECTORY.meta_dir().join(LIBRARIES_DIR);
        Self {
            base_path,
            concurrent_downloads: DEFAULT_CONCURRENT_DOWNLOADS,
            concurrent_libraries: DEFAULT_CONCURRENT_LIBRARIES,
        }
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

        if fs::try_exists(&target_path).await? {
            let metadata = fs::metadata(&target_path).await?;
            if metadata.len() as i64 == download_info.size {
                info!(
                    "File already exists with correct size: {}",
                    target_path.display()
                );
                return Ok(());
            }
        }

        let url = &download_info.url;
        let response = reqwest::get(url).await.map_err(AppError::MinecraftApi)?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "No error details available".to_string());
            return Err(AppError::Download(format!(
                "Failed to download file from {} - Status {}: {}",
                url, status, error_text
            )));
        }

        let bytes = response.bytes().await.map_err(AppError::MinecraftApi)?;

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let mut file = fs::File::create(&target_path).await?;
        file.write_all(&bytes).await?;
        
        // Ensure the file is fully written to disk before attempting to read it.
        // This prevents potential "end of central directory record not found" errors with jar files
        // that can occur if we try to read the file before the OS has flushed all write buffers.
        file.sync_all().await.map_err(|e| {
            AppError::Download(format!("Failed to sync minecraft library: {}", e))
        })?;
        // Explicitly close the file by dropping the handle
        drop(file);

        Ok(())
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
