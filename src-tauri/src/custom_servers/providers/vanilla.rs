use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use tokio::fs;

use crate::custom_servers::models::CustomServer;
use crate::utils::download_file;
use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};

/// Placeholder struct for API endpoints implementation
pub struct VanillaProvider;

static VANILLA_LAUNCHER_API: &str = "https://launchermeta.mojang.com";
const VANILLA_PISTON_API: &str = "https://piston-meta.mojang.com";

impl VanillaProvider {
    /// Request all available minecraft versions
    pub async fn get_all_versions() -> Result<VanillaVersions> {
        Self::request_from_endpoint(VANILLA_LAUNCHER_API, "mc/game/version_manifest.json").await
    }

    /// Request a vanilla version manifest
    pub async fn get_manifest(hash: &str, version: &str) -> Result<VanillaManifest> {
        Self::request_from_endpoint(VANILLA_LAUNCHER_API, &format!("v1/packages/{}/{}.json", hash, version)).await
    }

    pub async fn download_server_jar<F>(custom_server: &CustomServer, hash: &str, on_progress: F) -> Result<()> where F : Fn(u64, u64) {
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join(&custom_server.id).join("server.jar");
        let manifest = Self::get_manifest(hash, &custom_server.mc_version).await?;
        let content = download_file(&manifest.downloads.client.url, on_progress).await?;
        let _ = fs::write(path, content).await.map_err(|e| e);
        Ok(())
    }

    pub async fn create_eula_file(custom_server: &CustomServer) -> Result<()> {
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join(&custom_server.id).join("eula.txt");
        let content = "# USER HAS AGREED TO THIS THROUGH THE GUI OF THE NRC LAUNCHER!\neula=true";
        let _ = fs::write(path, Vec::from(content)).await.map_err(|e| e);
        Ok(())
    }

    /// Request JSON formatted data from launcher API
    pub async fn request_from_endpoint<T: DeserializeOwned>(base: &str, endpoint: &str) -> Result<T> {
        let url = format!("{}/{}", base, endpoint);
        println!("URL: {}", url); // Den formatierten String ausgeben
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
    #[serde(rename(serialize = "javaVersion"))]
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
    #[serde(rename(serialize = "majorVersion"))]
    pub major_version: u32,
}