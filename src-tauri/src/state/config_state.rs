use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY, update_custom_game_dir};
use crate::error::Result;
use crate::state::post_init::PostInitializationHandler;
use crate::state::profile_state::MemorySettings;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    #[serde(default = "default_global_memory_settings")]
    pub global_memory_settings: MemorySettings,
    #[serde(default)]
    pub custom_game_directory: Option<PathBuf>,
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

fn default_global_memory_settings() -> MemorySettings {
    MemorySettings {
        min: 3072, // 2GB
        max: 3072, // 4GB
    }
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
            global_memory_settings: default_global_memory_settings(),
            custom_game_directory: None,
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
                *config = loaded_config.clone();
                
                // Update cache
                update_custom_game_dir(loaded_config.custom_game_directory);
            }
            Err(e) => {
                error!("Failed to parse config file: {}", e);
                warn!("Attempting to migrate or preserve existing settings...");
                
                // Try to parse as generic JSON first to preserve user settings
                match serde_json::from_str::<serde_json::Value>(&config_data) {
                    Ok(json_value) => {
                        info!("Config file is valid JSON, attempting migration...");
                        
                        // Create backup of original config
                        let backup_path = self.config_path.with_extension("json.backup");
                        if let Err(backup_err) = fs::copy(&self.config_path, &backup_path).await {
                            warn!("Failed to create config backup: {}", backup_err);
                        } else {
                            info!("Created config backup at: {:?}", backup_path);
                        }
                        
                        // Start with default config and try to migrate settings
                        let mut migrated_config = LauncherConfig::default();
                        
                        // Migrate known fields that might exist
                        if let Some(obj) = json_value.as_object() {
                            // Migrate simple boolean fields
                            if let Some(exp) = obj.get("is_experimental").and_then(|v| v.as_bool()) {
                                migrated_config.is_experimental = exp;
                            }
                            if let Some(auto_check) = obj.get("auto_check_updates").and_then(|v| v.as_bool()) {
                                migrated_config.auto_check_updates = auto_check;
                            }
                            if let Some(discord) = obj.get("enable_discord_presence").and_then(|v| v.as_bool()) {
                                migrated_config.enable_discord_presence = discord;
                            }
                            if let Some(beta) = obj.get("check_beta_channel").and_then(|v| v.as_bool()) {
                                migrated_config.check_beta_channel = beta;
                            }
                            if let Some(logs) = obj.get("open_logs_after_starting").and_then(|v| v.as_bool()) {
                                migrated_config.open_logs_after_starting = logs;
                            }
                            if let Some(hide) = obj.get("hide_on_process_start").and_then(|v| v.as_bool()) {
                                migrated_config.hide_on_process_start = hide;
                            }
                            
                            // Migrate numeric fields
                            if let Some(downloads) = obj.get("concurrent_downloads").and_then(|v| v.as_u64()) {
                                if downloads > 0 && downloads <= 20 { // Reasonable bounds
                                    migrated_config.concurrent_downloads = downloads as usize;
                                }
                            }
                            if let Some(io_limit) = obj.get("concurrent_io_limit").and_then(|v| v.as_u64()) {
                                if io_limit > 0 && io_limit <= 50 { // Reasonable bounds
                                    migrated_config.concurrent_io_limit = io_limit as usize;
                                }
                            }
                            
                            // Migrate string fields
                            if let Some(grouping) = obj.get("profile_grouping_criterion").and_then(|v| v.as_str()) {
                                // Validate known values and migrate "none" to "group"
                                match grouping {
                                    "loader" | "game_version" | "group" => {
                                        migrated_config.profile_grouping_criterion = Some(grouping.to_string());
                                    }
                                    "none" => {
                                        warn!("Migrating legacy 'none' grouping to 'group'");
                                        migrated_config.profile_grouping_criterion = Some("group".to_string());
                                    }
                                    _ => {
                                        warn!("Unknown grouping criterion '{}', using default", grouping);
                                    }
                                }
                            }
                            
                            // Migrate UUID fields (with validation)
                            if let Some(profile_str) = obj.get("last_played_profile").and_then(|v| v.as_str()) {
                                if let Ok(uuid) = Uuid::parse_str(profile_str) {
                                    migrated_config.last_played_profile = Some(uuid);
                                }
                            }
                            
                            // Migrate custom game directory
                            if let Some(custom_dir_str) = obj.get("custom_game_directory").and_then(|v| v.as_str()) {
                                migrated_config.custom_game_directory = Some(PathBuf::from(custom_dir_str));
                            }
                        }
                        
                        info!("Migration completed, saving migrated configuration");
                        let mut config = self.config.write().await;
                        *config = migrated_config.clone();
                        drop(config); // Release lock before save
                        
                        // Save the migrated config
                        self.save_config().await?;
                        
                        // Update cache
                        update_custom_game_dir(migrated_config.custom_game_directory);
                    }
                    Err(json_err) => {
                        error!("Config file is not valid JSON: {}", json_err);
                        warn!("Config file is corrupted, creating backup and using defaults");
                        
                        // Create backup of corrupted file
                        let backup_path = self.config_path.with_extension("json.corrupted");
                        if let Err(backup_err) = fs::copy(&self.config_path, &backup_path).await {
                            error!("Failed to backup corrupted config: {}", backup_err);
                        } else {
                            info!("Backed up corrupted config to: {:?}", backup_path);
                        }
                        
                        // Use default config and save it
                self.save_config().await?;
                    }
                }
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
                && current.global_memory_settings.min == new_config.global_memory_settings.min
                && current.global_memory_settings.max == new_config.global_memory_settings.max
                && current.custom_game_directory == new_config.custom_game_directory
            {
                debug!("No config changes detected, skipping save");
                false
            } else {
                // Preserve version during replacement
                let version = config.version;

                // Log changes
                if current.is_experimental != new_config.is_experimental {
                    info!(
                        "Changing experimental mode: {} -> {}",
                        current.is_experimental, new_config.is_experimental
                    );
                }
                if current.auto_check_updates != new_config.auto_check_updates {
                    info!(
                        "Changing auto check updates: {} -> {}",
                        current.auto_check_updates, new_config.auto_check_updates
                    );
                }
                if current.concurrent_downloads != new_config.concurrent_downloads {
                    info!(
                        "Changing concurrent downloads: {} -> {}",
                        current.concurrent_downloads, new_config.concurrent_downloads
                    );
                }
                if current.enable_discord_presence != new_config.enable_discord_presence {
                    info!(
                        "Changing Discord Rich Presence: {} -> {}",
                        current.enable_discord_presence, new_config.enable_discord_presence
                    );
                }
                if current.check_beta_channel != new_config.check_beta_channel {
                    info!(
                        "Changing beta channel check: {} -> {}",
                        current.check_beta_channel, new_config.check_beta_channel
                    );
                }
                if current.profile_grouping_criterion != new_config.profile_grouping_criterion {
                    info!(
                        "Changing profile grouping criterion: {:?} -> {:?}",
                        current.profile_grouping_criterion, new_config.profile_grouping_criterion
                    );
                }
                if current.open_logs_after_starting != new_config.open_logs_after_starting {
                    info!(
                        "Changing open logs after starting: {} -> {}",
                        current.open_logs_after_starting, new_config.open_logs_after_starting
                    );
                }
                if current.concurrent_io_limit != new_config.concurrent_io_limit {
                    info!(
                        "Changing concurrent IO limit: {} -> {}",
                        current.concurrent_io_limit, new_config.concurrent_io_limit
                    );
                }
                if current.last_played_profile != new_config.last_played_profile {
                    info!(
                        "Changing last played profile: {:?} -> {:?}",
                        current.last_played_profile, new_config.last_played_profile
                    );
                }
                if current.hooks != new_config.hooks {
                    info!(
                        "Changing hooks: {:?} -> {:?}",
                        current.hooks, new_config.hooks
                    );
                }
                if current.hide_on_process_start != new_config.hide_on_process_start {
                    info!(
                        "Changing hide on process start: {} -> {}",
                        current.hide_on_process_start, new_config.hide_on_process_start
                    );
                }
                if current.global_memory_settings.min != new_config.global_memory_settings.min
                    || current.global_memory_settings.max != new_config.global_memory_settings.max {
                    info!(
                        "Changing global memory settings: {}MB-{}MB -> {}MB-{}MB",
                        current.global_memory_settings.min, current.global_memory_settings.max,
                        new_config.global_memory_settings.min, new_config.global_memory_settings.max
                    );
                }
                if current.custom_game_directory != new_config.custom_game_directory {
                    info!(
                        "Changing custom game directory: {:?} -> {:?}",
                        current.custom_game_directory, new_config.custom_game_directory
                    );
                }

                // Update config while preserving version
                *config = LauncherConfig {
                    version,
                    is_experimental: new_config.is_experimental,
                    auto_check_updates: new_config.auto_check_updates,
                    concurrent_downloads: new_config.concurrent_downloads,
                    enable_discord_presence: new_config.enable_discord_presence,
                    check_beta_channel: new_config.check_beta_channel,
                    profile_grouping_criterion: new_config.profile_grouping_criterion.clone(),
                    open_logs_after_starting: new_config.open_logs_after_starting,
                    concurrent_io_limit: new_config.concurrent_io_limit,
                    last_played_profile: new_config.last_played_profile,
                    hooks: new_config.hooks,
                    hide_on_process_start: new_config.hide_on_process_start,
                    global_memory_settings: new_config.global_memory_settings,
                    custom_game_directory: new_config.custom_game_directory.clone(),
                };

                true
            }
        };

        // Save the updated config if needed
        if should_save {
            self.save_config().await?;

            // Update cache
            update_custom_game_dir(new_config.custom_game_directory.clone());

            // Update Discord status if it changed
            if let Ok(state) = crate::state::State::get().await {
                // Check if Discord status changed
                let discord_enabled = new_config.enable_discord_presence;
                if let Err(e) = state.discord_manager.set_enabled(discord_enabled).await {
                    warn!(
                        "Error updating Discord after config change: {}, continuing anyway",
                        e
                    );
                }
            }
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
