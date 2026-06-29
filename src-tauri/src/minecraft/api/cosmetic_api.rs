use crate::{error::Result, utils::http_client::nrc_get};
use log::debug;
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

        nrc_get(&url)
            .bearer(norisk_token)
            .json::<serde_json::Value>("Player outfit")
            .await
    }
}

impl Default for CosmeticApi {
    fn default() -> Self {
        Self::new()
    }
}
