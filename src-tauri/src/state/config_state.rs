use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::state::post_init::PostInitializationHandler;
use async_trait::async_trait;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

const CONFIG_FILENAME: &str = "launcher_config.json";
const CONFIG_CURRENT_VERSION: u32 = 1;

/// Game initialization hooks
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct Hooks {
    pub pre_launch: Option<String>,
    pub wrapper: Option<String>,
    pub post_exit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LauncherConfig {
    #[serde(default = "default_config_version")]
    pub version: u32,
    #[serde(default)]
    pub is_experimental: bool,
    // Add more configuration options as needed:
    #[serde(default)]
    pub auto_check_updates: bool,
    #[serde(default = "default_concurrent_downloads")]
    pub concurrent_downloads: usize,
    #[serde(default = "default_discord_presence")]
    pub enable_discord_presence: bool,
    #[serde(default)]
    pub check_beta_channel: bool,
    #[serde(default = "default_profile_grouping_criterion")]
    pub profile_grouping_criterion: Option<String>,
    #[serde(default = "default_open_logs_after_starting")]
    pub open_logs_after_starting: bool,
    #[serde(default = "default_concurrent_io_limit")]
    pub concurrent_io_limit: usize,
    #[serde(default)]
    pub last_played_profile: Option<Uuid>,
    #[serde(default)]
    pub hooks: Hooks,
    #[serde(default = "default_hide_on_process_start")]
    pub hide_on_process_start: bool,
    #[serde(default)]
    pub window_border_radius: Option<i32>,
}

fn default_config_version() -> u32 {
    CONFIG_CURRENT_VERSION
}

fn default_concurrent_downloads() -> usize {
    5
}

fn default_discord_presence() -> bool {
    true
}

fn default_profile_grouping_criterion() -> Option<String> {
    Some("group".to_string()) // Default to "group"
}

fn default_open_logs_after_starting() -> bool {
    true
}

fn default_concurrent_io_limit() -> usize {
    10 // Default based on CONCURRENT_IO_LIMIT in state_manager.rs
}

fn default_hide_on_process_start() -> bool {
    false
}

fn default_window_border_radius() -> Option<i32> {
    Some(0)
}

impl Default for LauncherConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_CURRENT_VERSION,
            is_experimental: false,
            auto_check_updates: true,
            concurrent_downloads: default_concurrent_downloads(),
            enable_discord_presence: default_discord_presence(),
            check_beta_channel: false,
            profile_grouping_criterion: default_profile_grouping_criterion(),
            open_logs_after_starting: default_open_logs_after_starting(),
            concurrent_io_limit: default_concurrent_io_limit(),
            last_played_profile: None,
            hooks: Hooks::default(),
            hide_on_process_start: default_hide_on_process_start(),
            window_border_radius: None,
        }
    }
}

pub struct ConfigManager {
    config: Arc<RwLock<LauncherConfig>>,
    config_path: PathBuf,
    save_lock: Mutex<()>,
}

impl ConfigManager {
    pub fn new() -> Result<Self> {
        let config_path = LAUNCHER_DIRECTORY.root_dir().join(CONFIG_FILENAME);
        info!(
            "ConfigManager: Initializing with path: {:?} (config loading deferred)",
            config_path
        );

        Ok(Self {
            config: Arc::new(RwLock::new(LauncherConfig::default())),
            config_path,
            save_lock: Mutex::new(()),
        })
    }

    async fn load_config_internal(&self) -> Result<()> {
        if !self.config_path.exists() {
            info!("Config file not found, using default configuration");
            // Save the default config
            self.save_config().await?;
            return Ok(());
        }

        info!(
            "Loading launcher configuration from: {:?}",
            self.config_path
        );
        let config_data = fs::read_to_string(&self.config_path).await?;

        match serde_json::from_str::<LauncherConfig>(&config_data) {
            Ok(loaded_config) => {
                info!("Successfully loaded launcher configuration");
                debug!("Loaded config: {:?}", loaded_config);

                // Update the stored config
                let mut config = self.config.write().await;
                *config = loaded_config;
            }
            Err(e) => {
                error!("Failed to parse config file: {}", e);
                warn!("Using default configuration and saving it");
                // Save the default config to repair the file
                self.save_config().await?;
            }
        }

        Ok(())
    }

    pub async fn save_config(&self) -> Result<()> {
        let _guard = self.save_lock.lock().await;
        debug!("Acquired save lock, proceeding to save config...");

        // Ensure directory exists
        if let Some(parent_dir) = self.config_path.parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir).await?;
            }
        }

        let config = self.config.read().await;
        let config_data = serde_json::to_string_pretty(&*config)?;

        fs::write(&self.config_path, config_data).await?;
        info!(
            "Successfully saved launcher configuration to: {:?}",
            self.config_path
        );

        Ok(())
    }

    // Public methods for accessing and modifying configuration

    pub async fn get_config(&self) -> LauncherConfig {
        self.config.read().await.clone()
    }

    pub async fn is_experimental_mode(&self) -> bool {
        self.config.read().await.is_experimental
    }

    pub async fn set_config(&self, new_config: LauncherConfig) -> Result<()> {
        let should_save = {
            let mut config = self.config.write().await;
            let current = &*config;

            // Check if there's any change to avoid unnecessary saves
            if current.is_experimental == new_config.is_experimental
                && current.auto_check_updates == new_config.auto_check_updates
                && current.concurrent_downloads == new_config.concurrent_downloads
                && current.enable_discord_presence == new_config.enable_discord_presence
                && current.check_beta_channel == new_config.check_beta_channel
                && current.profile_grouping_criterion == new_config.profile_grouping_criterion
                && current.open_logs_after_starting == new_config.open_logs_after_starting
                && current.concurrent_io_limit == new_config.concurrent_io_limit
                && current.last_played_profile == new_config.last_played_profile
                && current.hooks == new_config.hooks
                && current.hide_on_process_start == new_config.hide_on_process_start
                && current.window_border_radius == new_config.window_border_radius
            {
                return Ok(());
            }

            info!("Changing window border radius: {:?} -> {:?}", 
                  current.window_border_radius, new_config.window_border_radius);

            *config = new_config;
            true
        };

        if should_save {
            self.save_config().await?;
        }

        Ok(())
    }
}

#[async_trait]
impl PostInitializationHandler for ConfigManager {
    async fn on_state_ready(&self, _app_handle: Arc<tauri::AppHandle>) -> Result<()> {
        info!("ConfigManager: on_state_ready called. Loading configuration...");
        self.load_config_internal().await?;
        info!("ConfigManager: Successfully loaded configuration in on_state_ready.");
        Ok(())
    }
}

pub fn default_config_path() -> PathBuf {
    LAUNCHER_DIRECTORY.root_dir().join(CONFIG_FILENAME)
}
