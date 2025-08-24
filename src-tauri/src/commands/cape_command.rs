use crate::error::{AppError, CommandError};
use crate::minecraft::api::cape_api::{CapeApi, CapesBrowseResponse, CosmeticCape};
use crate::minecraft::api::mc_api::MinecraftApiService;
use crate::state::state_manager::State;
use log::{debug, error};
use serde::Deserialize;
use std::path::PathBuf;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

// Define a struct to hold all parameters for browse_capes
#[derive(Deserialize, Debug)]
pub struct BrowseCapesPayload {
    page: Option<u32>,
    page_size: Option<u32>,
    sort_by: Option<String>,
    filter_has_elytra: Option<bool>,
    filter_creator: Option<String>,
    time_frame: Option<String>,
    norisk_token: Option<String>,
    request_uuid: Option<String>,
}

/// Browse capes with optional parameters
///
/// Parameters are now passed via the BrowseCapesPayload struct
#[tauri::command]
pub async fn browse_capes(
    payload: BrowseCapesPayload,
) -> Result<CapesBrowseResponse, CommandError> {
    debug!("Command called: browse_capes");
    debug!("Payload: {:?}", payload);

    // Get the state manager
    let state = State::get().await?;

    // Get the is_experimental value from the config state
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    // Get the active account
    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    // Get the NoRisk token: prioritize passed token, otherwise get from active account
    let token_to_use = match payload.norisk_token {
        Some(token) => {
            debug!("Using provided NoRisk token.");
            token
        }
        None => {
            debug!("No token provided, retrieving from active account.");
            active_account
                .norisk_credentials
                .get_token_for_mode(is_experimental)?
        }
    };

    let cape_api = CapeApi::new();

    // Convert filter_creator from String to Uuid if provided
    let filter_creator_uuid = if let Some(creator_str) = payload.filter_creator {
        match Uuid::parse_str(&creator_str) {
            Ok(uuid) => Some(uuid),
            Err(e) => {
                debug!("Invalid UUID format for filter_creator: {}", e);
                return Err(CommandError::from(AppError::InvalidInput(format!(
                    "Invalid UUID format for filter_creator: {}",
                    e
                ))));
            }
        }
    } else {
        None
    };

    // Determine the request UUID to use
    let uuid_to_use = match payload.request_uuid {
        Some(uuid) => {
            debug!("Using provided request UUID: {}", uuid);
            uuid
        }
        None => {
            debug!(
                "No request UUID provided, using active account ID: {}",
                active_account.id
            );
            active_account.id.to_string()
        }
    };

    let result = cape_api
        .browse_capes(
            &token_to_use,
            payload.page,
            payload.page_size,
            payload.sort_by.as_deref(),
            payload.filter_has_elytra,
            filter_creator_uuid.as_ref(),
            payload.time_frame.as_deref(),
            &uuid_to_use,
            is_experimental,
        )
        .await
        .map_err(|e| {
            debug!("Failed to browse capes: {:?}", e);
            CommandError::from(e)
        });

    if result.is_ok() {
        debug!("Command completed: browse_capes");
    } else {
        debug!("Command failed: browse_capes");
    }

    result
}

#[derive(Deserialize, Debug)]
pub struct GetPlayerCapesPayload {
    pub player_identifier: String,
    pub norisk_token: Option<String>,
    pub request_uuid: Option<String>,
}

