use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, CommandError};
use crate::integrations::modrinth::ModrinthVersion;
use crate::integrations::mrpack;
use crate::integrations::norisk_packs::NoriskModpacksConfig;
use crate::integrations::norisk_versions::NoriskVersionsConfig;
use crate::minecraft::installer;
use crate::state::event_state::{EventPayload, EventType};
use crate::state::profile_state::{
    default_profile_path, CustomModInfo, ModLoader, Profile, ProfileSettings, ProfileState,
};
use crate::state::state_manager::State;
use crate::utils::datapack_utils::DataPackInfo;
use crate::utils::mc_utils::{self, WorldInfo};
use crate::utils::path_utils::find_unique_profile_segment;
use crate::utils::profile_utils::{
    CheckContentParams, ContentInstallStatus, ContentType as ProfileUtilContentType,
    GenericModrinthInfo, LoadItemsParams as ProfileUtilLoadItemsParams, LocalContentItem,
    LocalContentLoader as ProfileUtilLocalContentLoader, ScreenshotInfo,
};
use crate::utils::resourcepack_utils::ResourcePackInfo;
use crate::utils::shaderpack_utils::ShaderPackInfo;
use crate::utils::world_utils;
use crate::utils::{
    datapack_utils, path_utils, profile_utils, repair_utils, resourcepack_utils, shaderpack_utils,
};
use chrono::Utc;
use log::{error, info, trace, warn};
use sanitize_filename::sanitize;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use sysinfo::System;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tokio::fs as TokioFs;
use uuid::Uuid;

