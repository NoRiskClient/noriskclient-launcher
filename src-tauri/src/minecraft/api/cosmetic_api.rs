use crate::{error::Result, utils::http_client::{nrc_get, nrc_post}};
use log::trace;
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize)]
struct SkinAnnounceRequest<'a> {
    variant: &'a str,
    url: &'a str,
}

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

    pub async fn announce_skin(
        &self,
        norisk_token: &str,
        skin_url: &str,
        skin_variant: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let url = format!("{}/user/skin/announce", Self::get_api_base(is_experimental));
        trace!("[Cosmetic API announce_skin] URL: {} variant: {}", url, skin_variant);

        nrc_post(&url)
            .bearer(norisk_token)
            .json_body(&SkinAnnounceRequest { variant: skin_variant, url: skin_url })
            .send("Announce skin")
            .await?;

        Ok(())
    }

    pub async fn get_player_outfit(
        &self,
        norisk_token: &str,
        player_uuid: &Uuid,
        is_experimental: bool,
    ) -> Result<serde_json::Value> {
        let url = format!("{}/user/{}/outfit", Self::get_api_base(is_experimental), player_uuid);
        trace!("[Cosmetic API get_player_outfit] URL: {}", url);

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
