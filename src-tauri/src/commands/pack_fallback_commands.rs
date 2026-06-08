use crate::error::CommandError;
use log::info;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{OnceCell, RwLock};

const DEFAULT_FALLBACK_PACK_ID: &str = "norisk-stable";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackFallbackConfig {
    pub fallback_pack_id: String,
}

impl Default for PackFallbackConfig {
    fn default() -> Self {
        Self {
            fallback_pack_id: DEFAULT_FALLBACK_PACK_ID.to_string(),
        }
    }
}

static PACK_FALLBACK_CONFIG: OnceCell<Arc<RwLock<PackFallbackConfig>>> = OnceCell::const_new();

async fn storage() -> &'static Arc<RwLock<PackFallbackConfig>> {
    PACK_FALLBACK_CONFIG
        .get_or_init(|| async { Arc::new(RwLock::new(PackFallbackConfig::default())) })
        .await
}

pub async fn get_fallback_pack_id() -> String {
    storage().await.read().await.fallback_pack_id.clone()
}

#[tauri::command]
pub async fn set_pack_fallback_config(config: PackFallbackConfig) -> Result<(), CommandError> {
    info!(
        "[PackFallback] Fallback pack ID set to: {}",
        config.fallback_pack_id
    );
    *storage().await.write().await = config;
    Ok(())
}

#[tauri::command]
pub async fn get_pack_fallback_config() -> Result<PackFallbackConfig, CommandError> {
    Ok(storage().await.read().await.clone())
}
