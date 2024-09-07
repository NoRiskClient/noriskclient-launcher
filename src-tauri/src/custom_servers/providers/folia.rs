use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use tokio::fs;
use log::info;

use crate::custom_servers::models::CustomServer;
use crate::utils::download_file;
use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};

/// Placeholder struct for API endpoints implementation
pub struct FoliaProvider;

static FOLIA_API_BASE: &str = "https://api.papermc.io/v2/projects/folia";

impl FoliaProvider {
    /// Request all available minecraft versions
    pub async fn get_all_game_versions() -> Result<FoliaManifest> {
        Self::request_from_endpoint(FOLIA_API_BASE, "").await
    }
    
    /// Request all available loader versions
    pub async fn get_all_build_versions(mc_version: &str) -> Result<FoliaBuilds> {
        Self::request_from_endpoint(FOLIA_API_BASE, &format!("versions/{}/builds", mc_version)).await
    }

    pub async fn download_server_jar<F>(custom_server: &CustomServer, on_progress: F) -> Result<()> where F : Fn(u64, u64) {
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join(&custom_server.id);
        fs::create_dir_all(&path).await?;
        let mut build_version = Self::get_all_build_versions(&custom_server.mc_version).await?.builds;
        build_version.reverse();
        let latest_build = build_version.first().unwrap();
        let url = format!("{}/versions/{}/builds/{}/downloads/{}", FOLIA_API_BASE, &custom_server.mc_version, custom_server.loader_version.clone().unwrap_or_default(), format!("server-{}-{}.jar", custom_server.mc_version, latest_build.build));
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
pub struct FoliaManifest {
    pub versions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FoliaBuilds {
    pub builds: Vec<FoliaBuildVersion>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FoliaBuildVersion {
    pub build: i32,
}