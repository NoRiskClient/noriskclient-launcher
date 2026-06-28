use crate::error::CommandError;
use crate::state::state_manager::State;
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{OnceCell, RwLock};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PackRolloutConfig {
    #[serde(default)]
    pub aliases: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackRolloutStatus {
    pub override_mode: String,
    pub aliases: HashMap<String, String>,
    pub active: bool,
}

static PACK_ROLLOUT_CONFIG: OnceCell<Arc<RwLock<PackRolloutConfig>>> = OnceCell::const_new();

async fn storage() -> &'static Arc<RwLock<PackRolloutConfig>> {
    PACK_ROLLOUT_CONFIG
        .get_or_init(|| async { Arc::new(RwLock::new(PackRolloutConfig::default())) })
        .await
}

pub async fn resolve_effective_pack_id(original: &str) -> String {
    let override_mode = match State::get().await {
        Ok(state) => state.config_manager.get_config().await.pack_rollout_override,
        Err(_) => "auto".to_string(),
    };

    if override_mode == "off" {
        return original.to_string();
    }

    let guard = storage().await.read().await;
    if let Some(target) = guard.aliases.get(original) {
        if target == original {
            return original.to_string();
        }
        info!(
            "[PackRollout] override={} → resolving {} -> {}",
            override_mode, original, target
        );
        return target.clone();
    }

    original.to_string()
}

#[tauri::command]
pub async fn is_pack_rollout_active() -> Result<bool, CommandError> {
    let aliases = storage().await.read().await.aliases.clone();
    Ok(!aliases.is_empty())
}

#[tauri::command]
pub async fn is_pack_aliased(pack_id: String) -> Result<bool, CommandError> {
    let effective = resolve_effective_pack_id(&pack_id).await;
    Ok(effective != pack_id)
}

#[tauri::command]
pub async fn set_pack_rollout_config(config: PackRolloutConfig) -> Result<(), CommandError> {
    if config.aliases.is_empty() {
        info!("[PackRollout] No rollout active (flagsmith returned empty aliases)");
    } else {
        info!(
            "[PackRollout] Rollout ACTIVE — {} alias(es):",
            config.aliases.len()
        );
        for (src, dst) in &config.aliases {
            info!("[PackRollout]   {} → {}", src, dst);
        }
    }
    let mut guard = storage().await.write().await;
    *guard = config;
    Ok(())
}

#[tauri::command]
pub async fn get_pack_rollout_status() -> Result<PackRolloutStatus, CommandError> {
    let override_mode = match State::get().await {
        Ok(state) => state.config_manager.get_config().await.pack_rollout_override,
        Err(_) => "auto".to_string(),
    };
    let aliases = storage().await.read().await.aliases.clone();
    let active = override_mode != "off" && !aliases.is_empty();
    Ok(PackRolloutStatus {
        override_mode,
        aliases,
        active,
    })
}

#[tauri::command]
pub async fn get_pack_rollout_config() -> Result<PackRolloutConfig, CommandError> {
    Ok(storage().await.read().await.clone())
}

#[tauri::command]
pub async fn get_effective_pack_id(pack_id: String) -> Result<String, CommandError> {
    Ok(resolve_effective_pack_id(&pack_id).await)
}
