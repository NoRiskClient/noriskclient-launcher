use std::{collections::HashMap, path::Path};
use std::path::PathBuf;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::app::api::LoginData;
use crate::LAUNCHER_DIRECTORY;

fn default_concurrent_downloads() -> i32 {
    10
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct LauncherOptions {
    #[serde(rename = "keepLauncherOpen")]
    pub keep_launcher_open: bool,
    #[serde(rename = "dataPath")]
    pub data_path: String,
    #[serde(rename = "showNightlyBuilds")]
    pub show_nightly_builds: bool,
    #[serde(rename = "memoryPercentage")]
    pub memory_percentage: i32,
    #[serde(rename = "customJavaPath", default)]
    pub custom_java_path: String,
    #[serde(rename = "customJavaArgs", default)]
    pub custom_java_args: String,
    #[serde(rename = "theme", default)]
    pub theme: String,
    #[serde(rename = "preferredBranch")]
    pub preferred_branch: Option<String>,
    #[serde(rename = "currentUuid")]
    pub current_uuid: Option<String>,
    #[serde(rename = "accounts")]
    pub accounts: Vec<LoginData>,
    #[serde(rename = "preferredBuild")]
    pub preferred_build: Option<i32>,
    #[serde(rename = "modStates", default)]
    pub mod_states: HashMap<String, bool>,
    #[serde(rename = "concurrentDownloads", default = "default_concurrent_downloads")]
    pub concurrent_downloads: i32
}

impl LauncherOptions {
    pub async fn load(app_data: &Path) -> Result<Self> {
        // load the options from the file
        Ok(serde_json::from_slice::<Self>(&fs::read(app_data.join("options.json")).await?)?)
    }

    pub async fn store(&self, app_data: &Path) -> Result<()> {
        // store the options in the file
        fs::write(app_data.join("options.json"), serde_json::to_string_pretty(&self)?).await?;
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
        let mut theme = "";
        let mode = dark_light::detect();
        match mode {
            // Dark mode
            dark_light::Mode::Dark => {
                theme = "DARK";
            },
            // Light mode
            dark_light::Mode::Light => {
                theme = "LIGHT";
            },
            // Unspecified
            dark_light::Mode::Default => {
                theme = "LIGHT";
            },
        }
        Self {
            keep_launcher_open: false,
            data_path: LAUNCHER_DIRECTORY.data_dir().to_str().unwrap().to_string(),
            show_nightly_builds: false,
            memory_percentage: 80, // 80% memory of computer allocated to game
            custom_java_path: String::new(),
            custom_java_args: String::new(),
            theme: theme.to_string(),
            current_uuid: None,
            accounts: Vec::new(),
            preferred_branch: None,
            preferred_build: None,
            mod_states: HashMap::new(),
            concurrent_downloads: 10
        }
    }
}
