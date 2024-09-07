use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use tokio::fs;
use log::info;

use crate::app::app_data::LauncherOptions;
use crate::utils::download_file;
use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};

/// Placeholder struct for API endpoints implementation
pub struct QuiltProvider;

static QUILT_MODRINTH_API_BASE: &str = "https://meta.modrinth.com/quilt";
static QUILT_MAVEN_REPO_BASE: &str = "https://maven.quiltmc.org/repository/release/org/quiltmc";

impl QuiltProvider {
    fn get_nrc_meta_api_base(is_experimental: bool) -> String {
        return if is_experimental {
            String::from("https://dl-staging.norisk.gg/meta/quilt")
        } else {
            String::from("https://dl.norisk.gg/meta/quilt")
        };
    }
    
    /// Request all available minecraft versions
    pub async fn get_manifest() -> Result<QuiltManifest> {
        Self::request_from_endpoint(QUILT_MODRINTH_API_BASE, "v0/manifest.json").await
    }
    
    /// Request all available installer versions
    pub async fn get_all_installer_versions() -> Result<Vec<String>> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir()).await.unwrap_or_default();
        Self::request_from_endpoint(&Self::get_nrc_meta_api_base(options.experimental_mode), "installer_versions.json").await
    }

    pub async fn download_installer_jar<F>(on_progress: F) -> Result<()> where F : Fn(u64, u64) {
        let installer_version = Self::get_all_installer_versions().await?.first().unwrap().clone();
        let path = LAUNCHER_DIRECTORY.data_dir().join("custom_servers").join("installers");
        fs::create_dir_all(&path).await?;
        let url = format!("{}/quilt-installer/{}/quilt-installer-{}.jar", QUILT_MAVEN_REPO_BASE, installer_version, installer_version);
        let content = download_file(&url, on_progress).await?;
        let _ = fs::write(path.join(format!("quilt-{}.jar", installer_version)), content).await.map_err(|e| e);
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
pub struct QuiltManifest {
    #[serde(rename = "gameVersions")]
    pub game_versions: Vec<QuiltVersion>
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuiltVersion {
    pub id: String,
    pub stable: bool,
    pub loaders: Vec<QuiltLoaderVersion>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuiltLoaderVersion {
    pub id: String,
    pub stable: bool,
}