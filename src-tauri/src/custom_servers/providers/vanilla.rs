use anyhow::Result;
use log::info;
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use tokio::fs;

use crate::custom_servers::models::CustomServer;
use crate::utils::download_file_untracked;
use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};

/// Placeholder struct for API endpoints implementation
pub struct VanillaProvider;

static VANILLA_LAUNCHER_API: &str = "https://launchermeta.mojang.com";

impl VanillaProvider {
    /// Request all available minecraft versions
    pub async fn get_all_versions() -> Result<VanillaVersions> {
        Self::request_from_endpoint(VANILLA_LAUNCHER_API, "mc/game/version_manifest.json").await
    }

    /// Request a vanilla version manifest
    pub async fn get_manifest(hash: &str, version: &str) -> Result<VanillaManifest> {
        Self::request_from_endpoint(VANILLA_LAUNCHER_API, &format!("v1/packages/{}/{}.json", hash, version)).await
    }

    pub async fn download_server_jar(custom_server: &CustomServer, hash: &str) -> Result<()> {
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join(&custom_server.id);
        fs::create_dir_all(&path).await?;
        let manifest = Self::get_manifest(hash, &custom_server.mc_version).await?;
        let _ = download_file_untracked(&manifest.downloads.server.url, path.join("server.jar")).await?;
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
pub struct VanillaVersions {
    pub latest: LatestVanillaVersion,
    pub versions: Vec<VanillaVersion>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LatestVanillaVersion {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VanillaVersion {
    pub id: String,
    pub r#type: String,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VanillaManifest {
    pub downloads: Downloads,
    pub id: String,
    #[serde(rename = "javaVersion")]
    pub java_version: JavaVersion
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Downloads {
    pub client: DownloadFile,
    pub server: DownloadFile,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadFile {
    pub sha1: String,
    pub size: u32,
    pub url: String
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JavaVersion {
    pub component: String,
    #[serde(rename = "majorVersion")]
    pub major_version: u32,
}