/// Get capes for a specific player
///
/// Parameters:
/// - player_identifier: UUID or username of the player
/// - request_uuid: UUID for tracking the request (optional)
/// - norisk_token: Optional NoRisk token
#[tauri::command]
pub async fn get_player_capes(
    payload: GetPlayerCapesPayload,
) -> Result<Vec<CosmeticCape>, CommandError> {
    debug!(
        "[CMD get_player_capes] Initial payload received: {:?}",
        payload
    );

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!(
        "[CMD get_player_capes] Using experimental mode: {}",
        is_experimental
    );

    let active_account_opt = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?;

    let player_uuid_to_use: Uuid = match Uuid::parse_str(&payload.player_identifier) {
        Ok(uuid) => {
            debug!(
                "[CMD get_player_capes] Successfully parsed player_identifier as UUID: {}",
                uuid
            );
            uuid
        }
        Err(_) => {
            debug!(
                "[CMD get_player_capes] player_identifier '{}' is not a UUID, attempting to resolve as name.",
                payload.player_identifier
            );
            let api_service = MinecraftApiService::new();
            let profile = api_service
                .get_profile_by_name_or_uuid(&payload.player_identifier)
                .await?;
            match Uuid::parse_str(&profile.id) {
                Ok(resolved_uuid) => {
                    debug!(
                        "[CMD get_player_capes] Resolved player name '{}' to UUID: {}",
                        payload.player_identifier, resolved_uuid
                    );
                    resolved_uuid
                }
                Err(e) => {
                    error!("[CMD get_player_capes] Failed to parse UUID from resolved profile for '{}'. Profile ID: '{}'. Error: {}", payload.player_identifier, profile.id, e);
                    return Err(CommandError::from(AppError::InvalidInput(format!(
                        "Could not resolve player '{}' to a valid UUID.",
                        payload.player_identifier
                    ))));
                }
            }
        }
    };
    debug!(
        "[CMD get_player_capes] Final player_uuid_to_use for API call: {}",
        player_uuid_to_use
    );

    let token_to_use = match payload.norisk_token {
        Some(token) => {
            debug!("[CMD get_player_capes] Using norisk_token from payload.");
            token
        }
        None => {
            debug!("[CMD get_player_capes] No norisk_token in payload, attempting to use token from active account.");
            let acc = active_account_opt.as_ref().ok_or_else(|| {
                error!("[CMD get_player_capes] NoRisk token required (neither in payload nor from active account).");
                CommandError::from(AppError::NoCredentialsError)
            })?;
            acc.norisk_credentials.get_token_for_mode(is_experimental)?
        }
    };
    debug!(
        "[CMD get_player_capes] Token to use (first/last 8 chars): {}...{}",
        &token_to_use[..std::cmp::min(8, token_to_use.len())],
        &token_to_use[std::cmp::max(0, token_to_use.len().saturating_sub(8))..]
    );

    let cape_api = CapeApi::new();

    let uuid_for_request = match payload.request_uuid {
        Some(uuid) => {
            debug!(
                "[CMD get_player_capes] Using request_uuid from payload: {}",
                uuid
            );
            uuid
        }
        None => match active_account_opt.as_ref() {
            Some(acc) => {
                debug!("[CMD get_player_capes] No request_uuid in payload, using active account ID: {}", acc.id);
                acc.id.to_string()
            }
            None => {
                let new_req_uuid = Uuid::new_v4().to_string();
                debug!("[CMD get_player_capes] No request_uuid in payload and no active account, generated new request_uuid: {}", new_req_uuid);
                new_req_uuid
            }
        },
    };
    debug!(
        "[CMD get_player_capes] Request UUID for API call: {}",
        uuid_for_request
    );
    debug!("[CMD get_player_capes] Calling cape_api.get_player_capes with player_uuid: {}, request_uuid: {}, is_experimental: {}", 
        player_uuid_to_use, uuid_for_request, is_experimental);

    cape_api
        .get_player_capes(
            &token_to_use,
            &player_uuid_to_use,
            &uuid_for_request,
            is_experimental,
        )
        .await
        .map_err(|e| {
            error!(
                "[CMD get_player_capes] Error from cape_api.get_player_capes: {:?}",
                e
            );
            CommandError::from(e)
        })
}

