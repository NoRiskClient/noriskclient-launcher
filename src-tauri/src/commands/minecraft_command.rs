use crate::error::{AppError, CommandError};
use crate::minecraft::api::fabric_api::FabricApi;
use crate::minecraft::api::forge_api::ForgeApi;
use crate::minecraft::api::mc_api::MinecraftApiService;
use crate::minecraft::api::mclogs_api::upload_log_to_mclogs;
use crate::minecraft::api::neo_forge_api::NeoForgeApi;
use crate::minecraft::api::quilt_api::QuiltApi;
use crate::minecraft::api::crafatar_api::{CrafatarApiService, GetCrafatarAvatarPayload};
use crate::minecraft::api::starlight_api::{GetSkinRenderPayload, StarlightApiService};
use crate::minecraft::dto::fabric_meta::FabricVersionInfo;
use crate::minecraft::dto::minecraft_profile::MinecraftProfile;
use crate::minecraft::dto::quilt_meta::QuiltVersionInfo;
use crate::minecraft::dto::VersionManifest;
use crate::state::skin_state::MinecraftSkin;
use crate::state::state_manager::State;
use crate::utils::mc_utils;
use log::{debug, error, info};
use std::path::PathBuf;
use std::sync::Arc;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

// --- New Imports for add_skin_locally ---
use crate::minecraft::dto::skin_payloads::{
    AddLocalSkinCommandPayload, SkinSource,
};
use crate::utils::mc_utils::{extract_skin_info_from_profile, get_base64_from_skin_source};
use chrono::Utc;
// --- End New Imports ---

#[tauri::command]
pub async fn get_minecraft_versions() -> Result<VersionManifest, CommandError> {
    debug!("Command called: get_minecraft_versions");
    let api_service = MinecraftApiService::new();
    let result = api_service
        .get_version_manifest()
        .await
        .map_err(|e| e.into());

    if result.is_ok() {
        debug!("Command completed: get_minecraft_versions");
    } else {
        debug!("Command failed: get_minecraft_versions");
    }

    result
}

#[tauri::command]
pub async fn upload_log_to_mclogs_command(log_content: String) -> Result<String, CommandError> {
    debug!("Command called: upload_log_to_mclogs_command");
    let result = upload_log_to_mclogs(log_content)
        .await
        .map(|result| {
            debug!("Successfully uploaded log to MCLogs");
            result.url
        })
        .map_err(|e| {
            debug!("Failed to upload log to MCLogs: {:?}", e);
            e.into()
        });

    debug!("Command completed: upload_log_to_mclogs_command");
    result
}

#[tauri::command]
pub async fn get_fabric_loader_versions(
    minecraft_version: String,
) -> Result<Vec<FabricVersionInfo>, CommandError> {
    let fabric_api = FabricApi::new();
    fabric_api
        .get_loader_versions(&minecraft_version)
        .await
        .map_err(|e| e.into())
}

#[tauri::command]
pub async fn get_quilt_loader_versions(
    minecraft_version: String,
) -> Result<Vec<QuiltVersionInfo>, CommandError> {
    let quilt_api = QuiltApi::new();
    quilt_api
        .get_loader_versions(&minecraft_version)
        .await
        .map_err(|e| e.into())
}

#[tauri::command]
pub async fn get_forge_versions(minecraft_version: String) -> Result<Vec<String>, CommandError> {
    let forge_api = ForgeApi::new();
    let metadata = forge_api
        .get_all_versions()
        .await
        .map_err(CommandError::from)?;

    let filtered_versions = metadata.get_versions_for_minecraft(&minecraft_version);
    Ok(filtered_versions)
}

#[tauri::command]
pub async fn get_neoforge_versions(minecraft_version: String) -> Result<Vec<String>, CommandError> {
    let neo_forge_api = NeoForgeApi::new();
    let metadata = neo_forge_api
        .get_all_versions()
        .await
        .map_err(CommandError::from)?;

    let filtered_versions = metadata.get_versions_for_minecraft(&minecraft_version);
    Ok(filtered_versions)
}

