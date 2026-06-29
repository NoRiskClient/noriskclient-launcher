use crate::{
    config::HTTP_CLIENT,
    error::{AppError, Result},
};
use log::{debug, error};
use uuid::Uuid;

pub struct CosmeticApi;

impl CosmeticApi {
    pub fn new() -> Self {
        Self
    }

    fn get_api_base(is_experimental: bool) -> String {
        if is_experimental {
            String::from("https://api-staging.norisk.gg/api/v1/cosmetics")
        } else {
            String::from("https://api.norisk.gg/api/v1/cosmetics")
        }
    }

    pub async fn get_player_outfit(
        &self,
        norisk_token: &str,
        player_uuid: &Uuid,
        is_experimental: bool,
    ) -> Result<serde_json::Value> {
        let url = format!("{}/user/{}/outfit", Self::get_api_base(is_experimental), player_uuid);
        debug!("[Cosmetic API get_player_outfit] URL: {}", url);

        let response = HTTP_CLIENT
            .get(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|e| {
                error!("[Cosmetic API get_player_outfit] Request failed: {}", e);
                AppError::RequestError(format!("Failed to send get_player_outfit request: {}", e))
            })?;

        crate::utils::api_utils::parse_response_with_logging::<serde_json::Value>(
            response,
            "Player outfit",
        )
        .await
    }

    pub async fn get_player_icon(
        &self,
        norisk_token: &str,
        player_uuid: &Uuid,
        is_experimental: bool,
    ) -> Result<serde_json::Value> {
        let url = format!("{}/icon/{}", Self::get_api_base(is_experimental), player_uuid);

        let response = HTTP_CLIENT
            .get(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|e| {
                error!("[Cosmetic API get_player_icon] Request failed: {}", e);
                AppError::RequestError(format!("Failed to send get_player_icon request: {}", e))
            })?;

        crate::utils::api_utils::parse_response_with_logging::<serde_json::Value>(
            response,
            "Player icon",
        )
        .await
    }

    pub async fn get_shop_user(
        &self,
        norisk_token: &str,
        is_experimental: bool,
    ) -> Result<serde_json::Value> {
        let url = format!("{}/store/user", Self::get_api_base(is_experimental));

        let response = HTTP_CLIENT
            .get(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|e| {
                error!("[Cosmetic API get_shop_user] Request failed: {}", e);
                AppError::RequestError(format!("Failed to send get_shop_user request: {}", e))
            })?;

        crate::utils::api_utils::parse_response_with_logging::<serde_json::Value>(
            response,
            "Shop user",
        )
        .await
    }

    pub async fn get_plus_status(&self, player_uuid: &Uuid) -> Result<bool> {
        let url = format!(
            "https://api.norisk.gg/api/v1/core/user/{}/plus-status",
            player_uuid
        );
        let response = HTTP_CLIENT.get(&url).send().await.map_err(|e| {
            AppError::RequestError(format!("Failed to fetch plus-status: {}", e))
        })?;
        if !response.status().is_success() {
            return Ok(false);
        }
        let body: serde_json::Value = response.json().await.unwrap_or(serde_json::Value::Null);
        Ok(body
            .get("isNoRiskPlus")
            .and_then(|v| v.as_bool())
            .unwrap_or(false))
    }

    pub async fn get_creator_code_rewards(&self, code: &str) -> Result<serde_json::Value> {
        let url = format!(
            "https://api.norisk.gg/api/v1/cosmetics/support-a-creator-code/{}/rewards",
            urlencoding::encode(code)
        );
        let response = HTTP_CLIENT.get(&url).send().await.map_err(|e| {
            AppError::RequestError(format!("Failed to fetch creator-code rewards: {}", e))
        })?;
        if !response.status().is_success() {
            return Ok(serde_json::Value::Null);
        }
        response
            .json::<serde_json::Value>()
            .await
            .or(Ok(serde_json::Value::Null))
    }
}

impl Default for CosmeticApi {
    fn default() -> Self {
        Self::new()
    }
}
