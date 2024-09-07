use anyhow::Result;
use serde::de::DeserializeOwned;
use tokio::fs;
use log::info;

use crate::app::app_data::LauncherOptions;
use crate::custom_servers::models::CustomServer;
use crate::utils::download_file;
use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};

/// Placeholder struct for API endpoints implementation
pub struct BukkitProvider;

static GETBUKKIT_API_BASE: &str = "https://download.getbukkit.org/bukkit";

impl BukkitProvider {
    fn get_nrc_meta_api_base(is_experimental: bool) -> String {
        return if is_experimental {
            String::from("https://dl-staging.norisk.gg/meta/bukkit")
        } else {
            String::from("https://dl.norisk.gg/meta/bukkit")
        };
    }
    
    /// Request all available minecraft versions
    pub async fn get_all_game_versions() -> Result<Vec<String>> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        Self::request_from_endpoint(&Self::get_nrc_meta_api_base(options.experimental_mode), "versions.json").await
    }

    pub async fn download_server_jar<F>(custom_server: &CustomServer, on_progress: F) -> Result<()> where F : Fn(u64, u64) {
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join(&custom_server.mc_version);
        fs::create_dir_all(&path).await?;
        let url = format!("{}/craftbukkit-{}.jar", GETBUKKIT_API_BASE, custom_server.mc_version);
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