#[tauri::command]
pub async fn get_profile_by_name_or_uuid(
    name_or_uuid_query: String,
) -> Result<MinecraftProfile, CommandError> {
    debug!(
        "Command called: get_profile_by_name_or_uuid for query: {}",
        name_or_uuid_query
    );
    let api_service = MinecraftApiService::new();

    // This assumes MinecraftApiService has a method like `get_profile_by_name_or_uuid`
    // which intelligently handles whether the input is a name or a UUID.
    // If it's a name, it would first resolve it to a UUID, then fetch the profile.
    match api_service
        .get_profile_by_name_or_uuid(&name_or_uuid_query) // Hypothetical method
        .await
    {
        Ok(profile) => {
            debug!(
                "Successfully retrieved profile for query: {}",
                name_or_uuid_query
            );
            Ok(profile)
        }
        Err(e) => {
            debug!(
                "Failed to retrieve profile for query {}: {:?}",
                name_or_uuid_query, e
            );
            Err(CommandError::from(e))
        }
    }
}

/// Get the current user skin data
#[tauri::command]
pub async fn get_user_skin_data(
    uuid: String,
    access_token: Option<String>,
) -> Result<MinecraftProfile, CommandError> {
    debug!("Command called: get_user_skin_data for UUID: {}", uuid);
    let api_service = MinecraftApiService::new();

    let skin_data = match api_service.get_user_profile(&uuid).await {
        Ok(data) => {
            debug!("Successfully retrieved skin data for UUID: {}", uuid);
            data
        }
        Err(e) => {
            debug!("Failed to retrieve skin data for UUID {}: {:?}", uuid, e);
            return Err(CommandError::from(e));
        }
    };

    debug!("Command completed: get_user_skin_data");
    Ok(skin_data)
}

