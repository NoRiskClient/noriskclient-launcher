use crate::config::{ProjectDirsExt, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::dto::piston_meta::{AssetIndex, AssetIndexContent, AssetObject};
use crate::state::event_state::{EventPayload, EventType};
use crate::state::State;
use crate::utils::download_utils::{DownloadConfig, DownloadUtils};
use crate::utils::mc_utils;
use futures::stream::{iter, StreamExt};
use log::{debug, error, info, trace, warn};
use reqwest;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::fs;
use uuid::Uuid;

const ASSETS_DIR: &str = "assets";
const DEFAULT_CONCURRENT_DOWNLOADS: usize = 12;
// concurrent_assets is not used in this implementation

pub struct MinecraftAssetsDownloadService {
    assets_path: PathBuf,
    concurrent_downloads: usize,
}

impl MinecraftAssetsDownloadService {
    pub fn new() -> Self {
        let assets_path = LAUNCHER_DIRECTORY.meta_dir().join(ASSETS_DIR);
        info!(
            "[Assets Service] Initialized. Assets Path: {}",
            assets_path.display()
        );
        Self {
            assets_path,
            concurrent_downloads: DEFAULT_CONCURRENT_DOWNLOADS,
        }
    }

    /// Sets the number of concurrent downloads to use
    pub fn with_concurrent_downloads(mut self, concurrent_downloads: usize) -> Self {
        self.concurrent_downloads = concurrent_downloads;
        self
    }

    /// Download Minecraft assets with progress events
    pub async fn download_assets_with_progress(
        &self,
        asset_index: &AssetIndex,
        profile_id: Uuid,
    ) -> Result<()> {
        trace!(
            "[Assets Download] Starting download process for asset index: {}",
            asset_index.id
        );

        // Get state for events
        let state = State::get().await?;

        // Emit initial progress event
        self.emit_progress_event(
            &state,
            profile_id,
            &format!("Starting download for asset index: {}", asset_index.id),
            0.05,
            None,
        )
        .await?;

        // Try to reuse existing Minecraft assets first
        info!("[Assets Download] Checking if we can reuse existing Minecraft assets");

        // Use the progress-aware version
        let assets_reused =
            mc_utils::try_reuse_minecraft_assets_with_progress(asset_index, profile_id).await?;

        if assets_reused {
            info!("[Assets Download] Successfully reused existing Minecraft assets");
            // Even if we copied the index, we should check if any assets are missing
            debug!("[Assets Download] Checking for any missing assets that need to be downloaded");

            self.emit_progress_event(
                &state,
                profile_id,
                "Reused existing Minecraft assets. Checking for missing files...",
                0.2,
                None,
            )
            .await?;
        } else {
            info!("[Assets Download] No existing assets found or could not be reused, proceeding with download");

            self.emit_progress_event(
                &state,
                profile_id,
                "Downloading Minecraft assets index...",
                0.1,
                None,
            )
            .await?;
        }

        let asset_index_content = self.download_asset_index(asset_index).await?;

        self.emit_progress_event(
            &state,
            profile_id,
            &format!(
                "Asset index downloaded. Found {} assets to process",
                asset_index_content.objects.len()
            ),
            0.15,
            None,
        )
        .await?;

        let assets: Vec<(String, AssetObject)> = asset_index_content.objects.into_iter().collect();
        let mut downloads = Vec::new();
        let assets_path = self.assets_path.clone();
        let task_counter = Arc::new(AtomicUsize::new(1)); // Start counter at 1
        let completed_counter = Arc::new(AtomicUsize::new(0));
        let total_to_download = Arc::new(AtomicUsize::new(0));
        let total_assets = assets.len();

        trace!(
            "[Assets Download] Preparing {} potential jobs...",
            assets.len()
        );

        // Build a HashMap of existing files (hash -> size) from the objects directory
        // This replaces 4585 individual fs::try_exists + fs::metadata calls with a single directory scan
        let objects_path = assets_path.join("objects");
        let existing_files = measure_time!("Assets cache scan", {
            Self::scan_existing_assets(&objects_path).await
        });
        info!("[Assets Download] Found {} cached assets on disk", existing_files.len());

        let mut job_count = 0;

        for (name, asset) in assets {
            let hash = asset.hash.clone();
            let size = asset.size;
            let name_clone = name.clone();
            let task_counter_clone = Arc::clone(&task_counter);
            let completed_counter_clone = Arc::clone(&completed_counter);
            let total_to_download_clone = Arc::clone(&total_to_download);
            let target_path = objects_path.join(&hash[..2]).join(&hash);

            // Fast in-memory check instead of filesystem calls
            if let Some(&cached_size) = existing_files.get(&hash) {
                if cached_size as i64 == size {
                    trace!("[Assets Download] Skipping asset {} (already exists with correct size)", name_clone);
                    continue;
                }
                warn!("[Assets Download] Asset {} exists but size mismatch (expected {}, got {}), redownloading.", name_clone, size, cached_size);
            }

            job_count += 1;
            total_to_download_clone.fetch_add(1, Ordering::SeqCst);

            downloads.push(async move {
                let task_id = task_counter_clone.fetch_add(1, Ordering::SeqCst);
                trace!("[Assets Download Task {}] Starting download for: {}", task_id, name_clone);
                
                let url = format!(
                    "https://resources.download.minecraft.net/{}/{}",
                    &hash[..2],
                    hash
                );

                // Use the new centralized download utility with size verification
                let config = DownloadConfig::new()
                    .with_size(size as u64)  // Size verification prevents corruption
                    .with_streaming(false)  // Assets are typically small files
                    .with_retries(2);  // Limited retries for faster concurrent processing

                let download_result = DownloadUtils::download_file(&url, &target_path, config).await;
                
                match download_result {
                    Ok(()) => {
                        // Increment completed counter
                        let completed = completed_counter_clone.fetch_add(1, Ordering::SeqCst) + 1;
                        let total = total_to_download_clone.load(Ordering::SeqCst);

                        info!(
                            "[Assets Download Task {}] Finished download for: {} ({}/{})",
                            task_id, name_clone, completed, total
                        );
                        Ok(())
                    }
                    Err(e) => {
                        error!("[Assets Download Task {}] Failed to download asset {}: {}", task_id, name_clone, e);
                        Err(AppError::Download(format!("Failed to download asset {}: {}", name_clone, e)))
                    }
                }
            });
        }

        info!(
            "[Assets Download] Queued {} actual download tasks.",
            job_count
        );

        if job_count == 0 {
            info!("[Assets Download] No downloads needed, all assets already exist with correct sizes");

            // Final progress event
            self.emit_progress_event(
                &state,
                profile_id,
                "All Minecraft assets already up to date!",
                1.0,
                None,
            )
            .await?;

            return Ok(());
        }

        info!(
            "[Assets Download] Processing tasks with {} concurrent downloads...",
            self.concurrent_downloads
        );

        // Create progress tracking event
        if job_count > 0 {
            self.emit_progress_event(
                &state,
                profile_id,
                &format!("Downloading {} Minecraft assets...", job_count),
                0.2,
                None,
            )
            .await?;
        }

        let results: Vec<Result<()>> = iter(downloads)
            .buffer_unordered(self.concurrent_downloads)
            .inspect(|_| {
                // Update progress after each download completes
                let completed = completed_counter.fetch_add(0, Ordering::SeqCst); // Just read current value
                let total = total_to_download.load(Ordering::SeqCst);

                // Report progress every time
                if total > 0 {
                    // Calculate progress from 0.2 to 0.9
                    let progress = 0.2 + 0.7 * (completed as f64 / total as f64);

                    // Create a separate task for the event to avoid lifetime issues
                    tokio::spawn({
                        let state_clone = state.clone();
                        let message =
                            format!("Downloading Minecraft assets: {}/{}", completed, total);

                        async move {
                            let event_id = Uuid::new_v4();
                            if let Err(e) = state_clone
                                .emit_event(EventPayload {
                                    event_id,
                                    event_type: EventType::DownloadingAssets,
                                    target_id: Some(profile_id),
                                    message,
                                    progress: Some(progress),
                                    error: None,
                                })
                                .await
                            {
                                error!("[Assets Download] Failed to emit progress event: {}", e);
                            }
                        }
                    });
                }
            })
            .collect()
            .await;

        // Check for errors after all downloads are attempted
        let mut errors = Vec::new();
        for result in results {
            if let Err(e) = result {
                errors.push(e);
            }
        }

        if !errors.is_empty() {
            // Log all errors encountered
            error!("[Assets Download] Finished with {} errors:", errors.len());
            for error_item in &errors {
                error!("  - {}", error_item);
            }

            // Emit error event
            self.emit_progress_event(
                &state,
                profile_id,
                &format!("Asset download completed with {} errors", errors.len()),
                0.9,
                Some(errors[0].to_string()),
            )
            .await?;

            // Return the first error encountered to signal failure
            Err(errors.remove(0))
        } else {
            info!("[Assets Download] All asset downloads completed successfully.");

            // Final progress event
            self.emit_progress_event(
                &state,
                profile_id,
                "Minecraft assets download completed successfully!",
                1.0,
                None,
            )
            .await?;

            Ok(())
        }
    }

    /// Wrapper method to maintain compatibility with existing calls
    pub async fn download_assets(&self, asset_index: &AssetIndex) -> Result<()> {
        self.download_assets_with_progress(asset_index, Uuid::nil())
            .await
    }

    async fn download_asset_index(&self, asset_index: &AssetIndex) -> Result<AssetIndexContent> {
        let index_path = self
            .assets_path
            .join("indexes")
            .join(format!("{}.json", asset_index.id));

        info!("[Assets Download] Downloading asset index: {}", asset_index.id);

        // Use the new centralized download utility with size verification
        let config = DownloadConfig::new()
            .with_size(asset_index.size as u64)  // Size verification prevents corruption
            .with_streaming(false)  // Index files are small JSON files
            .with_retries(3);  // Built-in retry logic

        DownloadUtils::download_file(&asset_index.url, &index_path, config)
            .await
            .map_err(|e| AppError::Download(format!("Failed to download asset index {}: {}", asset_index.id, e)))?;

        info!("[Assets Download] Successfully downloaded asset index: {}", asset_index.id);

        // Read and parse the downloaded index
        let content = fs::read(&index_path).await?;
        Ok(serde_json::from_slice(&content)?)
    }

    /// Scans the objects directory and returns a HashMap of hash -> file size.
    /// This replaces thousands of individual filesystem calls with a single batch scan.
    async fn scan_existing_assets(objects_path: &PathBuf) -> HashMap<String, u64> {
        let mut existing = HashMap::new();

        // Read all prefix directories (00, 01, ..., ff)
        let mut prefix_dirs = match fs::read_dir(objects_path).await {
            Ok(dir) => dir,
            Err(_) => return existing,
        };

        while let Ok(Some(prefix_entry)) = prefix_dirs.next_entry().await {
            if !prefix_entry.path().is_dir() {
                continue;
            }

            // Read all hash files in this prefix directory
            let mut hash_files = match fs::read_dir(prefix_entry.path()).await {
                Ok(dir) => dir,
                Err(_) => continue,
            };

            while let Ok(Some(hash_entry)) = hash_files.next_entry().await {
                if let Ok(metadata) = hash_entry.metadata().await {
                    if metadata.is_file() {
                        let file_name = hash_entry.file_name().to_string_lossy().to_string();
                        existing.insert(file_name, metadata.len());
                    }
                }
            }
        }

        existing
    }

    /// Helper method for emitting progress events
    async fn emit_progress_event(
        &self,
        state: &State,
        profile_id: Uuid,
        message: &str,
        progress: f64,
        error: Option<String>,
    ) -> Result<Uuid> {
        let event_id = Uuid::new_v4();
        state
            .emit_event(EventPayload {
                event_id,
                event_type: EventType::DownloadingAssets,
                target_id: Some(profile_id),
                message: message.to_string(),
                progress: Some(progress),
                error,
            })
            .await?;
        Ok(event_id)
    }
}
