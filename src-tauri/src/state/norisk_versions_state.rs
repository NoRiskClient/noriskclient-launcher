use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::integrations::norisk_versions::NoriskVersionsConfig;
use crate::minecraft::api::norisk_api::NoRiskApi;
use crate::state::post_init::PostInitializationHandler;
use crate::state::state_manager::State;
use async_trait::async_trait;
use log::{debug, error, info};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::Mutex;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::profile_state::Profile;

// Default filename for the Norisk versions configuration
const NORISK_VERSIONS_FILENAME: &str = "norisk_versions.json";

/// Returns the path for the norisk versions config depending on experimental mode
pub fn norisk_versions_path_for(is_experimental: bool) -> PathBuf {
    let filename = if is_experimental {
        "norisk_versions_exp.json"
    } else {
        NORISK_VERSIONS_FILENAME
    };
    LAUNCHER_DIRECTORY.root_dir().join(filename)
}

pub struct NoriskVersionManager {
    config: Arc<RwLock<NoriskVersionsConfig>>,
    config_path: PathBuf,
    save_lock: Mutex<()>, // Lock for potential future save operations
}

impl NoriskVersionManager {
    /// Creates a new NoriskVersionManager instance, loading the configuration from the specified path.
    /// If the file doesn't exist, it initializes with a default empty configuration.
    pub fn new(config_path: PathBuf) -> Result<Self> {
        info!(
            "NoriskVersionManager: Initializing with path: {:?} (config loading deferred)",
            config_path
        );
        Ok(Self {
            config: Arc::new(RwLock::new(NoriskVersionsConfig::default())),
            config_path,
            save_lock: Mutex::new(()),
        })
    }

    /// Fetches the latest Norisk versions configuration from the API and updates the local state.
    /// Saves the updated configuration to the file on success.
    pub async fn fetch_and_update_config(
        &self,
        // Assuming no token/experimental needed based on previous confirmation for packs
        norisk_token: &str,
        is_experimental: bool,
    ) -> Result<()> {
        info!("Fetching latest Norisk versions config from API...");

        // Assuming placeholder token/flag is okay, like for packs
        match NoRiskApi::get_standard_versions(norisk_token, is_experimental).await {
            Ok(new_config) => {
                debug!(
                    "Successfully fetched {} standard profile definitions from API.",
                    new_config.profiles.len()
                );
                {
                    // Scope for the write lock
                    let mut config_guard = self.config.write().await;
                    *config_guard = new_config;
                } // Write lock released here

                // Save the newly fetched config
                match self.save_config().await {
                    Ok(_) => {
                        info!("Successfully updated and saved Norisk versions config from API.");
                        Ok(())
                    }
                    Err(e) => {
                        error!(
                            "Fetched versions config from API, but failed to save it: {}",
                            e
                        );
                        Err(e) // Return the save error
                    }
                }
            }
            Err(e) => {
                error!("Failed to fetch Norisk versions config from API: {}", e);
                Err(e) // Return the fetch error
            }
        }
    }

    /// Loads the Norisk versions configuration from a JSON file.
    /// Returns a default empty config if the file doesn't exist or cannot be parsed.
    async fn load_config_internal(&self, path: &PathBuf) -> Result<NoriskVersionsConfig> {
        if !path.exists() {
            info!(
                "Norisk versions config file not found at {:?}, using default empty config.",
                path
            );
            return Ok(NoriskVersionsConfig { profiles: vec![] });
        }

        let data = fs::read_to_string(path).await?;

        match serde_json::from_str(&data) {
            Ok(config) => Ok(config),
            Err(e) => {
                error!("Failed to parse norisk_versions.json at {:?}: {}. Returning default empty config.", path, e);
                // Return default instead of error to allow launcher to start even with broken config
                Ok(NoriskVersionsConfig { profiles: vec![] })
            }
        }
    }

    /// Saves the current configuration back to the JSON file.
    /// Note: This might not be frequently used for standard versions unless caching fetched data.
    #[allow(dead_code)]
    async fn save_config(&self) -> Result<()> {
        let _guard = self.save_lock.lock().await;

        let config_data = {
            let config_guard = self.config.read().await;
            serde_json::to_string_pretty(&*config_guard)?
        };

        // Choose path based on experimental mode if available; fall back to manager's path
        let path_to_write = if let Ok(state) = State::get().await {
            let is_exp = state.config_manager.is_experimental_mode().await;
            norisk_versions_path_for(is_exp)
        } else {
            self.config_path.clone()
        };

        if let Some(parent_dir) = path_to_write.parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir).await?;
                info!(
                    "Created directory for norisk versions config: {:?}",
                    parent_dir
                );
            }
        }

        fs::write(&path_to_write, config_data).await?;
        info!(
            "Successfully saved norisk versions config to {:?}",
            path_to_write
        );
        Ok(())
    }

    /// Returns a clone of the entire current NoriskVersionsConfig.
    pub async fn get_config(&self) -> NoriskVersionsConfig {
        self.config.read().await.clone()
    }

    /// Updates the entire configuration and saves it to the file.
    /// Note: Use with caution, as standard versions are often meant to be static or fetched.
    #[allow(dead_code)]
    pub async fn update_config(&self, new_config: NoriskVersionsConfig) -> Result<()> {
        {
            let mut config_guard = self.config.write().await;
            *config_guard = new_config;
        }
        self.save_config().await // Save the updated config
    }

    /// Prints the current configuration to the console for debugging.
    #[allow(dead_code)]
    pub async fn print_current_config(&self) {
        let config_guard = self.config.read().await;
        println!("--- Current Norisk Versions Config ---");
        println!("{:#?}", *config_guard);
        println!("--- End Norisk Versions Config ---");
    }

    /// Returns a standard profile by ID if found
    pub async fn get_profile_by_id(&self, id: Uuid) -> Option<Profile> {
        let config = self.config.read().await;
        config.profiles.iter().find(|p| p.id == id).cloned()
    }

    // Add more specific accessor methods if needed, e.g.:
    // pub async fn get_standard_profile(&self, profile_id: Uuid) -> Option<NoriskVersionProfile> { ... }
}

#[async_trait]
impl PostInitializationHandler for NoriskVersionManager {
    async fn on_state_ready(&self, _app_handle: Arc<tauri::AppHandle>) -> Result<()> {
        info!("NoriskVersionManager: on_state_ready called. Loading configuration...");
        // Load initial config. If loading fails critically (e.g., IO error other than NotFound), propagate the error.
        // If parsing fails or file not found, use default. This logic is now effectively in load_config_internal.
        let load_path = if let Ok(state) = State::get().await {
            let is_exp = state.config_manager.is_experimental_mode().await;
            norisk_versions_path_for(is_exp)
        } else {
            self.config_path.clone()
        };
        let loaded_config = self.load_config_internal(&load_path).await.unwrap_or_else(|e| {
            error!(
                "NoriskVersionManager: Critical error in on_state_ready loading config (path: {:?}): {}. Using default empty config.", 
                load_path,
                e
            );
            NoriskVersionsConfig::default()
        });

        let mut config_guard = self.config.write().await;
        *config_guard = loaded_config;
        drop(config_guard);

        info!("NoriskVersionManager: Successfully processed configuration in on_state_ready.");
        Ok(())
    }
}

/// Returns the default path for the norisk_versions.json file within the launcher directory.
pub fn default_norisk_versions_path() -> PathBuf {
    LAUNCHER_DIRECTORY.root_dir().join(NORISK_VERSIONS_FILENAME)
}