/// Upload a new skin
#[tauri::command]
pub async fn upload_skin<R: tauri::Runtime>(
    uuid: String,
    access_token: String,
    skin_variant: String,
    app: tauri::AppHandle<R>,
) -> Result<(), CommandError> {
    debug!(
        "Command called: upload_skin for UUID: {} with variant: {}",
        uuid, skin_variant
    );

    // Validate skin variant
    if skin_variant != "classic" && skin_variant != "slim" {
        debug!("Invalid skin variant: {}", skin_variant);
        return Err(CommandError::from(AppError::Other(format!(
            "Invalid skin variant. Must be 'classic' or 'slim'"
        ))));
    }

    debug!("Opening file dialog to select skin file");
    // Spawn the blocking dialog call onto a blocking thread pool
    let dialog_result = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("PNG Image", &["png"])
            .set_title("Select Minecraft Skin File")
            .blocking_pick_file()
    })
    .await
    .map_err(|e| {
        debug!("Dialog task failed: {}", e);
        CommandError::from(AppError::Other(format!("Dialog task failed: {}", e)))
    })?;

    let skin_path = match dialog_result {
        Some(file_path_obj) => match file_path_obj.into_path() {
            Ok(path) => {
                debug!("Selected skin file: {:?}", path);
                path
            }
            Err(e) => {
                debug!("Failed to convert selected file path: {}", e);
                return Err(CommandError::from(AppError::Other(format!(
                    "Failed to convert selected file path: {}",
                    e
                ))));
            }
        },
        None => {
            debug!("No skin file selected");
            return Err(CommandError::from(AppError::Other(
                "No skin file selected".to_string(),
            )));
        }
    };

    debug!("Reading skin file content");
    // Read skin file as bytes
    let file_content = match std::fs::read(&skin_path) {
        Ok(content) => {
            debug!("Successfully read skin file ({} bytes)", content.len());
            content
        }
        Err(e) => {
            debug!("Failed to read skin file: {}", e);
            return Err(CommandError::from(AppError::Other(format!(
                "Failed to read skin file: {}",
                e
            ))));
        }
    };

    // Get filename from path to use as skin name
    let filename = skin_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("skin.png")
        .to_string();

    // Remove the .png extension if present
    let skin_name = if filename.to_lowercase().ends_with(".png") {
        filename[..filename.len() - 4].to_string()
    } else {
        filename
    };
    debug!("Using skin name: {}", skin_name);

    // Create a new API service instance
    let api_service = MinecraftApiService::new();

    debug!("Uploading skin to Minecraft API");
    // Upload the skin
    match api_service
        .change_skin(
            &access_token,
            &uuid,
            skin_path.to_str().unwrap_or(""),
            &skin_variant,
        )
        .await
    {
        Ok(_) => debug!("Successfully uploaded skin to Minecraft API"),
        Err(e) => {
            debug!("Failed to upload skin to Minecraft API: {:?}", e);
            return Err(CommandError::from(e));
        }
    }

    // Convert the file content to base64
    let base64_data = base64::encode(&file_content);
    debug!(
        "Converted skin to base64 ({} characters)",
        base64_data.len()
    );

    debug!("Saving skin to local database");
    // Save the skin to the local database
    let state = match State::get().await {
        Ok(s) => s,
        Err(e) => {
            debug!("Failed to get state: {:?}", e);
            return Err(CommandError::from(e));
        }
    };

    // Create a new skin with a unique ID
    let skin_id = Uuid::new_v4().to_string();
    debug!("Created new skin ID: {}", skin_id);

    let skin = MinecraftSkin {
        id: skin_id,
        name: skin_name,
        base64_data,
        variant: skin_variant,
        description: format!("Uploaded on {}", chrono::Local::now().format("%Y-%m-%d")),
        added_at: chrono::Utc::now(),
    };

    // Add the skin to the database
    match state.skin_manager.add_skin(skin).await {
        Ok(_) => debug!("Successfully added skin to local database"),
        Err(e) => {
            debug!("Failed to add skin to local database: {:?}", e);
            return Err(CommandError::from(e));
        }
    }

    debug!("Command completed: upload_skin");
    Ok(())
}

/// Reset skin to default
#[tauri::command]
pub async fn reset_skin(uuid: String, access_token: String) -> Result<(), CommandError> {
    debug!("Command called: reset_skin for UUID: {}", uuid);

    // Create a new API service instance
    let api_service = MinecraftApiService::new();

    debug!("Resetting skin to default via Minecraft API");
    // Reset skin
    match api_service.reset_skin(&access_token, &uuid).await {
        Ok(_) => debug!("Successfully reset skin to default"),
        Err(e) => {
            debug!("Failed to reset skin: {:?}", e);
            return Err(CommandError::from(e));
        }
    }

    debug!("Command completed: reset_skin");
    Ok(())
}

/// Get all skins from the local database
#[tauri::command]
pub async fn get_all_skins() -> Result<Vec<MinecraftSkin>, CommandError> {
    debug!("Command called: get_all_skins");

    let state = match State::get().await {
        Ok(s) => s,
        Err(e) => {
            debug!("Failed to get state: {:?}", e);
            return Err(CommandError::from(e));
        }
    };

    let skins = state.skin_manager.get_all_skins().await;
    debug!("Retrieved {} skins from local database", skins.len());

    debug!("Command completed: get_all_skins");
    Ok(skins)
}

/// Get a skin by ID from the local database
#[tauri::command]
pub async fn get_skin_by_id(id: String) -> Result<Option<MinecraftSkin>, CommandError> {
    debug!("Command called: get_skin_by_id with ID: {}", id);

    let state = match State::get().await {
        Ok(s) => s,
        Err(e) => {
            debug!("Failed to get state: {:?}", e);
            return Err(CommandError::from(e));
        }
    };

    let skin = state.skin_manager.get_skin_by_id(&id).await;
    if skin.is_some() {
        debug!("Found skin with ID: {}", id);
    } else {
        debug!("No skin found with ID: {}", id);
    }

    debug!("Command completed: get_skin_by_id");
    Ok(skin)
}

