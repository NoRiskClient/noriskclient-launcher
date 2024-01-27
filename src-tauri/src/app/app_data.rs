use std::{path::Path};
use std::path::PathBuf;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::fs;
use keyring::Entry as KeyringEntry;

use crate::app::api::LoginData;
use crate::LAUNCHER_DIRECTORY;

fn default_concurrent_downloads() -> i32 {
    10
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct LauncherOptions {
    #[serde(rename = "keepLauncherOpen")]
    pub keep_launcher_open: bool,
    #[serde(rename = "experimentalMode")]
    pub experimental_mode: bool,
    #[serde(rename = "experimentalModeToken")]
    pub experimental_mode_token: String,
    #[serde(rename = "dataPath")]
    pub data_path: String,
    #[serde(rename = "memoryPercentage")]
    pub memory_percentage: i32,
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
    #[serde(rename = "currentUuid")]
    pub current_uuid: Option<String>,
    #[serde(rename = "accounts")]
    pub accounts: Vec<LoginData>,
    #[serde(rename = "concurrentDownloads", default = "default_concurrent_downloads")]
    pub concurrent_downloads: i32
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct LauncherOptionsMinimal {
    #[serde(rename = "keepLauncherOpen")]
    pub keep_launcher_open: bool,
    #[serde(rename = "experimentalMode")]
    pub experimental_mode: bool,
    #[serde(rename = "experimentalModeToken")]
    pub experimental_mode_token: String,
    #[serde(rename = "dataPath")]
    pub data_path: String,
    #[serde(rename = "memoryPercentage")]
    pub memory_percentage: i32,
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
    #[serde(rename = "currentUuid")]
    pub current_uuid: Option<String>,
    #[serde(rename = "accounts")]
    pub accounts: Vec<LoginDataMinimal>,
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

pub struct TokenManager {}

impl TokenManager {
    const SERVICE: &'static str = "noriskclient-launcher";

    pub fn load_tokens(&self, mut login_data: LoginData) -> LoginData {
        // logic for loading tokens
        let uuid = login_data.uuid.clone();
        let keyring_mc_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "mcToken")).map_err(|e| format!("Failed to fetch keyring-mc-token: {}", e.to_string())).unwrap();
        let keyring_access_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "accessToken")).map_err(|e| format!("Failed to fetch keyring-access-token: {}", e.to_string())).unwrap();
        let keyring_refresh_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "refreshToken")).map_err(|e| format!("Failed to fetch keyring-refresh-token: {}", e.to_string())).unwrap();
        let keyring_norisk_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "noriskToken")).map_err(|e| format!("Failed to fetch keyring-norisk-token: {}", e.to_string())).unwrap();
        let keyring_experimental_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "experimentalToken")).map_err(|e| format!("Failed to fetch keyring-experimental-token: {}", e.to_string())).unwrap();

        login_data.mc_token = keyring_mc_token.get_password().unwrap();
        login_data.access_token = keyring_access_token.get_password().unwrap();
        login_data.refresh_token = keyring_refresh_token.get_password().unwrap();
        login_data.norisk_token = keyring_norisk_token.get_password().unwrap();
        login_data.experimental_token = Some(keyring_experimental_token.get_password().unwrap());

        return login_data;
    }

    pub fn store_tokens(&mut self, mut login_data: LoginData) -> LoginData {
        // logic for storing tokens
        let uuid = login_data.uuid.clone();
        let keyring_mc_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "mcToken")).map_err(|e| format!("Failed to fetch keyring-mc-token: {}", e.to_string())).unwrap();
        let keyring_access_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "accessToken")).map_err(|e| format!("Failed to fetch keyring-access-token: {}", e.to_string())).unwrap();
        let keyring_refresh_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "refreshToken")).map_err(|e| format!("Failed to fetch keyring-refresh-token: {}", e.to_string())).unwrap();
        let keyring_norisk_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "noriskToken")).map_err(|e| format!("Failed to fetch keyring-norisk-token: {}", e.to_string())).unwrap();
        let keyring_experimental_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "experimentalToken")).map_err(|e| format!("Failed to fetch keyring-experimental-token: {}", e.to_string())).unwrap();

        keyring_mc_token.set_password(&login_data.mc_token).unwrap();
        keyring_access_token.set_password(&login_data.access_token).unwrap();
        keyring_refresh_token.set_password(&login_data.refresh_token).unwrap();
        keyring_norisk_token.set_password(&login_data.norisk_token).unwrap();
        keyring_experimental_token.set_password(&login_data.experimental_token.unwrap()).unwrap();

        login_data.mc_token = String::new();
        login_data.access_token = String::new();
        login_data.refresh_token = String::new();
        login_data.norisk_token = String::new();
        login_data.experimental_token = Some(String::new());

        return login_data
    }

    pub fn delete_tokens(&mut self, login_data: LoginData) {
        // logic for deleting tokens
        let uuid = login_data.uuid.clone();
        let keyring_mc_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "mcToken")).map_err(|e| format!("Failed to fetch keyring-mc-token: {}", e.to_string())).unwrap();
        let keyring_access_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "accessToken")).map_err(|e| format!("Failed to fetch keyring-access-token: {}", e.to_string())).unwrap();
        let keyring_refresh_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "refreshToken")).map_err(|e| format!("Failed to fetch keyring-refresh-token: {}", e.to_string())).unwrap();
        let keyring_norisk_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "noriskToken")).map_err(|e| format!("Failed to fetch keyring-norisk-token: {}", e.to_string())).unwrap();
        let keyring_experimental_token = KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, "experimentalToken")).map_err(|e| format!("Failed to fetch keyring-experimental-token: {}", e.to_string())).unwrap();

        keyring_mc_token.delete_password();
        keyring_access_token.delete_password();
        keyring_refresh_token.delete_password();
        keyring_norisk_token.delete_password();
        keyring_experimental_token.delete_password();
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
            keep_launcher_open: true,
            experimental_mode: false,
            experimental_mode_token: String::new(),
            data_path: LAUNCHER_DIRECTORY.data_dir().to_str().unwrap().to_string(),
            memory_percentage: 35, // 35% memory of computer allocated to game
            custom_java_path: String::new(),
            custom_java_args: String::new(),
            theme: theme.to_string(),
            latest_branch: None,
            latest_dev_branch: None,
            current_uuid: None,
            accounts: Vec::new(),
            concurrent_downloads: 10
        }
    }
}
