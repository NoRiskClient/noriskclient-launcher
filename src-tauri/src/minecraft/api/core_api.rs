use crate::{
    error::Result, minecraft::dto::norisk_user::NoRiskUserMinimal,
    utils::http_client::nrc_get,
};
use uuid::Uuid;

pub struct CoreApi;

impl CoreApi {
    pub fn new() -> Self {
        Self
    }

    fn get_api_base(is_experimental: bool) -> &'static str {
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
}

impl Default for CoreApi {
    fn default() -> Self {
        Self::new()
    }
}