/// Add a skin to the local database
#[tauri::command]
pub async fn add_skin(
    name: String,
    base64_data: String,
    variant: String,
    description: Option<String>,
) -> Result<MinecraftSkin, CommandError> {
    debug!(
        "Command called: add_skin with name: {}, variant: {}",
        name, variant
    );

    // Validate skin variant
    if variant != "classic" && variant != "slim" {
        debug!("Invalid skin variant: {}", variant);
        return Err(CommandError::from(AppError::Other(format!(
            "Invalid skin variant. Must be 'classic' or 'slim'"
        ))));
    }

    // Create a new skin with a unique ID
    let skin_id = Uuid::new_v4().to_string();
    debug!("Created new skin ID: {}", skin_id);

    let skin = MinecraftSkin {
        id: skin_id,
        name,
        base64_data,
        variant,
        description: description.unwrap_or_default(),
        added_at: chrono::Utc::now(),
    };

    debug!("Adding skin to local database");
    // Add the skin to the database
    let state = match State::get().await {
        Ok(s) => s,
        Err(e) => {
            debug!("Failed to get state: {:?}", e);
            return Err(CommandError::from(e));
        }
    };

    match state.skin_manager.add_skin(skin.clone()).await {
        Ok(_) => debug!("Successfully added skin to local database"),
        Err(e) => {
            debug!("Failed to add skin to local database: {:?}", e);
            return Err(CommandError::from(e));
        }
    }

    debug!("Command completed: add_skin");
    Ok(skin)
}

/// Remove a skin from the local database
#[tauri::command]
pub async fn remove_skin(id: String) -> Result<bool, CommandError> {
    debug!("Command called: remove_skin with ID: {}", id);

    let state = match State::get().await {
        Ok(s) => s,
        Err(e) => {
            debug!("Failed to get state: {:?}", e);
            return Err(CommandError::from(e));
        }
    };

    let removed = match state.skin_manager.remove_skin(&id).await {
        Ok(r) => {
            if r {
                debug!("Successfully removed skin with ID: {}", id);
            } else {
                debug!("No skin found with ID: {}", id);
            }
            r
        }
        Err(e) => {
            debug!("Failed to remove skin: {:?}", e);
            return Err(CommandError::from(e));
        }
    };

    debug!("Command completed: remove_skin");
    Ok(removed)
}

/// Apply a skin from base64 data
#[tauri::command]
pub async fn apply_skin_from_base64(
    uuid: String,
    access_token: String,
    base64_data: String,
    skin_variant: String,
) -> Result<(), CommandError> {
    debug!(
        "Command called: apply_skin_from_base64 for UUID: {} with variant: {}",
        uuid, skin_variant
    );
    debug!("Base64 data length: {} characters", base64_data.len());

    // Validate skin variant
    if skin_variant != "classic" && skin_variant != "slim" {
        debug!("Invalid skin variant: {}", skin_variant);
        return Err(CommandError::from(AppError::Other(format!(
            "Invalid skin variant. Must be 'classic' or 'slim'"
        ))));
    }

    // Create a new API service instance
    let api_service = MinecraftApiService::new();

    debug!("Applying skin from base64 data via Minecraft API");
    // Apply the skin using base64 data
    match api_service
        .change_skin_from_base64(&access_token, &base64_data, &skin_variant)
        .await
    {
        Ok(_) => debug!("Successfully applied skin from base64 data"),
        Err(e) => {
            debug!("Failed to apply skin from base64 data: {:?}", e);
            return Err(CommandError::from(e));
        }
    }

    debug!("Command completed: apply_skin_from_base64");
    Ok(())
}

