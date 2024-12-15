use crate::app::api::{NoRiskLaunchManifest, NoriskAssets};
use crate::app::app_data::LauncherOptions;
use crate::{HTTP_CLIENT, LAUNCHER_DIRECTORY};
use log::info;
use serde::de::DeserializeOwned;
use uuid::Uuid;

pub struct AssetsApi;

pub fn get_assets_api_base(is_experimental: bool) -> String {
    return String::from("https://assets.norisk.gg/api/v1/assets");
}
impl AssetsApi {
    pub async fn branches(
        norisk_token: &str,
        request_uuid: &str,
    ) -> core::result::Result<Vec<String>, crate::error::Error> {
        Self::get_from_norisk_endpoint_with_error_handling("branches", norisk_token, request_uuid)
            .await
    }

    pub async fn assets(
        branch: String,
        norisk_token: &str,
        request_uuid: &str,
    ) -> core::result::Result<NoriskAssets, crate::error::Error> {
        Self::get_from_norisk_endpoint_with_error_handling(
            &format!("branch/{}", branch),
            norisk_token,
            request_uuid,
        )
        .await
    }

    /// Request launch manifest of specific build
    pub async fn launch_manifest(
        branch: &str,
        norisk_token: &str,
        uuid: Uuid,
    ) -> core::result::Result<NoRiskLaunchManifest, crate::error::Error> {
        Self::get_from_norisk_endpoint_with_error_handling(
            &format!("version/launch/{}", branch),
            norisk_token,
            &uuid.to_string(),
        )
        .await
    }

    async fn get_from_norisk_endpoint_with_error_handling<T: DeserializeOwned>(
        endpoint: &str,
        norisk_token: &str,
        request_uuid: &str,
    ) -> core::result::Result<T, crate::error::Error> {
        let options = LauncherOptions::load(LAUNCHER_DIRECTORY.config_dir())
            .await
            .unwrap_or_default();
        let url = format!(
            "{}/{}",
            get_assets_api_base(options.experimental_mode),
            endpoint
        );
        info!("URL: {}", url); // Den formatierten String ausgeben
        Ok(HTTP_CLIENT
            .get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[
                ("uuid", request_uuid),
                ("experimental", &options.experimental_mode.to_string()),
            ])
            .send()
            .await?
            .error_for_status()?
            .json::<T>()
            .await?)
    }
}