/// Equip a specific cape for a player
///
/// Parameters:
/// - cape_hash: Hash of the cape to equip
/// - norisk_token: Optional NoRisk token
/// - player_uuid: Optional UUID of the player (defaults to active account)
#[tauri::command]
pub async fn equip_cape(
    cape_hash: String,
    norisk_token: Option<String>,
    player_uuid: Option<Uuid>,
) -> Result<(), CommandError> {
    debug!(
        "Command called: equip_cape for cape_hash: {}, player_uuid: {:?}",
        cape_hash, player_uuid
    );

    // Get the state manager
    let state = State::get().await?;

    // Get the is_experimental value from the config state
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    // Get the active account
    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    // Get the NoRisk token: prioritize passed token, otherwise get from active account
    let token_to_use = match norisk_token {
        Some(token) => {
            debug!("Using provided NoRisk token.");
            token
        }
        None => {
            debug!("No token provided, retrieving from active account.");
            active_account
                .norisk_credentials
                .get_token_for_mode(is_experimental)?
        }
    };

    let cape_api = CapeApi::new();

    // Determine the player UUID to use
    let uuid_to_use = match player_uuid {
        Some(uuid) => {
            debug!("Using provided player UUID: {}", uuid);
            uuid
        }
        None => {
            debug!(
                "No player UUID provided, using active account ID: {}",
                active_account.id
            );
            active_account.id
        }
    };

    let result = cape_api
        .equip_cape(&token_to_use, &uuid_to_use, &cape_hash, is_experimental)
        .await
        .map_err(|e| {
            debug!("Failed to equip cape: {:?}", e);
            CommandError::from(e)
        });

    if result.is_ok() {
        debug!("Command completed: equip_cape");
    } else {
        debug!("Command failed: equip_cape");
    }

    result
}

/// Add a cape to the user's favorites
///
/// Parameters:
/// - cape_hash: Hash of the cape to favorite
/// - norisk_token: Optional NoRisk token
#[tauri::command]
pub async fn add_favorite_cape(
    cape_hash: String,
    norisk_token: Option<String>,
) -> Result<Vec<String>, CommandError> {
    debug!(
        "Command called: add_favorite_cape for cape_hash: {}",
        cape_hash
    );

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    let token_to_use = match norisk_token {
        Some(token) => {
            debug!("Using provided NoRisk token.");
            token
        }
        None => {
            debug!("No token provided, retrieving from active account.");
            active_account
                .norisk_credentials
                .get_token_for_mode(is_experimental)?
        }
    };

    let cape_api = CapeApi::new();

    cape_api
        .add_favorite_cape(&token_to_use, &cape_hash, is_experimental)
        .await
        .map_err(|e| {
            debug!("Failed to add favorite cape: {:?}", e);
            CommandError::from(e)
        })
}

/// Get multiple capes by hashes (max 100)
#[tauri::command]
pub async fn get_capes_by_hashes(
    hashes: Vec<String>,
    norisk_token: Option<String>,
) -> Result<Vec<CosmeticCape>, CommandError> {
    debug!(
        "Command called: get_capes_by_hashes (count={})",
        hashes.len()
    );

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    let token_to_use = match norisk_token {
        Some(token) => {
            debug!("Using provided NoRisk token.");
            token
        }
        None => {
            debug!("No token provided, retrieving from active account.");
            active_account
                .norisk_credentials
                .get_token_for_mode(is_experimental)?
        }
    };

    let cape_api = CapeApi::new();

    cape_api
        .get_capes_by_hashes(&token_to_use, &hashes, is_experimental)
        .await
        .map_err(|e| {
            debug!("Failed to get capes by hashes: {:?}", e);
            CommandError::from(e)
        })
}

/// Remove a cape from the user's favorites
///
/// Parameters:
/// - cape_hash: Hash of the cape to remove from favorites
/// - norisk_token: Optional NoRisk token
#[tauri::command]
pub async fn remove_favorite_cape(
    cape_hash: String,
    norisk_token: Option<String>,
) -> Result<Vec<String>, CommandError> {
    debug!(
        "Command called: remove_favorite_cape for cape_hash: {}",
        cape_hash
    );

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    let token_to_use = match norisk_token {
        Some(token) => {
            debug!("Using provided NoRisk token.");
            token
        }
        None => {
            debug!("No token provided, retrieving from active account.");
            active_account
                .norisk_credentials
                .get_token_for_mode(is_experimental)?
        }
    };

    let cape_api = CapeApi::new();

    cape_api
        .remove_favorite_cape(&token_to_use, &cape_hash, is_experimental)
        .await
        .map_err(|e| {
            debug!("Failed to remove favorite cape: {:?}", e);
            CommandError::from(e)
        })
}