/// Update skin properties (name and variant)
#[tauri::command]
pub async fn update_skin_properties(
    id: String,
    name: String,
    variant: String,
) -> Result<Option<MinecraftSkin>, CommandError> {
    debug!("Command called: update_skin_properties for ID: {}", id);
    debug!("New name: {}, New variant: {}", name, variant);

    // Validate skin variant
    if variant != "classic" && variant != "slim" {
        debug!("Invalid skin variant: {}", variant);
        return Err(CommandError::from(AppError::Other(format!(
            "Invalid skin variant. Must be 'classic' or 'slim'"
        ))));
    }

    let state = match State::get().await {
        Ok(s) => s,
        Err(e) => {
            debug!("Failed to get state: {:?}", e);
            return Err(CommandError::from(e));
        }
    };

    let updated_skin = match state
        .skin_manager
        .update_skin_properties(&id, name, variant)
        .await
    {
        Ok(skin) => {
            if let Some(s) = &skin {
                debug!("Successfully updated skin properties for ID: {}", id);
            } else {
                debug!("No skin found with ID: {}", id);
            }
            skin
        }
        Err(e) => {
            debug!("Failed to update skin properties: {:?}", e);
            return Err(CommandError::from(e));
        }
    };

    debug!("Command completed: update_skin_properties");
    Ok(updated_skin)
}

/// Pings a Minecraft server to get its status information.
#[tauri::command]
pub async fn ping_minecraft_server(
    address: String,
) -> Result<mc_utils::ServerPingInfo, CommandError> {
    info!(
        "Command called: ping_minecraft_server for address: {}",
        address
    );

    // Call the utility function
    // ping_server_status itself returns ServerPingInfo directly,
    // including potential errors within the struct.
    // It does not return a Result<> that needs mapping here.
    let ping_result = mc_utils::ping_server_status(&address).await;

    // No mapping needed as the function handles errors internally by returning them in the struct
    Ok(ping_result)
}

#[tauri::command]
pub async fn add_skin_locally(
    payload: AddLocalSkinCommandPayload,
) -> Result<MinecraftSkin, CommandError> {
    info!(
        "[CMD] add_skin_locally: TargetName='{}', TargetVariant='{}', SourceType={:?}",
        payload.target_skin_name, payload.target_skin_variant, payload.source
    );

    let mut final_skin_name = payload.target_skin_name.clone();
    let mut final_skin_variant = payload.target_skin_variant.clone();

    // Extract base64 data using the reusable function
    let base64_data = get_base64_from_skin_source(&payload.source).await?;

    // Handle special cases for Profile and FilePath sources where we need additional metadata
    match &payload.source {
        SkinSource::Profile(profile_data) => {
            // For profile sources, we need to extract the profile name
            // But we keep the user's chosen variant instead of overwriting it
            let api_service = MinecraftApiService::new();
            let profile = api_service
                .get_profile_by_name_or_uuid(&profile_data.query)
                .await?;

            let (_, _, profile_name) = extract_skin_info_from_profile(&profile)?;

            if final_skin_name.is_empty() {
                final_skin_name = profile_name;
            }
            // NOTE: We keep the user's chosen final_skin_variant
            // instead of overwriting it with source_variant
        }
        SkinSource::FilePath(filepath_data) => {
            // For file path sources, we need to extract the filename if no name is provided
            if final_skin_name.is_empty() {
                let mut corrected_path_string = filepath_data.path.clone();
                if cfg!(windows) {
                    // Example: /C:/Users/username -> C:/Users/username
                    if corrected_path_string.starts_with("/")
                        && corrected_path_string.len() > 2
                        && corrected_path_string.chars().nth(2) == Some(':')
                    {
                        corrected_path_string.remove(0);
                    }
                }
                let corrected_path = PathBuf::from(corrected_path_string);
                final_skin_name = corrected_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("skin_from_file")
                    .to_string();
            }
        }
        _ => {
            // For Url and Base64 sources, we don't need any special handling
        }
    }

    if final_skin_name.is_empty() {
        error!("[CMD] add_skin_locally: Final skin name is empty after processing source.");
        return Err(CommandError::from(AppError::InvalidInput(
            "Skin name cannot be empty. Please provide a name or ensure the source can provide one (e.g., profile name, filename).".to_string()
        )));
    }

    debug!(
        "[CMD] add_skin_locally: Attempting to save skin to local database. Name: '{}', Variant: '{}'",
        final_skin_name,
        final_skin_variant
    );
    let state = State::get().await?;

    let new_skin_id = Uuid::new_v4().to_string();
    let current_time = Utc::now();

    let skin_to_add = MinecraftSkin {
        id: new_skin_id,
        name: final_skin_name,
        base64_data,
        variant: final_skin_variant.to_string(),
        description: payload
            .description
            .unwrap_or_else(|| format!("Added on {}", current_time.format("%Y-%m-%d"))),
        added_at: current_time,
    };

    state.skin_manager.add_skin(skin_to_add.clone()).await?;
    info!(
        "[CMD] add_skin_locally: Successfully added skin '{}' (ID: {}) to local database.",
        skin_to_add.name, skin_to_add.id
    );
    Ok(skin_to_add)
}