// DTOs für Command-Parameter
#[derive(Deserialize)]
pub struct CreateProfileParams {
    name: String,
    game_version: String,
    loader: String,
    loader_version: Option<String>,
    selected_norisk_pack_id: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct UpdateProfileParams {
    name: Option<String>,
    game_version: Option<String>,
    loader: Option<String>,
    loader_version: Option<String>,
    settings: Option<ProfileSettings>,
    selected_norisk_pack_id: Option<String>,
    group: Option<String>,
    clear_selected_norisk_pack: Option<bool>,
    norisk_information: Option<crate::state::profile_state::NoriskInformation>,
}

// Neue DTO für den copy_profile Command
#[derive(Deserialize)]
pub struct CopyProfileParams {
    source_profile_id: Uuid,
    new_profile_name: String,
    // Option um nur bestimmte Dateien zu kopieren
    include_files: Option<Vec<PathBuf>>,
}

// Export profile command parameters
#[derive(Deserialize)]
pub struct ExportProfileParams {
    profile_id: Uuid,
    output_path: Option<String>, // This will be ignored but kept for backward compatibility
    file_name: String,           // Base name without extension
    include_files: Option<Vec<PathBuf>>,
    open_folder: bool, // Whether to open the exports folder after export
}

// DTO for the new command
#[derive(Deserialize)]
pub struct CopyWorldParams {
    source_profile_id: Uuid,
    source_world_folder: String,
    target_profile_id: Uuid,
    target_world_name: String,
}

// CRUD Commands
#[tauri::command]
pub async fn create_profile(params: CreateProfileParams) -> Result<Uuid, CommandError> {
    let state = State::get().await?;

    // 1. Basis-Pfad für Profile bestimmen
    let base_profiles_dir = default_profile_path();
    // Stelle sicher, dass das Basisverzeichnis existiert (optional, aber gut)
    TokioFs::create_dir_all(&base_profiles_dir)
        .await
        .map_err(|e| CommandError::from(AppError::Io(e)))?;

    // 2. Gewünschten Segmentnamen bereinigen
    let sanitized_base_name = sanitize(&params.name);
    if sanitized_base_name.is_empty() {
        // Handle den Fall, dass der Name nach der Bereinigung leer ist
        // Z.B. einen Standardnamen verwenden oder Fehler zurückgeben
        return Err(CommandError::from(AppError::Other(
            "Profile name is invalid after sanitization.".to_string(),
        )));
    }

    // 3. Eindeutigen Segmentnamen finden
    let unique_segment =
        find_unique_profile_segment(&base_profiles_dir, &sanitized_base_name).await?;
    info!("Unique segment: {}", unique_segment);

    // 4. Profil-Pfad konstruieren
    // Annahme: profile.path speichert nur das Segment (den Ordnernamen)
    let profile_path = unique_segment;

    TokioFs::create_dir_all(&base_profiles_dir.join(&profile_path))
        .await
        .map_err(|e| CommandError::from(AppError::Io(e)))?;

    let profile = Profile {
        id: Uuid::new_v4(),
        name: params.name.clone(), // Der Anzeigename bleibt original
        path: profile_path,        // Verwende den eindeutigen Pfad/Segment
        game_version: params.game_version.clone(),
        loader: ModLoader::from_str(&params.loader)?,
        loader_version: params.loader_version.clone(),
        created: Utc::now(),
        last_played: None,
        settings: ProfileSettings::default(),
        state: ProfileState::NotInstalled,
        mods: Vec::new(),
        selected_norisk_pack_id: params.selected_norisk_pack_id.clone(),
        disabled_norisk_mods_detailed: HashSet::new(),
        source_standard_profile_id: None,
        group: None,
        description: None,
        banner: None,
        background: None,
        is_standard_version: false,
        norisk_information: None,
    };

    let id = state.profile_manager.create_profile(profile).await?;
    Ok(id)
}

#[tauri::command]
pub async fn launch_profile(
    id: Uuid,
    quick_play_singleplayer: Option<String>,
    quick_play_multiplayer: Option<String>,
) -> Result<(), CommandError> {
    log::info!(
        "[Command] launch_profile called for ID: {}. QuickPlay Single: {:?}, QuickPlay Multi: {:?}",
        id,
        quick_play_singleplayer,
        quick_play_multiplayer
    );

    let state = State::get().await?;

    // Try to get the regular profile
    let profile = match state.profile_manager.get_profile(id).await {
        Ok(profile) => {
            // Found existing profile - update last_played time
            let mut profile = profile;
            profile.last_played = Some(Utc::now());
            state
                .profile_manager
                .update_profile(id, profile.clone())
                .await?;

            // Update launcher config with last played profile ID
            let mut current_config = state.config_manager.get_config().await;
            current_config.last_played_profile = Some(id);
            if let Err(e) = state.config_manager.set_config(current_config).await {
                warn!("Failed to update last_played_profile in config: {}", e);
            }

            profile
        }
        Err(_) => {
            // Profile not found - check if it's a standard version ID
            info!(
                "Profile with ID {} not found, checking standard versions",
                id
            );
            let standard_versions = state.norisk_version_manager.get_config().await;

            // Find a standard profile with matching ID
            let standard_profile = standard_versions
                .profiles
                .iter()
                .find(|p| p.id == id)
                .ok_or_else(|| {
                    AppError::Other(format!(
                        "No profile or standard version found with ID {}",
                        id
                    ))
                })?;

            // Convert standard profile to a temporary profile
            info!(
                "Converting standard profile '{}' to a temporary profile",
                standard_profile.name
            );

            // Update launcher config with last played profile ID (for standard versions too)
            // Even though it's not a "user" profile, we still record it was the last one launched.
            let mut current_config = state.config_manager.get_config().await;
            current_config.last_played_profile = Some(id); // id here is the standard_profile.id
            if let Err(e) = state.config_manager.set_config(current_config).await {
                warn!(
                    "Failed to update last_played_profile in config for standard version: {}",
                    e
                );
            }

            // Return the converted profile without saving it
            standard_profile.clone()
        }
    };

    let version = profile.game_version.clone();
    let modloader = profile.loader.clone();
    let credentials = match state
        .minecraft_account_manager_v2
        .get_active_account()
        .await
    {
        Ok(Some(creds)) => Some(creds),
        Ok(None) => {
            return Err(CommandError::from(AppError::NoCredentialsError));
        }
        Err(e) => {
            info!("Error getting active account: {}", e);
            return Err(CommandError::from(AppError::NoCredentialsError));
        }
    };

    let profile_id = profile.id; // Store profile ID for later use
    let profile_clone = profile.clone();

    // Clone Quick Play parameters for the spawned task
    let quick_play_sp_clone = quick_play_singleplayer.clone();
    let quick_play_mp_clone = quick_play_multiplayer.clone();

    // Log if Quick Play is being used
    if quick_play_singleplayer.is_some() {
        info!(
            "Launching profile {} with Quick Play singleplayer: {}",
            id,
            quick_play_singleplayer.as_ref().unwrap()
        );
    } else if quick_play_multiplayer.is_some() {
        info!(
            "Launching profile {} with Quick Play multiplayer: {}",
            id,
            quick_play_multiplayer.as_ref().unwrap()
        );
    }

    // Spawn the installation task and get the JoinHandle
    let handle = tokio::spawn(async move {
        let install_result = installer::install_minecraft_version(
            &version,
            &modloader.as_str(),
            &profile_clone,
            credentials,
            quick_play_sp_clone,
            quick_play_mp_clone,
        )
        .await;

        // Get state again within the spawn context
        if let Ok(state) = State::get().await {
            // Ensure we remove the launching process tracking when done
            state.process_manager.remove_launching_process(profile_id);

            match install_result {
                Ok(_) => {
                    info!(
                        "Successfully installed/launched Minecraft version {} for profile {}",
                        version, profile_id
                    );
                    // Emit the new LaunchSuccessful event
                    let success_payload = EventPayload {
                        event_id: uuid::Uuid::new_v4(),
                        event_type: EventType::LaunchSuccessful,
                        target_id: Some(profile_id),
                        message: format!("Profile {} launched successfully.", profile_id),
                        progress: Some(1.0), // Indicate completion
                        error: None,
                    };
                    if let Err(emit_err) = state.emit_event(success_payload).await {
                        error!(
                            "Failed to emit LaunchSuccessful event for profile {}: {}",
                            profile_id, emit_err
                        );
                    }
                }
                Err(e) => {
                    let error_message = e.to_string();
                    info!(
                        "Error installing/launching Minecraft for profile {}: {}",
                        profile_id, error_message
                    );

                    // Emit an error event to the frontend
                    let event_payload = EventPayload {
                        event_id: uuid::Uuid::new_v4(), // A new UUID for this specific error event
                        event_type: EventType::Error,   // Use the existing Error type
                        target_id: Some(profile_id),
                        message: error_message.clone(), // The error message for the 'message' field
                        progress: None, // Progress is not relevant for a final error
                        error: Some(error_message), // The error message for the 'error' field
                    };

                    if let Err(emit_err) = state.emit_event(event_payload).await {
                        error!(
                            "Failed to emit error event to frontend for profile {}: {}",
                            profile_id, emit_err
                        );
                    }
                }
            }
        } else {
            error!(
                "Failed to get state within spawned task for profile_id: {}. Install error (if any): {:?}", 
                profile_id, 
                install_result.err().map(|e| e.to_string())
            );
        }
    });

    // Store the task handle for possible abortion
    state
        .process_manager
        .add_launching_process(profile_id, handle);

    Ok(())
}

/// Aborts an ongoing launch process for a profile.
/// This is useful to cancel a profile installation/launch that's taking too long.
#[tauri::command]
pub async fn abort_profile_launch(profile_id: Uuid) -> Result<(), CommandError> {
    info!(
        "Attempting to abort launch process for profile ID: {}",
        profile_id
    );

    let state = State::get().await?;

    // Check if the profile has an active launching process
    if !state.process_manager.has_launching_process(profile_id) {
        info!(
            "No active launch process found for profile ID: {}",
            profile_id
        );
        return Err(CommandError::from(AppError::Other(format!(
            "No active launch process found for profile ID: {}",
            profile_id
        ))));
    }

    // Attempt to abort the process
    match state.process_manager.abort_launch_process(profile_id) {
        Ok(_) => {
            info!(
                "Successfully aborted launch process for profile ID: {}",
                profile_id
            );

            // Emit an event to notify the UI that the process was aborted
            let event_payload = crate::state::event_state::EventPayload {
                event_id: Uuid::new_v4(),
                event_type: crate::state::event_state::EventType::LaunchingMinecraft,
                target_id: Some(profile_id),
                message: "Launch process wurde abgebrochen".to_string(),
                progress: Some(0.0), // Reset progress
                error: Some("Der Launch-Prozess wurde manuell abgebrochen".to_string()),
            };

            if let Err(e) = state.event_state.emit(event_payload).await {
                error!(
                    "Failed to emit abort event for profile {}: {}",
                    profile_id, e
                );
            }

            Ok(())
        }
        Err(e) => {
            error!(
                "Failed to abort launch process for profile ID {}: {}",
                profile_id, e
            );
            Err(CommandError::from(e))
        }
    }
}

#[tauri::command]
pub async fn get_profile(id: Uuid) -> Result<Profile, CommandError> {
    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(id).await?;
    Ok(profile)
}

#[tauri::command]
pub async fn update_profile(id: Uuid, params: UpdateProfileParams) -> Result<(), CommandError> {
    info!(
        "[CMD] update_profile called for ID: {} with params: {:?}",
        id, params
    );
    match try_update_profile(id, params).await {
        Ok(_) => {
            info!("[CMD] update_profile successful for ID: {}", id);
            Ok(())
        }
        Err(e) => {
            error!("[CMD] update_profile failed for ID: {}: {:?}", id, e);
            Err(e)
        }
    }
}

// Helper function to contain the actual logic and allow for ? operator
async fn try_update_profile(id: Uuid, params: UpdateProfileParams) -> Result<(), CommandError> {
    info!(
        "[CMD] try_update_profile for ID: {}. Received params: {:?}",
        id, params
    );
    let state = State::get().await?;
    let mut profile = state.profile_manager.get_profile(id).await?;

    if let Some(name) = &params.name {
        // Borrow params.name
        info!("Updating profile name to: {}", name);
        profile.name = name.clone();
    }
    if let Some(game_version) = &params.game_version {
        // Borrow params.game_version
        info!("Updating game_version to: {}", game_version);
        profile.game_version = game_version.clone();
    }
    if let Some(loader_str) = &params.loader {
        // Borrow params.loader
        info!("Updating loader to: {}", loader_str);
        profile.loader = ModLoader::from_str(loader_str)?;
    }
    if let Some(loader_version) = &params.loader_version {
        // Borrow params.loader_version
        info!("Updating loader_version to: {}", loader_version);
        profile.loader_version = Some(loader_version.clone());
    }
    if let Some(settings) = params.settings {
        // settings can be moved if it's Clone or Copy, or borrowed if not
        info!("Updating settings: {:?}", settings);
        profile.settings = settings; // Assuming ProfileSettings is Clone or params.settings is not used after this
    }

    // Handle selected_norisk_pack_id based on clear_selected_norisk_pack and new value
    if params.clear_selected_norisk_pack == Some(true) {
        info!("Clearing selected_norisk_pack_id for profile {}", id);
        profile.selected_norisk_pack_id = None;
    } else if let Some(pack_id) = &params.selected_norisk_pack_id {
        info!(
            "Updating selected_norisk_pack_id to: {} for profile {}",
            pack_id, id
        );
        profile.selected_norisk_pack_id = Some(pack_id.clone());
    } else {
        info!("selected_norisk_pack_id not explicitly changed or cleared for profile {}. Current: {:?}", id, profile.selected_norisk_pack_id);
        // No change to selected_norisk_pack_id if neither clear is true nor a new value is provided
    }

    if let Some(new_group) = &params.group {
        // Borrow params.group
        info!("Updating group to: {}", new_group);
        profile.group = Some(new_group.clone());
    }

    // Handle norisk_information
    if let Some(norisk_info) = params.norisk_information {
        info!("Updating norisk_information to: {:?}", norisk_info);
        profile.norisk_information = Some(norisk_info);
    } else {
        // This else block handles the case where `norisk_information` is explicitly `null` in JSON,
        // which Serde maps to `None` for `Option<NoriskInformation>`.
        // If you want to distinguish between `null` and `undefined` (field not present),
        // you might need `Option<Option<NoriskInformation>>` or a custom deserializer.
        // For now, if it's `None` (either not sent or sent as null), we keep the existing value.
        // If you want `null` to clear it, you would do: `profile.norisk_information = None;`
        info!(
            "norisk_information not provided or explicitly null, keeping existing: {:?}",
            profile.norisk_information
        );
    }

    state.profile_manager.update_profile(id, profile).await?;
    info!("Profile {} updated successfully.", id);
    Ok(())
}

#[tauri::command]
pub async fn delete_profile(id: Uuid) -> Result<(), CommandError> {
    let state = State::get().await?;
    state.profile_manager.delete_profile(id).await?;
    Ok(())
}

#[tauri::command]
pub async fn repair_profile(id: Uuid) -> Result<(), CommandError> {
    info!("Executing repair_profile command for profile {}", id);
    
    // Call the actual repair function from repair_utils
    repair_utils::repair_profile(id).await?;
    
    Ok(())
}

#[tauri::command]
pub async fn add_modrinth_mod_to_profile(
    profile_id: Uuid,
    project_id: String,
    version_id: String,
    file_name: String,
    download_url: String,
    file_hash_sha1: Option<String>,
    mod_name: Option<String>,
    version_number: Option<String>,
    loaders: Option<Vec<String>>,
    game_versions: Option<Vec<String>>,
) -> Result<(), CommandError> {
    info!(
        "Executing add_mod_to_profile command for profile {}",
        profile_id
    );

    Ok(State::get()
        .await?
        .profile_manager
        .add_modrinth_mod(
            profile_id,
            project_id,
            version_id,
            file_name,
            download_url,
            file_hash_sha1,
            mod_name,
            version_number,
            loaders,
            game_versions,
            true,
        )
        .await?)
}

#[tauri::command]
pub async fn list_profiles() -> Result<Vec<Profile>, CommandError> {
    let state = State::get().await?;
    let profiles = state.profile_manager.list_profiles().await?;
    Ok(profiles)
}

#[tauri::command]
pub async fn search_profiles(query: String) -> Result<Vec<Profile>, CommandError> {
    let state = State::get().await?;
    let profiles = state.profile_manager.search_profiles(&query).await?;
    Ok(profiles)
}

/// Loads and returns the list of standard profiles from the local configuration file.
#[tauri::command]
pub async fn get_standard_profiles() -> Result<NoriskVersionsConfig, CommandError> {
    info!("Executing get_standard_profiles command");
    let state = State::get().await?;
    let config = state.norisk_version_manager.get_config().await;
    Ok(config)
}

#[tauri::command]
pub async fn set_profile_mod_enabled(
    profile_id: Uuid,
    mod_id: Uuid,
    enabled: bool,
) -> Result<(), CommandError> {
    info!(
        "Received command set_profile_mod_enabled: profile={}, mod={}, enabled={}",
        profile_id, mod_id, enabled
    );
    let state = State::get().await?;
    state
        .profile_manager
        .set_mod_enabled(profile_id, mod_id, enabled)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_mod_from_profile(profile_id: Uuid, mod_id: Uuid) -> Result<(), CommandError> {
    info!(
        "Received command delete_mod_from_profile: profile={}, mod={}",
        profile_id, mod_id
    );
    let state = State::get().await?;
    state.profile_manager.delete_mod(profile_id, mod_id).await?;
    Ok(())
}

// Command to retrieve the list of available Norisk Modpacks
#[tauri::command]
pub async fn get_norisk_packs() -> Result<NoriskModpacksConfig, CommandError> {
    info!("Received command get_norisk_packs");
    let state = State::get().await?;
    let config = state.norisk_pack_manager.get_config().await;
    Ok(config)
}

/// Retrieves the Norisk packs configuration with fully resolved mod lists for each pack.
#[tauri::command]
pub async fn get_norisk_packs_resolved() -> Result<NoriskModpacksConfig, CommandError> {
    info!("Received command get_norisk_packs_resolved");
    let state = State::get().await?;
    let manager = &state.norisk_pack_manager; // Get a reference

    // Get the base configuration to access metadata and pack IDs
    let base_config = manager.get_config().await;

    // Create a new map to store the resolved pack definitions
    let mut resolved_packs = HashMap::new();

    // Iterate through the pack IDs from the base config's packs map
    for pack_id in base_config.packs.keys() {
        match base_config.get_resolved_pack_definition(pack_id) {
            Ok(resolved_pack) => {
                resolved_packs.insert(pack_id.clone(), resolved_pack);
            }
            Err(e) => {
                // Log the error for the specific pack but continue resolving others
                error!(
                    "Failed to resolve pack definition for ID '{}': {}",
                    pack_id, e
                );
                // Optionally, return an error if resolving any pack fails
                // return Err(CommandError::from(e));
            }
        }
    }

    // Construct the final config object with the resolved packs
    let resolved_config = NoriskModpacksConfig {
        packs: resolved_packs, // Use the newly created map with resolved packs
        repositories: base_config.repositories, // Copy repositories from base config
    };

    Ok(resolved_config)
}

#[tauri::command]
pub async fn set_norisk_mod_status(
    profile_id: Uuid,
    pack_id: String,
    mod_id: String,
    game_version: String,
    loader_str: String, // Receive loader as string from frontend
    disabled: bool,
) -> Result<(), CommandError> {
    info!(
        "Received command set_norisk_mod_status: profile={}, pack={}, mod={}, mc={}, loader={}, disabled={}",
        profile_id, pack_id, mod_id, game_version, loader_str, disabled
    );
    let state = State::get().await?;

    // Convert loader string to ModLoader enum
    let loader = ModLoader::from_str(&loader_str)?;

    state
        .profile_manager
        .set_norisk_mod_status(profile_id, pack_id, mod_id, game_version, loader, disabled)
        .await?;
    Ok(())
}

// Command to update the version of a Modrinth mod in a profile
#[tauri::command]
pub async fn update_modrinth_mod_version(
    profile_id: Uuid,
    mod_instance_id: Uuid, // The unique ID of the Mod instance in the profile's list
    new_version_details: ModrinthVersion, // Receive the full details of the target version
) -> Result<(), CommandError> {
    info!(
        "Received command update_modrinth_mod_version: profile={}, mod_instance={}, new_version_id={}",
        profile_id,
        mod_instance_id,
        new_version_details.id
    );
    let state = State::get().await?;
    state
        .profile_manager
        .update_profile_modrinth_mod_version(profile_id, mod_instance_id, &new_version_details) // Pass details by reference
        .await?;
    Ok(())
}

// --- Custom Mod Commands ---

#[tauri::command]
pub async fn get_custom_mods(profile_id: Uuid) -> Result<Vec<CustomModInfo>, CommandError> {
    log::info!(
        "Received get_custom_mods command for profile {}",
        profile_id
    );
    let state: std::sync::Arc<State> = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;
    Ok(state.profile_manager.list_custom_mods(&profile).await?)
}

#[tauri::command]
pub async fn set_custom_mod_enabled(
    profile_id: Uuid,
    filename: String,
    enabled: bool,
) -> Result<(), CommandError> {
    // Return Result<()> as the manager method does
    log::info!(
        "Received set_custom_mod_enabled command for profile {}, file '{}', set_enabled={}",
        profile_id,
        filename,
        enabled
    );
    let state: std::sync::Arc<State> = State::get().await?;
    Ok(state
        .profile_manager
        .set_custom_mod_enabled(profile_id, filename, enabled)
        .await?)
}

#[tauri::command]
pub async fn delete_custom_mod(profile_id: Uuid, filename: String) -> Result<(), CommandError> {
    log::info!(
        "Received delete_custom_mod command for profile {}, file '{}'",
        profile_id,
        filename
    );

    // Ensure the filename itself doesn't end with .disabled - we expect the base name.
    if filename.ends_with(".disabled") {
        log::warn!("delete_custom_mod called with filename ending in .disabled: '{}'. Please provide the base filename.", filename);
        return Err(CommandError::from(AppError::Other(format!(
            "Invalid filename provided to delete_custom_mod: {}",
            filename
        ))));
    }

    let state = State::get().await?;

    // Call the ProfileManager method to handle the deletion
    state
        .profile_manager
        .delete_custom_mod_file(profile_id, &filename)
        .await?;

    Ok(())
}

// --- New Command to get System RAM ---
#[tauri::command]
pub async fn get_system_ram_mb() -> Result<u64, CommandError> {
    log::info!("Received command get_system_ram_mb");
    // In a real application, you might want to manage the System instance
    // in the global state to avoid recreating it, but for a one-off command,
    // this is fine.
    let mut sys = System::new_all();
    sys.refresh_memory(); // Refresh memory information
    let total_memory_bytes = sys.total_memory();
    let total_memory_mb = total_memory_bytes / (1024 * 1024);
    Ok(total_memory_mb)
}

// --- New Command to open Profile Folder ---
#[tauri::command]
pub async fn open_profile_folder(
    app_handle: tauri::AppHandle,
    profile_id: Uuid,
) -> Result<(), CommandError> {
    log::info!(
        "Received command open_profile_folder for profile {}",
        profile_id
    );
    let state = State::get().await?;
    let profile_full_path = state
        .profile_manager
        .get_profile_instance_path(profile_id)
        .await?;

    // Check if the directory exists (optional but good practice)
    if !profile_full_path.is_dir() {
        log::warn!(
            "Profile directory does not exist or is not a directory: {:?}",
            profile_full_path
        );
        return Err(CommandError::from(AppError::Other(format!(
            "Profile directory not found: {}",
            profile_full_path.display()
        ))));
    }

    log::info!("Attempting to open profile folder: {:?}", profile_full_path);

    match app_handle
        .opener()
        .open_path(profile_full_path.to_string_lossy(), None::<&str>)
    {
        Ok(_) => {
            log::info!(
                "Successfully requested to open profile folder: {:?}",
                profile_full_path
            );
            Ok(())
        }
        Err(e) => {
            log::error!(
                "Failed to open profile folder {:?}: {}",
                profile_full_path,
                e
            );
            Err(CommandError::from(AppError::Other(format!(
                "Failed to open folder: {}",
                e
            ))))
        }
    }
}

#[tauri::command]
pub async fn import_local_mods(
    app_handle: tauri::AppHandle,
    profile_id: Uuid,
) -> Result<(), CommandError> {
    log::info!(
        "Executing import_local_mods command for profile {}",
        profile_id
    );

    // Spawn the blocking dialog call onto a blocking thread pool
    let dialog_result_outer = tokio::task::spawn_blocking(move || {
        app_handle
            .dialog()
            .file()
            .add_filter("Java Archives", &["jar"])
            .set_title("Select Mod Jars to Import")
            .blocking_pick_files() // Use the blocking version inside spawn_blocking
    })
    .await
    .map_err(|e| CommandError::from(AppError::Other(format!("Dialog task failed: {}", e))))?;
    // The first ? handles JoinError

    if let Some(paths_enums) = dialog_result_outer {
        // Check if user selected files
        if paths_enums.is_empty() {
            log::info!("No files selected by user for import.");
            return Ok(());
        }
        log::info!(
            "User selected {} files to import for profile {}. Triggering processing...",
            paths_enums.len(),
            profile_id
        );

        // Call the ProfileManager method to handle the processing
        let state = State::get().await?;
        state
            .profile_manager
            .import_local_mods_to_profile(profile_id, paths_enums)
            .await?;
        // Propagate potential critical errors from the processing method

        // Emit event to trigger UI update for this profile
        if let Err(e) = state.event_state.trigger_profile_update(profile_id).await {
            // Log the error, but don't fail the whole command just because the event failed
            log::error!(
                "Failed to emit TriggerProfileUpdate event for profile {}: {}",
                profile_id,
                e
            );
        }

        // --- REMOVED processing logic (hashing, bulk lookup, adding/copying) ---

        // TODO: Decide if the frontend update event should be emitted here or within the ProfileManager method
        // It might be better in ProfileManager after processing is fully complete.
    } else {
        log::info!("User cancelled the file import dialog (blocking).");
    }

    Ok(())
}

#[tauri::command]
pub async fn import_profile_from_file(app_handle: tauri::AppHandle) -> Result<(), CommandError> {
    log::info!("Executing import_profile_from_file command");

    // Spawn the blocking dialog call onto a blocking thread pool
    let dialog_result = tokio::task::spawn_blocking(move || {
        app_handle
            .dialog()
            .file()
            .add_filter("Modpack Files", &["mrpack", "noriskpack"])
            .set_title("Select Modpack File (.mrpack or .noriskpack)")
            .blocking_pick_file() // Use the blocking version for single file selection
    })
    .await
    .map_err(|e| CommandError::from(AppError::Other(format!("Dialog task failed: {}", e))))?;

    if let Some(file_path_obj) = dialog_result {
        // Convert FilePath to PathBuf
        let file_path_buf = match file_path_obj.into_path() {
            Ok(path) => path,
            Err(e) => {
                log::error!("Failed to convert selected file path: {}", e);
                return Err(CommandError::from(AppError::Other(
                    "Failed to convert selected file path".to_string(),
                )));
            }
        };

        log::info!(
            "User selected modpack file: {:?}. Triggering processing...",
            file_path_buf
        );

        // Check the file extension
        let file_extension = file_path_buf
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_lowercase());

        let new_profile_id = match file_extension.as_deref() {
            Some("mrpack") => {
                log::info!("File extension is .mrpack, proceeding with mrpack processing.");
                mrpack::import_mrpack_as_profile(file_path_buf).await?
            }
            Some("noriskpack") => {
                log::info!("File extension is .noriskpack, proceeding with noriskpack processing.");
                crate::integrations::norisk_packs::import_noriskpack_as_profile(file_path_buf)
                    .await?
            }
            _ => {
                log::error!(
                    "Selected file has an invalid extension: {:?}",
                    file_path_buf
                );
                return Err(CommandError::from(AppError::Other(
                    "Invalid file type selected. Please select a .mrpack or .noriskpack file."
                        .to_string(),
                )));
            }
        };

        // Get state to emit event
        let state = State::get().await?;
        // Emit event to trigger UI update for the newly created profile
        if let Err(e) = state
            .event_state
            .trigger_profile_update(new_profile_id)
            .await
        {
            log::error!(
                "Failed to emit TriggerProfileUpdate event for new profile {}: {}",
                new_profile_id,
                e
            );
        }

        Ok(())
    } else {
        log::info!("User cancelled the file import dialog.");
        Ok(())
    }
}

/// Imports a profile from a specified file path.
#[tauri::command]
pub async fn import_profile(file_path_str: String) -> Result<Uuid, CommandError> {
    log::info!(
        "Executing import_profile command with file_path: {}",
        file_path_str
    );

    let file_path_buf = PathBuf::from(file_path_str);

    if !file_path_buf.exists() {
        log::error!("File path does not exist: {:?}", file_path_buf);
        return Err(CommandError::from(AppError::Other(format!(
            "File not found at path: {}",
            file_path_buf.display()
        ))));
    }

    log::info!(
        "Processing modpack file: {:?}. Triggering processing...",
        file_path_buf
    );

    // Check the file extension
    let file_extension = file_path_buf
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase());

