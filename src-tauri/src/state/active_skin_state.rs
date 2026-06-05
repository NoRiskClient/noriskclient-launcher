use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::state::post_init::PostInitializationHandler;
use crate::utils::mc_utils::{fetch_skin_base64_for_uuid, normalize_uuid};
use async_trait::async_trait;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::{Mutex, RwLock};

const ACTIVE_SKINS_FILENAME: &str = "active_skins.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveSkin {
    pub uuid: String,
    pub base64_data: String,
    pub variant: String,
    #[serde(default)]
    pub source: String,
    #[serde(default = "chrono::Utc::now")]
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ActiveSkinDatabase {
    #[serde(default)]
    pub skins: HashMap<String, ActiveSkin>,
}

pub struct ActiveSkinManager {
    db: Arc<RwLock<ActiveSkinDatabase>>,
    path: PathBuf,
    save_lock: Mutex<()>,
}

impl ActiveSkinManager {
    pub fn new(path: PathBuf) -> Result<Self> {
        info!("ActiveSkinManager: Initializing with path: {:?}", path);
        Ok(Self {
            db: Arc::new(RwLock::new(ActiveSkinDatabase::default())),
            path,
            save_lock: Mutex::new(()),
        })
    }

    async fn load_internal(&self) -> Result<()> {
        if !self.path.exists() {
            info!("Active skins file not found, using empty database");
            self.save().await?;
            return Ok(());
        }

        let data = fs::read_to_string(&self.path).await?;
        match serde_json::from_str::<ActiveSkinDatabase>(&data) {
            Ok(loaded) => {
                info!(
                    "Successfully loaded active skins database with {} entries",
                    loaded.skins.len()
                );
                *self.db.write().await = loaded;
            }
            Err(e) => {
                error!("Failed to parse active skins file: {}", e);
                warn!("Using empty active skins database and saving it");
                self.save().await?;
            }
        }
        Ok(())
    }

    async fn save(&self) -> Result<()> {
        let _guard = self.save_lock.lock().await;
        if let Some(parent) = self.path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).await?;
            }
        }
        let data = serde_json::to_string_pretty(&*self.db.read().await)?;
        fs::write(&self.path, data).await?;
        debug!("Saved active skins database to: {:?}", self.path);
        Ok(())
    }

    pub async fn get(&self, uuid: &str) -> Option<ActiveSkin> {
        self.db.read().await.skins.get(&normalize_uuid(uuid)).cloned()
    }

    pub async fn clear(&self, uuid: &str) -> Result<()> {
        self.db.write().await.skins.remove(&normalize_uuid(uuid));
        self.save().await
    }

    pub async fn set(&self, uuid: &str, base64_data: String, variant: String, source: &str) -> Result<bool> {
        let key = normalize_uuid(uuid);
        let changed = {
            let db = self.db.read().await;
            db.skins
                .get(&key)
                .map_or(true, |existing| existing.base64_data != base64_data)
        };

        let record = ActiveSkin {
            uuid: key.clone(),
            base64_data,
            variant,
            source: source.to_string(),
            updated_at: chrono::Utc::now(),
        };

        self.db.write().await.skins.insert(key, record);
        self.save().await?;
        Ok(changed)
    }

    pub async fn reconcile(&self, uuid: &str) -> Result<bool> {
        debug!("ActiveSkinManager: reconciling skin for UUID {}", uuid);
        let (base64, variant) = fetch_skin_base64_for_uuid(uuid).await?;
        self.set(uuid, base64, variant.to_string(), "reconciled").await
    }
}

#[async_trait]
impl PostInitializationHandler for ActiveSkinManager {
    async fn on_state_ready(&self, _app_handle: Arc<tauri::AppHandle>) -> Result<()> {
        info!("ActiveSkinManager: on_state_ready called. Loading active skins...");
        self.load_internal().await?;
        Ok(())
    }
}

pub fn default_active_skins_path() -> PathBuf {
    LAUNCHER_DIRECTORY.root_dir().join(ACTIVE_SKINS_FILENAME)
}
