use crate::{
    error::Result, minecraft::dto::afkpoints::AfkPointsBalance,
    minecraft::dto::norisk_user::NoRiskUserMinimal, utils::http_client::nrc_get,
};
use serde::Deserialize;
use uuid::Uuid;

#[derive(Deserialize)]
struct ApplixirSessionResponse {
    token: String,
}

pub struct CoreApi;

impl CoreApi {
    pub fn new() -> Self {
        Self
    }

    pub fn get_api_base(is_experimental: bool) -> &'static str {
        if is_experimental {
            "https://api-staging.norisk.gg/api/v1/core"
        } else {
            "https://api.norisk.gg/api/v1/core"
        }
    }

    pub async fn get_minimal_user_info(
        &self,
        norisk_token: &str,
        target_uuid: &Uuid,
        requester_uuid: &Uuid,
        is_experimental: bool,
    ) -> Result<NoRiskUserMinimal> {
        let url = format!("{}/user/info/{}", Self::get_api_base(is_experimental), target_uuid);

        nrc_get(&url)
            .query(&[("uuid", requester_uuid.to_string())])
            .bearer(norisk_token)
            .json::<NoRiskUserMinimal>("Minimal user info")
            .await
    }

    pub async fn mint_applixir_session(
        &self,
        norisk_token: &str,
        is_experimental: bool,
    ) -> Result<String> {
        let url = format!("{}/applixir/session", Self::get_api_base(is_experimental));
        let session = nrc_get(&url)
            .bearer(norisk_token)
            .json::<ApplixirSessionResponse>("AppLixir session")
            .await?;
        Ok(session.token)
    }

    pub async fn get_afkpoints_balance(
        &self,
        norisk_token: &str,
        is_experimental: bool,
    ) -> Result<AfkPointsBalance> {
        let url = format!("{}/afkpoints/balance", Self::get_api_base(is_experimental));
        nrc_get(&url)
            .bearer(norisk_token)
            .json::<AfkPointsBalance>("AFK Points balance")
            .await
    }
}

impl Default for CoreApi {
    fn default() -> Self {
        Self::new()
    }
}