    let new_profile_id = match file_extension.as_deref() {
        Some("mrpack") => {
            log::info!("File extension is .mrpack, proceeding with mrpack processing.");
            mrpack::import_mrpack_as_profile(file_path_buf).await?
        }
        Some("noriskpack") => {
            log::info!("File extension is .noriskpack, proceeding with noriskpack processing.");
            crate::integrations::norisk_packs::import_noriskpack_as_profile(file_path_buf).await?
        }
        _ => {
            log::error!(
                "Selected file has an invalid extension: {:?}",
                file_path_buf
            );
            return Err(CommandError::from(AppError::Other(
                "Invalid file type selected. Please select a .mrpack or .noriskpack file."
                    .to_string(),
            )));
        }
    };

    // Get state to emit event
    let state = State::get().await?;
    // Emit event to trigger UI update for the newly created profile
    if let Err(e) = state
        .event_state
        .trigger_profile_update(new_profile_id)
        .await
    {
        log::error!(
            "Failed to emit TriggerProfileUpdate event for new profile {}: {}",
            new_profile_id,
            e
        );
    }

    Ok(new_profile_id)
}

// Command to get all resourcepacks in a profile
#[tauri::command]
pub async fn get_local_resourcepacks(
    profile_id: Uuid,
    calculate_hashes: bool,
    fetch_modrinth_data: bool,
) -> Result<Vec<resourcepack_utils::ResourcePackInfo>, CommandError> {
    log::info!(
        "Executing get_local_resourcepacks command for profile {}, fetch_modrinth_data: {}",
        profile_id,
        fetch_modrinth_data
    );

    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;

    // Use the utility function to get all resourcepacks
    let resourcepacks = resourcepack_utils::get_resourcepacks_for_profile(
        &profile,
        calculate_hashes,
        fetch_modrinth_data,
    )
    .await
    .map_err(|e| CommandError::from(e))?;

    Ok(resourcepacks)
}

