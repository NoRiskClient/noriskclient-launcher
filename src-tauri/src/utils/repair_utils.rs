use crate::error::{AppError, Result};
use crate::state::state_manager::State;
use crate::state::profile_state::{ModSource, get_profile_mod_filename};
use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::integrations::norisk_packs;
use crate::utils::path_utils;
use log::{debug, info, warn};
use uuid::Uuid;
use tokio::fs;

const MOD_CACHE_DIR_NAME: &str = "mod_cache";

/// Repairs a profile by checking and fixing common issues
/// 
/// This function performs various repair operations on a profile including:
/// - Verifying and repairing file integrity
/// - Checking mod compatibility
/// - Fixing configuration issues
/// - Redownloading missing or corrupted files
///
/// # Arguments
///
/// * `profile_id` - The UUID of the profile to repair
///
/// # Returns
///
/// Returns `Ok(())` on successful repair, or `Err(AppError)` if repair fails
pub async fn repair_profile(profile_id: Uuid) -> Result<()> {
    info!("Starting repair process for profile {}", profile_id);

    // Get the profile and state
    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;

    debug!("Repairing profile: {} ({})", profile.name, profile.id);
    debug!("Game version: {}, Loader: {}", profile.game_version, profile.loader.as_str());

    // Call individual repair functions
    repair_profile_mods(profile_id).await?;
    
    info!("Profile repair completed successfully for profile {}", profile_id);
    Ok(())
}

/// Verifies the integrity of profile files
/// 
/// # Arguments
///
/// * `profile_id` - The UUID of the profile to verify
///
/// # Returns
///
/// Returns `Ok(())` if all files are valid, or `Err(AppError)` if issues are found
pub async fn verify_profile_integrity(profile_id: Uuid) -> Result<()> {
    info!("Verifying profile integrity for profile {}", profile_id);

    // TODO: Implement file integrity verification
    // - Check mod file hashes
    // - Verify configuration files
    // - Check for missing dependencies
    
    Ok(())
}

/// Repairs mod-related issues in a profile
/// 
/// # Arguments
///
/// * `profile_id` - The UUID of the profile to repair
///
/// # Returns
///
/// Returns `Ok(())` on successful mod repair, or `Err(AppError)` if repair fails
pub async fn repair_profile_mods(profile_id: Uuid) -> Result<()> {
    info!("Repairing mods for profile {}", profile_id);

    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;
    
    // 1. Delete the mods folder
    let mods_dir = state.profile_manager.get_profile_mods_path(&profile)?;
    if mods_dir.exists() {
        info!("Deleting mods directory: {:?}", mods_dir);
        fs::remove_dir_all(&mods_dir).await.map_err(|e| {
            warn!("Failed to delete mods directory {:?}: {}", mods_dir, e);
            AppError::Io(e)
        })?;
        info!("Successfully deleted mods directory");
    } else {
        debug!("Mods directory does not exist, skipping deletion: {:?}", mods_dir);
    }

    // 2. Delete mod files from mod cache (profile mods)
    let mod_cache_dir = LAUNCHER_DIRECTORY.meta_dir().join(MOD_CACHE_DIR_NAME);
    if mod_cache_dir.exists() {
        info!("Cleaning mod cache for profile {} mods", profile_id);
        
        let mut cache_files_removed = 0;
        let mut cache_errors = 0;
        
        for mod_info in &profile.mods {
            // Get the filename for this mod
            match get_profile_mod_filename(&mod_info.source) {
                Ok(filename) => {
                    let cache_file_path = mod_cache_dir.join(&filename);
                    if cache_file_path.exists() {
                        match fs::remove_file(&cache_file_path).await {
                            Ok(_) => {
                                debug!("Removed profile mod cache file: {}", filename);
                                cache_files_removed += 1;
                            }
                            Err(e) => {
                                warn!("Failed to remove profile mod cache file {}: {}", filename, e);
                                cache_errors += 1;
                            }
                        }
                    } else {
                        debug!("Profile mod cache file does not exist: {}", filename);
                    }
                }
                Err(e) => {
                    warn!("Could not determine filename for profile mod {:?}: {}", 
                          mod_info.display_name.as_deref().unwrap_or("unknown"), e);
                    cache_errors += 1;
                }
            }
        }

        // 3. Delete NoRisk pack mod files from cache
        if let Some(pack_id) = &profile.selected_norisk_pack_id {
            info!("Cleaning NoRisk pack mod cache for pack: {}", pack_id);
            
            let norisk_config = state.norisk_pack_manager.get_config().await;
            match norisk_config.get_resolved_pack_definition(pack_id) {
                Ok(resolved_pack) => {
                    for norisk_mod in &resolved_pack.mods {
                        // Get the cache path for this NoRisk mod
                        match path_utils::get_norisk_mod_cache_path(
                            norisk_mod,
                            &profile.game_version,
                            profile.loader.as_str(),
                        ) {
                            Ok(cache_path) => {
                                if cache_path.exists() {
                                    match fs::remove_file(&cache_path).await {
                                        Ok(_) => {
                                            debug!("Removed NoRisk pack mod cache file: {:?}", cache_path);
                                            cache_files_removed += 1;
                                        }
                                        Err(e) => {
                                            warn!("Failed to remove NoRisk pack mod cache file {:?}: {}", cache_path, e);
                                            cache_errors += 1;
                                        }
                                    }
                                } else {
                                    debug!("NoRisk pack mod cache file does not exist: {:?}", cache_path);
                                }
                            }
                            Err(e) => {
                                warn!("Could not determine cache path for NoRisk pack mod {}: {}", 
                                      norisk_mod.display_name.as_deref().unwrap_or(&norisk_mod.id), e);
                                cache_errors += 1;
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!("Failed to get NoRisk pack definition for {}: {}", pack_id, e);
                    cache_errors += 1;
                }
            }
        } else {
            debug!("Profile has no selected NoRisk pack, skipping NoRisk mod cache cleanup");
        }
        
        info!("Cache cleanup completed: {} files removed, {} errors", cache_files_removed, cache_errors);
    } else {
        debug!("Mod cache directory does not exist: {:?}", mod_cache_dir);
    }
    
    info!("Mod repair completed for profile {}", profile_id);
    Ok(())
}

/// Repairs configuration files for a profile
/// 
/// # Arguments
///
/// * `profile_id` - The UUID of the profile to repair
///
/// # Returns
///
/// Returns `Ok(())` on successful config repair, or `Err(AppError)` if repair fails
pub async fn repair_profile_config(profile_id: Uuid) -> Result<()> {
    info!("Repairing configuration for profile {}", profile_id);

    // TODO: Implement config repair logic
    // - Check for corrupted config files
    // - Reset to defaults if necessary
    // - Verify settings validity
    
    Ok(())
} 