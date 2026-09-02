use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::state::post_init::PostInitializationHandler;
use async_trait::async_trait;
use log::{debug, error, info, trace, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::{Mutex, RwLock};

const SKINS_FILENAME: &str = "minecraft_skins.json";

/// Represents a Minecraft skin stored in the local database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftSkin {
    /// Unique identifier for the skin
    pub id: String,
    /// Display name of the skin
    pub name: String,
    /// Base64 encoded skin data
    pub base64_data: String,
    /// Skin variant: "slim" (Alex) or "classic" (Steve)
    pub variant: String,
    /// Optional description
    #[serde(default)]
    pub description: String,
    /// Timestamp when the skin was added
    #[serde(default = "chrono::Utc::now")]
    pub added_at: chrono::DateTime<chrono::Utc>,
}

/// Container for all stored skins
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkinDatabase {
    /// List of stored skins
    #[serde(default)]
    pub skins: Vec<MinecraftSkin>,
}

/// Manager for handling Minecraft skin storage
pub struct SkinManager {
    /// The skin database, protected by a read-write lock
    skins: Arc<RwLock<SkinDatabase>>,
    /// Path to the skin database file
    skins_path: PathBuf,
    /// Lock for synchronizing save operations
    save_lock: Mutex<()>,
}

impl SkinManager {
    /// Create a new skin manager
    pub fn new(skins_path: PathBuf) -> Result<Self> {
        trace!(
            "SkinManager: Initializing with path: {:?} (skins loading deferred)",
            skins_path
        );
        Ok(Self {
            skins: Arc::new(RwLock::new(SkinDatabase::default())),
            skins_path,
            save_lock: Mutex::new(()),
        })
    }

    /// Load skins from the database file
    async fn load_skins_internal(&self) -> Result<()> {
        if !self.skins_path.exists() {
            info!("Skins database file not found, using empty database");
            // Save the empty database
            self.save_skins().await?;
            return Ok(());
        }

        trace!("Loading skins database from: {:?}", self.skins_path);
        let skins_data = fs::read_to_string(&self.skins_path).await?;

        match serde_json::from_str::<SkinDatabase>(&skins_data) {
            Ok(loaded_skins) => {
                info!(
                    "Successfully loaded skins database with {} skins",
                    loaded_skins.skins.len()
                );

                // Update the stored skins
                let mut skins = self.skins.write().await;
                *skins = loaded_skins;
            }
            Err(e) => {
                error!("Failed to parse skins database file: {}", e);
                warn!("Using empty skins database and saving it");
                // Save the empty database to repair the file
                self.save_skins().await?;
            }
        }

        Ok(())
    }

    /// Save skins to the database file
    async fn save_skins(&self) -> Result<()> {
        let _guard = self.save_lock.lock().await;
        debug!("Acquired save lock, proceeding to save skins database...");

        // Ensure directory exists
        if let Some(parent_dir) = self.skins_path.parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir).await?;
                info!(
                    "Created directory for skins database file: {:?}",
                    parent_dir
                );
            }
        }

        let skins = self.skins.read().await;
        let skins_data = serde_json::to_string_pretty(&*skins)?;

        fs::write(&self.skins_path, skins_data).await?;
        info!(
            "Successfully saved skins database to: {:?}",
            self.skins_path
        );

        Ok(())
    }

    /// Get all skins from the database
    pub async fn get_all_skins(&self) -> Vec<MinecraftSkin> {
        debug!("Getting all skins from database");
        let skins = self.skins.read().await.skins.clone();
        debug!("Retrieved {} skins from database", skins.len());
        skins
    }

    /// Get a skin by its ID
    pub async fn get_skin_by_id(&self, id: &str) -> Option<MinecraftSkin> {
        debug!("Getting skin with ID: {}", id);
        let skins = self.skins.read().await;
        let skin = skins.skins.iter().find(|skin| skin.id == id).cloned();

        if skin.is_some() {
            debug!("Found skin with ID: {}", id);
        } else {
            debug!("No skin found with ID: {}", id);
        }

        skin
    }

    /// Add a new skin to the database
    pub async fn add_skin(&self, skin: MinecraftSkin) -> Result<()> {
        let mut skins = self.skins.write().await;

        // Check if a skin with this ID already exists
        if let Some(index) = skins.skins.iter().position(|s| s.id == skin.id) {
            // Replace the existing skin
            skins.skins[index] = skin;
            info!("Updated existing skin with ID: {}", skins.skins[index].id);
        } else {
            // Add the new skin
            skins.skins.push(skin);
            info!("Added new skin, total count: {}", skins.skins.len());
        }

        // Save the updated database
        drop(skins); // Release the write lock before saving
        self.save_skins().await?;

        Ok(())
    }

    /// Remove a skin from the database
    pub async fn remove_skin(&self, id: &str) -> Result<bool> {
        let mut skins = self.skins.write().await;

        let initial_len = skins.skins.len();
        skins.skins.retain(|skin| skin.id != id);

        let removed = skins.skins.len() < initial_len;

        if removed {
            info!("Removed skin with ID: {}", id);
            // Save the updated database
            drop(skins); // Release the write lock before saving
            self.save_skins().await?;
        } else {
            info!("No skin found with ID: {}", id);
        }

        Ok(removed)
    }

    /// Update skin properties (name and variant)
    pub async fn update_skin_properties(
        &self,
        id: &str,
        name: String,
        variant: String,
    ) -> Result<Option<MinecraftSkin>> {
        debug!("Updating skin properties for ID: {}", id);
        debug!("New name: {}, New variant: {}", name, variant);

        let mut skins = self.skins.write().await;

        // Find the skin with the given ID
        if let Some(index) = skins.skins.iter().position(|s| s.id == id) {
            // Update the skin properties
            skins.skins[index].name = name;
            skins.skins[index].variant = variant;

            let updated_skin = skins.skins[index].clone();
            debug!("Successfully updated skin properties for ID: {}", id);

            // Save the updated database
            drop(skins); // Release the write lock before saving
            self.save_skins().await?;

            Ok(Some(updated_skin))
        } else {
            debug!("No skin found with ID: {}", id);
            Ok(None)
        }
    }
}

#[async_trait]
impl PostInitializationHandler for SkinManager {
    async fn on_state_ready(&self, _app_handle: Arc<tauri::AppHandle>) -> Result<()> {
        trace!("SkinManager: on_state_ready called. Loading skins...");
        self.load_skins_internal().await?;
        trace!("SkinManager: Successfully loaded skins in on_state_ready.");
        Ok(())
    }
}

/// Get the default path for the skins database file
pub fn default_skins_path() -> PathBuf {
    LAUNCHER_DIRECTORY.root_dir().join(SKINS_FILENAME)
}