// Command to get all shaderpacks in a profile
#[tauri::command]
pub async fn get_local_shaderpacks(
    profile_id: Uuid,
) -> Result<Vec<shaderpack_utils::ShaderPackInfo>, CommandError> {
    log::info!(
        "Executing get_local_shaderpacks command for profile {}",
        profile_id
    );

    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;

    // Use the utility function to get all shaderpacks
    let shaderpacks = shaderpack_utils::get_shaderpacks_for_profile(&profile, true, true)
        .await
        .map_err(|e| CommandError::from(e))?;

    Ok(shaderpacks)
}

#[tauri::command]
pub async fn add_modrinth_content_to_profile(
    profile_id: Uuid,
    project_id: String,
    version_id: String,
    file_name: String,
    download_url: String,
    file_hash_sha1: Option<String>,
    content_name: Option<String>,
    version_number: Option<String>,
    project_type: String,
) -> Result<(), CommandError> {
    info!(
        "Executing add_modrinth_content_to_profile for profile {}",
        profile_id
    );

    // Konvertiere den String project_type in ModrinthProjectType
    let content_type = match project_type.to_lowercase().as_str() {
        "resourcepack" => profile_utils::ContentType::ResourcePack,
        "shader" => profile_utils::ContentType::ShaderPack,
        "datapack" => profile_utils::ContentType::DataPack,
        _ => {
            return Err(CommandError::from(AppError::Other(format!(
                "Unsupported content type: {}",
                project_type
            ))));
        }
    };

    // Rufe die Implementierung auf
    profile_utils::add_modrinth_content_to_profile(
        profile_id,
        project_id,
        version_id,
        file_name,
        download_url,
        file_hash_sha1,
        content_name,
        version_number,
        content_type,
    )
    .await
    .map_err(CommandError::from)
}

