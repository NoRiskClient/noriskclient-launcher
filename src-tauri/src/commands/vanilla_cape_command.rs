use crate::error::{AppError, CommandError};
use crate::minecraft::api::vanilla_cape_api::{VanillaCape, VanillaCapeApi, VanillaCapeInfo};
use crate::state::state_manager::State;
use log::debug;
use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct EquipVanillaCapePayload {
    pub cape_id: Option<String>,
}

#[tauri::command]
pub async fn get_owned_vanilla_capes() -> Result<Vec<VanillaCape>, CommandError> {
    debug!("Command called: get_owned_vanilla_capes");

    let state = State::get().await?;

    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    debug!("Using active account: {} (UUID: {})", active_account.username, active_account.id);

    let cape_api = VanillaCapeApi::new();

    let result = cape_api
        .get_owned_capes(&active_account.access_token)
        .await
        .map_err(|e| {
            debug!("Failed to get owned vanilla capes: {:?}", e);
            CommandError::from(e)
        });

    if result.is_ok() {
        debug!("Command completed: get_owned_vanilla_capes");
    } else {
        debug!("Command failed: get_owned_vanilla_capes");
    }

    result
}

#[tauri::command]
pub async fn get_currently_equipped_vanilla_cape() -> Result<Option<VanillaCape>, CommandError> {
    debug!("Command called: get_currently_equipped_vanilla_cape");

    let state = State::get().await?;

    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    debug!("Using active account: {} (UUID: {})", active_account.username, active_account.id);

    let cape_api = VanillaCapeApi::new();

    let result = cape_api
        .get_currently_equipped_cape(&active_account.access_token)
        .await
        .map_err(|e| {
            debug!("Failed to get currently equipped vanilla cape: {:?}", e);
            CommandError::from(e)
        });

    if result.is_ok() {
        debug!("Command completed: get_currently_equipped_vanilla_cape");
    } else {
        debug!("Command failed: get_currently_equipped_vanilla_cape");
    }

    result
}

#[tauri::command]
pub async fn equip_vanilla_cape(cape_id: Option<String>) -> Result<(), CommandError> {
    debug!("Command called: equip_vanilla_cape with cape_id: {:?}", cape_id);

    let state = State::get().await?;

    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    debug!("Using active account: {} (UUID: {})", active_account.username, active_account.id);

    let cape_api = VanillaCapeApi::new();

    let result = cape_api
        .equip_cape(&active_account.access_token, cape_id.as_deref())
        .await
        .map_err(|e| {
            debug!("Failed to equip vanilla cape: {:?}", e);
            CommandError::from(e)
        });

    if result.is_ok() {
        debug!("Command completed: equip_vanilla_cape");

        let cape_hash = cape_id.unwrap_or_else(|| "unequipped".to_string());
        let mut props = std::collections::HashMap::new();
        props.insert("cape_hash".to_string(), serde_json::Value::String(cape_hash.clone()));
        props.insert("cape_source".to_string(), serde_json::Value::String("vanilla".to_string()));
        props.insert("cape_name".to_string(), serde_json::Value::String(cape_hash));
        crate::commands::analytics_command::track_event("cape_selected", props);
    } else {
        debug!("Command failed: equip_vanilla_cape");
    }

    result
}

#[tauri::command]
pub async fn get_vanilla_cape_info() -> Result<Vec<VanillaCapeInfo>, CommandError> {
    debug!("Command called: get_vanilla_cape_info");

    let cape_api = VanillaCapeApi::new();
    let cape_info = cape_api.get_cape_info();

    debug!("Command completed: get_vanilla_cape_info - returned {} cape info entries", cape_info.len());
    Ok(cape_info)
}

#[tauri::command]
pub async fn refresh_vanilla_cape_data() -> Result<(), CommandError> {
    debug!("Command called: refresh_vanilla_cape_data");
    debug!("Command completed: refresh_vanilla_cape_data");
    Ok(())
}