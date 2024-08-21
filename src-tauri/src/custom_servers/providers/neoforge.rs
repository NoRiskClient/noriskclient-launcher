use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use tokio::fs;
use log::info;

use crate::custom_servers::models::CustomServer;
use crate::utils::download_file;
use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};

/// Placeholder struct for API endpoints implementation
pub struct NeoForgeProvider;

static NEO_FORGE_MODRINTH_API_BASE: &str = "https://meta.modrinth.com/neo";
static NEO_FORGE_MAVEN_REPO_BASE: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge";

impl NeoForgeProvider {
    /// Request all available minecraft versions
    pub async fn get_manifest() -> Result<NeoForgeManifest> {
        Self::request_from_endpoint(NEO_FORGE_MODRINTH_API_BASE, "v0/manifest.json").await
    }

    pub async fn download_installer_jar<F>(custom_server: &CustomServer, on_progress: F) -> Result<()> where F : Fn(u64, u64) {
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join("installers");
        fs::create_dir_all(&path).await?;
        let url = format!("{}/{loader}/neoforge-{loader}-installer.jar", NEO_FORGE_MAVEN_REPO_BASE, loader = custom_server.loader_version.clone().unwrap_or_default());
        let content = download_file(&url, on_progress).await?;
        let _ = fs::write(path.join(format!("neoforge-{}.jar", custom_server.loader_version.clone().unwrap_or_default())), content).await.map_err(|e| e);
        Ok(())
    }

    /// Request JSON formatted data from launcher API
    pub async fn request_from_endpoint<T: DeserializeOwned>(base: &str, endpoint: &str) -> Result<T> {
        let url = format!("{}/{}", base, endpoint);
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.get(url)
            .send().await?
            .error_for_status()?
            .json::<T>()
            .await?
        )
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NeoForgeManifest {
    #[serde(rename = "gameVersions")]
    pub game_versions: Vec<NeoForgeGameVersion>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NeoForgeGameVersion {
    pub id: String,
    pub stable: bool,
    pub loaders: Vec<NeoForgeLoaderVersion>
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NeoForgeLoaderVersion {
    pub id: String,
}