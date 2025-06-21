use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::integrations::norisk_packs::{self, NoriskModSourceDefinition, NoriskModpacksConfig};
use futures::stream::{iter, StreamExt};
use hex;
use log::{debug, error, info, warn};
use reqwest;
use sha1::{Digest, Sha1};
use std::path::PathBuf;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const DEFAULT_CONCURRENT_MOD_DOWNLOADS: usize = 4;
const MOD_CACHE_DIR_NAME: &str = "mod_cache"; // Reuse the same cache directory
const MODRINTH_MAVEN_URL: &str = "https://api.modrinth.com/maven"; // Modrinth Maven repo

#[derive(Clone)]
pub struct NoriskPackDownloadService {
    concurrent_downloads: usize,
}

impl NoriskPackDownloadService {
    pub fn new() -> Self {
        Self {
            concurrent_downloads: DEFAULT_CONCURRENT_MOD_DOWNLOADS,
        }
    }

    pub fn with_concurrency(concurrent_downloads: usize) -> Self {
        Self {
            concurrent_downloads,
        }
    }

    /// Downloads mods specified in a Norisk pack definition to the central mod cache.
    /// Requires the pack config, the ID of the pack to download, the target Minecraft version, and loader.
    pub async fn download_pack_mods_to_cache(
        &self,
        config: &NoriskModpacksConfig,
        pack_id: &str,
        minecraft_version: &str,
        loader: &str,
    ) -> Result<()> {
        info!(
            "Checking/Downloading Norisk Pack mods to cache. Pack ID: '{}', MC: {}, Loader: {} (Concurrency: {})",
            pack_id, minecraft_version, loader, self.concurrent_downloads
        );

        let mod_cache_dir = LAUNCHER_DIRECTORY.meta_dir().join(MOD_CACHE_DIR_NAME);
        if !mod_cache_dir.exists() {
            info!("Creating mod cache directory: {:?}", mod_cache_dir);
            fs::create_dir_all(&mod_cache_dir).await?;
        }

        let pack_definition = config.packs.get(pack_id).ok_or_else(|| {
            let msg = format!("Norisk pack definition not found for ID: '{}'", pack_id);
            error!("{}", msg);
            AppError::Other(msg)
        })?;

        let mut download_futures = Vec::new();

        for mod_entry in &pack_definition.mods {
            let compatibility_target = match mod_entry
                .compatibility
                .get(minecraft_version)
                .and_then(|loader_map| loader_map.get(loader))
            {
                Some(target) => target.clone(),
                None => {
                    warn!(
                        "No compatible version found for mod '{}' (ID: {}) for MC {} / Loader {}. Skipping.",
                        mod_entry.display_name.as_deref().unwrap_or(&mod_entry.id),
                        mod_entry.id,
                        minecraft_version,
                        loader
                    );
                    continue;
                }
            };

            let cache_dir_clone = mod_cache_dir.clone();
            let source = mod_entry.source.clone();
            let mod_id = mod_entry.id.clone();
            let display_name_opt = mod_entry.display_name.clone();
            let target_clone = compatibility_target.clone();

            // --- Determine filename using the new helper function ---
            let filename_result =
                norisk_packs::get_norisk_pack_mod_filename(&source, &target_clone, &mod_id);

            download_futures.push(async move {
                let display_name = display_name_opt.unwrap_or_else(|| mod_id.clone());
                let identifier = target_clone.identifier; // Keep identifier for version/URL

                // Check if filename retrieval was successful
                let filename = match filename_result {
                    Ok(fname) => fname,
                    Err(e) => {
                        // Log the error and skip this mod download
                        error!("Skipping download for mod '{}': {}", display_name, e);
                        return Err(e); // Return error to the future stream
                    }
                };

                let target_path = cache_dir_clone.join(&filename);

                // --- Proceed with download logic using derived/provided filename & identifier ---
                match source {
                    // Use the original source variable
                    NoriskModSourceDefinition::Modrinth {
                        project_id,
                        project_slug,
                    } => {
                        // Extract both IDs
                        let group_id = "maven.modrinth".to_string();
                        let artifact_id = project_slug;
                        let version = identifier;

                        Self::download_maven_mod(
                            MODRINTH_MAVEN_URL.to_string(),
                            group_id,
                            artifact_id, // Pass the corrected slug
                            version,
                            filename,
                            target_path,
                            None,
                        )
                        .await
                        .map_err(|e| {
                            error!(
                                "Failed cache Modrinth (as Maven) mod '{}': {}",
                                display_name, e
                            );
                            e
                        })
                    }
                    NoriskModSourceDefinition::Maven {
                        repository_ref,
                        group_id,
                        artifact_id,
                    } => {
                        let repo_url = config
                            .repositories
                            .get(&repository_ref)
                            .ok_or_else(|| {
                                AppError::Download(format!(
                                    "Repository reference '{}' not found for mod '{}'",
                                    repository_ref, display_name
                                ))
                            })?
                            .trim_end_matches('/')
                            .to_string();

                        // Use gid and aid directly as they are String now
                        let version = identifier;

                        Self::download_maven_mod(
                            repo_url,
                            group_id.clone(), // Clone if needed, or use reference
                            artifact_id.clone(),
                            version,
                            filename,
                            target_path,
                            None,
                        )
                        .await
                        .map_err(|e| {
                            error!("Failed cache Maven mod '{}': {}", display_name, e);
                            e
                        })
                    }
                    NoriskModSourceDefinition::Url => {
                        let download_url = identifier;

                        info!(
                            "Preparing URL mod for cache: {} ({})",
                            display_name, filename
                        );
                        Self::download_and_verify_file(&download_url, &target_path, None)
                            .await
                            .map_err(|e| {
                                error!("Failed cache URL mod {}: {}", display_name, e);
                                e
                            })
                    }
                }
            });
        }

        info!(
            "Executing {} Norisk pack mod cache tasks for pack '{}'...",
            download_futures.len(),
            pack_id
        );
        let results: Vec<Result<()>> = iter(download_futures)
            .buffer_unordered(self.concurrent_downloads)
            .collect()
            .await;

        let mut errors = Vec::new();
        for result in results {
            if let Err(e) = result {
                errors.push(e);
            }
        }

        if errors.is_empty() {
            info!(
                "Norisk pack mod cache check/download process completed successfully for pack: '{}'",
                pack_id
            );
            Ok(())
        } else {
            error!(
                "Norisk pack mod cache check/download process completed with {} errors for pack: '{}'",
                errors.len(), pack_id
            );
            Err(errors.remove(0))
        }
    }

