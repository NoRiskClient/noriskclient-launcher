use crate::commands::file_command; // Added import for file_command
use crate::error::{AppError, CommandError};
use crate::integrations::modrinth::ModrinthVersion; // Added for new payload
use crate::state::profile_state::ModSource;
use crate::state::state_manager::State as AppStateManager;
use crate::utils::datapack_utils::DataPackInfo;
use crate::utils::hash_utils; // For calculate_sha1
use crate::utils::profile_utils::GenericModrinthInfo; // Already there or similar
use crate::utils::resourcepack_utils::ResourcePackInfo;
use crate::utils::shaderpack_utils::ShaderPackInfo;
use crate::utils::{datapack_utils, profile_utils, resourcepack_utils, shaderpack_utils};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri_plugin_fs::FilePath;
use tokio::fs;
use tokio::sync::Semaphore;
use uuid::Uuid;

// Updated InstallContentPayload struct
#[derive(Serialize, Deserialize, Debug)]
pub struct InstallContentPayload {
    profile_id: Uuid,
    project_id: String,
    version_id: String,
    file_name: String,
    download_url: String,
    file_hash_sha1: Option<String>,
    content_name: Option<String>, // Used as mod_name for mods
    version_number: Option<String>,
    content_type: profile_utils::ContentType, // Use ContentType from profile_utils
    loaders: Option<Vec<String>>,             // Added loaders
    game_versions: Option<Vec<String>>,       // Added game_versions
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UninstallContentPayload {
    profile_id: Uuid,
    sha1_hash: Option<String>,
    file_path: Option<String>,
    content_type: Option<profile_utils::ContentType>, // Added content_type
                                                      // Add other parameters here later if needed, e.g., content_type (mod, resourcepack, etc.)
}

async fn uninstall_content_by_sha1_internal(
    profile_id: Uuid,
    sha1_to_delete: &str,
    state_manager: &Arc<AppStateManager>,
    content_type: Option<profile_utils::ContentType>, // Added content_type parameter
) -> crate::error::Result<(usize, usize, bool, bool)> {
    let profile = state_manager
        .profile_manager
        .get_profile(profile_id)
        .await?;

    // Part 1: Remove Modrinth mod entries
    let mut mod_ids_to_remove: Vec<Uuid> = Vec::new();
    for mod_entry in &profile.mods {
        if let ModSource::Modrinth {
            file_hash_sha1: Some(mod_hash),
            ..
        } = &mod_entry.source
        {
            if mod_hash == sha1_to_delete {
                mod_ids_to_remove.push(mod_entry.id);
                log::debug!(
                    "Internal: Found Modrinth entry for deletion by SHA1: ID={}, ProfileID={}, SHA1={}",
                    mod_entry.id, profile_id, sha1_to_delete
                );
            }
        }
    }

    let mut mod_entries_deleted_count = 0;
    let mut mod_entry_deletion_errors_occurred = false;
    if !mod_ids_to_remove.is_empty() {
        for mod_id in mod_ids_to_remove {
            if let Err(e) = state_manager
                .profile_manager
                .delete_mod(profile_id, mod_id)
                .await
            {
                log::error!(
                    "Internal: Failed to remove Modrinth entry {} (SHA1: {}) from profile {}: {}",
                    mod_id,
                    sha1_to_delete,
                    profile_id,
                    e
                );
                mod_entry_deletion_errors_occurred = true;
            } else {
                mod_entries_deleted_count += 1;
            }
        }
    }

    // Part 2: Delete physical files from asset directories
    let mut asset_files_deleted_count = 0;
    let mut asset_file_deletion_errors_occurred = false;

    // Scan directories based on content type
    let should_scan_assets = true; // Always scan directories now

    if should_scan_assets {
        match state_manager
            .profile_manager
            .get_profile_instance_path(profile_id)
            .await
        {
            Ok(profile_instance_path) => {
                // Get profile mods path for local mods scanning
                let profile_mods_path = state_manager.profile_manager.get_profile_mods_path(&profile)?;
                
                let mut dirs_to_scan = vec![
                    ("shaderpacks", profile_instance_path.join("shaderpacks")),
                    ("resourcepacks", profile_instance_path.join("resourcepacks")), 
                    ("datapacks", profile_instance_path.join("datapacks")),
                    ("mods", profile_mods_path),
                    ("custom_mods", profile_instance_path.join("custom_mods")),
                ];

                // Filter directories based on content_type
                if let Some(ref ct) = content_type {
                    dirs_to_scan = match ct {
                        profile_utils::ContentType::Mod => dirs_to_scan.into_iter().filter(|(name, _)| name == &"mods" || name == &"custom_mods").collect(),
                        profile_utils::ContentType::ShaderPack => dirs_to_scan.into_iter().filter(|(name, _)| name == &"shaderpacks").collect(),
                        profile_utils::ContentType::ResourcePack => dirs_to_scan.into_iter().filter(|(name, _)| name == &"resourcepacks").collect(),
                        profile_utils::ContentType::DataPack => dirs_to_scan.into_iter().filter(|(name, _)| name == &"datapacks").collect(),
                        _ => dirs_to_scan, // NoRiskMod or others: scan all
                    };
                }

                for (dir_name, asset_dir_path) in dirs_to_scan {
                    if asset_dir_path.exists() && asset_dir_path.is_dir() {
                        match fs::read_dir(&asset_dir_path).await {
                            Ok(mut entries) => {
                                while let Some(entry_result) =
                                    entries.next_entry().await.map_err(AppError::Io)?
                                {
                                    let file_path = entry_result.path();
                                    if file_path.is_file() {
                                        match hash_utils::calculate_sha1(&file_path).await {
                                            Ok(file_sha1) => {
                                                if file_sha1 == sha1_to_delete {
                                                    if let Err(e) = fs::remove_file(&file_path).await {
                                                        log::error!("Internal: Failed to delete asset file {:?}: {}", file_path, e);
                                                        asset_file_deletion_errors_occurred = true;
                                                    } else {
                                                        asset_files_deleted_count += 1;
                                                    }
                                                }
                                            }
                                            Err(e) => log::warn!("Internal: Could not calculate SHA1 for asset file {:?}: {}. Skipping deletion.", file_path, e),
                                        }
                                    }
                                }
                            }
                            Err(e) => log::warn!(
                                "Internal: Could not read asset directory {:?}: {}. Skipping.",
                                asset_dir_path,
                                e
                            ),
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("Internal: Failed to get profile instance path for {} to scan asset dirs: {}. Asset file deletion will be skipped.", profile_id, e);
                asset_file_deletion_errors_occurred = true;
            }
        }
    }
    Ok((
        mod_entries_deleted_count,
        asset_files_deleted_count,
        mod_entry_deletion_errors_occurred,
        asset_file_deletion_errors_occurred,
    ))
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ToggleContentPayload {
    profile_id: Uuid,
    sha1_hash: Option<String>,
    file_path: Option<String>,
    enabled: bool,
    norisk_mod_identifier: Option<crate::state::profile_state::NoriskModIdentifier>,
    content_type: Option<profile_utils::ContentType>, // Added for targeted toggling
}

/// Helper function to toggle a single asset file (shader, resourcepack, datapack)
async fn toggle_single_asset_file(
    asset_path_str: &str,
    asset_filename_str: &str, // Base name, e.g., "coolpack.zip"
    asset_is_disabled: bool,
    target_enabled_state: bool,
    asset_type_name: &str, // For logging, e.g., "shader pack"
) -> Result<(), AppError> {
    let asset_path = PathBuf::from(asset_path_str);
    log::debug!(
        "Processing {} to toggle: {:?} (current_disabled: {}, target_enabled: {}).",
        asset_type_name,
        asset_path,
        asset_is_disabled,
        target_enabled_state
    );

    // If current disabled state is the inverse of target enabled state, it's already correct.
    // e.g., asset_is_disabled = true, target_enabled_state = false -> already disabled
    // e.g., asset_is_disabled = false, target_enabled_state = true -> already enabled
    if asset_is_disabled == !target_enabled_state {
        log::info!(
            "{} {:?} is already in the desired state (enabled: {}).",
            asset_type_name,
            asset_path,
            target_enabled_state
        );
        return Ok(()); // Already in desired state
    }

    let new_path = if target_enabled_state {
        // To enable: ensure filename does NOT end with .disabled
        // Use the base asset_filename_str. strip_suffix on it is for robustness if it somehow had .disabled
        asset_path.with_file_name(
            asset_filename_str
                .strip_suffix(".disabled")
                .unwrap_or(asset_filename_str),
        )
    } else {
        // To disable: ensure filename DOES end with .disabled
        asset_path.with_file_name(format!("{}.disabled", asset_filename_str))
    };

    log::info!(
        "Toggling {}: {:?} -> {:?}",
        asset_type_name,
        asset_path,
        new_path
    );

    fs::rename(&asset_path, &new_path).await.map_err(|e| {
        log::error!(
            "Failed to toggle {} {:?}: {}",
            asset_type_name,
            asset_path,
            e
        );
        AppError::Io(e) // Or a more specific error type if created
    })
}

#[tauri::command]
pub async fn toggle_content_from_profile(
    payload: ToggleContentPayload,
) -> Result<(), CommandError> {
    log::info!(
        "Attempting to toggle content state: profile_id={}, sha1_hash={:?}, file_path={:?}, enabled={}, norisk_mod_identifier={:?}, content_type={:?}",
        payload.profile_id,
        payload.sha1_hash,
        payload.file_path,
        payload.enabled,
        payload.norisk_mod_identifier,
        payload.content_type
    );

    // New: Prioritize file_path based toggling for non-Mod content types
    if let Some(ref path_str) = payload.file_path {
        log::info!(
            "Toggling content via direct file path: {} to enabled={}",
            path_str,
            payload.enabled
        );
        return file_command::set_file_enabled(path_str.clone(), payload.enabled).await;
    }

    let state_manager = AppStateManager::get().await.map_err(|e| {
        log::error!("Failed to get AppStateManager: {}", e);
        CommandError::from(AppError::Other(format!(
            "Failed to get internal state: {}",
            e
        )))
    })?;

    // Handle NoRisk Pack item toggling if the identifier is provided
    if let Some(norisk_mod_identifier) = payload.norisk_mod_identifier {
        log::info!(
            "Toggling NoRisk Pack item state: profile={}, pack={}, mod={}, disabled={}",
            payload.profile_id,
            norisk_mod_identifier.pack_id,
            norisk_mod_identifier.mod_id,
            !payload.enabled
        );

        // Clone the fields needed for logging
        let pack_id = norisk_mod_identifier.pack_id.clone();
        let mod_id = norisk_mod_identifier.mod_id.clone();

        // Call set_norisk_mod_status with the appropriate parameters
        match state_manager
            .profile_manager
            .set_norisk_mod_status(
                payload.profile_id,
                norisk_mod_identifier.pack_id,
                norisk_mod_identifier.mod_id,
                norisk_mod_identifier.game_version,
                norisk_mod_identifier.loader,
                !payload.enabled, // Note: disabled = !enabled
            )
            .await
        {
            Ok(_) => {
                log::info!(
                    "Successfully toggled NoRisk Pack item state for pack_id={}, mod_id={} to enabled={}",
                    pack_id,
                    mod_id,
                    payload.enabled
                );
                return Ok(());
            }
            Err(e) => {
                log::error!("Failed to toggle NoRisk Pack item state: {}", e);
                return Err(CommandError::from(e));
            }
        }
    }

    // Continue with SHA1-based content toggling if not a NoRisk Pack item
    let current_sha1_hash = match payload.sha1_hash {
        Some(ref hash) => hash.clone(),
        None => {
            log::warn!("SHA1 hash is required for the current toggle implementation when not toggling a NoRisk Pack item.");
            return Err(CommandError::from(AppError::Other(
                "SHA1 hash is required for this toggle operation when not toggling a NoRisk Pack item.".to_string(),
            )));
        }
    };

    let profile = state_manager
        .profile_manager
        .get_profile(payload.profile_id)
        .await
        .map_err(CommandError::from)?;

    let mut mod_entries_toggled_count = 0;
    let mut mod_entry_toggle_errors = false;
    let mut asset_files_toggled_count = 0;
    let mut asset_file_toggle_errors = false;

    // --- Phase 1: Toggle Modrinth Mod Entries (in profile.mods list) ---
    // Always check mods if SHA1 is provided, as it's a primary place for managed content.
    // If content_type is explicitly Mod, we'd primarily expect a hit here.
    // If content_type is an asset, a mod might still share a SHA1 if manually placed or due to other reasons.
    for mod_entry in profile.mods.iter() {
        if let ModSource::Modrinth {
            file_hash_sha1: Some(mod_hash),
            ..
        } = &mod_entry.source
        {
            if mod_hash == &current_sha1_hash {
                if mod_entry.enabled == payload.enabled {
                    log::info!("Mod entry {} in profile {} is already state enabled={}. Skipping DB update.", mod_entry.id, payload.profile_id, payload.enabled);
                    mod_entries_toggled_count += 1; // Count as processed even if no change needed
                    continue;
                }
                match state_manager
                    .profile_manager
                    .set_mod_enabled(payload.profile_id, mod_entry.id, payload.enabled)
                    .await
                {
                    Ok(_) => {
                        log::info!(
                            "Successfully toggled Modrinth entry {} in profile {} to enabled={}.",
                            mod_entry.id,
                            payload.profile_id,
                            payload.enabled
                        );
                        mod_entries_toggled_count += 1;
                    }
                    Err(e) => {
                        log::error!(
                            "Failed to toggle Modrinth entry {} (SHA1: {}) in profile {}: {}",
                            mod_entry.id,
                            current_sha1_hash,
                            payload.profile_id,
                            e
                        );
                        mod_entry_toggle_errors = true;
                    }
                }
            }
        }
    }

    // --- Phase 2: Toggle Asset Files (ShaderPacks, ResourcePacks, DataPacks) ---
    // Only proceed with asset file toggling if a specific asset content_type is given,
    // or if content_type is None (in which case, for safety, we might scan all - though for optimization, we avoid this if possible).
    // For this optimization: if content_type is Some(AssetType), only scan that type.
    // If content_type is Some(Mod) or None, and a mod was already toggled above, we might stop to avoid asset scans.
    // However, if a mod was NOT found by SHA1, and type is None, we might fall back to scanning assets.
    //
    // Revised logic for Phase 2:
    // Only enter this phase if payload.content_type targets an asset type.
    match payload.content_type {
        Some(profile_utils::ContentType::ShaderPack) => {
            log::debug!(
                "Targeted toggle for ShaderPacks with SHA1: {}",
                current_sha1_hash
            );
            match shaderpack_utils::get_shaderpacks_for_profile(&profile, true, true).await {
                Ok(shader_packs) => {
                    for pack_info in shader_packs {
                        if pack_info.sha1_hash.as_deref() == Some(&current_sha1_hash) {
                            match toggle_single_asset_file(
                                &pack_info.path,
                                &pack_info.filename,
                                pack_info.is_disabled,
                                payload.enabled,
                                "shader pack",
                            )
                            .await
                            {
                                Ok(_) => asset_files_toggled_count += 1,
                                Err(_) => asset_file_toggle_errors = true,
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!(
                        "Failed to list shader packs for profile {}: {}. Skipping shader toggle.",
                        payload.profile_id,
                        e
                    );
                    asset_file_toggle_errors = true;
                }
            }
        }
        Some(profile_utils::ContentType::ResourcePack) => {
            log::debug!(
                "Targeted toggle for ResourcePacks with SHA1: {}",
                current_sha1_hash
            );
            match resourcepack_utils::get_resourcepacks_for_profile(&profile, true, false).await {
                Ok(resource_packs) => {
                    for pack_info in resource_packs {
                        if pack_info.sha1_hash.as_deref() == Some(&current_sha1_hash) {
                            match toggle_single_asset_file(
                                &pack_info.path,
                                &pack_info.filename,
                                pack_info.is_disabled,
                                payload.enabled,
                                "resource pack",
                            )
                            .await
                            {
                                Ok(_) => asset_files_toggled_count += 1,
                                Err(_) => asset_file_toggle_errors = true,
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("Failed to list resource packs for profile {}: {}. Skipping resource pack toggle.", payload.profile_id, e);
                    asset_file_toggle_errors = true;
                }
            }
        }
        Some(profile_utils::ContentType::DataPack) => {
            log::debug!(
                "Targeted toggle for DataPacks with SHA1: {}",
                current_sha1_hash
            );
            match datapack_utils::get_datapacks_for_profile(&profile, true, true).await {
                Ok(data_packs) => {
                    for pack_info in data_packs {
                        if pack_info.sha1_hash.as_deref() == Some(&current_sha1_hash) {
                            match toggle_single_asset_file(
                                &pack_info.path,
                                &pack_info.filename,
                                pack_info.is_disabled,
                                payload.enabled,
                                "datapack",
                            )
                            .await
                            {
                                Ok(_) => asset_files_toggled_count += 1,
                                Err(_) => asset_file_toggle_errors = true,
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!(
                        "Failed to list datapacks for profile {}: {}. Skipping datapack toggle.",
                        payload.profile_id,
                        e
                    );
                    asset_file_toggle_errors = true;
                }
            }
        }
        Some(profile_utils::ContentType::Mod) => {
            log::debug!("Targeted toggle for Mods with SHA1: {}", current_sha1_hash);
            // Check local mod files if no profile mod was toggled
            if mod_entries_toggled_count == 0 {
                match profile_utils::LocalContentLoader::load_items(profile_utils::LoadItemsParams {
                    profile_id: profile.id,
                    content_type: profile_utils::ContentType::Mod,
                    calculate_hashes: true,
                    fetch_modrinth_data: false, // Don't need Modrinth data for toggling
                }).await {
                    Ok(local_mods) => {
                        for mod_item in local_mods {
                            if mod_item.sha1_hash.as_deref() == Some(&current_sha1_hash) {
                                match toggle_single_asset_file(
                                    &mod_item.path_str,
                                    &mod_item.filename,
                                    mod_item.is_disabled,
                                    payload.enabled,
                                    "mod",
                                ).await {
                                    Ok(_) => asset_files_toggled_count += 1,
                                    Err(_) => asset_file_toggle_errors = true,
                                }
                            }
                        }
                    }
                    Err(e) => {
                        log::error!(
                            "Failed to list local mods for profile {}: {}. Skipping local mod toggle.",
                            payload.profile_id, e
                        );
                        asset_file_toggle_errors = true;
                    }
                }
            }
        }
        Some(profile_utils::ContentType::NoRiskMod) => {
            log::debug!(
                "Targeted toggle for NoRiskMod with SHA1: {}",
                current_sha1_hash
            );
            // NoRiskMods are handled differently, not by scanning directories
            // We don't need to scan any asset types for NoRiskMods
            // We'll handle this in the future if needed
        }
        None => {
            // ContentType is None. This case is tricky for optimization.
            // Current "safe" behavior without content_type was to scan all.
            // For this optimization, if mods were checked (Phase 1) and nothing was found,
            // and no specific asset type was given, we might log a warning or error.
            // If a mod WAS found and toggled in Phase 1, we likely don't need to scan assets.
            // However, if a mod was NOT found and no content type was given, we might log a warning or error.
            if mod_entries_toggled_count > 0 {
                log::debug!("ContentType is None, but a mod was found and toggled by SHA1. Skipping asset scans.");
            } else {
                // No mod found by SHA1, and no content type specified.
                // This implies the SHA1 might belong to an unmanaged asset or an asset whose type isn't known by the frontend.
                // To maintain previous exhaustive behavior (at the cost of performance for this specific call),
                // one *could* scan all asset types here as a fallback.
                // However, for the purpose of this specific optimization task, if type is None and no mod matched,
                // we'll assume the frontend should have provided a type if it was an asset.
                // For now, we'll log and the final check will determine if an error is returned.
                log::warn!(
                    "ContentType is None and no Modrinth entry found with SHA1 '{}'. \
                    For targeted asset toggling, provide content_type. \
                    No asset folders will be scanned in this specific optimized path if a mod wasn't found.",
                    current_sha1_hash
                );
            }
        }
    }

    // --- Datapacks: Toggling not yet implemented by SHA1, as they are often not single files with clear SHA1s from Modrinth directly in profile list ---
    // Future: Could scan datapacks directory if needed, similar to uninstall, but toggling implies individual file identity.

    if mod_entries_toggled_count == 0 && asset_files_toggled_count == 0 {
        log::warn!(
            "No Modrinth entries, shader packs, resource packs, or datapacks found with SHA1 '{}' in profile {} to toggle.",
            current_sha1_hash, payload.profile_id
        );
        return Err(CommandError::from(AppError::Other(format!(
            "No content with SHA1 '{}' found in profile {} to toggle (mods, shaders, resourcepacks, datapacks).",
            current_sha1_hash, payload.profile_id
        ))));
    }

    if mod_entry_toggle_errors || asset_file_toggle_errors {
        log::error!(
            "One or more errors occurred while toggling content for SHA1 '{}' in profile {}. ModToggleOK: {}, AssetToggleOK: {}. ModToggleErr: {}, AssetToggleErr: {}", 
            current_sha1_hash, payload.profile_id, 
            mod_entries_toggled_count > 0 && !mod_entry_toggle_errors, 
            asset_files_toggled_count > 0 && !asset_file_toggle_errors, 
            mod_entry_toggle_errors, asset_file_toggle_errors
        );
        return Err(CommandError::from(AppError::Other(format!(
            "Errors occurred while toggling content for profile {}. Check logs.",
            payload.profile_id
        ))));
    }

    log::info!(
        "Content toggle for SHA1 '{}' in profile {} processed. Modrinth entries processed: {}. Asset files (shaders, rpacks, datapacks) processed: {}.", 
        current_sha1_hash, payload.profile_id, mod_entries_toggled_count, asset_files_toggled_count
    );
    Ok(())
}

#[tauri::command]
pub async fn uninstall_content_from_profile(
    payload: UninstallContentPayload,
) -> Result<(), CommandError> {
    log::info!(
        "Uninstall command received: profile_id={}, sha1_hash={:?}, file_path={:?}",
        payload.profile_id,
        payload.sha1_hash,
        payload.file_path
    );

    let state_manager = AppStateManager::get().await.map_err(|e| {
        log::error!("Failed to get AppStateManager: {}", e);
        CommandError::from(AppError::Other(format!(
            "Failed to get internal state: {}",
            e
        )))
    })?;

    if let Some(path_to_delete) = payload.file_path {
        log::info!(
            "Proceeding with uninstallation by file_path: {}",
            path_to_delete
        );
        match file_command::delete_file(path_to_delete.clone()).await {
            Ok(_) => {
                log::info!(
                    "Successfully deleted file {} for profile {}",
                    path_to_delete,
                    payload.profile_id
                );
                // Optional: If custom mods deleted by path are also tracked in profile.mods
                // (e.g., as ModSource::Local with a matching path), you might want to
                // remove that entry here. This example assumes direct file deletion is sufficient
                // for items uninstalled via path.
                // Example: state_manager.profile_manager.remove_mod_by_path(payload.profile_id, &path_to_delete).await?;
                return Ok(()); // Successfully deleted by path
            }
            Err(e) => {
                log::error!(
                    "Failed to delete file {} for profile {}: {:?}",
                    path_to_delete,
                    payload.profile_id,
                    e
                );
                // Decide on error handling: return error directly or fall back to SHA1 if available?
                // For now, return error directly if path deletion fails.
                return Err(CommandError::from(e));
            }
        }
    } else if let Some(sha1_hash_to_delete) = payload.sha1_hash {
        log::info!(
            "Proceeding with uninstallation by SHA1: {}",
            sha1_hash_to_delete
        );

        match uninstall_content_by_sha1_internal(
            payload.profile_id,
            &sha1_hash_to_delete,
            &state_manager,
            payload.content_type,
        )
        .await
        {
            Ok((mod_count, asset_count, mod_errors, asset_errors)) => {
                if mod_count == 0 && asset_count == 0 {
                    log::warn!(
                        "No Modrinth entries or asset files found with SHA1 hash '{}' in profile {}.",
                        sha1_hash_to_delete, payload.profile_id
                    );
                    return Err(CommandError::from(AppError::Other(format!(
                        "No content found with SHA1 hash '{}' for profile {}.",
                        sha1_hash_to_delete, payload.profile_id
                    ))));
                }
                if mod_errors || asset_errors {
                    log::error!(
                        "One or more errors occurred during SHA1 uninstallation for profile {}. ModOK: {}, AssetOK: {}. ModErr: {}, AssetErr: {}", 
                        payload.profile_id, mod_count > 0 && !mod_errors, asset_count > 0 && !asset_errors, mod_errors, asset_errors
                    );
                    return Err(CommandError::from(AppError::Other(format!(
                        "Errors occurred while uninstalling content by SHA1 for profile {}. Check logs.",
                        payload.profile_id
                    ))));
                }
                log::info!(
                    "SHA1 uninstallation for profile {} completed. Mod entries removed: {}. Asset files removed: {}.", 
                    payload.profile_id, mod_count, asset_count
                );
                Ok(())
            }
            Err(e) => {
                log::error!(
                    "Error during SHA1 uninstallation for profile {}: {}",
                    payload.profile_id,
                    e
                );
                Err(CommandError::from(e))
            }
        }
    } else {
        // Handle other uninstall criteria in the future or return error
        log::warn!("No SHA1 hash or file_path provided and no other uninstall criteria met for profile {}.", payload.profile_id);
        Err(CommandError::from(AppError::Other(
            "No valid uninstallation criteria provided.".to_string(),
        )))
    }
}

#[tauri::command]
pub async fn install_content_to_profile(
    payload: InstallContentPayload,
) -> Result<(), CommandError> {
    log::info!(
        "Executing install_content_to_profile for profile {} with content type {:?}",
        payload.profile_id,
        payload.content_type
    );

    match payload.content_type {
        profile_utils::ContentType::Mod => {
            log::info!(
                "Attempting to install mod using profile_command::add_modrinth_mod_to_profile"
            );
            crate::commands::profile_command::add_modrinth_mod_to_profile(
                payload.profile_id,
                payload.project_id,
                payload.version_id,
                payload.file_name,
                payload.download_url,
                payload.file_hash_sha1,
                payload.content_name, // Maps to mod_name
                payload.version_number,
                payload.loaders,       // Pass loaders
                payload.game_versions, // Pass game_versions
            )
            .await
        }
        profile_utils::ContentType::ResourcePack => profile_utils::add_modrinth_content_to_profile(
            payload.profile_id,
            payload.project_id,
            payload.version_id,
            payload.file_name,
            payload.download_url,
            payload.file_hash_sha1,
            payload.content_name,
            payload.version_number,
            profile_utils::ContentType::ResourcePack,
        )
        .await
        .map_err(CommandError::from),
        profile_utils::ContentType::ShaderPack => profile_utils::add_modrinth_content_to_profile(
            payload.profile_id,
            payload.project_id,
            payload.version_id,
            payload.file_name,
            payload.download_url,
            payload.file_hash_sha1,
            payload.content_name,
            payload.version_number,
            profile_utils::ContentType::ShaderPack,
        )
        .await
        .map_err(CommandError::from),
        profile_utils::ContentType::DataPack => profile_utils::add_modrinth_content_to_profile(
            payload.profile_id,
            payload.project_id,
            payload.version_id,
            payload.file_name,
            payload.download_url,
            payload.file_hash_sha1,
            payload.content_name,
            payload.version_number,
            profile_utils::ContentType::DataPack,
        )
        .await
        .map_err(CommandError::from),
        _ => {
            log::error!("Unsupported content type: {:?}", payload.content_type);
            Err(CommandError::from(AppError::Other(
                "Unsupported content type".to_string(),
            )))
        } // No default needed as ContentType from profile_utils is an enum and all variants are handled
    }
}

// --- New Struct and Command for Installing Local Content (e.g., JARs) ---

#[derive(Serialize, Deserialize, Debug)]
pub struct InstallLocalContentPayload {
    profile_id: Uuid,
    file_paths: Vec<String>,
    content_type: profile_utils::ContentType, // Added content_type field
}

#[tauri::command]
pub async fn install_local_content_to_profile(
    payload: InstallLocalContentPayload,
) -> Result<(), CommandError> {
    log::info!(
        "Executing install_local_content_to_profile for profile {} with {} file paths and content type {:?}.",
        payload.profile_id,
        payload.file_paths.len(),
        payload.content_type
    );

    let state_manager = AppStateManager::get().await?;

    match payload.content_type {
        profile_utils::ContentType::Mod => {
            log::info!(
                "Processing local file installation as Mod for profile {}.",
                payload.profile_id
            );
            let jar_file_paths_str: Vec<String> = payload
                .file_paths
                .into_iter()
                .filter(|path_str| {
                    let lower_path = path_str.to_lowercase();
                    lower_path.ends_with(".jar") || lower_path.ends_with(".jar.disabled")
                })
                .collect();

            if jar_file_paths_str.is_empty() {
                log::info!("No .jar or .jar.disabled files found in the provided paths for profile {} to import as Mod.", payload.profile_id);
                return Ok(()); // No compatible files to process for Mod type
            }

            log::info!(
                "Found {} .jar or .jar.disabled files from input to import as Mod for profile {}.",
                jar_file_paths_str.len(),
                payload.profile_id
            );

            let tauri_file_paths: Vec<tauri_plugin_fs::FilePath> = jar_file_paths_str
                .iter()
                .map(|path_str| tauri_plugin_fs::FilePath::Path(PathBuf::from(path_str)))
                .collect();

            state_manager
                .profile_manager
                .import_local_mods_to_profile(payload.profile_id, tauri_file_paths)
                .await?;
            log::info!(
                "Successfully processed local Mod(s) import for profile {}.",
                payload.profile_id
            );
        }
        profile_utils::ContentType::ResourcePack
        | profile_utils::ContentType::ShaderPack
        | profile_utils::ContentType::DataPack => {
            log::info!(
                "Processing local file installation as {:?} for profile {}.",
                payload.content_type,
                payload.profile_id
            );
            let profile_instance_path = state_manager
                .profile_manager
                .get_profile_instance_path(payload.profile_id)
                .await?;

            let target_subdir_name = match payload.content_type {
                profile_utils::ContentType::ResourcePack => "resourcepacks",
                profile_utils::ContentType::ShaderPack => "shaderpacks",
                profile_utils::ContentType::DataPack => "datapacks",
                _ => unreachable!(), // Already matched by outer arm
            };

            let target_dir = profile_instance_path.join(target_subdir_name);
            if !target_dir.exists() {
                fs::create_dir_all(&target_dir)
                    .await
                    .map_err(AppError::Io)?;
                log::info!("Created directory: {:?}", target_dir);
            }

            let mut files_skipped_pre_copy = 0;
            let mut copy_tasks = Vec::new();
            let io_semaphore = state_manager.io_semaphore.clone(); // Clone Arc<Semaphore>

            for path_str in payload.file_paths {
                let source_path = PathBuf::from(&path_str);

                if !source_path.is_file() {
                    log::warn!(
                        "Provided path '{:?}' is not a file or does not exist. Skipping.",
                        source_path
                    );
                    files_skipped_pre_copy += 1;
                    continue;
                }

                let file_name = match source_path.file_name() {
                    Some(name) => name.to_os_string(), // Keep as OsString for PathBuf::join
                    None => {
                        log::error!(
                            "Could not get file name for path: '{}'. Skipping.",
                            path_str
                        );
                        files_skipped_pre_copy += 1;
                        continue;
                    }
                };
                let dest_path = target_dir.join(&file_name);

                if dest_path.exists() {
                    log::warn!(
                        "File {:?} already exists in target directory {:?}. Skipping copy.",
                        dest_path,
                        target_dir
                    );
                    files_skipped_pre_copy += 1;
                    continue;
                }

                // Acquire permit before spawning the task
                let permit = match io_semaphore.clone().acquire_owned().await {
                    Ok(p) => p,
                    Err(_) => {
                        // Semaphore closed error
                        log::error!("Failed to acquire semaphore permit as it might be closed. Halting further copy tasks.");
                        return Err(CommandError::from(AppError::Other(
                            "IO Semaphore closed, cannot proceed with file copies.".to_string(),
                        )));
                    }
                };

                let current_source_path = source_path.clone();
                let current_dest_path = dest_path.clone();

                copy_tasks.push(tokio::spawn(async move {
                    let _permit_guard = permit; // Permit is moved into the task and dropped when the task finishes.

                    match fs::copy(&current_source_path, &current_dest_path).await {
                        Ok(_) => {
                            log::info!(
                                "Copied local content file {:?} to {:?}",
                                current_source_path,
                                current_dest_path
                            );
                            Ok(current_dest_path) // Return Ok(dest_path) for logging or tracking
                        }
                        Err(e) => {
                            log::error!(
                                "Failed to copy file {:?} to {:?}: {}",
                                current_source_path,
                                current_dest_path,
                                e
                            );
                            Err(AppError::Io(e)) // Propagate the specific error
                        }
                    }
                }));
            }

            let mut successful_copies = 0;
            let mut failed_copies = 0;
            let mut task_results = Vec::new();

            for task_handle in copy_tasks {
                match task_handle.await {
                    // This handles JoinError (task panicked)
                    Ok(Ok(copied_path)) => {
                        // Task completed, fs::copy was Ok
                        task_results.push(Ok(copied_path));
                        successful_copies += 1;
                    }
                    Ok(Err(app_err)) => {
                        // Task completed, fs::copy returned an AppError
                        task_results.push(Err(app_err));
                        failed_copies += 1;
                    }
                    Err(join_err) => {
                        // Task panicked or was cancelled
                        log::error!("A copy task panicked or was cancelled: {}", join_err);
                        task_results.push(Err(AppError::Other(format!(
                            "Copy task failed: {}",
                            join_err
                        ))));
                        failed_copies += 1;
                    }
                }
            }

            log::info!(
                "Finished copy operations for {:?}. Successful copies: {}. Failed copies: {}. Skipped pre-copy: {}. Profile: {}.",
                payload.content_type, successful_copies, failed_copies, files_skipped_pre_copy, payload.profile_id
            );

            if failed_copies > 0 {
                let error_messages: Vec<String> = task_results
                    .iter()
                    .filter_map(|r| r.as_ref().err().map(|e| e.to_string()))
                    .collect();
                return Err(CommandError::from(AppError::Other(format!(
                    "{} file(s) failed to copy for profile {}. Errors: [{}]",
                    failed_copies,
                    payload.profile_id,
                    error_messages.join("; ")
                ))));
            }
        }
        profile_utils::ContentType::NoRiskMod => {
            log::error!(
                "ContentType::NoRiskMod is not supported for local installation via this command. Profile: {}",
                payload.profile_id
            );
            return Err(CommandError::from(AppError::Other(
                "Local installation of NoRiskMod content type is not supported.".to_string(),
            )));
        }
        // Handle any other ContentType variants not explicitly covered, if any exist or are added later.
        _ => {
            log::warn!(
                "Local installation for content type {:?} is not yet implemented for profile {}.",
                payload.content_type,
                payload.profile_id
            );
            return Err(CommandError::from(AppError::Other(format!(
                "Local installation for content type {:?} is not yet implemented.",
                payload.content_type
            ))));
        }
    }

    // Emit event to trigger UI update for this profile, so the frontend can refresh.
    if let Err(e) = state_manager
        .event_state
        .trigger_profile_update(payload.profile_id)
        .await
    {
        log::error!(
            "Failed to emit TriggerProfileUpdate event for profile {} after local content install: {}",
            payload.profile_id,
            e
        );
        // Do not fail the entire command if event emission fails, log and continue.
    }

    log::info!(
        "Successfully processed request to install local content (JARs) for profile {}.",
        payload.profile_id
    );
    Ok(())
}

// --- New Struct and Command for Switching Content Version ---

#[derive(Serialize, Deserialize, Debug)]
pub struct SwitchContentVersionPayload {
    profile_id: Uuid,
    content_type: profile_utils::ContentType,
    current_item_details: Option<profile_utils::LocalContentItem>, // Pass the whole item
    new_modrinth_version_details: Option<ModrinthVersion>, // Full details of the new version
}

#[tauri::command]
pub async fn switch_content_version(
    payload: SwitchContentVersionPayload,
) -> Result<(), CommandError> {
    let new_version_details = payload.new_modrinth_version_details.ok_or_else(|| {
        AppError::InvalidInput("Missing new_modrinth_version_details in payload.".to_string())
    })?;

    let current_item = payload.current_item_details.ok_or_else(|| {
        AppError::InvalidInput("Missing current_item_details in payload.".to_string())
    })?;

    log::info!(
        "Attempting to switch content version for item '{}' (ContentType: {:?}, ID: {:?}) in profile {}",
        current_item.filename,
        payload.content_type, // Use content_type from top-level payload for clarity
        current_item.id,
        payload.profile_id
    );
    log::info!(
        "Switching to Modrinth version: Project_ID: {}, Version_ID: {}, Name: {}",
        new_version_details.project_id,
        new_version_details.id,
        new_version_details.name
    );

    let state_manager = AppStateManager::get().await?;

    match payload.content_type {
        // Use payload.content_type here
        profile_utils::ContentType::Mod => {
            if let Some(mod_id_str) = current_item.id.clone() {
                // Managed Modrinth mod entry update by ID
                let mod_id_to_update = Uuid::parse_str(&mod_id_str).map_err(|_| {
                    AppError::InvalidInput(format!("Invalid Uuid format for mod id: {}", mod_id_str))
                })?;

                log::info!(
                    "Proceeding with version switch for mod ID: {}. New version: {}",
                    mod_id_to_update,
                    new_version_details.id
                );
                state_manager
                    .profile_manager
                    .update_profile_modrinth_mod_version(
                        payload.profile_id,
                        mod_id_to_update,
                        &new_version_details,
                    )
                    .await
                    .map_err(CommandError::from)
            } else {
                // Local/custom mod file: replace the JAR in-place using the selected Modrinth version
                use std::path::PathBuf;
                use tokio::fs;

                let primary_file = new_version_details
                    .files
                    .iter()
                    .find(|f| f.primary)
                    .or_else(|| new_version_details.files.first())
                    .ok_or_else(|| AppError::InvalidInput("Selected version has no files".to_string()))?;

                let current_path = PathBuf::from(&current_item.path_str);
                let dir = current_path
                    .parent()
                    .ok_or_else(|| AppError::InvalidInput("Invalid current item path".to_string()))?;

                let target_path = dir.join(&primary_file.filename);

                // Ensure directory exists
                fs::create_dir_all(dir).await.map_err(AppError::Io).map_err(CommandError::from)?;

                // Download to a temp path then atomically replace
                let tmp_path = target_path.with_extension("jar.nrc_tmp");
                let mut config = crate::utils::download_utils::DownloadConfig::new()
                    .with_streaming(true);
                if let Some(sha1) = &primary_file.hashes.sha1 {
                    config = config.with_sha1(sha1);
                }
                crate::utils::download_utils::DownloadUtils::download_file(
                    &primary_file.url,
                    &tmp_path,
                    config,
                )
                .await
                .map_err(CommandError::from)?;

                // Remove old file if it exists (either enabled or disabled variant)
                if current_path.exists() {
                    let _ = fs::remove_file(&current_path).await; // ignore errors
                }

                // Move tmp -> target
                fs::rename(&tmp_path, &target_path)
                    .await
                    .map_err(AppError::Io)
                    .map_err(CommandError::from)?;

                log::info!(
                    "Switched local/custom mod '{}' -> '{}'",
                    current_item.path_str,
                    target_path.to_string_lossy()
                );

                Ok(())
            }
        }
        profile_utils::ContentType::ResourcePack => {
            let profile = state_manager
                .profile_manager
                .get_profile(payload.profile_id)
                .await?;
            let rp_info = ResourcePackInfo {
                filename: current_item.filename,
                path: current_item.path_str, // path_str from LocalContentItem
                sha1_hash: current_item.sha1_hash,
                file_size: current_item.file_size,
                is_disabled: current_item.is_disabled,
                modrinth_info: None, // The update util focuses on new_version_details
            };

            log::info!(
                "Switching ResourcePack version for file: {}",
                rp_info.filename
            );
            resourcepack_utils::update_resourcepack_from_modrinth(
                &profile,
                &rp_info,
                &new_version_details,
            )
            .await
            .map_err(CommandError::from)
        }
        profile_utils::ContentType::ShaderPack => {
            let profile = state_manager
                .profile_manager
                .get_profile(payload.profile_id)
                .await?;
            let sp_info = ShaderPackInfo {
                filename: current_item.filename,
                path: current_item.path_str,
                sha1_hash: current_item.sha1_hash,
                file_size: current_item.file_size,
                is_disabled: current_item.is_disabled,
                modrinth_info: None,
            };

            log::info!(
                "Switching ShaderPack version for file: {}",
                sp_info.filename
            );
            shaderpack_utils::update_shaderpack_from_modrinth(
                &profile,
                &sp_info,
                &new_version_details,
            )
            .await
            .map_err(CommandError::from)
        }
        profile_utils::ContentType::DataPack => {
            let profile = state_manager
                .profile_manager
                .get_profile(payload.profile_id)
                .await?;
            let dp_info = DataPackInfo {
                filename: current_item.filename,
                path: current_item.path_str,
                sha1_hash: current_item.sha1_hash,
                file_size: current_item.file_size,
                is_disabled: current_item.is_disabled,
                modrinth_info: None,
            };

            log::info!("Switching DataPack version for file: {}", dp_info.filename);
            datapack_utils::update_datapack_from_modrinth(&profile, &dp_info, &new_version_details)
                .await
                .map_err(CommandError::from)
        }
        profile_utils::ContentType::NoRiskMod => {
            log::error!("Switching version for NoRiskMod is not supported via this command.");
            Err(CommandError::from(AppError::InvalidOperation(
                "NoRiskMod versions are managed by pack configuration.".to_string(),
            )))
        }
    }
}
