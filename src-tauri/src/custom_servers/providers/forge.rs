use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use tokio::fs;
use log::info;

use crate::custom_servers::models::CustomServer;
use crate::utils::download_file_untracked;
use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};

/// Placeholder struct for API endpoints implementation
pub struct ForgeProvider;

static FORGE_MODRINTH_API_BASE: &str = "https://meta.modrinth.com/forge";
static FORGE_MAVEN_REPO_BASE: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";

impl ForgeProvider {
    /// Request all available minecraft versions
    pub async fn get_manifest() -> Result<ForgeManifest> {
        Self::request_from_endpoint(FORGE_MODRINTH_API_BASE, "v0/manifest.json").await
    }

    pub async fn download_installer_jar(custom_server: &CustomServer) -> Result<()> {
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join("installers");
        if !path.join(format!("forge-{}-{}.jar", custom_server.mc_version, custom_server.loader_version.clone().unwrap_or_default())).exists() {
            fs::create_dir_all(&path).await?;
            let url = format!("{}/{mc}-{loader}/forge-{mc}-{loader}-installer.jar", FORGE_MAVEN_REPO_BASE, mc = custom_server.mc_version, loader = custom_server.loader_version.clone().unwrap_or_default());
            download_file_untracked(&url, path.join(format!("forge-{}-{}.jar", custom_server.mc_version, custom_server.loader_version.clone().unwrap_or_default()))).await?;
        }
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
pub struct ForgeManifest {
    #[serde(rename = "gameVersions")]
    pub game_versions: Vec<ForgeGameVersion>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ForgeGameVersion {
    pub id: String,
    pub stable: bool,
    pub loaders: Vec<ForgeLoaderVersion>
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ForgeLoaderVersion {
    pub id: String,
}