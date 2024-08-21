use anyhow::Result;
use log::info;
use tokio::fs;

use crate::app::app_data::LauncherOptions;
use crate::utils::download_file_untracked;
use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};

/// Placeholder struct for API endpoints implementation
pub struct ForwardingManagerProvider;

impl ForwardingManagerProvider {
    fn get_nrc_meta_api_base(is_experimental: bool) -> String {
        return if is_experimental {
            String::from("https://dl-staging.norisk.gg/meta/forwarding-manager")
        } else {
            // FIXME: Change to production URL
            String::from("https://dl-staging.norisk.gg/meta/forwarding-manager")
        };
    }
    
    /// Request all available minecraft versions
    async fn get_latest_version() -> Result<String> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        Self::request_from_endpoint(&Self::get_nrc_meta_api_base(options.experimental_mode), "version.txt").await
    }

    async fn download_forwarding_manager(version: &str) -> Result<()> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join("forwarding_manager");
        fs::create_dir_all(&path).await?;
        let url = format!("{}/files/forwarding_manager-{}.jar", Self::get_nrc_meta_api_base(options.experimental_mode), version);
        download_file_untracked(&url, path.join("forwarding_manager.jar")).await?;
        Ok(())
    }

    pub async fn maintain_forwarding_manager() -> Result<()> {
        info!("Maintaining forwarding manager");
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join("forwarding_manager");
        if !path.exists() {
            fs::create_dir_all(&path).await?;
        }
        let version_file_path = path.join(".version");
        let forwarding_manager_path = path.join("forwarding_manager.jar");
        let latest_version = Self::get_latest_version().await?;
        if !forwarding_manager_path.exists() {
            info!("Downloading forwarding manager for the first time...");
            Self::download_forwarding_manager(&latest_version).await?;
            fs::write(version_file_path, latest_version.as_bytes()).await?;
        } else {
            let current_version = fs::read_to_string(&version_file_path).await.unwrap_or_default();
            if current_version != latest_version {
                info!("Updating forwarding manager from {} to {}...", current_version, latest_version);
                Self::download_forwarding_manager(&latest_version).await?;
                fs::write(version_file_path, latest_version.as_bytes()).await?;
            } else {
                info!("Forwarding manager is up to date!");
            }
        }
        Ok(())
    }

    /// Request JSON formatted data from launcher API
    async fn request_from_endpoint(base: &str, endpoint: &str) -> Result<String> {
        let url = format!("{}/{}", base, endpoint);
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT.get(url)
            .send().await?
            .error_for_status()?
            .text().await?
        )
    }
}