    /// Helper function to download a mod from a Maven repository.
    async fn download_maven_mod(
        repo_url: String,
        group_id: String,
        artifact_id: String,
        version: String,
        filename: String,
        target_path: PathBuf,
        expected_sha1: Option<&str>,
    ) -> Result<()> {
        let group_path = group_id.replace('.', "/");
        let artifact_path = format!("{}/{}/{}/{}", group_path, artifact_id, version, filename);
        let download_url = format!("{}/{}", repo_url, artifact_path);

        info!(
            "Preparing Maven mod for cache: {} (Group: {}, Artifact: {}, Version: {}) from {}",
            filename, group_id, artifact_id, version, repo_url
        );

        Self::download_and_verify_file(&download_url, &target_path, expected_sha1).await
    }

    /// Downloads a file from a URL to a target path, optionally verifying its SHA1 hash.
    async fn download_and_verify_file(
        url: &str,
        target_path: &PathBuf,
        expected_sha1: Option<&str>,
    ) -> Result<()> {
        debug!("Checking file: {:?}", target_path);

        if target_path.exists() {
            if let Some(expected_hash) = expected_sha1 {
                debug!("File exists, verifying SHA1 hash...");
                let current_hash = Self::calculate_sha1(target_path).await?;
                if current_hash.eq_ignore_ascii_case(expected_hash) {
                    info!("File already exists and hash matches: {:?}", target_path);
                    return Ok(());
                } else {
                    warn!(
                        "Hash mismatch (Expected: {}, Found: {}). Redownloading: {:?}",
                        expected_hash, current_hash, target_path
                    );
                    fs::remove_file(target_path).await.map_err(|e| {
                        AppError::Download(format!("Failed to remove {:?}: {}", target_path, e))
                    })?;
                }
            } else {
                info!("File exists, skipping (no hash check): {:?}", target_path);
                return Ok(());
            }
        }

        info!("Downloading from {} to {:?}", url, target_path);
        let response = reqwest::get(url)
            .await
            .map_err(|e| AppError::Download(format!("Request failed for {}: {}", url, e)))?;

        if !response.status().is_success() {
            if response.status() == reqwest::StatusCode::NOT_FOUND {
                error!("Maven artifact not found (404): {}", url);
                return Err(AppError::Download(format!(
                    "Maven artifact not found: {}",
                    url
                )));
            } else {
                return Err(AppError::Download(format!(
                    "Download failed: Status {} for {}",
                    response.status(),
                    url
                )));
            }
        }

        if let Some(parent) = target_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).await?;
            }
        }
        let mut file = fs::File::create(target_path).await.map_err(|e| {
            AppError::Download(format!("Failed to create file {:?}: {}", target_path, e))
        })?;
        let mut stream = response.bytes_stream();

        while let Some(chunk_result) = stream.next().await {
            let chunk =
                chunk_result.map_err(|e| AppError::Download(format!("Stream error: {}", e)))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| AppError::Download(format!("Write error: {}", e)))?;
        }

        // Ensure the file is fully written to disk before attempting to read it.
        // This prevents potential "end of central directory record not found" errors with zip/jar files
        // that can occur if we try to read the file before the OS has flushed all write buffers.
        file.sync_all()
            .await
            .map_err(|e| AppError::Download(format!("Failed to sync norisk pack file: {}", e)))?;
        // Explicitly close the file by dropping the handle
        drop(file);

        debug!("Finished writing file: {:?}", target_path);

        if let Some(expected_hash) = expected_sha1 {
            debug!("Verifying SHA1 after download...");
            let downloaded_hash = Self::calculate_sha1(target_path).await?;
            if !downloaded_hash.eq_ignore_ascii_case(expected_hash) {
                error!(
                    "Hash mismatch after download! Expected: {}, Found: {}. Deleting: {:?}",
                    expected_hash, downloaded_hash, target_path
                );
                fs::remove_file(target_path).await.map_err(|e| {
                    AppError::Download(format!(
                        "Failed to remove invalid file {:?}: {}",
                        target_path, e
                    ))
                })?;
                return Err(AppError::Download(
                    "Hash mismatch after download".to_string(),
                ));
            } else {
                info!("Hash verified: {:?}", target_path);
            }
        }

        Ok(())
    }

    /// Calculates the SHA1 hash of a file asynchronously.
    async fn calculate_sha1(file_path: &PathBuf) -> Result<String> {
        let mut file = fs::File::open(file_path)
            .await
            .map_err(|e| AppError::Io(e))?;
        let mut hasher = Sha1::new();
        let mut buffer = [0; 1024];

        loop {
            let n = file.read(&mut buffer).await.map_err(|e| AppError::Io(e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }

        let hash_bytes = hasher.finalize();
        Ok(hex::encode(hash_bytes))
    }
}

// Note: Syncing logic (like `sync_mods_to_profile` from ModDownloadService)
// is not included here as it depends on a specific Profile's mod list,
// not directly on the Norisk Pack definition. Syncing would still use
// ModDownloadService after the Profile's mod list has been potentially
// updated based on a selected Norisk Pack.
