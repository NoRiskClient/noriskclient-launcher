use crate::error::{AppError, CommandError};
use crate::minecraft::api::norisk_api::NoRiskApi;
use crate::state::state_manager::State;
use chrono::{DateTime, Utc};
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::{AppHandle, Emitter};
use tokio::sync::{OnceCell, RwLock};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PermissionCacheState {
    pub nodes: Vec<String>,
    pub last_fetched: Option<DateTime<Utc>>,
    pub last_account_id: Option<String>,
}

static CACHE: OnceCell<RwLock<PermissionCacheState>> = OnceCell::const_new();

const PERMISSIONS_CHANGED_EVENT: &str = "permissions:changed";

async fn cache() -> &'static RwLock<PermissionCacheState> {
    CACHE
        .get_or_init(|| async { RwLock::new(PermissionCacheState::default()) })
        .await
}

fn grants(set: &HashSet<&str>, node: &str) -> bool {
    if set.contains("*") || set.contains(node) {
        return true;
    }
    let mut prefix = node;
    while let Some(dot) = prefix.rfind('.') {
        prefix = &prefix[..dot];
        if set.contains(format!("{}.*", prefix).as_str()) {
            return true;
        }
    }
    false
}

async fn granted_nodes(nodes: Vec<String>) -> Vec<String> {
    let guard = cache().await.read().await;
    let set: HashSet<&str> = guard.nodes.iter().map(|s| s.as_str()).collect();
    nodes.into_iter().filter(|node| grants(&set, node)).collect()
}

pub async fn has_permission_internal(node: &str) -> bool {
    !granted_nodes(vec![node.to_string()]).await.is_empty()
}

#[tauri::command]
pub async fn refresh_permissions(app: AppHandle) -> Result<(), CommandError> {
    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;

    let active = match state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
    {
        Some(a) => a,
        None => {
            debug!("[Permissions] No active account, clearing cache");
            *cache().await.write().await = PermissionCacheState::default();
            let _ = app.emit(PERMISSIONS_CHANGED_EVENT, ());
            return Ok(());
        }
    };

    let account_id_str = active.id.to_string();
    let token = match active.norisk_credentials.get_token_for_mode(is_experimental) {
        Ok(t) => t,
        Err(e) => {
            warn!(
                "[Permissions] No NoRisk token for account {} (experimental={}): {}",
                account_id_str, is_experimental, e
            );
            return Err(AppError::from(e).into());
        }
    };

    match NoRiskApi::get_user_permissions(&token, &account_id_str, is_experimental).await {
        Ok(nodes) => {
            let mut sorted = nodes;
            sorted.sort();
            sorted.dedup();
            info!(
                "[Permissions] Cached {} node(s) for {}",
                sorted.len(),
                account_id_str
            );
            *cache().await.write().await = PermissionCacheState {
                nodes: sorted,
                last_fetched: Some(Utc::now()),
                last_account_id: Some(account_id_str),
            };
            let _ = app.emit(PERMISSIONS_CHANGED_EVENT, ());
            Ok(())
        }
        Err(e) => {
            warn!("[Permissions] Refresh failed: {}", e);
            Err(e.into())
        }
    }
}

#[tauri::command]
pub async fn get_cached_permissions() -> Result<PermissionCacheState, CommandError> {
    Ok(cache().await.read().await.clone())
}

#[tauri::command]
pub async fn has_permission(node: String) -> Result<bool, CommandError> {
    Ok(has_permission_internal(&node).await)
}

#[tauri::command]
pub async fn get_granted_permissions(nodes: Vec<String>) -> Result<Vec<String>, CommandError> {
    Ok(granted_nodes(nodes).await)
}