/// Command to get the directory structure of a profile
#[tauri::command]
pub async fn get_profile_directory_structure(
    profile_id: Uuid,
) -> Result<path_utils::FileNode, CommandError> {
    log::info!(
        "Executing get_profile_directory_structure command for profile {}",
        profile_id
    );

    let state = State::get().await?;

    // Profil abrufen - versuche reguläres Profil oder Standard-Version
    let profile = match state.profile_manager.get_profile(profile_id).await {
        Ok(profile) => profile,
        Err(_) => {
            // Profil nicht gefunden - prüfe ob es eine Standard-Version ID ist
            log::info!(
                "Profile with ID {} not found, checking standard versions",
                profile_id
            );
            let standard_versions = state.norisk_version_manager.get_config().await;

            // Finde ein Standard-Profil mit passender ID
            let standard_profile = standard_versions
                .profiles
                .iter()
                .find(|p| p.id == profile_id)
                .ok_or_else(|| {
                    AppError::Other(format!(
                        "No profile or standard version found with ID {}",
                        profile_id
                    ))
                })?;

            // Konvertiere Standard-Profil zu einem temporären Profil
            log::info!(
                "Converting standard profile '{}' to a user profile for directory structure",
                standard_profile.name
            );
            standard_profile.clone()
        }
    };

    // Calculate the full profile path
    let profile_path = state
        .profile_manager
        .calculate_instance_path_for_profile(&profile)?;

    // Get the directory structure using path_utils
    let structure = path_utils::get_directory_structure(&profile_path, false)
        .await
        .map_err(|e| CommandError::from(e))?;

    Ok(structure)
}

