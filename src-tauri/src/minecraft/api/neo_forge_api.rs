use crate::config::{ProjectDirsExt, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::dto::neo_forge_maven_meta::NeoForgeMavenMetadata;
use log::{debug, error, info};
use quick_xml::de::from_str;
use std::path::PathBuf;
use tokio::fs as tokio_fs;

const NEO_FORGE_MAVEN_METADATA_URL: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";

pub struct NeoForgeApi {
    base_url: String,
    cache_dir: PathBuf,
}

impl NeoForgeApi {
    pub fn new() -> Self {
        let cache_dir = LAUNCHER_DIRECTORY.meta_dir().join("neoforge_cache");
        if !cache_dir.exists() {
            std::fs::create_dir_all(&cache_dir).unwrap_or_else(|e| {
                error!("Failed to create NeoForge cache directory: {}", e);
            });
        }
        Self {
            base_url: NEO_FORGE_MAVEN_METADATA_URL.to_string(),
            cache_dir,
        }
    }

    async fn fetch_and_cache_metadata(base_url: &str, cache_path: &PathBuf) -> Result<NeoForgeMavenMetadata> {
        debug!("Fetching NeoForge metadata from: {}", base_url);

        let response = HTTP_CLIENT.get(base_url)
            .send()
            .await
            .map_err(|e| AppError::ForgeError(format!("Failed to fetch NeoForge versions: {}", e)))?;

        if !response.status().is_success() {
            return Err(AppError::ForgeError(format!(
                "Failed to fetch NeoForge versions: Status {}",
                response.status()
            )));
        }

        let xml_content = response
            .text()
            .await
            .map_err(|e| AppError::ForgeError(format!("Failed to read response: {}", e)))?;

        let metadata: NeoForgeMavenMetadata = from_str(&xml_content)
            .map_err(|e| AppError::ForgeError(format!("Failed to parse NeoForge metadata: {}", e)))?;

        if let Err(e) = tokio_fs::write(cache_path, &xml_content).await {
            error!("Failed to write NeoForge cache: {}", e);
        } else {
            debug!("Cached NeoForge metadata: {:?}", cache_path);
        }

        info!("Successfully fetched {} NeoForge versions", metadata.get_all_versions().len());
        Ok(metadata)
    }

    async fn background_update(base_url: String, cache_path: PathBuf) {
        debug!("[BG] Updating NeoForge metadata");
        if let Err(e) = Self::fetch_and_cache_metadata(&base_url, &cache_path).await {
            error!("[BG] Failed to update NeoForge cache: {}", e);
        }
    }

    pub async fn get_all_versions(&self) -> Result<NeoForgeMavenMetadata> {
        let cache_path = self.cache_dir.join("neoforge_metadata.xml");

        if cache_path.exists() {
            debug!("Cache hit for NeoForge metadata: {:?}", cache_path);
            
            match tokio_fs::read_to_string(&cache_path).await {
                Ok(cached_xml) => {
                    match from_str::<NeoForgeMavenMetadata>(&cached_xml) {
                        Ok(cached_metadata) => {
                            let base_url = self.base_url.clone();
                            let cache_path_clone = cache_path.clone();
                            
                            tokio::spawn(async move {
                                Self::background_update(base_url, cache_path_clone).await;
                            });
                            
                            return Ok(cached_metadata);
                        }
                        Err(e) => {
                            error!("Failed to parse cached NeoForge metadata: {}", e);
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to read NeoForge cache: {}", e);
                }
            }
        }

        debug!("Cache miss for NeoForge metadata, fetching...");
        Self::fetch_and_cache_metadata(&self.base_url, &cache_path).await
    }
}
