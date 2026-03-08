use crate::config::{ProjectDirsExt, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::dto::neo_forge_maven_meta::NeoForgeMavenMetadata;
use log::{debug, error, info};
use quick_xml::de::from_str;
use std::path::PathBuf;
use tokio::fs as tokio_fs;

const NEO_FORGE_MAVEN_RELEASES_URL: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";

const NEO_FORGE_MAVEN_SNAPSHOTS_URL: &str =
    "https://maven.neoforged.net/snapshots/net/neoforged/neoforge/maven-metadata.xml";

pub struct NeoForgeApi {
    releases_url: String,
    snapshots_url: String,
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
            releases_url: NEO_FORGE_MAVEN_RELEASES_URL.to_string(),
            snapshots_url: NEO_FORGE_MAVEN_SNAPSHOTS_URL.to_string(),
            cache_dir,
        }
    }

    async fn fetch_and_cache_metadata(url: &str, cache_path: &PathBuf) -> Result<NeoForgeMavenMetadata> {
        debug!("Fetching NeoForge metadata from: {}", url);

        let response = HTTP_CLIENT.get(url)
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

        info!("Successfully fetched {} NeoForge versions from {}", metadata.get_all_versions().len(), url);
        Ok(metadata)
    }

    async fn load_from_cache(cache_path: &PathBuf) -> Option<NeoForgeMavenMetadata> {
        if !cache_path.exists() {
            return None;
        }
        match tokio_fs::read_to_string(cache_path).await {
            Ok(xml) => match from_str::<NeoForgeMavenMetadata>(&xml) {
                Ok(metadata) => Some(metadata),
                Err(e) => {
                    error!("Failed to parse NeoForge cache {:?}: {}", cache_path, e);
                    None
                }
            },
            Err(e) => {
                error!("Failed to read NeoForge cache {:?}: {}", cache_path, e);
                None
            }
        }
    }

    async fn background_update(
        releases_url: String,
        snapshots_url: String,
        releases_cache: PathBuf,
        snapshots_cache: PathBuf,
    ) {
        debug!("[BG] Updating NeoForge metadata (releases + snapshots)");
        if let Err(e) = Self::fetch_and_cache_metadata(&releases_url, &releases_cache).await {
            error!("[BG] Failed to update NeoForge releases cache: {}", e);
        }
        if let Err(e) = Self::fetch_and_cache_metadata(&snapshots_url, &snapshots_cache).await {
            error!("[BG] Failed to update NeoForge snapshots cache: {}", e);
        }
    }

    pub async fn get_all_versions(&self) -> Result<NeoForgeMavenMetadata> {
        let releases_cache = self.cache_dir.join("neoforge_releases_metadata.xml");
        let snapshots_cache = self.cache_dir.join("neoforge_snapshots_metadata.xml");

        // Serve from cache when both files exist; refresh in the background
        let releases_cached = Self::load_from_cache(&releases_cache).await;
        let snapshots_cached = Self::load_from_cache(&snapshots_cache).await;

        if let (Some(releases), Some(snapshots)) = (releases_cached, snapshots_cached) {
            debug!("Cache hit for NeoForge metadata (releases + snapshots)");
            let releases_url = self.releases_url.clone();
            let snapshots_url = self.snapshots_url.clone();
            let rc = releases_cache.clone();
            let sc = snapshots_cache.clone();
            tokio::spawn(async move {
                Self::background_update(releases_url, snapshots_url, rc, sc).await;
            });
            return Ok(releases.merge_with(snapshots));
        }

        // Fetch fresh — releases are required, snapshots are optional
        debug!("Cache miss for NeoForge metadata, fetching from releases and snapshots...");
        let releases = Self::fetch_and_cache_metadata(&self.releases_url, &releases_cache).await?;
        let snapshots_result =
            Self::fetch_and_cache_metadata(&self.snapshots_url, &snapshots_cache).await;

        match snapshots_result {
            Ok(snapshots) => Ok(releases.merge_with(snapshots)),
            Err(e) => {
                error!("Failed to fetch NeoForge snapshots metadata (continuing with releases only): {}", e);
                Ok(releases)
            }
        }
    }
}