/// Kopiert ein bestehendes Profil und erstellt ein neues mit den gleichen Eigenschaften,
/// aber kopiert nur die angegebenen Dateien wenn include_files angegeben ist.
#[tauri::command]
pub async fn copy_profile(params: CopyProfileParams) -> Result<Uuid, CommandError> {
    info!(
        "Executing copy_profile command from profile {}",
        params.source_profile_id
    );

    let state = State::get().await?;

    // 1. Quellprofil abrufen - versuche reguläres Profil oder Standard-Version
    let source_profile = match state
        .profile_manager
        .get_profile(params.source_profile_id)
        .await
    {
        Ok(profile) => profile,
        Err(_) => {
            // Profil nicht gefunden - prüfe ob es eine Standard-Version ID ist
            info!(
                "Profile with ID {} not found, checking standard versions",
                params.source_profile_id
            );
            let standard_versions = state.norisk_version_manager.get_config().await;

            // Finde ein Standard-Profil mit passender ID
            let standard_profile = standard_versions
                .profiles
                .iter()
                .find(|p| p.id == params.source_profile_id)
                .ok_or_else(|| {
                    AppError::Other(format!(
                        "No profile or standard version found with ID {}",
                        params.source_profile_id
                    ))
                })?;

            // Konvertiere Standard-Profil zu einem temporären Profil
            info!(
                "Converting standard profile '{}' to a user profile for copying",
                standard_profile.name
            );
            standard_profile.clone()
        }
    };

    // 2. Basis-Pfad für Profile bestimmen
    let base_profiles_dir = default_profile_path();
    TokioFs::create_dir_all(&base_profiles_dir)
        .await
        .map_err(|e| CommandError::from(AppError::Io(e)))?;

    // 3. Gewünschten Segmentnamen für das neue Profil bereinigen
    let sanitized_base_name = sanitize(&params.new_profile_name);
    if sanitized_base_name.is_empty() {
        return Err(CommandError::from(AppError::Other(
            "Profile name is invalid after sanitization.".to_string(),
        )));
    }

    // 4. Eindeutigen Segmentnamen finden
    let unique_segment =
        find_unique_profile_segment(&base_profiles_dir, &sanitized_base_name).await?;
    info!("Unique segment for copied profile: {}", unique_segment);

    // 5. Erstelle ein neues Profil basierend auf dem Quellprofil
    let new_profile = Profile {
        id: Uuid::new_v4(),
        name: params.new_profile_name.clone(),
        path: unique_segment.clone(), // Verwende den eindeutigen Pfad
        game_version: source_profile.game_version.clone(),
        loader: source_profile.loader.clone(),
        loader_version: source_profile.loader_version.clone(),
        created: Utc::now(),
        last_played: None,
        settings: source_profile.settings.clone(),
        state: ProfileState::NotInstalled, // Neues Profil ist noch nicht installiert
        mods: source_profile.mods.clone(), // Kopiere die Modrinth-Mods aus dem Quellprofil
        selected_norisk_pack_id: source_profile.selected_norisk_pack_id.clone(),
        disabled_norisk_mods_detailed: source_profile.disabled_norisk_mods_detailed.clone(),
        source_standard_profile_id: source_profile.source_standard_profile_id,
        group: source_profile.group.clone(),
        is_standard_version: false,
        description: source_profile.description.clone(),
        norisk_information: source_profile.norisk_information.clone(),
        banner: source_profile.banner.clone(),
        background: source_profile.background.clone(),
    };

    // 6. Erstelle das neue Profilverzeichnis
    let new_profile_path = base_profiles_dir.join(&unique_segment);
    TokioFs::create_dir_all(&new_profile_path)
        .await
        .map_err(|e| CommandError::from(AppError::Io(e)))?;

    // 7. Berechne die vollständigen Pfade für Quell- und Zielverzeichnisse
    let source_full_path = state
        .profile_manager
        .calculate_instance_path_for_profile(&source_profile)?;
    // The calculate_instance_path_for_profile function has its own trace logging

    // 8. Kopiere die Dateien basierend auf den Parametern
    let files_copied = if let Some(include_files) = &params.include_files {
        if !include_files.is_empty() {
            // Wenn eine nicht-leere Include-Liste angegeben wurde, verwende die neue Funktion
            info!(
                "Copying only specified files ({} paths) to new profile {}",
                include_files.len(),
                new_profile.id
            );

            // Die neue Funktion kümmert sich um alles in einem Schritt
            path_utils::copy_profile_with_includes(
                &source_full_path,
                &new_profile_path,
                include_files,
            )
            .await?
        } else {
            // Leere include_files bedeutet: kopiere nichts
            info!(
                "Empty include_files list, not copying any files to new profile {}",
                new_profile.id
            );
            0
        }
    } else {
        info!(
            "No include_files specified, copying no files to new profile {}",
            new_profile.id
        );
        0
    };

    info!(
        "Copied {} files to new profile {}",
        files_copied, new_profile.id
    );

    // 9. Speichere das neue Profil in der Datenbank
    let new_profile_id = state.profile_manager.create_profile(new_profile).await?;

    // 10. Event auslösen, um das UI zu aktualisieren
    if let Err(e) = state
        .event_state
        .trigger_profile_update(new_profile_id)
        .await
    {
        log::error!(
            "Failed to emit TriggerProfileUpdate event for profile {}: {}",
            new_profile_id,
            e
        );
    }

    Ok(new_profile_id)
}

/// Exports a profile to a .noriskpack file format with a fixed export directory
#[tauri::command]
pub async fn export_profile(
    app_handle: tauri::AppHandle,
    params: ExportProfileParams,
) -> Result<String, CommandError> {
    info!(
        "Executing export_profile command for profile {}",
        params.profile_id
    );

    // Ensure the exports directory exists
    let exports_dir = LAUNCHER_DIRECTORY.root_dir().join("exports");
    TokioFs::create_dir_all(&exports_dir)
        .await
        .map_err(|e| CommandError::from(AppError::Io(e)))?;

    // Sanitize the filename and add .noriskpack extension
    let sanitized_name = sanitize(&params.file_name);
    if sanitized_name.is_empty() {
        return Err(CommandError::from(AppError::Other(
            "Export filename is invalid after sanitization.".to_string(),
        )));
    }

    // Generate complete filename with extension
    let noriskpack_filename = format!("{}.noriskpack", sanitized_name);

    // Create full export path
    let export_path = exports_dir.join(&noriskpack_filename);

    info!("Exporting profile to {}", export_path.display());

    // Perform the export
    let result_path = profile_utils::export_profile_to_noriskpack(
        params.profile_id,
        Some(export_path.clone()),
        params.include_files,
    )
    .await?;

    // Open the export directory if requested
    if params.open_folder {
        info!("Opening export directory: {}", exports_dir.display());
        if let Err(e) = app_handle
            .opener()
            .open_path(exports_dir.to_string_lossy(), None::<&str>)
        {
            info!("Failed to open export directory: {}", e);
            // Don't fail the command if directory opening fails
        }
    }

    Ok(result_path.to_string_lossy().to_string())
}

/// Checks if a profile is currently being launched.
/// Returns true if there's an active launch process for the given profile ID.
#[tauri::command]
pub async fn is_profile_launching(profile_id: Uuid) -> Result<bool, CommandError> {
    let state = State::get().await?;
    Ok(state.process_manager.has_launching_process(profile_id))
}

/// Fetches the latest Norisk packs configuration from the API and updates the local cache.
#[tauri::command]
pub async fn refresh_norisk_packs() -> Result<(), CommandError> {
    info!("Refreshing Norisk packs via command...");
    let state = State::get().await?;
    let config = state.config_manager.get_config().await;

    match state
        .norisk_pack_manager
        .fetch_and_update_config(&"", config.is_experimental)
        .await
    {
        Ok(_) => {
            info!("Successfully refreshed Norisk packs via command.");
            Ok(())
        }
        Err(e) => {
            error!("Failed to refresh Norisk packs via command: {}", e);
            Err(CommandError::from(e))
        }
    }
}

/// Fetches the latest standard version profiles from the API and updates the local cache.
#[tauri::command]
pub async fn refresh_standard_versions() -> Result<(), CommandError> {
    info!("Refreshing standard versions via command...");
    let state = State::get().await?;
    let config = state.config_manager.get_config().await;

    match state
        .norisk_version_manager
        .fetch_and_update_config(&"", config.is_experimental)
        .await
    {
        Ok(_) => {
            info!("Successfully refreshed standard versions via command.");
            Ok(())
        }
        Err(e) => {
            error!("Failed to refresh standard versions via command: {}", e);
            Err(CommandError::from(e))
        }
    }
}

// Command to update a Modrinth resourcepack in a profile
#[tauri::command]
pub async fn update_resourcepack_from_modrinth(
    profile_id: Uuid,
    resourcepack: ResourcePackInfo,
    new_version_details: ModrinthVersion,
) -> Result<(), CommandError> {
    info!(
        "Received command update_resourcepack_from_modrinth: profile={}, resourcepack={}, new_version_id={}",
        profile_id,
        resourcepack.filename,
        new_version_details.id
    );

    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;

    crate::utils::resourcepack_utils::update_resourcepack_from_modrinth(
        &profile,
        &resourcepack,
        &new_version_details,
    )
    .await?;

    Ok(())
}

