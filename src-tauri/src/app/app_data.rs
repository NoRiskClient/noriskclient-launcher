use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;
use std::vec;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::LAUNCHER_DIRECTORY;

use super::modrinth_api::CustomMod;
use super::modrinth_api::Datapack;
use super::modrinth_api::ResourcePack;
use super::modrinth_api::Shader;

fn default_concurrent_downloads() -> i32 {
    10
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Addons {
    pub shaders: Vec<Shader>,
    #[serde(rename = "resourcePacks")]
    pub resourcepacks: Vec<ResourcePack>,
    pub datapacks: Vec<Datapack>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LauncherProfile {
    pub id: String,
    pub branch: String,
    pub name: String,
    pub mods: Vec<CustomMod>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct LauncherProfiles {
    #[serde(rename = "mainProfiles")]
    pub main_profiles: Vec<LauncherProfile>,
    #[serde(rename = "selectedMainProfiles")]
    pub selected_main_profiles: HashMap<String, String>,
    #[serde(rename = "experimentalProfiles")]
    pub experimental_profiles: Vec<LauncherProfile>,
    #[serde(rename = "selectedExperimentalProfiles")]
    pub selected_experimental_profiles: HashMap<String, String>,
    pub addons: HashMap<String, Addons>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LauncherOptions {
    #[serde(rename = "keepLauncherOpen")]
    pub keep_launcher_open: bool,
    #[serde(rename = "experimentalMode")]
    pub experimental_mode: bool,
    #[serde(rename = "dataPath")]
    pub data_path: String,
    #[serde(rename = "memoryPercentage")]
    pub memory_limit: i32,
    #[serde(rename = "customJavaPath", default)]
    pub custom_java_path: String,
    #[serde(rename = "customJavaArgs", default)]
    pub custom_java_args: String,
    #[serde(rename = "theme", default)]
    pub theme: String,
    #[serde(rename = "latestBranch")]
    pub latest_branch: Option<String>,
    #[serde(rename = "latestDevBranch")]
    pub latest_dev_branch: Option<String>,
    #[serde(rename = "concurrentDownloads", default = "default_concurrent_downloads")]
    pub concurrent_downloads: i32,
}

impl LauncherOptions {
    pub async fn load(app_data: &Path) -> Result<Self> {
        // load the options from the file
        let options = serde_json::from_slice::<LauncherOptions>(&fs::read(app_data.join("options.json")).await?).map_err(|err| -> String { format!("Failed to write options.json: {}", err.to_string()).into() }).unwrap_or_else(|_| LauncherOptions::default());
        Ok(options)
    }

    pub async fn store(&self, app_data: &Path) -> Result<()> {
        let _ = fs::write(app_data.join("options.json"), serde_json::to_string_pretty(&self)?).await.map_err(|err| -> String { format!("Failed to write options.json: {}", err).into() });
        Ok(())
    }

    pub fn data_path_buf(&self) -> PathBuf {
        if self.data_path.is_empty() {
            return LAUNCHER_DIRECTORY.data_dir().to_path_buf();
        }
        PathBuf::from(&self.data_path)
    }
}

impl Default for LauncherOptions {
    fn default() -> Self {
        let mode = dark_light::detect();
        let theme = match mode {
            // Dark mode
            dark_light::Mode::Dark => "DARK",
            // Light mode
            dark_light::Mode::Light => "LIGHT",
            // Unspecified
            dark_light::Mode::Default => "LIGHT",
        };
        Self {
            keep_launcher_open: true,
            experimental_mode: false,
            data_path: LAUNCHER_DIRECTORY.data_dir().to_str().unwrap().to_string(),
            memory_limit: 2048, // 2GB memory of computer allocated to game
            custom_java_path: String::new(),
            custom_java_args: String::new(),
            theme: theme.to_string(),
            latest_branch: None,
            latest_dev_branch: None,
            concurrent_downloads: 10,
        }
    }
}

impl LauncherProfiles {
    pub async fn load(app_data: &Path) -> Result<Self> {
        // load the launcher_profiles from the file
        let launcher_profiles = serde_json::from_slice::<LauncherProfiles>(&fs::read(app_data.join("launcher_profiles.json")).await?).map_err(|err| -> String { format!("Failed to write launcher_profiles.json: {}", err.to_string()).into() }).unwrap_or_else(|_| LauncherProfiles::default());
        Ok(launcher_profiles)
    }

    pub async fn store(&self, app_data: &Path) -> Result<()> {
        // save the launcher_profiles to the file
        let _ = fs::write(app_data.join("launcher_profiles.json"), serde_json::to_string_pretty(&self)?).await.map_err(|err| -> String { format!("Failed to write launcher_profiles.json: {}", err).into() });
        Ok(())
    }
}

impl Default for LauncherProfiles {
    fn default() -> Self {
        Self {
            main_profiles: vec![],
            selected_main_profiles: HashMap::new(),
            experimental_profiles: vec![],
            selected_experimental_profiles: HashMap::new(),
            addons: HashMap::new(),
        }
    }
}

impl Default for Addons {
    fn default() -> Self {
        Self {
            shaders: vec![],
            resourcepacks: vec![],
            datapacks: vec![],
        }
    }
}
