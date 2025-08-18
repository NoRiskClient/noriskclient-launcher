use crate::integrations::norisk_packs::NoriskModpacksConfig;
use crate::integrations::norisk_versions::NoriskVersionsConfig;
use crate::minecraft::auth::minecraft_auth::NoRiskToken;
use crate::minecraft::dto::norisk_meta::NoriskAssets;
use crate::state::process_state::ProcessMetadata;
use crate::{
    config::HTTP_CLIENT,
    error::{AppError, Result},
};
use log::{debug, error, info};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use rand;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CrashlogDto {
    pub mc_logs_url: String,
    pub metadata: Option<ProcessMetadata>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerIdResponse {
    pub server_id: String,
    pub expires_in: i32,
}

pub struct NoRiskApi;

impl NoRiskApi {
    pub fn new() -> Self {
        Self
    }

    pub fn get_api_base(is_experimental: bool) -> String {
        if is_experimental {
            debug!("[NoRisk API] Using experimental API endpoint");
            String::from("https://api-staging.norisk.gg/api/v1")
        } else {
            debug!("[NoRisk API] Using production API endpoint");
            String::from("https://api.norisk.gg/api/v1")
        }
    }

    /// Request a new server ID from NoRisk API for secure authentication
    pub async fn request_server_id(is_experimental: bool) -> Result<ServerIdResponse> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/launcher/auth/request-server-id", base_url);

        debug!("[NoRisk API] Requesting new server ID");
        debug!("[NoRisk API] Full URL: {}", url);

        let response = HTTP_CLIENT
            .post(url)
            .send()
            .await
            .map_err(|e| {
                error!("[NoRisk API] Server ID request failed: {}", e);
                AppError::RequestError(format!("Failed to request server ID from NoRisk API: {}", e))
            })?;

        let status = response.status();
        debug!("[NoRisk API] Server ID request response status: {}", status);

        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            error!(
                "[NoRisk API] Server ID request error response: Status {}, Body: {}",
                status, error_body
            );
            return Err(AppError::RequestError(format!(
                "NoRisk API returned error status for server ID request: {}, Body: {}",
                status, error_body
            )));
        }

        debug!("[NoRisk API] Parsing server ID response as JSON");
        match response.json::<ServerIdResponse>().await {
            Ok(server_response) => {
                let server_id = &server_response.server_id;
                if !server_id.starts_with("nrc-") {
                    error!("[NoRisk API] Invalid server ID received: {}", server_id);
                    return Err(AppError::RequestError(format!(
                        "Invalid server ID received from NoRisk API: {}",
                        server_id
                    )));
                }
                
                info!("[NoRisk API] Server ID request successful: {}", server_id);
                Ok(server_response)
            }
            Err(e) => {
                error!("[NoRisk API] Failed to parse server ID response: {}", e);
                Err(AppError::ParseError(format!("Failed to parse NoRisk API server ID response: {}", e)))
            }
        }
    }

    pub async fn post_from_norisk_endpoint_with_parameters<T: for<'de> Deserialize<'de>>(
        endpoint: &str,
        norisk_token: &str,
        params: &str,
        extra_params: Option<HashMap<&str, &str>>,
        is_experimental: bool,
    ) -> Result<T> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        debug!("[NoRisk API] Making request to endpoint: {}", endpoint);
        debug!("[NoRisk API] Full URL: {}", url);

        let mut query_params: HashMap<&str, &str> = HashMap::new();
        if !params.is_empty() {
            query_params.insert("params", params);
            debug!("[NoRisk API] Added base params: {}", params);
        }

        if let Some(extra) = extra_params {
            for (key, value) in extra {
                query_params.insert(key, value);
                debug!("[NoRisk API] Added extra param: {} = {}", key, value);
            }
        }

        debug!(
            "[NoRisk API] Sending POST request with {} parameters",
            query_params.len()
        );
        let response = HTTP_CLIENT
            .post(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&query_params)
            .send()
            .await
            .map_err(|e| {
                error!("[NoRisk API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to send request to NoRisk API: {}", e))
            })?;

        let status = response.status();
        debug!("[NoRisk API] Response status: {}", status);

        if !status.is_success() {
            error!("[NoRisk API] Error response: Status {}", status);
            return Err(AppError::RequestError(format!(
                "NoRisk API returned error status: {}",
                status
            )));
        }

        debug!("[NoRisk API] Parsing response body as JSON");
        response.json::<T>().await.map_err(|e| {
            error!("[NoRisk API] Failed to parse response: {}", e);
            AppError::ParseError(format!("Failed to parse NoRisk API response: {}", e))
        })
    }

    pub async fn get_from_norisk_endpoint_with_parameters<T: for<'de> Deserialize<'de>>(
        endpoint: &str,
        norisk_token: &str,
        extra_params: Option<HashMap<&str, &str>>,
        is_experimental: bool,
    ) -> Result<T> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        debug!("[NoRisk API] Making GET request to endpoint: {}", endpoint);
        debug!("[NoRisk API] Full URL: {}", url);

        let mut request = HTTP_CLIENT
            .get(url)
            .header("Authorization", format!("Bearer {}", norisk_token));

        if let Some(extra) = extra_params {
            debug!("[NoRisk API] Adding {} query parameters", extra.len());
            request = request.query(&extra);
        }

        debug!("[NoRisk API] Sending GET request");
        let response = request.send().await.map_err(|e| {
            error!("[NoRisk API] GET request failed: {}", e);
            AppError::RequestError(format!("Failed to send GET request to NoRisk API: {}", e))
        })?;

        let status = response.status();
        debug!("[NoRisk API] Response status: {}", status);

        if !status.is_success() {
            error!("[NoRisk API] Error response: Status {}", status);
            return Err(AppError::RequestError(format!(
                "NoRisk API returned error status: {}",
                status
            )));
        }

        debug!("[NoRisk API] Parsing response body as JSON");
        response.json::<T>().await.map_err(|e| {
            error!("[NoRisk API] Failed to parse response: {}", e);
            AppError::ParseError(format!("Failed to parse NoRisk API response: {}", e))
        })
    }

    pub async fn delete_from_norisk_endpoint_text_with_parameters(
        endpoint: &str,
        norisk_token: &str,
        extra_params: Option<HashMap<&str, &str>>,
        is_experimental: bool,
    ) -> Result<String> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        debug!(
            "[NoRisk API] Making DELETE request to endpoint: {}",
            endpoint
        );
        debug!("[NoRisk API] Full URL: {}", url);

        let mut request = HTTP_CLIENT
            .delete(url)
            .header("Authorization", format!("Bearer {}", norisk_token));

        if let Some(extra) = extra_params {
            debug!("[NoRisk API] Adding {} query parameters", extra.len());
            request = request.query(&extra);
        }

        debug!("[NoRisk API] Sending DELETE request");
        let response = request.send().await.map_err(|e| {
            error!("[NoRisk API] DELETE request failed: {}", e);
            AppError::RequestError(format!(
                "Failed to send DELETE request to NoRisk API: {}",
                e
            ))
        })?;

        let status = response.status();
        debug!("[NoRisk API] Response status: {}", status);

        if !status.is_success() {
            error!("[NoRisk API] Error response: Status {}", status);
            return Err(AppError::RequestError(format!(
                "NoRisk API returned error status: {}",
                status
            )));
        }

        debug!("[NoRisk API] Reading response body as text");
        response.text().await.map_err(|e| {
            error!("[NoRisk API] Failed to read response text: {}", e);
            AppError::ParseError(format!("Failed to read NoRisk API response text: {}", e))
        })
    }

    /// Secure version of token refresh using server-provided server ID
    /// This prevents the middleman attack by using controlled server IDs
    pub async fn refresh_norisk_token_v3(
        hwid: &str,
        username: &str,
        access_token: &str,
        selected_profile: &str,
        force: bool,
        is_experimental: bool,
    ) -> Result<NoRiskToken> {
        info!("[NoRisk API] Refreshing NoRisk token v3 with HWID: {}", hwid);
        debug!("[NoRisk API] Username: {}", username);
        debug!("[NoRisk API] Force refresh: {}", force);
        debug!("[NoRisk API] Experimental mode: {}", is_experimental);

        // Step 1: Request server ID from NoRisk API
        debug!("[NoRisk API] Step 1: Requesting server ID from NoRisk API");
        let server_response = Self::request_server_id(is_experimental).await?;
        let server_id = &server_response.server_id;
        info!("[NoRisk API] Received server ID: {}", server_id);

        // Step 2: Join the Minecraft server session (client-side authentication)
        debug!("[NoRisk API] Step 2: Joining Minecraft server session with server ID: {}", server_id);
        let mc_api = crate::minecraft::api::mc_api::MinecraftApiService::new();
        mc_api.join_server_session(access_token, selected_profile, server_id).await?;
        info!("[NoRisk API] Successfully joined Minecraft server session");

        // Step 3: Call NoRisk API v2 (server will verify with has_joined)
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/launcher/auth/validate/v2", base_url);

        debug!("[NoRisk API] Step 3: Making POST request to auth/validate/v2 endpoint");
        debug!("[NoRisk API] Full URL: {}", url);

        // All parameters as query parameters
        let force_str = force.to_string();
        let mut query_params = HashMap::new();
        query_params.insert("force", force_str.as_str());
        query_params.insert("hwid", hwid);
        query_params.insert("username", username);
        query_params.insert("server_id", server_id);

        debug!("[NoRisk API] Sending POST request with server-provided server ID");
        let response = HTTP_CLIENT
            .post(url)
            .query(&query_params)
            .send()
            .await
            .map_err(|e| {
                error!("[NoRisk API] v3 token refresh request failed: {}", e);
                AppError::RequestError(format!("Failed to send v3 token refresh request to NoRisk API: {}", e))
            })?;

        let status = response.status();
        debug!("[NoRisk API] v3 token refresh response status: {}", status);

        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            error!(
                "[NoRisk API] v3 token refresh error response: Status {}, Body: {}",
                status, error_body
            );
            return Err(AppError::RequestError(format!(
                "NoRisk API v3 returned error status: {}, Body: {}",
                status, error_body
            )));
        }

        debug!("[NoRisk API] Parsing v3 token refresh response body as JSON");
        match response.json::<NoRiskToken>().await {
            Ok(token) => {
                info!("[NoRisk API] v3 token refresh successful");
                debug!("[NoRisk API] Token valid status: {}", token.value.len() > 0);
                Ok(token)
            }
            Err(e) => {
                error!("[NoRisk API] Failed to parse v3 token refresh response: {}", e);
                Err(AppError::ParseError(format!("Failed to parse NoRisk API v3 response: {}", e)))
            }
        }
    }

    pub async fn request_from_norisk_endpoint<T: for<'de> Deserialize<'de>>(
        endpoint: &str,
        norisk_token: &str,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<T> {
        debug!(
            "[NoRisk API] Request from endpoint: {} with UUID: {}",
            endpoint, request_uuid
        );
        let mut extra_params = HashMap::new();
        extra_params.insert("uuid", request_uuid);

        Self::post_from_norisk_endpoint_with_parameters(
            endpoint,
            norisk_token,
            "",
            Some(extra_params),
            is_experimental,
        )
        .await
    }

    pub async fn get_from_norisk_endpoint<T: for<'de> Deserialize<'de>>(
        endpoint: &str,
        norisk_token: &str,
        request_uuid: Option<&str>,
        is_experimental: bool,
    ) -> Result<T> {
        debug!("[NoRisk API] GET request from endpoint: {}", endpoint);

        let mut extra_params = HashMap::new();
        if let Some(uuid) = request_uuid {
            debug!("[NoRisk API] Adding UUID: {}", uuid);
            extra_params.insert("uuid", uuid);
        }

        Self::get_from_norisk_endpoint_with_parameters(
            endpoint,
            norisk_token,
            Some(extra_params),
            is_experimental,
        )
        .await
    }

    /// Request norisk assets json for specific branch
    pub async fn norisk_assets(
        pack: &str,
        norisk_token: &str,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<NoriskAssets> {
        Self::get_from_norisk_endpoint(
            &format!("launcher/pack/{}", pack),
            norisk_token,
            Some(request_uuid),
            is_experimental,
        )
        .await
    }

    /// Fetches the complete modpack configuration from the NoRisk API.
    pub async fn get_modpacks(
        norisk_token: &str,
        is_experimental: bool,
    ) -> Result<NoriskModpacksConfig> {
        debug!(
            "[NoRisk API] Fetching modpack configuration. Experimental: {}",
            is_experimental
        );
        Self::get_from_norisk_endpoint("launcher/modpacks", norisk_token, None, is_experimental)
            .await
    }

    /// Fetches the standard version profiles from the NoRisk API.
    pub async fn get_standard_versions(
        norisk_token: &str,
        is_experimental: bool,
    ) -> Result<NoriskVersionsConfig> {
        debug!(
            "[NoRisk API] Fetching standard version profiles. Experimental: {}",
            is_experimental
        );
        Self::get_from_norisk_endpoint("launcher/versions", norisk_token, None, is_experimental)
            .await
    }

    /// Request discord link status
    pub async fn discord_link_status(
        norisk_token: &str,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<bool> {
        debug!(
            "[NoRisk API] Requesting Discord link status with UUID: {}",
            request_uuid
        );
        Self::get_from_norisk_endpoint(
            "core/oauth/discord/check",
            norisk_token,
            Some(request_uuid),
            is_experimental,
        )
        .await
    }

    /// Request to unlink Discord account
    pub async fn unlink_discord(
        norisk_token: &str,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<String> {
        debug!(
            "[NoRisk API] Requesting Discord unlink with UUID: {}",
            request_uuid
        );
        let mut extra_params = HashMap::new();
        extra_params.insert("uuid", request_uuid);

        Self::delete_from_norisk_endpoint_text_with_parameters(
            "core/oauth/discord/unlink",
            norisk_token,
            Some(extra_params),
            is_experimental,
        )
        .await
    }

    /// Submits a crash log to the NoRisk API.
    pub async fn submit_crash_log(
        norisk_token: &str,
        crash_log_data: &CrashlogDto,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let base_url = Self::get_api_base(is_experimental);
        let endpoint = "core/crashlog";
        let url = format!("{}/{}", base_url, endpoint);

        debug!(
            "[NoRisk API] Submitting crash log to endpoint: {}",
            endpoint
        );
        debug!("[NoRisk API] Full URL: {}", url);
        debug!("[NoRisk API] With request UUID: {}", request_uuid);
        debug!("[NoRisk API] Crash log data: {:?}", crash_log_data);

        let response = HTTP_CLIENT
            .post(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("uuid", request_uuid)])
            .json(crash_log_data)
            .send()
            .await
            .map_err(|e| {
                error!("[NoRisk API] Crash log submission request failed: {}", e);
                AppError::RequestError(format!("Failed to send crash log to NoRisk API: {}", e))
            })?;

        let status = response.status();
        debug!(
            "[NoRisk API] Crash log submission response status: {}",
            status
        );

        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            error!(
                "[NoRisk API] Crash log submission error response: Status {}, Body: {}",
                status, error_body
            );
            return Err(AppError::RequestError(format!(
                "NoRisk API returned error status for crash log: {}, Body: {}",
                status, error_body
            )));
        }

        info!("[NoRisk API] Crash log submitted successfully.");
        Ok(())
    }

    pub async fn get_mcreal_app_token(
        norisk_token: &str,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<String> {
        let base_url = Self::get_api_base(is_experimental);
        let endpoint = "mcreal/user/mobileAppToken";
        let url = format!("{}/{}", base_url, endpoint);
        
        info!("[NoRisk API] Requesting mcreal app token");
        debug!("[NoRisk API] Full URL: {}", url);
        
        let response = HTTP_CLIENT
            .get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("uuid", request_uuid)])
            .send()
            .await
            .map_err(|e| {
                error!("[NoRisk API] McReal app token request failed: {}", e);
                AppError::RequestError(format!("Failed to get mobile app token from NoRisk API: {}", e))
            })?;

        let status = response.status();
        debug!("[NoRisk API] McReal app token response status: {}", status);

        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            error!(
                "[NoRisk API] McReal app token error response: Status {}, Body: {}",
                status, error_body
            );
            return Err(AppError::RequestError(format!(
                "NoRisk API returned error status for mobile app token: {}, Body: {}",
                status, error_body
            )));
        }

        response.text().await.map_err(|e| {
            error!("[NoRisk API] Failed to read mobile app token response: {}", e);
            AppError::ParseError(format!("Failed to read NoRisk API mobile app token response: {}", e))
        })
    }

    pub async fn reset_mcreal_app_token(
        norisk_token: &str,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<String> {
        let base_url = Self::get_api_base(is_experimental);
        let endpoint = "mcreal/user/mobileAppToken/reset";
        let url = format!("{}/{}", base_url, endpoint);
        
        info!("[NoRisk API] Resetting mcreal app token");
        debug!("[NoRisk API] Full URL: {}", url);
        
        let response = HTTP_CLIENT
            .post(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("uuid", request_uuid)])
            .send()
            .await
            .map_err(|e| {
                error!("[NoRisk API] McReal app token reset request failed: {}", e);
                AppError::RequestError(format!("Failed to reset mobile app token from NoRisk API: {}", e))
            })?;

        let status = response.status();
        debug!("[NoRisk API] McReal app token reset response status: {}", status);

        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            error!(
                "[NoRisk API] McReal app token reset error response: Status {}, Body: {}",
                status, error_body
            );
            return Err(AppError::RequestError(format!(
                "NoRisk API returned error status for mobile app token reset: {}, Body: {}",
                status, error_body
            )));
        }

        response.text().await.map_err(|e| {
            error!("[NoRisk API] Failed to read mobile app token reset response: {}", e);
            AppError::ParseError(format!("Failed to read NoRisk API mobile app token reset response: {}", e))
        })
    }

    // Add more NoRisk API methods as needed
}
