use crate::{
    config::HTTP_CLIENT,
    error::{AppError, Result},
    minecraft::dto::norisk_user::NoRiskUserMinimal,
};
use log::error;
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

        let response = HTTP_CLIENT
            .get(&url)
            .query(&[("uuid", requester_uuid.to_string())])
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|e| {
                error!("[Core API get_minimal_user_info] Request failed: {}", e);
                AppError::RequestError(format!("Failed to send get_minimal_user_info request: {}", e))
            })?;

        crate::utils::api_utils::parse_response_with_logging::<NoRiskUserMinimal>(
            response,
            "Minimal user info",
        )
        .await
    }
}

impl Default for CoreApi {
    fn default() -> Self {
        Self::new()
    }
}
