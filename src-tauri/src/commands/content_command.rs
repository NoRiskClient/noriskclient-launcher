use crate::commands::file_command; // Added import for file_command
use crate::error::{AppError, CommandError};
use crate::integrations::modrinth::ModrinthVersion; // Added for new payload
use crate::integrations::curseforge::CurseForgeFile; // Added for CurseForge support
use crate::integrations::unified_mod::UnifiedVersion; // Added for unified version support
use crate::state::profile_state::ModSource;
use crate::integrations::unified_mod::ModPlatform; // Import unified ModPlatform
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
    pub profile_id: Uuid,
    pub project_id: String,
    pub version_id: String,
    pub file_name: String,
    pub download_url: String,
    pub file_hash_sha1: Option<String>,
    pub file_fingerprint: Option<u64>,           // CurseForge fingerprint for update checking
    pub content_name: Option<String>, // Used as mod_name for mods
    pub version_number: Option<String>,
    pub content_type: profile_utils::ContentType, // Use ContentType from profile_utils
    pub loaders: Option<Vec<String>>,             // Added loaders
    pub game_versions: Option<Vec<String>>,       // Added game_versions
    pub source: ModPlatform,                      // Added source to distinguish Modrinth/CurseForge
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

    // Part 1: Remove Modrinth and CurseForge mod entries
    let mut mod_ids_to_remove: Vec<Uuid> = Vec::new();
    for mod_entry in &profile.mods {
        match &mod_entry.source {
            ModSource::Modrinth {
                file_hash_sha1: Some(mod_hash),
                ..
            } => {
                if mod_hash == sha1_to_delete {
                    mod_ids_to_remove.push(mod_entry.id);
                    log::debug!(
                        "Internal: Found Modrinth entry for deletion by SHA1: ID={}, ProfileID={}, SHA1={}",
                        mod_entry.id, profile_id, sha1_to_delete
                    );
                }
            }
            ModSource::CurseForge {
                file_hash_sha1: Some(mod_hash),
                ..
            } => {
                if mod_hash == sha1_to_delete {
                    mod_ids_to_remove.push(mod_entry.id);
                    log::debug!(
                        "Internal: Found CurseForge entry for deletion by SHA1: ID={}, ProfileID={}, SHA1={}",
                        mod_entry.id, profile_id, sha1_to_delete
                    );
                }
            }
            _ => {
                // Skip other mod sources
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
                    "Internal: Failed to remove mod entry {} (SHA1: {}) from profile {}: {}",
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
                let mut dirs_to_scan: Vec<(&str, PathBuf)> = vec![
                    ("shaderpacks", profile_instance_path.join("shaderpacks")),
                    ("resourcepacks", profile_instance_path.join("resourcepacks")),
                    ("datapacks", profile_instance_path.join("datapacks")),
                ];
                for mods_dir in state_manager.profile_manager.mod_scan_dirs(&profile)? {
                    dirs_to_scan.push(("mods", mods_dir));
                }

                // Filter directories based on content_type
                if let Some(ref ct) = content_type {
                    dirs_to_scan = match ct {
                        profile_utils::ContentType::Mod => dirs_to_scan.into_iter().filter(|(name, _)| name == &"mods").collect(),
                        profile_utils::ContentType::ShaderPack => dirs_to_scan.into_iter().filter(|(name, _)| name == &"shaderpacks").collect(),
                        profile_utils::ContentType::ResourcePack => dirs_to_scan.into_iter().filter(|(name, _)| name == &"resourcepacks").collect(),
                        profile_utils::ContentType::DataPack => dirs_to_scan.into_iter().filter(|(name, _)| name == &"datapacks").collect(),
                        _ => dirs_to_scan, // NoRiskMod or others: scan all
                    };
                }

                for (_dir_name, asset_dir_path) in dirs_to_scan {
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

use crate::state::profile_state::NoriskModIdentifier;
use std::collections::{HashMap, HashSet};

#[derive(serde::Serialize, Debug, Default)]
pub struct BatchToggleResult {
    pub mods_changed: usize,
    pub norisk_changed: usize,
    pub files_changed: usize,
    pub failed: usize,
}

#[tauri::command]
pub async fn toggle_contents_from_profile(
    payloads: Vec<ToggleContentPayload>,
) -> Result<BatchToggleResult, CommandError> {
    let mut perf = crate::utils::perf_utils::Phase::start("toggle_contents_batch");
    let mut result = BatchToggleResult::default();
    if payloads.is_empty() {
        return Ok(result);
    }

    let state = AppStateManager::get().await.map_err(|e| {
        CommandError::from(AppError::Other(format!("Failed to get internal state: {}", e)))
    })?;

    let mut by_profile: HashMap<Uuid, (Vec<(Uuid, bool)>, Vec<(NoriskModIdentifier, bool)>)> =
        HashMap::new();
    let mut leftovers: Vec<ToggleContentPayload> = Vec::new();
    let mut mod_index: HashMap<Uuid, HashMap<String, Uuid>> = HashMap::new();

    for payload in payloads {
        if payload.file_path.is_some() {
            leftovers.push(payload);
            continue;
        }

        if let Some(identifier) = payload.norisk_mod_identifier.clone() {
            by_profile
                .entry(payload.profile_id)
                .or_default()
                .1
                .push((identifier, payload.enabled));
            continue;
        }

        let Some(hash) = payload.sha1_hash.clone() else {
            leftovers.push(payload);
            continue;
        };

        if !mod_index.contains_key(&payload.profile_id) {
            let profile = state
                .profile_manager
                .get_profile(payload.profile_id)
                .await
                .map_err(CommandError::from)?;
            let mut lookup = HashMap::new();
            for entry in &profile.mods {
                if let Some(sha1) = mod_sha1(&entry.source) {
                    lookup.insert(sha1.to_string(), entry.id);
                }
            }
            mod_index.insert(payload.profile_id, lookup);
        }

        match mod_index
            .get(&payload.profile_id)
            .and_then(|lookup| lookup.get(&hash))
        {
            Some(mod_id) => by_profile
                .entry(payload.profile_id)
                .or_default()
                .0
                .push((*mod_id, payload.enabled)),
            None => leftovers.push(payload),
        }
    }

    perf.mark(&format!(
        "grouped {} profile(s), {} leftover(s)",
        by_profile.len(),
        leftovers.len()
    ));

    for (profile_id, (mods, norisk)) in by_profile {
        for enabled in [true, false] {
            let ids: Vec<Uuid> = mods
                .iter()
                .filter(|(_, want)| *want == enabled)
                .map(|(id, _)| *id)
                .collect();
            match state
                .profile_manager
                .set_mods_enabled(profile_id, &ids, enabled)
                .await
            {
                Ok(changed) => result.mods_changed += changed,
                Err(e) => {
                    log::error!("Batch toggle failed for profile {}: {}", profile_id, e);
                    result.failed += ids.len();
                }
            }
        }

        match state
            .profile_manager
            .set_norisk_mod_statuses(profile_id, &norisk)
            .await
        {
            Ok(changed) => result.norisk_changed += changed,
            Err(e) => {
                log::error!("Batch norisk toggle failed for profile {}: {}", profile_id, e);
                result.failed += norisk.len();
            }
        }
    }

    perf.mark("profile writes");

    for payload in leftovers {
        match toggle_content_from_profile(payload).await {
            Ok(()) => result.files_changed += 1,
            Err(e) => {
                log::error!("Batch toggle fell back and failed: {}", e.message);
                result.failed += 1;
            }
        }
    }

    perf.mark("leftovers");
    log::info!(
        "Batch toggle: {} mods, {} norisk entries, {} files, {} failed",
        result.mods_changed,
        result.norisk_changed,
        result.files_changed,
        result.failed
    );
    Ok(result)
}

fn mod_sha1(source: &crate::state::profile_state::ModSource) -> Option<&str> {
    use crate::state::profile_state::ModSource;
    match source {
        ModSource::Modrinth { file_hash_sha1, .. }
        | ModSource::CurseForge { file_hash_sha1, .. } => file_hash_sha1.as_deref(),
        _ => None,
    }
}

#[tauri::command]
pub async fn toggle_content_from_profile(
    payload: ToggleContentPayload,
) -> Result<(), CommandError> {
    let mut perf = crate::utils::perf_utils::Phase::start("toggle_content");
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

    perf.mark("entry");
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

    // --- Phase 1: Toggle Modrinth and CurseForge Mod Entries (in profile.mods list) ---
    // Always check mods if SHA1 is provided, as it's a primary place for managed content.
    // If content_type is explicitly Mod, we'd primarily expect a hit here.
    // If content_type is an asset, a mod might still share a SHA1 if manually placed or due to other reasons.
    for mod_entry in profile.mods.iter() {
        let mod_hash = match &mod_entry.source {
            ModSource::Modrinth { file_hash_sha1: Some(hash), .. } => Some(hash),
            ModSource::CurseForge { file_hash_sha1: Some(hash), .. } => Some(hash),
            _ => None,
        };

        if let Some(mod_hash) = mod_hash {
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
                        perf.mark("set_mod_enabled");
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
                    cache_behaviour: Default::default(),
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

#[derive(serde::Serialize, Debug, Default)]
pub struct BatchUninstallResult {
    pub mods_removed: usize,
    pub files_deleted: usize,
    pub failed: usize,
}

#[tauri::command]
pub async fn uninstall_contents_from_profile(
    payloads: Vec<UninstallContentPayload>,
) -> Result<BatchUninstallResult, CommandError> {
    let mut perf = crate::utils::perf_utils::Phase::start("uninstall_contents_batch");
    let mut result = BatchUninstallResult::default();
    if payloads.is_empty() {
        return Ok(result);
    }

    let state_manager = AppStateManager::get().await.map_err(|e| {
        CommandError::from(AppError::Other(format!("Failed to get internal state: {}", e)))
    })?;

    let mut direct_paths: Vec<String> = Vec::new();
    let mut by_profile: HashMap<Uuid, (HashSet<String>, Option<profile_utils::ContentType>)> =
        HashMap::new();

    for payload in payloads {
        if let Some(path) = payload.file_path {
            direct_paths.push(path);
            continue;
        }
        let Some(hash) = payload.sha1_hash else {
            result.failed += 1;
            continue;
        };
        let entry = by_profile
            .entry(payload.profile_id)
            .or_insert_with(|| (HashSet::new(), payload.content_type.clone()));
        entry.0.insert(hash);
        if entry.1 != payload.content_type {
            entry.1 = None;
        }
    }

    perf.mark(&format!(
        "grouped {} profile(s), {} direct path(s)",
        by_profile.len(),
        direct_paths.len()
    ));

    for path in direct_paths {
        match fs::remove_file(&path).await {
            Ok(()) => result.files_deleted += 1,
            Err(e) => {
                log::error!("Batch uninstall could not delete {}: {}", path, e);
                result.failed += 1;
            }
        }
    }

    for (profile_id, (hashes, content_type)) in by_profile {
        let profile = match state_manager.profile_manager.get_profile(profile_id).await {
            Ok(profile) => profile,
            Err(e) => {
                log::error!("Batch uninstall could not read profile {}: {}", profile_id, e);
                result.failed += hashes.len();
                continue;
            }
        };

        let mod_ids: Vec<Uuid> = profile
            .mods
            .iter()
            .filter(|entry| match &entry.source {
                ModSource::Modrinth {
                    file_hash_sha1: Some(hash),
                    ..
                }
                | ModSource::CurseForge {
                    file_hash_sha1: Some(hash),
                    ..
                } => hashes.contains(hash),
                _ => false,
            })
            .map(|entry| entry.id)
            .collect();

        match state_manager
            .profile_manager
            .delete_mods(profile_id, &mod_ids)
            .await
        {
            Ok(removed) => result.mods_removed += removed,
            Err(e) => {
                log::error!("Batch uninstall could not remove mods from {}: {}", profile_id, e);
                result.failed += mod_ids.len();
            }
        }

        result.files_deleted += delete_files_by_hash(&state_manager, &profile, &hashes, &content_type)
            .await
            .unwrap_or_else(|e| {
                log::error!("Batch uninstall could not sweep files for {}: {}", profile_id, e);
                0
            });
    }

    perf.mark("sweep");
    log::info!(
        "Batch uninstall: {} mod entries, {} files, {} failed",
        result.mods_removed,
        result.files_deleted,
        result.failed
    );
    Ok(result)
}

async fn delete_files_by_hash(
    state_manager: &Arc<AppStateManager>,
    profile: &crate::state::profile_state::Profile,
    hashes: &HashSet<String>,
    content_type: &Option<profile_utils::ContentType>,
) -> crate::error::Result<usize> {
    let instance_path = state_manager
        .profile_manager
        .get_profile_instance_path(profile.id)
        .await?;

    let mut dirs_to_scan: Vec<(&str, PathBuf)> = vec![
        ("shaderpacks", instance_path.join("shaderpacks")),
        ("resourcepacks", instance_path.join("resourcepacks")),
        ("datapacks", instance_path.join("datapacks")),
    ];
    for mods_dir in state_manager.profile_manager.mod_scan_dirs(profile)? {
        dirs_to_scan.push(("mods", mods_dir));
    }

    if let Some(ct) = content_type {
        let keep = match ct {
            profile_utils::ContentType::Mod => Some("mods"),
            profile_utils::ContentType::ShaderPack => Some("shaderpacks"),
            profile_utils::ContentType::ResourcePack => Some("resourcepacks"),
            profile_utils::ContentType::DataPack => Some("datapacks"),
            _ => None,
        };
        if let Some(keep) = keep {
            dirs_to_scan.retain(|(name, _)| *name == keep);
        }
    }

    let mut deleted = 0;
    for (_, dir) in dirs_to_scan {
        let Ok(mut entries) = fs::read_dir(&dir).await else {
            continue;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Ok(hash) = hash_utils::calculate_sha1(&path).await else {
                continue;
            };
            if !hashes.contains(&hash) {
                continue;
            }
            match fs::remove_file(&path).await {
                Ok(()) => deleted += 1,
                Err(e) => log::error!("Could not delete {:?}: {}", path, e),
            }
        }
    }

    Ok(deleted)
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
        "Executing install_content_to_profile for profile {} with content type {:?} from source {:?}",
        payload.profile_id,
        payload.content_type,
        payload.source
    );

    match payload.content_type {
        profile_utils::ContentType::Mod => {
            match payload.source {
                ModPlatform::Modrinth | ModPlatform::CurseForge => {
                    let platform_name = match payload.source {
                        ModPlatform::Modrinth => "Modrinth",
                        ModPlatform::CurseForge => "CurseForge",
                    };

                    log::info!(
                        "Attempting to install mod from {} using ProfileManager::add_mod_from_payload",
                        platform_name
                    );

                    // Get profile manager from state
                    let state = crate::state::state_manager::State::get().await?;
                    let profile_manager = &state.profile_manager;

                    // Use the new unified method for both platforms with dependency installation
                    profile_manager.add_mod_from_payload(&payload, true).await.map_err(CommandError::from)
                }
            }
        }
        profile_utils::ContentType::NoRiskMod => {
            log::info!("NoRiskMod installation is not supported via this unified command");
            Err(CommandError::from(AppError::Other(
                "NoRiskMod installation not supported via this command".to_string(),
            )))
        }
        profile_utils::ContentType::ResourcePack => {
            log::info!("Installing ResourcePack from {:?}", payload.source);
            profile_utils::add_content_to_profile(
                payload.profile_id,
                payload.project_id,
                payload.version_id,
                payload.file_name,
                payload.download_url,
                payload.file_hash_sha1,
                payload.content_name,
                payload.version_number,
                profile_utils::ContentType::ResourcePack,
                payload.source,
            )
            .await
            .map_err(CommandError::from)
        }
        profile_utils::ContentType::ShaderPack => {
            log::info!("Installing ShaderPack from {:?}", payload.source);
            profile_utils::add_content_to_profile(
                payload.profile_id,
                payload.project_id,
                payload.version_id,
                payload.file_name,
                payload.download_url,
                payload.file_hash_sha1,
                payload.content_name,
                payload.version_number,
                profile_utils::ContentType::ShaderPack,
                payload.source,
            )
            .await
            .map_err(CommandError::from)
        }
        profile_utils::ContentType::DataPack => {
            log::info!("Installing DataPack from {:?}", payload.source);
            profile_utils::add_content_to_profile(
                payload.profile_id,
                payload.project_id,
                payload.version_id,
                payload.file_name,
                payload.download_url,
                payload.file_hash_sha1,
                payload.content_name,
                payload.version_number,
                profile_utils::ContentType::DataPack,
                payload.source,
            )
            .await
            .map_err(CommandError::from)
        }
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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SwitchContentVersionPayload {
    pub profile_id: Uuid,
    pub content_type: profile_utils::ContentType,
    pub current_item_details: Option<profile_utils::LocalContentItem>, // Pass the whole item
    pub new_version_details: UnifiedVersion, // Unified version details for any platform
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ToggleModUpdatesPayload {
    pub profile_id: Uuid,
    pub mod_id: Uuid,
    pub updates_enabled: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct BulkToggleModUpdatesPayload {
    pub profile_id: Uuid,
    pub mod_updates: Vec<BulkModUpdateEntry>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct BulkModUpdateEntry {
    pub mod_id: Uuid,
    pub updates_enabled: bool,
}

#[derive(serde::Serialize, Debug, Default)]
pub struct BatchUpdateResult {
    pub applied: Vec<usize>,
    pub failed: Vec<usize>,
}

#[tauri::command]
pub async fn update_contents_from_profile(
    payloads: Vec<SwitchContentVersionPayload>,
) -> Result<BatchUpdateResult, CommandError> {
    let mut perf = crate::utils::perf_utils::Phase::start("update_contents_batch");
    let mut result = BatchUpdateResult::default();
    if payloads.is_empty() {
        return Ok(result);
    }

    let state = AppStateManager::get().await.map_err(|e| {
        CommandError::from(AppError::Other(format!("Failed to get internal state: {}", e)))
    })?;

    let mut by_profile: HashMap<Uuid, Vec<usize>> = HashMap::new();
    let mut leftovers: Vec<usize> = Vec::new();

    for (slot, payload) in payloads.iter().enumerate() {
        let managed_mod = payload.content_type == profile_utils::ContentType::Mod
            && payload
                .current_item_details
                .as_ref()
                .map_or(false, |item| item.id.is_some());
        if managed_mod {
            by_profile.entry(payload.profile_id).or_default().push(slot);
        } else {
            leftovers.push(slot);
        }
    }

    perf.mark(&format!(
        "grouped {} profile(s), {} leftover(s)",
        by_profile.len(),
        leftovers.len()
    ));

    for (profile_id, slots) in by_profile {
        let group: Vec<&SwitchContentVersionPayload> =
            slots.iter().map(|slot| &payloads[*slot]).collect();
        match state
            .profile_manager
            .update_mods_with_switch_payloads(profile_id, &group)
            .await
        {
            Ok(applied) => {
                let done: HashSet<usize> = applied.iter().copied().collect();
                for (offset, slot) in slots.iter().enumerate() {
                    if done.contains(&offset) {
                        result.applied.push(*slot);
                    } else {
                        result.failed.push(*slot);
                    }
                }
            }
            Err(e) => {
                log::error!("Batch update failed for profile {}: {}", profile_id, e);
                result.failed.extend(slots);
            }
        }
    }

    perf.mark("profile writes");

    for slot in leftovers {
        match switch_content_version(payloads[slot].clone()).await {
            Ok(()) => result.applied.push(slot),
            Err(e) => {
                log::error!("Batch update fell back and failed: {}", e.message);
                result.failed.push(slot);
            }
        }
    }

    perf.mark("leftovers");
    result.applied.sort_unstable();
    result.failed.sort_unstable();
    log::info!(
        "Batch update: {} applied, {} failed",
        result.applied.len(),
        result.failed.len()
    );
    Ok(result)
}

#[tauri::command]
pub async fn switch_content_version(
    payload: SwitchContentVersionPayload,
) -> Result<(), CommandError> {
    let current_item_details = payload.current_item_details.as_ref().ok_or_else(|| {
        AppError::InvalidInput("Missing current_item_details in payload.".to_string())
    })?;

    log::info!(
        "Attempting to switch content version for item '{}' (ContentType: {:?}, ID: {:?}) in profile {}",
        current_item_details.filename.clone(),
        payload.content_type,
        current_item_details.id.clone(),
        payload.profile_id
    );

    let state_manager = AppStateManager::get().await?;

    // Get platform from unified version
    let platform = payload.new_version_details.source.clone();

    log::info!(
        "Using platform {:?} for version switch",
        platform
    );

    match payload.content_type {
        profile_utils::ContentType::Mod => {
            if current_item_details.id.is_some() {
                // Use the new unified method for managed mods
                log::info!("Using unified method for managed mod update");
                state_manager
                    .profile_manager
                    .update_mod_with_switch_content_version_payload(
                        payload.profile_id,
                        &payload,
                    )
                    .await
                    .map_err(CommandError::from)
            } else {
                // Local/custom mod file: replace the JAR in-place using the selected version
                let primary_file = payload.new_version_details.files.iter()
                    .find(|f| f.primary)
                    .or_else(|| payload.new_version_details.files.first())
                    .ok_or_else(|| AppError::InvalidInput("Selected unified version has no files".to_string()))?;

                log::info!(
                    "Switching local mod '{}' to version '{}' ({})",
                    current_item_details.filename.clone(),
                    payload.new_version_details.name,
                    payload.new_version_details.id
                );

                crate::utils::path_utils::download_and_replace_file(
                    &current_item_details.path_str,
                    &primary_file.filename,
                    &primary_file.url,
                    primary_file.hashes.get("sha1").map(|x| x.as_str()),
                ).await?;

                Ok(())
            }
        }
        profile_utils::ContentType::ResourcePack => {
            let profile = state_manager
                .profile_manager
                .get_profile(payload.profile_id)
                .await?;
            let rp_info = ResourcePackInfo {
                filename: current_item_details.filename.clone(),
                path: current_item_details.path_str.clone(),
                sha1_hash: current_item_details.sha1_hash.clone(),
                file_size: current_item_details.file_size,
                is_disabled: current_item_details.is_disabled,
                modrinth_info: None,
            };

            log::info!(
                "Switching ResourcePack version for file: {}",
                rp_info.filename
            );

            // Convert UnifiedVersion to ModrinthVersion using the From trait
            let modrinth_version: crate::integrations::modrinth::ModrinthVersion = payload.new_version_details.clone().into();

            resourcepack_utils::update_resourcepack_from_modrinth(
                &profile,
                &rp_info,
                &modrinth_version,
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
                filename: current_item_details.filename.clone(),
                path: current_item_details.path_str.clone(),
                sha1_hash: current_item_details.sha1_hash.clone(),
                file_size: current_item_details.file_size,
                is_disabled: current_item_details.is_disabled,
                modrinth_info: None,
            };

            log::info!(
                "Switching ShaderPack version for file: {}",
                sp_info.filename
            );

            // Convert UnifiedVersion to ModrinthVersion using the From trait
            let modrinth_version: crate::integrations::modrinth::ModrinthVersion = payload.new_version_details.clone().into();

            shaderpack_utils::update_shaderpack_from_modrinth(
                &profile,
                &sp_info,
                &modrinth_version,
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
                filename: current_item_details.filename.clone(),
                path: current_item_details.path_str.clone(),
                sha1_hash: current_item_details.sha1_hash.clone(),
                file_size: current_item_details.file_size,
                is_disabled: current_item_details.is_disabled,
                modrinth_info: None,
            };

            log::info!("Switching DataPack version for file: {}", dp_info.filename);

            // Convert UnifiedVersion to ModrinthVersion using the From trait
            let modrinth_version: crate::integrations::modrinth::ModrinthVersion = payload.new_version_details.clone().into();

            datapack_utils::update_datapack_from_modrinth(&profile, &dp_info, &modrinth_version)
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

#[tauri::command]
pub async fn toggle_mod_updates(
    payload: ToggleModUpdatesPayload,
) -> Result<(), CommandError> {
    // For backwards compatibility, convert single mod request to bulk request
    let bulk_payload = BulkToggleModUpdatesPayload {
        profile_id: payload.profile_id,
        mod_updates: vec![BulkModUpdateEntry {
            mod_id: payload.mod_id,
            updates_enabled: payload.updates_enabled,
        }],
    };

    bulk_toggle_mod_updates(bulk_payload).await
}

#[tauri::command]
pub async fn bulk_toggle_mod_updates(
    payload: BulkToggleModUpdatesPayload,
) -> Result<(), CommandError> {
    log::info!(
        "Attempting to bulk toggle mod updates: profile_id={}, mod_count={}",
        payload.profile_id,
        payload.mod_updates.len()
    );

    let state_manager = AppStateManager::get().await.map_err(|e| {
        log::error!("Failed to get AppStateManager: {}", e);
        CommandError::from(AppError::Other(format!(
            "Failed to get internal state: {}",
            e
        )))
    })?;

    // Get the profile to validate mods exist
    let profile = state_manager
        .profile_manager
        .get_profile(payload.profile_id)
        .await
        .map_err(CommandError::from)?;

    // Validate all mods exist before making any changes
    let mut not_found_mods = Vec::new();
    let mut mods_to_update = Vec::new();

    for mod_update in &payload.mod_updates {
        let mod_entry = profile.mods.iter().find(|m| m.id == mod_update.mod_id);
        match mod_entry {
            Some(mod_entry) => {
                // Only update if the state actually needs to change
                if mod_entry.updates_enabled != mod_update.updates_enabled {
                    mods_to_update.push((mod_update.mod_id, mod_update.updates_enabled));
                } else {
                    log::info!(
                        "Mod {} in profile {} already has updates_enabled={}. Skipping.",
                        mod_entry.id,
                        payload.profile_id,
                        mod_update.updates_enabled
                    );
                }
            }
            None => {
                not_found_mods.push(mod_update.mod_id);
            }
        }
    }

    // Report any mods that weren't found
    if !not_found_mods.is_empty() {
        log::warn!(
            "The following mods were not found in profile {}: {:?}",
            payload.profile_id,
            not_found_mods
        );
        return Err(CommandError::from(AppError::NotFound(format!(
            "Some mods not found in profile: {:?}",
            not_found_mods
        ))));
    }

    // If no mods need updating, we're done
    if mods_to_update.is_empty() {
        log::info!("No mods in profile {} need updating.", payload.profile_id);
        return Ok(());
    }

    let mut perf = crate::utils::perf_utils::Phase::start("bulk_toggle_mod_updates");
    let mut update_errors: Vec<(Uuid, String)> = Vec::new();

    for wanted in [true, false] {
        let ids: Vec<Uuid> = mods_to_update
            .iter()
            .filter(|(_, enabled)| *enabled == wanted)
            .map(|(id, _)| *id)
            .collect();
        if ids.is_empty() {
            continue;
        }

        if let Err(e) = state_manager
            .profile_manager
            .set_mods_updates_enabled(payload.profile_id, &ids, wanted)
            .await
        {
            log::error!(
                "Failed to toggle updates for {} mod(s) in profile {}: {}",
                ids.len(),
                payload.profile_id,
                e
            );
            update_errors.extend(ids.into_iter().map(|id| (id, e.to_string())));
        }
    }

    perf.mark("bulk write");

    if !update_errors.is_empty() {
        return Err(CommandError::from(AppError::Other(format!(
            "Some mod updates failed: {:?}",
            update_errors
        ))));
    }

    log::info!(
        "Successfully completed bulk toggle for {} mods in profile {}",
        payload.mod_updates.len(),
        payload.profile_id
    );

    Ok(())
}