/// Delete a specific cape owned by the player
///
/// Parameters:
/// - cape_hash: Hash of the cape to delete
/// - norisk_token: Optional NoRisk token
/// - player_uuid: Optional UUID of the player (defaults to active account)
#[tauri::command]
pub async fn delete_cape(
    cape_hash: String,
    norisk_token: Option<String>,
    player_uuid: Option<Uuid>,
) -> Result<(), CommandError> {
    debug!(
        "Command called: delete_cape for cape_hash: {}, player_uuid: {:?}",
        cape_hash, player_uuid
    );

    // Get the state manager
    let state = State::get().await?;

    // Get the is_experimental value from the config state
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    // Get the active account
    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    // Get the NoRisk token: prioritize passed token, otherwise get from active account
    let token_to_use = match norisk_token {
        Some(token) => {
            debug!("Using provided NoRisk token.");
            token
        }
        None => {
            debug!("No token provided, retrieving from active account.");
            active_account
                .norisk_credentials
                .get_token_for_mode(is_experimental)?
        }
    };

    let cape_api = CapeApi::new();

    // Determine the player UUID to use
    let uuid_to_use = match player_uuid {
        Some(uuid) => {
            debug!("Using provided player UUID: {}", uuid);
            uuid
        }
        None => {
            debug!(
                "No player UUID provided, using active account ID: {}",
                active_account.id
            );
            active_account.id
        }
    };

    let result = cape_api
        .delete_cape(&token_to_use, &uuid_to_use, &cape_hash, is_experimental)
        .await
        .map_err(|e| {
            debug!("Failed to delete cape: {:?}", e);
            CommandError::from(e)
        });

    if result.is_ok() {
        debug!("Command completed: delete_cape");
    } else {
        debug!("Command failed: delete_cape");
    }

    result
}

/// Upload a new cape image for the active player
///
/// Parameters:
/// - image_path: Path to the cape image file (PNG)
/// - norisk_token: Optional NoRisk token
/// - player_uuid: Optional UUID of the player (defaults to active account)
#[tauri::command]
pub async fn upload_cape(
    image_path: String,
    norisk_token: Option<String>,
    player_uuid: Option<Uuid>,
) -> Result<String, CommandError> {
    debug!(
        "Command called: upload_cape with image_path: {}, player_uuid: {:?}",
        image_path, player_uuid
    );

    // Get the state manager
    let state = State::get().await?;

    // Get the is_experimental value from the config state
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    // Get the active account
    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    // Get the NoRisk token: prioritize passed token, otherwise get from active account
    let token_to_use = match norisk_token {
        Some(token) => {
            debug!("Using provided NoRisk token.");
            token
        }
        None => {
            debug!("No token provided, retrieving from active account.");
            active_account
                .norisk_credentials
                .get_token_for_mode(is_experimental)?
        }
    };

    let cape_api = CapeApi::new();

    // Determine the player UUID to use
    let uuid_to_use = match player_uuid {
        Some(uuid) => {
            debug!("Using provided player UUID: {}", uuid);
            uuid
        }
        None => {
            debug!(
                "No player UUID provided, using active account ID: {}",
                active_account.id
            );
            active_account.id
        }
    };

    // Convert image_path string to PathBuf
    let image_path_buf = PathBuf::from(image_path);

    let result = cape_api
        .upload_cape(
            &token_to_use,
            &uuid_to_use,
            &image_path_buf,
            is_experimental,
        )
        .await
        .map_err(|e| {
            debug!("Failed to upload cape: {:?}", e);
            CommandError::from(e)
        });

    if result.is_ok() {
        debug!("Command completed: upload_cape");
    } else {
        debug!("Command failed: upload_cape");
    }

    result
}