// Command to update a Modrinth shaderpack in a profile
#[tauri::command]
pub async fn update_shaderpack_from_modrinth(
    profile_id: Uuid,
    shaderpack: ShaderPackInfo,
    new_version_details: ModrinthVersion,
) -> Result<(), CommandError> {
    info!(
        "Received command update_shaderpack_from_modrinth: profile={}, shaderpack={}, new_version_id={}",
        profile_id,
        shaderpack.filename,
        new_version_details.id
    );

    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;

    crate::utils::shaderpack_utils::update_shaderpack_from_modrinth(
        &profile,
        &shaderpack,
        &new_version_details,
    )
    .await?;

    Ok(())
}

// Command to get all datapacks in a profile
#[tauri::command]
pub async fn get_local_datapacks(
    profile_id: Uuid,
) -> Result<Vec<datapack_utils::DataPackInfo>, CommandError> {
    log::info!(
        "Executing get_local_datapacks command for profile {}",
        profile_id
    );

    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;

    // Use the utility function to get all datapacks
    let datapacks = datapack_utils::get_datapacks_for_profile(&profile, true, true)
        .await
        .map_err(|e| CommandError::from(e))?;

    Ok(datapacks)
}

// Command to update a Modrinth datapack in a profile
#[tauri::command]
pub async fn update_datapack_from_modrinth(
    profile_id: Uuid,
    datapack: DataPackInfo,
    new_version_details: ModrinthVersion,
) -> Result<(), CommandError> {
    info!(
        "Received command update_datapack_from_modrinth: profile={}, datapack={}, new_version_id={}",
        profile_id,
        datapack.filename,
        new_version_details.id
    );

    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;

    crate::utils::datapack_utils::update_datapack_from_modrinth(
        &profile,
        &datapack,
        &new_version_details,
    )
    .await?;

    Ok(())
}

/// Checks the installation status of content based on provided parameters.
#[tauri::command]
pub async fn is_content_installed(
    params: CheckContentParams,
) -> Result<ContentInstallStatus, CommandError> {
    info!(
        "Executing check_content_installed command for profile {:?}",
        params
    );
    // Call the utility function and map the error
    Ok(profile_utils::check_content_installed(params).await?)
}

/// Batch checks the installation status of multiple content items for a profile.
#[tauri::command]
pub async fn batch_check_content_installed(
    params: profile_utils::BatchCheckContentParams,
) -> Result<profile_utils::BatchContentInstallStatus, CommandError> {
    info!(
        "Executing batch_check_content_installed command for profile {} with {} items",
        params.profile_id,
        params.requests.len()
    );
    // Call the batch utility function and map the error
    Ok(profile_utils::check_content_installed_batch(params).await?)
}

/// Opens the latest log file for the specified profile using the system default application.
#[tauri::command]
pub async fn open_profile_latest_log<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    profile_id: Uuid,
) -> Result<(), CommandError> {
    info!(
        "Executing open_profile_latest_log command for profile {}",
        profile_id
    );

    // Call the utility function
    Ok(profile_utils::open_latest_log_for_profile(app_handle, profile_id).await?)
}

/// Gets the content of the latest log file for the specified profile.
#[tauri::command]
pub async fn get_profile_latest_log_content(profile_id: Uuid) -> Result<String, CommandError> {
    info!(
        "Executing get_profile_latest_log_content command for profile {}",
        profile_id
    );

    // Call the utility function
    Ok(profile_utils::get_latest_log_content(profile_id).await?)
}

/// Gets a list of all log file paths (.log and .log.gz) for the specified profile.
#[tauri::command]
pub async fn get_profile_log_files(profile_id: Uuid) -> Result<Vec<PathBuf>, CommandError> {
    info!(
        "Executing get_profile_log_files command for profile {}",
        profile_id
    );

    // Call the utility function
    Ok(profile_utils::list_log_files(profile_id).await?)
}

/// Gets the content of a specific log file (.log or .log.gz).
///
/// # Arguments
///
/// * `log_file_path` - The full path to the log file.
///
/// # Returns
///
/// Returns `Ok(String)` containing the log content on success.
/// Returns an empty string in `Ok` if the log file is not found or unsupported.
/// Returns an `AppError` if reading or decompression fails.
#[tauri::command]
pub async fn get_log_file_content(log_file_path: PathBuf) -> Result<String, CommandError> {
    info!(
        "Executing get_log_file_content command for file: {}",
        log_file_path.display()
    );

    // Call the utility function from file_utils
    Ok(crate::utils::file_utils::read_log_file_content(&log_file_path).await?)
}

#[tauri::command]
pub async fn get_worlds_for_profile(profile_id: Uuid) -> Result<Vec<WorldInfo>, CommandError> {
    info!(
        "Executing get_worlds_for_profile command for profile {}",
        profile_id
    );
    // Revert to calling the utility function
    Ok(mc_utils::get_profile_worlds(profile_id).await?)
}

#[tauri::command]
pub async fn get_servers_for_profile(
    profile_id: Uuid,
) -> Result<Vec<mc_utils::ServerInfo>, CommandError> {
    info!(
        "Executing get_servers_for_profile command for profile {}",
        profile_id
    );
    // Call the utility function and map the error
    Ok(mc_utils::get_profile_servers(profile_id).await?)
}

/// Copies a singleplayer world to another profile (or the same one) with a new name.
#[tauri::command]
pub async fn copy_world(params: CopyWorldParams) -> Result<String, CommandError> {
    info!(
        "Executing copy_world command: from profile {} ('{}') to profile {} (name: '{}')",
        params.source_profile_id,
        params.source_world_folder,
        params.target_profile_id,
        params.target_world_name
    );

    // Call the utility function
    let generated_folder_name = world_utils::copy_world_directory(
        params.source_profile_id,
        &params.source_world_folder,
        params.target_profile_id,
        &params.target_world_name,
    )
    .await?;

    // Optional: Trigger UI updates for the target profile if different from source
    if params.source_profile_id != params.target_profile_id {
        if let Ok(state) = State::get().await {
            if let Err(e) = state
                .event_state
                .trigger_profile_update(params.target_profile_id)
                .await
            {
                warn!(
                    "Failed to emit profile update event for target profile {}: {}",
                    params.target_profile_id, e
                );
            }
            // Optionally trigger for source profile too if needed, though less common for copy
            // if let Err(e) = state.event_state.trigger_profile_update(params.source_profile_id).await {
            //     warn!("Failed to emit profile update event for source profile {}: {}", params.source_profile_id, e);
            // }
        } else {
            warn!("Could not get state to emit profile update event after world copy.");
        }
    } else {
        // Source and target are the same, trigger update for that profile
        if let Ok(state) = State::get().await {
            if let Err(e) = state
                .event_state
                .trigger_profile_update(params.target_profile_id)
                .await
            {
                warn!(
                    "Failed to emit profile update event for profile {}: {}",
                    params.target_profile_id, e
                );
            }
        } else {
            warn!("Could not get state to emit profile update event after world copy.");
        }
    }

    info!(
        "Successfully executed copy_world command. New folder name: {}",
        generated_folder_name
    );
    Ok(generated_folder_name) // Return the actual folder name created
}

