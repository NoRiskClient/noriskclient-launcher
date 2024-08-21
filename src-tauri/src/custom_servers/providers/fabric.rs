use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use tokio::fs;
use log::info;

use crate::custom_servers::models::CustomServer;
use crate::utils::download_file;
use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};

/// Placeholder struct for API endpoints implementation
pub struct FabricProvider;

static FABRIC_API_BASE: &str = "https://meta.fabricmc.net/v2";

impl FabricProvider {
    /// Request all available minecraft versions
    pub async fn get_all_game_versions() -> Result<Vec<FabricVersion>> {
        Self::request_from_endpoint(FABRIC_API_BASE, "versions/game").await
    }
    
    /// Request all available loader versions
    pub async fn get_all_loader_versions(mc_version: &str) -> Result<Vec<FabricLoaderVersion>> {
        Self::request_from_endpoint(FABRIC_API_BASE, &format!("versions/loader/{}", mc_version)).await
    }
    
    /// Request all available installer versions
    pub async fn get_all_installer_versions() -> Result<Vec<FabricInstallerVersion>> {
        Self::request_from_endpoint(FABRIC_API_BASE, "versions/installer").await
    }

    pub async fn download_server_jar<F>(custom_server: &CustomServer, on_progress: F) -> Result<()> where F : Fn(u64, u64) {
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join(&custom_server.id);
        fs::create_dir_all(&path).await?;
        let installer_version = Self::get_all_installer_versions().await?.first().unwrap().version.clone();
        let url = format!("{}/versions/loader/{}/{}/{}/server/jar", FABRIC_API_BASE, &custom_server.mc_version, custom_server.loader_version.clone().unwrap_or_default(), installer_version);
        let content = download_file(&url, on_progress).await?;
        let _ = fs::write(path.join("server.jar"), content).await.map_err(|e| e);
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
pub struct FabricVersion {
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FabricLoaderVersion {
    pub loader: FabricLoader,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FabricLoader {
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FabricInstallerVersion {
    pub url: String,
    pub version: String,
    pub stable: bool,
}