/// Unequip the currently equipped cape for the active player
///
/// Parameters:
/// - norisk_token: Optional NoRisk token
/// - player_uuid: Optional UUID of the player (defaults to active account)
#[tauri::command]
pub async fn unequip_cape(
    norisk_token: Option<String>,
    player_uuid: Option<Uuid>,
) -> Result<(), CommandError> {
    debug!(
        "Command called: unequip_cape for player_uuid: {:?}",
        player_uuid
    );

    // Get the state manager
    let state = State::get().await?;

    // Get the is_experimental value from the config state
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    // Get the active account
    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    // Get the NoRisk token: prioritize passed token, otherwise get from active account
    let token_to_use = match norisk_token {
        Some(token) => {
            debug!("Using provided NoRisk token.");
            token
        }
        None => {
            debug!("No token provided, retrieving from active account.");
            active_account
                .norisk_credentials
                .get_token_for_mode(is_experimental)?
        }
    };

    let cape_api = CapeApi::new();

    // Determine the player UUID to use
    let uuid_to_use = match player_uuid {
        Some(uuid) => {
            debug!("Using provided player UUID: {}", uuid);
            uuid
        }
        None => {
            debug!(
                "No player UUID provided, using active account ID: {}",
                active_account.id
            );
            active_account.id
        }
    };

    let result = cape_api
        .unequip_cape(&token_to_use, &uuid_to_use, is_experimental)
        .await
        .map_err(|e| {
            debug!("Failed to unequip cape: {:?}", e);
            CommandError::from(e)
        });

    if result.is_ok() {
        debug!("Command completed: unequip_cape");
    } else {
        debug!("Command failed: unequip_cape");
    }

    result
}

/// Download a cape template and open the explorer to the file
///
/// Downloads the template to the user's download directory and opens the folder
#[tauri::command]
pub async fn download_template_and_open_explorer(
    app_handle: tauri::AppHandle,
) -> Result<(), CommandError> {
    debug!("Command called: download_template_and_open_explorer");

    // Get the state manager
    let state = State::get().await?;

    // Get the is_experimental value from the config state
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    // Set template URL based on experimental mode
    let template_url = if is_experimental {
        "https://cdn.norisk.gg/capes-staging/template.png"
    } else {
        "https://cdn.norisk.gg/capes/template.png"
    };
    debug!("Template URL: {}", template_url);

    // Get user's download directory
    let user_dirs = directories::UserDirs::new().ok_or_else(|| {
        CommandError::from(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Failed to get user directories",
        )))
    })?;

    let downloads_dir = user_dirs.download_dir().ok_or_else(|| {
        CommandError::from(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Failed to get downloads directory",
        )))
    })?;

    debug!("Downloads directory: {:?}", downloads_dir);

    // Create the output file path
    let file_path = downloads_dir.join("nrc_cape_template.png");
    let file_path_str = file_path.to_string_lossy().to_string();

    // Download the template using reqwest
    let response = crate::config::HTTP_CLIENT
        .get(template_url)
        .send()
        .await
        .map_err(|e| {
            error!("Error downloading template: {:?}", e);
            CommandError::from(AppError::RequestError(format!(
                "Error downloading template: {}",
                e
            )))
        })?;

    // Read response bytes
    let template_bytes = response.bytes().await.map_err(|e| {
        error!("Error reading template bytes: {:?}", e);
        CommandError::from(AppError::RequestError(format!(
            "Error reading template bytes: {}",
            e
        )))
    })?;

    // Save the template to the file using tokio's async file operations
    tokio::fs::write(&file_path, &template_bytes)
        .await
        .map_err(|e| {
            error!("Error writing template file: {:?}", e);
            CommandError::from(AppError::Io(e))
        })?;

    debug!("Template downloaded to: {:?}", file_path);

    // Use the Tauri opener plugin to reveal the file in the explorer
    app_handle
        .opener()
        .reveal_item_in_dir(file_path_str)
        .map_err(|e| {
            error!("Error revealing file in directory: {:?}", e);
            CommandError::from(AppError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Error revealing file in directory: {}", e),
            )))
        })?;

    debug!("File revealed in directory");
    debug!("Command completed: download_template_and_open_explorer");
    Ok(())
}