/// Checks if a specific world's session.lock file can be locked, indicating if it's likely in use.
#[tauri::command]
pub async fn check_world_lock_status(
    profile_id: Uuid,
    world_folder: String,
) -> Result<bool, CommandError> {
    info!(
        "Executing check_world_lock_status for profile {}, world '{}'",
        profile_id, world_folder
    );

    let state = State::get().await?;
    let profile_manager = &state.profile_manager;

    // Calculate the world path
    let instance_path = profile_manager
        .get_profile_instance_path(profile_id)
        .await?;
    let world_path = instance_path.join("saves").join(&world_folder);

    if !world_path.is_dir() {
        return Err(AppError::WorldNotFound {
            profile_id,
            world_folder,
        }
        .into());
    }

    // Call the utility function
    match world_utils::check_world_session_lock(&world_path).await {
        Ok(()) => {
            // Lock could be acquired -> world is NOT locked
            info!(
                "World '{}' in profile {} is not locked.",
                world_folder, profile_id
            );
            Ok(false)
        }
        Err(AppError::WorldLocked { .. }) => {
            // Lock could NOT be acquired -> world IS locked
            info!(
                "World '{}' in profile {} is locked.",
                world_folder, profile_id
            );
            Ok(true)
        }
        Err(e) => {
            // Other error during lock check
            error!(
                "Error checking lock status for world '{}' in profile {}: {}",
                world_folder, profile_id, e
            );
            Err(e.into()) // Propagate other errors
        }
    }
}

/// Deletes a specific world directory from a profile after checking the session lock.
#[tauri::command]
pub async fn delete_world(profile_id: Uuid, world_folder: String) -> Result<(), CommandError> {
    info!(
        "Executing delete_world command for profile {}, world '{}'",
        profile_id, world_folder
    );

    // Call the utility function to perform the deletion
    world_utils::delete_world_directory(profile_id, &world_folder).await?;

    // Trigger UI update for the affected profile
    if let Ok(state) = State::get().await {
        if let Err(e) = state.event_state.trigger_profile_update(profile_id).await {
            warn!(
                "Failed to emit profile update event after deleting world '{}' from profile {}: {}",
                world_folder, profile_id, e
            );
        }
    } else {
        warn!("Could not get state to emit profile update event after world deletion.");
    }

    info!("Successfully executed delete_world command.");
    Ok(())
}

// Added: Command to list screenshots for a profile
#[tauri::command]
pub async fn list_profile_screenshots(
    profile_id: Uuid,
) -> Result<Vec<ScreenshotInfo>, CommandError> {
    info!(
        "Executing list_profile_screenshots command for profile {}",
        profile_id
    );
    // Call the utility function from profile_utils, passing only the ID
    Ok(profile_utils::get_screenshots_for_profile(profile_id).await?)
}

// --- New DTO and Command for All Profiles and Last Played ---
#[derive(Serialize, Debug, Clone)]
pub struct AllProfilesAndLastPlayed {
    all_profiles: Vec<Profile>,
    last_played_profile_id: Option<Uuid>,
}

#[tauri::command]
pub async fn get_all_profiles_and_last_played() -> Result<AllProfilesAndLastPlayed, CommandError> {
    info!("Executing get_all_profiles_and_last_played command");
    let state = State::get().await?;

    // 1. Fetch User Profiles
    let user_profiles = state.profile_manager.list_profiles().await?;

    // 2. Fetch Standard Norisk Profiles
    let norisk_versions_config = state.norisk_version_manager.get_config().await;
    let standard_profiles = norisk_versions_config.profiles; // This is Vec<Profile>

    // 3. Combine Profiles
    let mut all_profiles_combined = user_profiles.clone();
    all_profiles_combined.extend(standard_profiles.clone());

    // Deduplicate based on ID, preferring user profiles if IDs clash (highly unlikely with UUIDs but safe)
    // This is a more robust way to combine, though simple concatenation is often fine.
    let mut unique_profiles_map: HashMap<Uuid, Profile> = HashMap::new();
    for profile in standard_profiles.iter() {
        unique_profiles_map.insert(profile.id, profile.clone());
    }
    for profile in user_profiles.iter() {
        // User profiles overwrite standard if same ID
        unique_profiles_map.insert(profile.id, profile.clone());
    }
    let all_profiles_final: Vec<Profile> = unique_profiles_map.values().cloned().collect();

    // 4. Handle `last_played_profile_id`
    let mut launcher_config = state.config_manager.get_config().await;
    let mut effective_last_played_id = launcher_config.last_played_profile;
    let mut config_needs_update = false;

    // Validate existing last_played_profile_id
    if let Some(id_to_check) = effective_last_played_id {
        let exists = all_profiles_final.iter().any(|p| p.id == id_to_check);
        if !exists {
            info!(
                "Last played profile ID {} no longer exists. Marking for reset.",
                id_to_check
            );
            effective_last_played_id = None; // Mark for reset logic below
                                             // The actual launcher_config.last_played_profile will be updated if a new default is found or it's set to None
        }
    }

    // If effective_last_played_id is None (either initially or after validation failed)
    if effective_last_played_id.is_none() {
        info!("Last played profile ID is not set or invalid. Attempting to set a default.");
        let new_default_id: Option<Uuid> = if !standard_profiles.is_empty() {
            standard_profiles.first().map(|p| p.id)
        } else if !user_profiles.is_empty() {
            user_profiles.first().map(|p| p.id)
        } else {
            None
        };

        // Check if the determined new_default_id is different from what's in the original config.
        // This ensures we only write to config if there's an actual change.
        if launcher_config.last_played_profile != new_default_id {
            info!(
                "Updating last_played_profile in config to: {:?}",
                new_default_id
            );
            launcher_config.last_played_profile = new_default_id;
            config_needs_update = true;
        }
        effective_last_played_id = new_default_id; // This is the ID to be returned
    }

    // Save config if it was changed
    if config_needs_update {
        if let Err(e) = state.config_manager.set_config(launcher_config).await {
            warn!("Failed to update launcher config with new last_played_profile_id: {}. Proceeding with potentially stale config value for this response.", e);
            // If saving fails, the effective_last_played_id we calculated is still returned,
            // but the config on disk might not reflect this change for the next app start.
        } else {
            info!("Successfully updated last_played_profile_id in launcher config.");
        }
    }

    Ok(AllProfilesAndLastPlayed {
        all_profiles: all_profiles_final,
        last_played_profile_id: effective_last_played_id,
    })
}

// --- DTO for GetLocalContent ---
// This DTO is no longer needed as we will use LoadItemsParams directly
/*
#[derive(Deserialize, Debug)]
pub struct GetLocalContentParams {
    profile_id: Uuid,
    content_type: String,
    calculate_hashes: bool,
    fetch_modrinth_data: bool,
}
*/

#[tauri::command]
pub async fn get_local_content(
    params: ProfileUtilLoadItemsParams, // Use LoadItemsParams directly from profile_utils
) -> Result<Vec<LocalContentItem>, CommandError> {
    info!(
        "Executing get_local_content command for profile {}, content_type: '{:?}', calc_hashes: {}, fetch_modrinth: {}",
        params.profile_id,
        params.content_type, // This is now the enum, so use {:?} for Debug display
        params.calculate_hashes,
        params.fetch_modrinth_data
    );

    // No need to map content_type string to enum, it's already the enum.
    // The loader_params creation is also simplified as params is already the correct type.

    match ProfileUtilLocalContentLoader::load_items(params.clone()).await {
        // .clone() if params is used later, or pass directly
        Ok(items) => {
            info!(
                "Successfully loaded {} items of type '{:?}' for profile {}",
                items.len(),
                params.content_type, // Log the enum directly
                params.profile_id
            );
            Ok(items)
        }
        Err(e) => {
            error!(
                "Failed to load content type '{:?}' for profile {}: {}",
                params.content_type, // Log the enum directly
                params.profile_id,
                e
            );
            Err(CommandError::from(e))
        }
    }
}

#[tauri::command]
pub async fn purge_trash(max_age_seconds: Option<u64>) -> Result<u64, CommandError> {
    let secs = max_age_seconds.unwrap_or(120);
    let removed = crate::utils::trash_utils::purge_expired(secs).await?;
    Ok(removed)
}
