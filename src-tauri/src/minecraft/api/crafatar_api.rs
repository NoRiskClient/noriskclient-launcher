use crate::config::{ProjectDirsExt, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use log::{debug, error, warn};
use serde::Deserialize;
use std::path::PathBuf;
use tokio::fs as tokio_fs;
use tokio::io::AsyncWriteExt;

const MCHEADS_API_BASE: &str = "https://mc-heads.net";
const MINEATAR_API_BASE: &str = "https://api.mineatar.io";

/// Normalizes UUID by removing hyphens for consistent cache filenames
fn normalize_uuid(uuid: &str) -> String {
    uuid.replace('-', "")
}

/// Generates cache filename based on UUID, size, and overlay parameters
fn generate_cache_filename(uuid: &str, size: Option<u32>, overlay: bool) -> String {
    let normalized_uuid = normalize_uuid(uuid);
    let size_str = size.map(|s| s.to_string()).unwrap_or_else(|| "default".to_string());
    let overlay_str = if overlay { "true" } else { "false" };
    format!("{}_{}_{}.png", normalized_uuid, size_str, overlay_str)
}

pub struct CrafatarApiService {
    cache_dir: PathBuf,
}

impl CrafatarApiService {
    pub fn new() -> Result<Self> {
        let cache_dir = LAUNCHER_DIRECTORY.meta_dir().join("crafatar_cache");
        if !cache_dir.exists() {
            std::fs::create_dir_all(&cache_dir).map_err(|e| {
                AppError::Other(format!("Failed to create MCHeads cache directory: {}", e))
            })?;
        }
        Ok(Self { cache_dir })
    }

    async fn fetch_from_mineatar(
        uuid: &str,
        size: Option<u32>,
        overlay: bool,
    ) -> Result<Vec<u8>> {
        // Mineatar uses /face/<uuid> endpoint for avatars
        // scale parameter: default is 4, which gives ~64x64 pixels
        // We convert size to scale: if size is provided, calculate scale (size / 16)
        // If no size provided, use default scale of 4
        let scale = if let Some(s) = size {
            // Mineatar's base is 16x16, so scale = size / 16
            // Minimum scale is 1, round up
            std::cmp::max(1, (s as f32 / 16.0).ceil() as u32)
        } else {
            4 // Default scale
        };

        let normalized_uuid = normalize_uuid(uuid);
        let base_url = format!("{}/face/{}", MINEATAR_API_BASE, normalized_uuid);

        let mut query_params = Vec::new();
        query_params.push(("scale", scale.to_string()));
        if overlay {
            query_params.push(("overlay", "true".to_string()));
        } else {
            query_params.push(("overlay", "false".to_string()));
        }

        let mut request_builder = HTTP_CLIENT.get(&base_url);
        request_builder = request_builder.query(&query_params);

        let request = request_builder.build().map_err(|e| {
            error!("Failed to build Mineatar API request: {}", e);
            AppError::Other(format!("Failed to build Mineatar API request: {}", e))
        })?;

        let final_url = request.url().to_string();

        debug!(
            "Fetching avatar from Mineatar fallback URL: {} for UUID {} (size: {:?}, overlay: {}, scale: {})",
            final_url, uuid, size, overlay, scale
        );

        let response = HTTP_CLIENT.execute(request).await.map_err(|e| {
            warn!(
                "Mineatar API request failed for UUID {} (size: {:?}, overlay: {}): {:?}",
                uuid, size, overlay, e
            );
            AppError::Other(format!("Mineatar API request failed: {}", e))
        })?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| format!("HTTP Error {}", status));
            warn!(
                "Mineatar API call failed for UUID {} (size: {:?}, overlay: {}) with status {}: {}",
                uuid, size, overlay, status, error_text
            );
            return Err(AppError::Other(format!(
                "Failed to fetch avatar from Mineatar for UUID '{}' (size: {:?}, overlay: {}): {}",
                uuid, size, overlay, error_text
            )));
        }

        let image_bytes = response.bytes().await.map_err(|e| {
            warn!(
                "Failed to read image bytes from Mineatar for UUID {} (size: {:?}, overlay: {}): {:?}",
                uuid, size, overlay, e
            );
            AppError::Other(format!("Failed to read image bytes from Mineatar for {}: {}", uuid, e))
        })?;

        debug!(
            "Successfully fetched avatar from Mineatar for UUID {} (size: {:?}, overlay: {})",
            uuid, size, overlay
        );
        Ok(image_bytes.to_vec())
    }

    async fn fetch_and_cache_avatar(
        uuid: &str,
        size: Option<u32>,
        overlay: bool,
        target_cache_path: &PathBuf,
    ) -> Result<Vec<u8>> {
        // MCHeads URL format: /avatar/{uuid}/{size} or /avatar/{uuid}/{size}/nohelm
        // UUID can be with or without hyphens, MCHeads accepts both
        let normalized_uuid = normalize_uuid(uuid);
        
        // Build URL path based on size and overlay parameters
        let url_path = if let Some(s) = size {
            if overlay {
                format!("/avatar/{}/{}", normalized_uuid, s)
            } else {
                format!("/avatar/{}/{}/nohelm", normalized_uuid, s)
            }
        } else {
            if overlay {
                format!("/avatar/{}", normalized_uuid)
            } else {
                format!("/avatar/{}/nohelm", normalized_uuid)
            }
        };
        
        let base_url = format!("{}{}", MCHEADS_API_BASE, url_path);

        let request = HTTP_CLIENT.get(&base_url).build().map_err(|e| {
            error!("Failed to build MCHeads API request: {}", e);
            AppError::Other(format!("Failed to build MCHeads API request: {}", e))
        })?;

        let final_url = request.url().to_string();

        debug!(
            "Fetching avatar from URL: {} for UUID {} (size: {:?}, overlay: {})",
            final_url, uuid, size, overlay
        );

        // Use global HTTP_CLIENT to execute the request
        let response = HTTP_CLIENT.execute(request).await.map_err(|e| {
            warn!(
                "MCHeads API request failed for UUID {} (size: {:?}, overlay: {}): {:?}",
                uuid, size, overlay, e
            );
            AppError::Other(format!("MCHeads API request failed: {}", e))
        })?;

        let status = response.status();
        let is_503_error = status == 503;

        if !status.is_success() {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| format!("HTTP Error {}", status));
            warn!(
                "MCHeads API call failed for UUID {} (size: {:?}, overlay: {}) with status {}: {}",
                uuid, size, overlay, status, error_text
            );

            // If 503 error, try Mineatar as fallback
            if is_503_error {
                debug!(
                    "MCHeads returned 503 for UUID {} (size: {:?}, overlay: {}), trying Mineatar fallback...",
                    uuid, size, overlay
                );
                match Self::fetch_from_mineatar(uuid, size, overlay).await {
                    Ok(mineatar_bytes) => {
                        // Save Mineatar result to cache
                        debug!(
                            "Mineatar fallback succeeded for UUID {} (size: {:?}, overlay: {}). Saving to cache: {:?}",
                            uuid, size, overlay, target_cache_path
                        );
                        let mut file = tokio_fs::File::create(&target_cache_path).await.map_err(|e| {
                            error!(
                                "Failed to create cache file for UUID {} (size: {:?}, overlay: {}): {:?}",
                                uuid, size, overlay, e
                            );
                            AppError::Other(format!(
                                "Failed to create cache file {}: {}",
                                target_cache_path.display(),
                                e
                            ))
                        })?;

                        file.write_all(&mineatar_bytes).await.map_err(|e| {
                            error!(
                                "Failed to write Mineatar image to cache file for UUID {} (size: {:?}, overlay: {}): {:?}",
                                uuid, size, overlay, e
                            );
                            AppError::Other(format!(
                                "Failed to write image to cache file {}: {}",
                                target_cache_path.display(),
                                e
                            ))
                        })?;

                        debug!(
                            "Successfully cached Mineatar avatar for UUID {} (size: {:?}, overlay: {}): {:?}",
                            uuid, size, overlay, target_cache_path
                        );
                        return Ok(mineatar_bytes);
                    }
                    Err(mineatar_err) => {
                        error!(
                            "Both MCHeads (503) and Mineatar failed for UUID {} (size: {:?}, overlay: {}). MCHeads error: {}, Mineatar error: {}",
                            uuid, size, overlay, error_text, mineatar_err
                        );
                        return Err(AppError::Other(format!(
                            "Failed to fetch avatar for UUID '{}' (size: {:?}, overlay: {}): MCHeads returned 503, Mineatar fallback also failed: {}",
                            uuid, size, overlay, mineatar_err
                        )));
                    }
                }
            }

            // For non-503 errors, return the original error
            return Err(AppError::Other(format!(
                "Failed to fetch avatar for UUID '{}' (size: {:?}, overlay: {}): {}",
                uuid,
                size,
                overlay,
                if status == 404 {
                    "Avatar not found".to_string()
                } else {
                    error_text
                }
            )));
        }

        let image_bytes = response.bytes().await.map_err(|e| {
            warn!(
                "Failed to read image bytes for UUID {} (size: {:?}, overlay: {}): {:?}",
                uuid, size, overlay, e
            );
            AppError::Other(format!("Failed to read image bytes for {}: {}", uuid, e))
        })?;

        debug!(
            "Saving avatar for UUID {} (size: {:?}, overlay: {}) to cache: {:?}",
            uuid, size, overlay, target_cache_path
        );
        let mut file = tokio_fs::File::create(&target_cache_path).await.map_err(|e| {
            error!(
                "Failed to create cache file for UUID {} (size: {:?}, overlay: {}): {:?}",
                uuid, size, overlay, e
            );
            AppError::Other(format!(
                "Failed to create cache file {}: {}",
                target_cache_path.display(),
                e
            ))
        })?;

        file.write_all(&image_bytes).await.map_err(|e| {
            error!(
                "Failed to write image to cache file for UUID {} (size: {:?}, overlay: {}): {:?}",
                uuid, size, overlay, e
            );
            AppError::Other(format!(
                "Failed to write image to cache file {}: {}",
                target_cache_path.display(),
                e
            ))
        })?;

        debug!(
            "Successfully cached avatar for UUID {} (size: {:?}, overlay: {}): {:?}",
            uuid, size, overlay, target_cache_path
        );
        Ok(image_bytes.to_vec())
    }

    async fn background_avatar_update(
        cache_dir: PathBuf,
        uuid: String,
        size: Option<u32>,
        overlay: bool,
    ) {
        let file_name = generate_cache_filename(&uuid, size, overlay);
        let cache_path = cache_dir.join(&file_name);

        debug!(
            "[BG] Attempting to update avatar for UUID {} (size: {:?}, overlay: {}) at {:?}",
            uuid, size, overlay, cache_path
        );

        match Self::fetch_and_cache_avatar(&uuid, size, overlay, &cache_path).await {
            Ok(_new_image_bytes) => {
                debug!(
                    "[BG] Avatar for UUID {} (size: {:?}, overlay: {}) successfully fetched and cached.",
                    uuid, size, overlay
                );
            }
            Err(e) => {
                warn!(
                    "[BG] Failed to fetch and cache avatar for UUID {} (size: {:?}, overlay: {}): {}",
                    uuid, size, overlay, e
                );
            }
        }
    }

    pub async fn get_avatar(
        &self,
        uuid: &str,
        size: Option<u32>,
        overlay: bool,
    ) -> Result<PathBuf> {
        debug!(
            "Requesting avatar for UUID: {} (size: {:?}, overlay: {})",
            uuid, size, overlay
        );

        let file_name = generate_cache_filename(uuid, size, overlay);
        let cache_path = self.cache_dir.join(&file_name);

        if cache_path.exists() {
            // Cache hit - return cached path and spawn background update
            debug!(
                "Cache hit for UUID {} (size: {:?}, overlay: {}): {:?}. Returning cached path and spawning background update.",
                uuid, size, overlay, cache_path
            );

            let cache_dir_clone = self.cache_dir.clone();
            let uuid_clone = uuid.to_string();
            let size_clone = size;

            tokio::spawn(async move {
                Self::background_avatar_update(cache_dir_clone, uuid_clone, size_clone, overlay)
                    .await;
            });
            Ok(cache_path)
        } else {
            // Cache miss, fetch and cache in foreground.
            debug!(
                "Cache miss for UUID {} (size: {:?}, overlay: {}). Fetching and caching in foreground.",
                uuid, size, overlay
            );
            match Self::fetch_and_cache_avatar(uuid, size, overlay, &cache_path).await {
                Ok(_) => Ok(cache_path),
                Err(e) => {
                    // If API fails (e.g., 503), check if we have any cached version for this UUID
                    // Try to find a cached avatar with different parameters
                    if let Ok(entries) = std::fs::read_dir(&self.cache_dir) {
                        let normalized_uuid = normalize_uuid(uuid);
                        for entry in entries.flatten() {
                            if let Some(file_name) = entry.file_name().to_str() {
                                if file_name.starts_with(&normalized_uuid) && file_name.ends_with(".png") {
                                    warn!(
                                        "API failed for UUID {} (size: {:?}, overlay: {}), but found cached version: {:?}. Returning cached version.",
                                        uuid, size, overlay, entry.path()
                                    );
                                    return Ok(entry.path());
                                }
                            }
                        }
                    }
                    error!(
                        "Failed to fetch avatar for UUID {} (size: {:?}, overlay: {}) in foreground: {}",
                        uuid, size, overlay, e
                    );
                    Err(e)
                }
            }
        }
    }
}

#[derive(Deserialize, Debug)]
pub struct GetCrafatarAvatarPayload {
    pub uuid: String,
    pub size: Option<u32>,
    #[serde(default = "default_overlay")]
    pub overlay: bool,
}

fn default_overlay() -> bool {
    true
}

