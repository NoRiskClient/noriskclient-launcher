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
}

impl Default for CosmeticApi {
    fn default() -> Self {
        Self::new()
    }
}
