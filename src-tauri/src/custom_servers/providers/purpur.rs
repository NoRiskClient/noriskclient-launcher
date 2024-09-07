use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use tokio::fs;
use log::info;

use crate::custom_servers::models::CustomServer;
use crate::utils::download_file;
use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};

/// Placeholder struct for API endpoints implementation
pub struct PurpurProvider;

static PURPUR_API_BASE: &str = "https://api.purpurmc.org/v2/purpur";

impl PurpurProvider {
    /// Request all available minecraft versions
    pub async fn get_all_game_versions() -> Result<PurpurVersions> {
        Self::request_from_endpoint(PURPUR_API_BASE, "").await
    }

    pub async fn download_server_jar<F>(custom_server: &CustomServer, on_progress: F) -> Result<()> where F : Fn(u64, u64) {
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join("installers");
        fs::create_dir_all(&path).await?;
        let url = format!("{}/{mc}/latest/download", PURPUR_API_BASE, mc = custom_server.mc_version);
        let content = download_file(&url, on_progress).await?;
        let _ = fs::write(path.join(format!("purpur-{}.jar", custom_server.mc_version)), content).await.map_err(|e| e);
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
pub struct PurpurVersions {
    pub versions: Vec<String>,
}