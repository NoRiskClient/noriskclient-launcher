use crate::error::{AppError, CommandError};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use regex::Regex;
use std::collections::HashMap;

/// Configuration for blocked mods that cause crashes or compatibility issues.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockedModsConfig {
    pub exact_filenames: Vec<String>,
    pub filename_patterns: Vec<String>,
    pub mod_ids: Vec<String>,
    pub modrinth_project_ids: Vec<String>,
    pub warning_project_ids: Vec<String>,
    pub description: String,
}

impl Default for BlockedModsConfig {
    fn default() -> Self {
        Self {
            exact_filenames: Vec::new(),
            filename_patterns: Vec::new(),
            mod_ids: Vec::new(),
            modrinth_project_ids: Vec::new(),
            warning_project_ids: Vec::new(),
            description: "Default empty configuration".to_string(),
        }
    }
}

// Global in-memory storage for blocked mods config
static BLOCKED_MODS_CONFIG: tokio::sync::OnceCell<Arc<RwLock<BlockedModsConfig>>> = tokio::sync::OnceCell::const_new();

// Global cache for compiled regex patterns
static REGEX_CACHE: tokio::sync::OnceCell<Arc<RwLock<HashMap<String, Regex>>>> = tokio::sync::OnceCell::const_new();

// Global optimized combined regex for all patterns (for max performance)
static COMBINED_REGEX: tokio::sync::OnceCell<Arc<RwLock<Option<Regex>>>> = tokio::sync::OnceCell::const_new();

async fn get_blocked_mods_config_storage() -> &'static Arc<RwLock<BlockedModsConfig>> {
    BLOCKED_MODS_CONFIG
        .get_or_init(|| async {
            Arc::new(RwLock::new(BlockedModsConfig::default()))
        })
        .await
}

async fn get_regex_cache() -> &'static Arc<RwLock<HashMap<String, Regex>>> {
    REGEX_CACHE
        .get_or_init(|| async {
            Arc::new(RwLock::new(HashMap::new()))
        })
        .await
}

async fn get_combined_regex() -> &'static Arc<RwLock<Option<Regex>>> {
    COMBINED_REGEX
        .get_or_init(|| async {
            Arc::new(RwLock::new(None))
        })
        .await
}

/// Set the blocked mods configuration from the frontend
#[tauri::command]
pub async fn set_blocked_mods_config(config: BlockedModsConfig) -> Result<(), CommandError> {
    debug!("Command called: set_blocked_mods_config");
    debug!(
        "Setting blocked mods config: {} exact filenames, {} patterns, {} mod IDs, {} modrinth project IDs, {} warning project IDs",
        config.exact_filenames.len(),
        config.filename_patterns.len(),
        config.mod_ids.len(),
        config.modrinth_project_ids.len(),
        config.warning_project_ids.len()
    );

    // Pre-compile all regex patterns and cache them
    let regex_cache = get_regex_cache().await;
    let mut cache_guard = regex_cache.write().await;
    cache_guard.clear(); // Clear old patterns
    
    let mut valid_patterns = Vec::new();
    
    for pattern in &config.filename_patterns {
        match Regex::new(pattern) {
            Ok(regex) => {
                cache_guard.insert(pattern.clone(), regex);
                valid_patterns.push(pattern.clone());
                debug!("Pre-compiled regex pattern: {}", pattern);
            }
            Err(e) => {
                warn!("Failed to compile regex pattern '{}': {}. Pattern will be ignored.", pattern, e);
            }
        }
    }
    drop(cache_guard);
    
    // Create optimized combined regex for maximum performance
    let combined_regex = get_combined_regex().await;
    let mut combined_guard = combined_regex.write().await;
    
    if !valid_patterns.is_empty() {
        // Combine all patterns with OR (|) for single regex check
        let combined_pattern = format!("({})", valid_patterns.join(")|("));
        match Regex::new(&combined_pattern) {
            Ok(regex) => {
                *combined_guard = Some(regex);
                debug!("Created optimized combined regex from {} patterns", valid_patterns.len());
            }
            Err(e) => {
                warn!("Failed to create combined regex: {}. Will use individual patterns.", e);
                *combined_guard = None;
            }
        }
    } else {
        *combined_guard = None;
    }
    drop(combined_guard);

    let storage = get_blocked_mods_config_storage().await;
    let mut config_guard = storage.write().await;
    *config_guard = config;
    drop(config_guard);

    info!("Successfully updated blocked mods configuration and compiled {} regex patterns", 
          regex_cache.read().await.len());
    debug!("Command completed: set_blocked_mods_config");
    Ok(())
}

