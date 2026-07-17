use crate::config::{ProjectDirsExt, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::minecraft::dto::fabric_meta::FabricVersionInfo;
use crate::utils::file_utils::write_atomic;
use log::{debug, error};
use serde_json;
use std::path::PathBuf;
use tokio::fs as tokio_fs;

pub struct FabricApi {
    base_url: String,
    cache_dir: PathBuf,
}

impl FabricApi {
    pub fn new() -> Self {
        let cache_dir = LAUNCHER_DIRECTORY.meta_dir().join("fabric_cache");
        if !cache_dir.exists() {
            std::fs::create_dir_all(&cache_dir).unwrap_or_else(|e| {
                error!("Failed to create Fabric cache directory: {}", e);
            });
        }
        Self {
            base_url: "https://meta.fabricmc.net/v2".to_string(),
            cache_dir,
        }
    }

    async fn fetch_and_cache_versions(
        base_url: &str,
        minecraft_version: &str,
        cache_path: &PathBuf,
    ) -> Result<Vec<FabricVersionInfo>> {
        let url = format!("{}/versions/loader/{}", base_url, minecraft_version);
        debug!("Fetching Fabric versions from: {}", url);

        let response = HTTP_CLIENT.get(&url).send().await.map_err(|e| {
            crate::error::AppError::FabricError(format!("Failed to fetch Fabric versions: {}", e))
        })?;

        if !response.status().is_success() {
            return Err(crate::error::AppError::FabricError(format!(
                "Failed to fetch Fabric versions: Status {}",
                response.status()
            )));
        }

        let versions = response
            .json::<Vec<FabricVersionInfo>>()
            .await
            .map_err(|e| {
                crate::error::AppError::FabricError(format!(
                    "Failed to parse Fabric versions: {}",
                    e
                ))
            })?;

        // Cache the result
        let json_data = serde_json::to_string_pretty(&versions).map_err(|e| {
            crate::error::AppError::FabricError(format!("Failed to serialize versions: {}", e))
        })?;

        if let Err(e) = write_atomic(cache_path, json_data).await {
            error!("Failed to write Fabric cache: {}", e);
        } else {
            debug!("Cached Fabric versions for {}: {:?}", minecraft_version, cache_path);
        }

        Ok(versions)
    }

    async fn background_update(
        base_url: String,
        minecraft_version: String,
        cache_path: PathBuf,
    ) {
        debug!("[BG] Updating Fabric versions for {}", minecraft_version);
        if let Err(e) = Self::fetch_and_cache_versions(&base_url, &minecraft_version, &cache_path).await {
            error!("[BG] Failed to update Fabric cache for {}: {}", minecraft_version, e);
        }
    }

    pub async fn get_loader_versions(
        &self,
        minecraft_version: &str,
    ) -> Result<Vec<FabricVersionInfo>> {
        let cache_filename = format!("fabric_versions_{}.json", minecraft_version);
        let cache_path = self.cache_dir.join(&cache_filename);

        if cache_path.exists() {
            debug!("Cache hit for Fabric versions {}: {:?}", minecraft_version, cache_path);
            
            // Return cached data immediately
            match tokio_fs::read_to_string(&cache_path).await {
                Ok(cached_data) => {
                    match serde_json::from_str::<Vec<FabricVersionInfo>>(&cached_data) {
                        Ok(cached_versions) => {
                            // Spawn background update
                            let base_url = self.base_url.clone();
                            let minecraft_version = minecraft_version.to_string();
                            let cache_path_clone = cache_path.clone();
                            
                            tokio::spawn(async move {
                                Self::background_update(base_url, minecraft_version, cache_path_clone).await;
                            });
                            
                            return Ok(cached_versions);
                        }
                        Err(e) => {
                            error!("Failed to parse cached Fabric data: {}", e);
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to read Fabric cache: {}", e);
                }
            }
        }

        // Cache miss or invalid cache - fetch in foreground
        debug!("Cache miss for Fabric versions {}, fetching...", minecraft_version);
        Self::fetch_and_cache_versions(&self.base_url, minecraft_version, &cache_path).await
    }

    pub async fn get_latest_stable_version(
        &self,
        minecraft_version: &str,
    ) -> Result<FabricVersionInfo> {
        let versions = self.get_loader_versions(minecraft_version).await?;

        versions
            .into_iter()
            .filter(|v| v.loader.stable)
            .max_by_key(|v| v.loader.build)
            .ok_or_else(|| {
                crate::error::AppError::FabricError("No stable Fabric version found".to_string())
            })
    }
}
