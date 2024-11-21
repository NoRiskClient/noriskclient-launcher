use std::path::Path;
use log::debug;
use tokio::fs;
use log::error;
use uuid::Uuid;
use crate::app::api::{ApiEndpoints, LaunchManifest, NoRiskLaunchManifest};
use crate::error::{Error, ErrorKind};
use crate::LAUNCHER_DIRECTORY;

pub struct NRCCache {}

impl NoRiskLaunchManifest {
    pub async fn load(app_data: &Path) -> Result<Self, Error> {
        // load the options from the file
        let options = serde_json::from_slice::<NoRiskLaunchManifest>(&fs::read(app_data.join("launch_manifest.json")).await?)?;
        Ok(options)
    }
    pub async fn store(&self, app_data: &Path) -> Result<(), Error> {
        let _ = fs::write(app_data.join("launch_manifest.json"), serde_json::to_string_pretty(&self)?).await?;
        debug!("Launch manifest was stored...");
        Ok(())
    }
}
impl NRCCache {
    pub async fn get_launch_manifest(branch: &str, norisk_token: &str, uuid: Uuid) -> Result<NoRiskLaunchManifest, Error> {
        let nrc_cache = LAUNCHER_DIRECTORY.data_dir().join("nrc_cache");
        match ApiEndpoints::launch_manifest(branch, norisk_token, uuid).await {
            Ok(manifest) => {
                fs::create_dir_all(&nrc_cache).await?;
                manifest.store(&nrc_cache).await?;
                Ok(manifest)
            }
            Err(error) => {
                error!("Error Loading Launch Manifest {:?}", error);
                let result = NoRiskLaunchManifest::load(&nrc_cache).await?;
                Ok(result)
            }
        }
    }
}