#[tauri::command]
pub async fn get_base64_from_skin_source_command(
    source: SkinSource,
) -> Result<String, CommandError> {
    debug!(
        "[CMD] get_base64_from_skin_source_command: Processing source type: {:?}",
        source
    );

    let base64_data = get_base64_from_skin_source(&source).await?;

    debug!(
        "[CMD] get_base64_from_skin_source_command: Successfully extracted base64 data ({} characters)",
        base64_data.len()
    );

    Ok(base64_data)
}

#[tauri::command]
pub async fn get_starlight_skin_render(
    payload: GetSkinRenderPayload,
) -> Result<PathBuf, CommandError> {
    debug!(
        "Command called: get_starlight_skin_render with payload: {:?}",
        payload
    );

    let starlight_service = match StarlightApiService::new() {
        Ok(service) => service,
        Err(e) => {
            error!(
                "[CMD] get_starlight_skin_render: Failed to create StarlightApiService: {:?}",
                e
            );
            return Err(CommandError::from(e));
        }
    };

    match starlight_service
        .get_skin_render(
            &payload.player_name,
            &payload.render_type,
            &payload.render_view,
            payload.base64_skin_data,
        )
        .await
    {
        Ok(path_buf) => {
            debug!(
                "Command completed: get_starlight_skin_render, path: {:?}",
                path_buf
            );
            Ok(path_buf)
        }
        Err(e) => {
            error!("Command failed: get_starlight_skin_render: {:?}", e);
            Err(CommandError::from(e))
        }
    }
}

#[tauri::command]
pub async fn get_crafatar_avatar(
    payload: GetCrafatarAvatarPayload,
) -> Result<PathBuf, CommandError> {
    debug!(
        "Command called: get_crafatar_avatar with payload: {:?}",
        payload
    );

    let crafatar_service = match CrafatarApiService::new() {
        Ok(service) => service,
        Err(e) => {
            error!(
                "[CMD] get_crafatar_avatar: Failed to create CrafatarApiService: {:?}",
                e
            );
            return Err(CommandError::from(e));
        }
    };

    match crafatar_service
        .get_avatar(&payload.uuid, payload.size, payload.overlay)
        .await
    {
        Ok(path_buf) => {
            debug!(
                "Command completed: get_crafatar_avatar, path: {:?}",
                path_buf
            );
            Ok(path_buf)
        }
        Err(e) => {
            error!("Command failed: get_crafatar_avatar: {:?}", e);
            Err(CommandError::from(e))
        }
    }
}
