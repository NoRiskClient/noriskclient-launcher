use crate::config::{ProjectDirsExt, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::dto::forge_maven_meta::ForgeMavenMetadata;
use crate::utils::file_utils::write_atomic;
use log::{debug, error, info};
use quick_xml::de::from_str;
use std::path::PathBuf;
use tokio::fs as tokio_fs;

const FORGE_MAVEN_METADATA_URL: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";

pub struct ForgeApi {
    base_url: String,
    cache_dir: PathBuf,
}

impl ForgeApi {
    pub fn new() -> Self {
        let cache_dir = LAUNCHER_DIRECTORY.meta_dir().join("forge_cache");
        if !cache_dir.exists() {
            std::fs::create_dir_all(&cache_dir).unwrap_or_else(|e| {
                error!("Failed to create Forge cache directory: {}", e);
            });
        }
        Self {
            base_url: FORGE_MAVEN_METADATA_URL.to_string(),
            cache_dir,
        }
    }

    async fn fetch_and_cache_metadata(base_url: &str, cache_path: &PathBuf) -> Result<ForgeMavenMetadata> {
        debug!("Fetching Forge metadata from: {}", base_url);

        let response = HTTP_CLIENT.get(base_url)
            .send()
            .await
            .map_err(|e| AppError::ForgeError(format!("Failed to fetch Forge versions: {}", e)))?;

        if !response.status().is_success() {
            return Err(AppError::ForgeError(format!(
                "Failed to fetch Forge versions: Status {}",
                response.status()
            )));
        }

        let xml_content = response
            .text()
            .await
            .map_err(|e| AppError::ForgeError(format!("Failed to read response: {}", e)))?;

        let metadata: ForgeMavenMetadata = from_str(&xml_content)
            .map_err(|e| AppError::ForgeError(format!("Failed to parse Forge metadata: {}", e)))?;

        if let Err(e) = write_atomic(cache_path, &xml_content).await {
            error!("Failed to write Forge cache: {}", e);
        } else {
            debug!("Cached Forge metadata: {:?}", cache_path);
        }

        info!("Successfully fetched {} Forge versions", metadata.get_all_versions().len());
        Ok(metadata)
    }

    async fn background_update(base_url: String, cache_path: PathBuf) {
        debug!("[BG] Updating Forge metadata");
        if let Err(e) = Self::fetch_and_cache_metadata(&base_url, &cache_path).await {
            error!("[BG] Failed to update Forge cache: {}", e);
        }
    }

    pub async fn get_all_versions(&self) -> Result<ForgeMavenMetadata> {
        let cache_path = self.cache_dir.join("forge_metadata.xml");

        if cache_path.exists() {
            debug!("Cache hit for Forge metadata: {:?}", cache_path);
            
            match tokio_fs::read_to_string(&cache_path).await {
                Ok(cached_xml) => {
                    match from_str::<ForgeMavenMetadata>(&cached_xml) {
                        Ok(cached_metadata) => {
                            let base_url = self.base_url.clone();
                            let cache_path_clone = cache_path.clone();
                            
                            tokio::spawn(async move {
                                Self::background_update(base_url, cache_path_clone).await;
                            });
                            
                            return Ok(cached_metadata);
                        }
                        Err(e) => {
                            error!("Failed to parse cached Forge metadata: {}", e);
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to read Forge cache: {}", e);
                }
            }
        }

        debug!("Cache miss for Forge metadata, fetching...");
        Self::fetch_and_cache_metadata(&self.base_url, &cache_path).await
    }
}
