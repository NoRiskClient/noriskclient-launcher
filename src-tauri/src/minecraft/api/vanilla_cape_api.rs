use crate::config::HTTP_CLIENT;
use crate::error::{AppError, Result};
use log::{debug, error};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const MOJANG_API_URL: &str = "https://api.minecraftservices.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VanillaCape {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub url: String,
    pub equipped: bool,
    pub obtained_at: Option<i64>,
    pub category: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VanillaCapeInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub preview_url: String,
    pub category: String,
    pub obtainable: bool,
    pub obtain_method: Option<String>,
}

#[derive(Debug, Serialize)]
struct ChangeCapeRequest {
    #[serde(rename = "capeId")]
    cape_id: Option<String>,
}

pub struct VanillaCapeApi {
    cape_info: HashMap<String, VanillaCapeInfo>,
}

impl VanillaCapeApi {
    pub fn new() -> Self {
        Self {
            cape_info: Self::initialize_cape_info(),
        }
    }

    fn initialize_cape_info() -> HashMap<String, VanillaCapeInfo> {
        let info = HashMap::new();
        info
    }

    pub async fn get_owned_capes(&self, access_token: &str) -> Result<Vec<VanillaCape>> {
        debug!("Fetching owned vanilla capes from Mojang API using bearer token");

        let url = format!("{}/minecraft/profile", MOJANG_API_URL);
        debug!("Request URL: {}", url);

        let response = HTTP_CLIENT
            .get(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await
            .map_err(|e| {
                error!("Failed to fetch profile from Mojang API: {:?}", e);
                AppError::MinecraftApi(e)
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            error!("Mojang API error {}: {}", status, error_text);
            
            return Err(AppError::Other(format!(
                "Failed to fetch profile from Mojang: {} - {}",
                status, error_text
            )));
        }

        let profile_response: serde_json::Value = response.json().await.map_err(|e| {
            error!("Failed to parse profile response: {:?}", e);
            AppError::MinecraftApi(e)
        })?;

        debug!("Received profile response: {:?}", profile_response);

        let empty_vec = Vec::new();
        let capes_value = profile_response.get("capes");
        let capes_array = match capes_value {
            Some(v) => v.as_array().unwrap_or(&empty_vec),
            None => &empty_vec,
        };

        debug!("Found {} capes in profile", capes_array.len());

        let mut capes = Vec::new();
        for cape_value in capes_array {
            let cape_obj = cape_value.as_object().ok_or_else(|| {
                AppError::Other("Invalid cape object format".to_string())
            })?;

            let cape_id = cape_obj
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();

            let cape_alias = cape_obj
                .get("alias")
                .and_then(|v| v.as_str())
                .unwrap_or(&cape_id)
                .to_string();

            let cape_url = cape_obj
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let cape_state = cape_obj
                .get("state")
                .and_then(|v| v.as_str())
                .unwrap_or("INACTIVE")
                .to_string();

            let cape_info = self.cape_info.get(&cape_id);
            
            let cape = VanillaCape {
                id: cape_id.clone(),
                name: cape_info
                    .map(|info| info.name.clone())
                    .unwrap_or_else(|| cape_alias.clone()),
                description: cape_info.and_then(|info| Some(info.description.clone())),
                url: cape_url,
                equipped: cape_state == "ACTIVE",
                obtained_at: None,
                category: cape_info
                    .map(|info| info.category.clone())
                    .unwrap_or_else(|| "unknown".to_string()),
                active: cape_state == "ACTIVE",
            };

            capes.push(cape);
        }

        debug!("Successfully converted {} capes", capes.len());
        Ok(capes)
    }

    pub async fn get_currently_equipped_cape(&self, access_token: &str) -> Result<Option<VanillaCape>> {
        debug!("Fetching currently equipped vanilla cape using bearer token");

        let capes = self.get_owned_capes(access_token).await?;
        let equipped_cape = capes.into_iter().find(|cape| cape.equipped);

        if let Some(ref cape) = equipped_cape {
            debug!("Found equipped cape: {} ({})", cape.name, cape.id);
        } else {
            debug!("No cape currently equipped");
        }

        Ok(equipped_cape)
    }

    pub async fn equip_cape(&self, access_token: &str, cape_id: Option<&str>) -> Result<()> {
        match cape_id {
            Some(id) => {
                debug!("Equipping cape: {}", id);
                self.equip_cape_by_id(access_token, id).await
            }
            None => {
                debug!("Unequipping cape");
                self.unequip_cape(access_token).await
            }
        }
    }

    async fn equip_cape_by_id(&self, access_token: &str, cape_id: &str) -> Result<()> {
        let url = format!("{}/minecraft/profile/capes/active", MOJANG_API_URL);
        debug!("Request URL: {}", url);

        let request_body = ChangeCapeRequest {
            cape_id: Some(cape_id.to_string()),
        };

        let response = HTTP_CLIENT
            .put(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| {
                error!("Failed to equip cape: {:?}", e);
                AppError::MinecraftApi(e)
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            error!("Failed to equip cape - {}: {}", status, error_text);
            return Err(AppError::Other(format!(
                "Failed to equip cape: {} - {}",
                status, error_text
            )));
        }

        debug!("Successfully equipped cape: {}", cape_id);
        Ok(())
    }

    async fn unequip_cape(&self, access_token: &str) -> Result<()> {
        let url = format!("{}/minecraft/profile/capes/active", MOJANG_API_URL);
        debug!("Request URL: {}", url);

        let response = HTTP_CLIENT
            .delete(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await
            .map_err(|e| {
                error!("Failed to unequip cape: {:?}", e);
                AppError::MinecraftApi(e)
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            error!("Failed to unequip cape - {}: {}", status, error_text);
            return Err(AppError::Other(format!(
                "Failed to unequip cape: {} - {}",
                status, error_text
            )));
        }

        debug!("Successfully unequipped cape");
        Ok(())
    }

    /// Get information about all known vanilla capes
    pub fn get_cape_info(&self) -> Vec<VanillaCapeInfo> {
        self.cape_info.values().cloned().collect()
    }

    /// Get information about a specific cape
    pub fn get_cape_info_by_id(&self, cape_id: &str) -> Option<&VanillaCapeInfo> {
        self.cape_info.get(cape_id)
    }
}