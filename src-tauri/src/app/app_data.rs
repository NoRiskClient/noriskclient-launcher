use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;
use std::vec;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::fs;
use keyring::Entry as KeyringEntry;

use crate::app::api::{LoginData, LoginDataMinimal};
use crate::LAUNCHER_DIRECTORY;

use super::modrinth_api::CustomMod;
use super::modrinth_api::Shader;

fn default_concurrent_downloads() -> i32 {
    10
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct LauncherProfile {
    pub id: String,
    pub branch: String,
    pub name: String,
    pub mods: Vec<CustomMod>,
    pub shaders: Vec<Shader>
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
    pub selected_experimental_profiles: HashMap<String, String>
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
        let options = serde_json::from_slice::<LauncherOptionsMinimal>(&fs::read(app_data.join("options.json")).await?).map_err(|err| -> String { format!("Failed to write options.json: {}", err.to_string()).into() }).unwrap_or_else(|_| LauncherOptionsMinimal::default());
        Ok(
            LauncherOptions {
                keep_launcher_open: options.keep_launcher_open,
                experimental_mode: options.experimental_mode,
                experimental_mode_token: options.experimental_mode_token,
                data_path: options.data_path,
                memory_percentage: options.memory_percentage,
                custom_java_path: options.custom_java_path,
                custom_java_args: options.custom_java_args,
                theme: options.theme,
                latest_branch: options.latest_branch,
                latest_dev_branch: options.latest_dev_branch,
                current_uuid: options.current_uuid,
                accounts: options.accounts.iter().map(|account| TokenManager{}.load_tokens(account.clone()).into()).collect(),
                concurrent_downloads: options.concurrent_downloads
            }
        )
    }

    pub async fn store(&self, app_data: &Path) -> Result<()> {
        // store the options in the file
        let options_minimal = LauncherOptionsMinimal {
            keep_launcher_open: self.keep_launcher_open,
            experimental_mode: self.experimental_mode,
            experimental_mode_token: self.experimental_mode_token.clone(),
            data_path: self.data_path.clone(),
            memory_percentage: self.memory_percentage,
            custom_java_path: self.custom_java_path.clone(),
            custom_java_args: self.custom_java_args.clone(),
            theme: self.theme.clone(),
            latest_branch: self.latest_branch.clone(),
            latest_dev_branch: self.latest_dev_branch.clone(),
            current_uuid: self.current_uuid.clone(),
            accounts: self.accounts.iter().map(|account| TokenManager{}.store_tokens(account.clone()).into()).collect(),
            concurrent_downloads: self.concurrent_downloads
        };

        let _ = fs::write(app_data.join("options.json"), serde_json::to_string_pretty(&options_minimal)?).await.map_err(|err| -> String { format!("Failed to write options.json: {}", err).into() });
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

    fn get_keyring_entry(uuid: &str, token_type: &str) -> KeyringEntry {
        KeyringEntry::new(Self::SERVICE, &*format!("{}-{}", uuid, token_type)).map_err(|e| format!("Failed to fetch keyring-{}-token: {}", token_type, e.to_string())).unwrap()
    }

    pub fn load_tokens(&self, login_data: LoginDataMinimal) -> LoginData {
        // logic for loading tokens
        let uuid = login_data.uuid.clone();
        let mc_token = Self::get_keyring_entry(&uuid, "mcToken").get_password().unwrap_or(String::new());
        let access_token = Self::get_keyring_entry(&uuid, "accessToken").get_password().unwrap_or(String::new());
        let refresh_token = Self::get_keyring_entry(&uuid, "refreshToken").get_password().unwrap_or(String::new());
        let norisk_token = Self::get_keyring_entry(&uuid, "noriskToken").get_password().unwrap_or(String::new());
        let experimental_token = Self::get_keyring_entry(&uuid, "experimentalToken").get_password().unwrap_or(String::new());

        return LoginData {
            uuid: login_data.uuid,
            username: login_data.username,
            mc_token: mc_token,
            access_token: access_token,
            refresh_token: refresh_token,
            norisk_token: norisk_token,
            experimental_token: Some(experimental_token)
        };
    }

    pub fn store_tokens(&mut self, login_data: LoginData) -> LoginDataMinimal {
        // logic for storing tokens
        let uuid = login_data.uuid.clone();
        let _mc_token = Self::get_keyring_entry(&uuid, "mcToken").set_password(&login_data.mc_token).unwrap();
        let _access_token = Self::get_keyring_entry(&uuid, "accessToken").set_password(&login_data.access_token).unwrap();
        let _refresh_token = Self::get_keyring_entry(&uuid, "refreshToken").set_password(&login_data.refresh_token).unwrap();
        let _norisk_token = Self::get_keyring_entry(&uuid, "noriskToken").set_password(&login_data.norisk_token).unwrap();
        let _experimental_token = Self::get_keyring_entry(&uuid, "experimentalToken").set_password(&login_data.experimental_token.unwrap()).unwrap();

        return LoginDataMinimal {
            uuid: login_data.uuid,
            username: login_data.username
        };
    }

    pub fn delete_tokens(&mut self, login_data: LoginData) {
        // logic for deleting tokens
        let uuid = login_data.uuid.clone();
        let _ = Self::get_keyring_entry(&uuid, "mcToken").delete_password();
        let _ = Self::get_keyring_entry(&uuid, "accessToken").delete_password();
        let _ = Self::get_keyring_entry(&uuid, "refreshToken").delete_password();
        let _ = Self::get_keyring_entry(&uuid, "noriskToken").delete_password();
        let _ = Self::get_keyring_entry(&uuid, "experimentalToken").delete_password();
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

impl Default for LauncherOptionsMinimal {
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

impl LauncherProfiles {
    pub async fn load(app_data: &Path) -> Result<Self> {
        // load the launcher_profiles from the file
        let launcher_profiles = serde_json::from_slice::<LauncherProfiles>(&fs::read(app_data.join("launcher_profiles.json")).await?).map_err(|err| -> String { format!("Failed to write launcher_profiles.json: {}", err.to_string()).into() }).unwrap_or_else(|_| LauncherProfiles::default());
        // for profile in launcher_profiles.main_profiles.iter_mut() {
        //     if profile.shaders.is_none() {
        //         profile.shaders = Some(vec![]);
        //     }
        // }
        // for profile in launcher_profiles.experimental_profiles.iter_mut() {
        //     if profile.shaders.is_none() {
        //         profile.shaders = Some(vec![]);
        //     }
        // }
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
            selected_experimental_profiles: HashMap::new()
        }
    }
}