/// Get the current blocked mods configuration
#[tauri::command]
pub async fn get_blocked_mods_config() -> Result<BlockedModsConfig, CommandError> {
    debug!("Command called: get_blocked_mods_config");

    let storage = get_blocked_mods_config_storage().await;
    let config_guard = storage.read().await;
    let config = config_guard.clone();
    drop(config_guard);
    
    debug!(
        "Retrieved blocked mods config: {} exact filenames, {} patterns, {} mod IDs, {} modrinth project IDs, {} warning project IDs",
        config.exact_filenames.len(),
        config.filename_patterns.len(),
        config.mod_ids.len(),
        config.modrinth_project_ids.len(),
        config.warning_project_ids.len()
    );

    debug!("Command completed: get_blocked_mods_config");
    Ok(config)
}

/// Fast filename blocking check using pre-compiled combined regex
async fn is_filename_blocked_fast(filename: &str, config: &BlockedModsConfig) -> bool {
    // 1. Fast exact filename check first (no regex needed)
    if config.exact_filenames.contains(&filename.to_string()) {
        debug!("Filename '{}' is blocked (exact match)", filename);
        return true;
    }
    
    // 2. If no patterns, return false immediately
    if config.filename_patterns.is_empty() {
        return false;
    }
    
    // 3. Use combined regex for maximum performance
    let combined_regex = get_combined_regex().await;
    let regex_guard = combined_regex.read().await;
    
    if let Some(ref regex) = *regex_guard {
        if regex.is_match(filename) {
            debug!("Filename '{}' is blocked (combined regex pattern)", filename);
            return true;
        }
    } else {
        warn!("Combined regex not available, falling back to individual patterns");
        drop(regex_guard);
        
        // Fallback to individual cached patterns
        let regex_cache = get_regex_cache().await;
        let cache_guard = regex_cache.read().await;
        
        for pattern in &config.filename_patterns {
            if let Some(regex) = cache_guard.get(pattern) {
                if regex.is_match(filename) {
                    debug!("Filename '{}' is blocked (individual pattern: '{}')", filename, pattern);
                    return true;
                }
            }
        }
    }
    
    false
}

/// Check if a specific filename should be blocked
#[tauri::command]
pub async fn is_filename_blocked(filename: String) -> Result<bool, CommandError> {
    debug!("Command called: is_filename_blocked for: {}", filename);

    let storage = get_blocked_mods_config_storage().await;
    let config_guard = storage.read().await;
    
    let is_blocked = is_filename_blocked_fast(&filename, &config_guard).await;
    
    if is_blocked {
        debug!("Filename '{}' is blocked", filename);
    } else {
        debug!("Filename '{}' is not blocked", filename);
    }

    debug!("Command completed: is_filename_blocked");
    Ok(is_blocked)
}

/// Check if a specific mod ID should be blocked
#[tauri::command]
pub async fn is_mod_id_blocked(mod_id: String) -> Result<bool, CommandError> {
    debug!("Command called: is_mod_id_blocked for: {}", mod_id);

    let storage = get_blocked_mods_config_storage().await;
    let config_guard = storage.read().await;
    
    let is_blocked = config_guard.mod_ids.contains(&mod_id);
    
    if is_blocked {
        debug!("Mod ID '{}' is blocked", mod_id);
    } else {
        debug!("Mod ID '{}' is not blocked", mod_id);
    }

    debug!("Command completed: is_mod_id_blocked");
    Ok(is_blocked)
}

/// Check if a specific Modrinth project ID should be blocked
#[tauri::command]
pub async fn is_modrinth_project_id_blocked(project_id: String) -> Result<bool, CommandError> {
    debug!("Command called: is_modrinth_project_id_blocked for: {}", project_id);

    let storage = get_blocked_mods_config_storage().await;
    let config_guard = storage.read().await;
    
    let is_blocked = config_guard.modrinth_project_ids.contains(&project_id);
    
    if is_blocked {
        debug!("Modrinth project ID '{}' is blocked", project_id);
    } else {
        debug!("Modrinth project ID '{}' is not blocked", project_id);
    }

    debug!("Command completed: is_modrinth_project_id_blocked");
    Ok(is_blocked)
}

/// Refresh the blocked mods configuration from Flagsmith
/// This is called by the frontend to trigger a background refresh
#[tauri::command]
pub async fn refresh_blocked_mods_config() -> Result<(), CommandError> {
    debug!("Command called: refresh_blocked_mods_config");
    
    // This command serves as a trigger for the frontend to know that
    // it should fetch the latest config from Flagsmith and then call
    // set_blocked_mods_config with the updated data
    
    info!("Blocked mods config refresh triggered - frontend should update the configuration");
    debug!("Command completed: refresh_blocked_mods_config");
    Ok(())
}

// Note: Removed matches_pattern function - now using regex directly 