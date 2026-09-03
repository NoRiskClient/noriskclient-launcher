use crate::integrations::norisk_packs::NoriskModpacksConfig;
use crate::integrations::norisk_versions::NoriskVersionsConfig;
use crate::minecraft::auth::minecraft_auth::NoRiskToken;
use crate::minecraft::dto::norisk_meta::NoriskAssets;
use crate::state::process_state::ProcessMetadata;
use crate::{
    error::{AppError, Result},
    utils::http_client::{nrc_delete, nrc_get, nrc_post, nrc_put},
};
use crate::state::state_manager::State;
use crate::state::event_state::{EventPayload, EventType};
use log::{debug, error, info, trace};
use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CrashlogDto {
    pub mc_logs_url: String,
    pub metadata: Option<ProcessMetadata>,
    pub locale: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerIdResponse {
    pub server_id: String,
    pub expires_in: i32,
}

/// Information about a referral code and its referrer
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReferralInfo {
    /// Display name of the referrer (username, creator name, etc.)
    pub referrer_name: String,
    /// Optional avatar/profile picture URL
    #[serde(default)]
    pub referrer_avatar: Option<String>,
    /// Whether the referral code is still valid
    pub valid: bool,
    /// Type of referral: "friend", "affiliate", "creator", "partner", etc.
    #[serde(default)]
    pub referral_type: Option<String>,
    /// Translation key for the banner message (e.g., "referral.invited_by_friend")
    #[serde(default)]
    pub translation_key: Option<String>,
    /// Fallback message if translation not found
    #[serde(default)]
    pub fallback_message: Option<String>,
    /// Optional custom message from the referrer/backend
    #[serde(default)]
    pub custom_message: Option<String>,
    /// Optional reward description (e.g., "Du erhältst 100 Coins!")
    #[serde(default)]
    pub reward_text: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum AdventCalendarDayStatus {
    Locked,
    Available,
    Claimed,
    Expired,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum ShopItemRewardType {
    Cosmetic,
    Emote,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum Reward {
    #[serde(rename = "Coins")]
    CoinReward {
        amount: i32,
    },
    #[serde(rename = "ShopItem")]
    ShopItemReward {
        #[serde(rename = "shopItemId")]
        shop_item_id: Uuid,
        duration: Option<i64>,
    },
    #[serde(rename = "RandomShopItem")]
    RandomShopItemReward {
        #[serde(rename = "itemType")]
        item_type: ShopItemRewardType,
        duration: Option<i64>,
    },
    #[serde(rename = "Discount")]
    DiscountReward {
        percentage: f64,
        #[serde(rename = "endTimestamp")]
        end_timestamp: String,
    },
    #[serde(rename = "NrcPlus")]
    NrcPlusReward {
        duration: i64,
    },
    #[serde(rename = "Theme")]
    ThemeReward {
        #[serde(rename = "themeId")]
        theme_id: String,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AdventCalendarDay {
    pub day: i32,
    pub status: AdventCalendarDayStatus,
    pub reward: Option<Reward>,
    #[serde(rename = "shopItemName")]
    pub shop_item_name: Option<String>,
    #[serde(rename = "shopItemModelUrl")]
    pub shop_item_model_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UniquePlayersResponse {
    pub count: i64,
    pub window_hours: i32,
    pub computed_at_ms: i64,
}

pub struct NoRiskApi;

impl NoRiskApi {
    pub fn new() -> Self {
        Self
    }

    pub fn get_api_base(is_experimental: bool) -> String {
        if is_experimental {
            trace!("[NoRisk API] Using experimental API endpoint");
            String::from("https://api-staging.norisk.gg/api/v1")
        } else {
            trace!("[NoRisk API] Using production API endpoint");
            String::from("https://api.norisk.gg/api/v1")
        }
    }

    /// Request a new server ID from NoRisk API for secure authentication
    pub async fn request_server_id(is_experimental: bool) -> Result<ServerIdResponse> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/launcher/auth/request-server-id", base_url);

        trace!("[NoRisk API] Requesting new server ID");
        trace!("[NoRisk API] Full URL: {}", url);

        let server_response = nrc_post(url)
            .json::<ServerIdResponse>("NoRisk server-id")
            .await?;

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

    pub async fn post_from_norisk_endpoint_with_parameters<T: for<'de> Deserialize<'de>>(
        endpoint: &str,
        norisk_token: &str,
        params: &str,
        extra_params: Option<HashMap<&str, &str>>,
        is_experimental: bool,
    ) -> Result<T> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        trace!("[NoRisk API] Making request to endpoint: {}", endpoint);
        trace!("[NoRisk API] Full URL: {}", url);

        let mut query_params: HashMap<&str, &str> = HashMap::new();
        if !params.is_empty() {
            query_params.insert("params", params);
            trace!("[NoRisk API] Added base params: {}", params);
        }

        if let Some(extra) = extra_params {
            for (key, value) in extra {
                query_params.insert(key, value);
                trace!("[NoRisk API] Added extra param: {} = {}", key, value);
            }
        }

        trace!(
            "[NoRisk API] Sending POST request with {} parameters",
            query_params.len()
        );
        nrc_post(url)
            .bearer(norisk_token)
            .query(&query_params)
            .json::<T>(endpoint)
            .await
    }

    pub async fn get_from_norisk_endpoint_with_parameters<T: for<'de> Deserialize<'de>>(
        endpoint: &str,
        norisk_token: &str,
        extra_params: Option<HashMap<&str, &str>>,
        is_experimental: bool,
    ) -> Result<T> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        trace!("[NoRisk API] Making GET request to endpoint: {}", endpoint);
        trace!("[NoRisk API] Full URL: {}", url);

        let mut request = nrc_get(url).bearer(norisk_token);

        if let Some(extra) = extra_params {
            trace!("[NoRisk API] Adding {} query parameters", extra.len());
            request = request.query(&extra);
        }

        trace!("[NoRisk API] Sending GET request");
        request.json::<T>(endpoint).await
    }

    pub async fn delete_from_norisk_endpoint_text_with_parameters(
        endpoint: &str,
        norisk_token: &str,
        extra_params: Option<HashMap<&str, &str>>,
        is_experimental: bool,
    ) -> Result<String> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        trace!(
            "[NoRisk API] Making DELETE request to endpoint: {}",
            endpoint
        );
        trace!("[NoRisk API] Full URL: {}", url);

        let mut request = nrc_delete(url).bearer(norisk_token);

        if let Some(extra) = extra_params {
            trace!("[NoRisk API] Adding {} query parameters", extra.len());
            request = request.query(&extra);
        }

        trace!("[NoRisk API] Sending DELETE request");
        request.text(endpoint).await
    }

    /// Secure version of token refresh using server-provided server ID
    /// This prevents the middleman attack by using controlled server IDs
    pub async fn refresh_norisk_token_v3(
        system_id: &str,
        username: &str,
        access_token: &str,
        selected_profile: &str,
        force: bool,
        is_experimental: bool,
    ) -> Result<NoRiskToken> {
        info!("[NoRisk API] Refreshing NoRisk token v3 with SystemID: {}", system_id);
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
        match mc_api.join_server_session(access_token, selected_profile, server_id).await {
            Ok(_) => {
                info!("[NoRisk API] Successfully joined Minecraft server session");
            }
            Err(join_err) => {
                // Inspect the error text for the specific InsufficientPrivilegesException coming from
                // the Minecraft session API (/session/minecraft/join). If found, emit a UI event so the
                // frontend can show a popup explaining that child protection / privacy settings on the
                // Microsoft account are limiting multiplayer and causing login to fail.
                let err_text = format!("{}", join_err);

                if err_text.contains("InsufficientPrivilegesException") && err_text.contains("/session/minecraft/join") {
                    debug!("[NoRisk API] Detected InsufficientPrivilegesException on join_server_session - emitting frontend event");

                    // Try to emit a state event (best-effort). Don't fail the whole flow because the emit failed.
                    if let Ok(state) = State::get().await {
                        let payload = EventPayload {
                            event_id: uuid::Uuid::new_v4(),
                            event_type: EventType::Error,
                            target_id: None,
                            message: String::from(username),
                            progress: None,
                            error: Some(String::from("Your Microsoft account appears to have a child protection / privacy mode enabled which restricts multiplayer access. This prevents the launcher from completing login via the Minecraft session API (/session/minecraft/join). Please review your Microsoft account settings.")),
                        };

                        if let Err(e) = state.emit_event(payload).await {
                            error!("[NoRisk API] Failed to emit InsufficientPrivilegesException event to frontend: {}", e);
                        }
                    } else {
                        error!("[NoRisk API] Could not get global state to emit InsufficientPrivilegesException event");
                    }
                }

                // Return the original error so callers can handle it as before
                return Err(join_err);
            }
        }

        // Step 3: Call NoRisk API v2 (server will verify with has_joined)
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/launcher/auth/validate/v2", base_url);

        debug!("[NoRisk API] Step 3: Making POST request to auth/validate/v2 endpoint");
        trace!("[NoRisk API] Full URL: {}", url);

        // All parameters as query parameters
        let force_str = force.to_string();
        let mut query_params = HashMap::new();
        query_params.insert("force", force_str.as_str());
        query_params.insert("hwid", system_id);
        query_params.insert("username", username);
        query_params.insert("server_id", server_id);

        trace!("[NoRisk API] Sending POST request with server-provided server ID");
        nrc_post(url)
            .query(&query_params)
            .json::<NoRiskToken>("NoRisk token refresh v3")
            .await
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
        trace!("[NoRisk API] GET request from endpoint: {}", endpoint);

        let mut extra_params = HashMap::new();
        if let Some(uuid) = request_uuid {
            trace!("[NoRisk API] Adding UUID: {}", uuid);
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
    /// Uses v3 endpoint with Git-based config storage.
    pub async fn get_modpacks(
        norisk_token: &str,
        is_experimental: bool,
    ) -> Result<NoriskModpacksConfig> {
        trace!(
            "[NoRisk API] Fetching modpack configuration from v3 endpoint. Experimental: {}",
            is_experimental
        );
        Self::get_from_norisk_endpoint("launcher/modpacks-v3", norisk_token, None, is_experimental)
            .await
    }

    /// Fetches the standard version profiles from the NoRisk API.
    pub async fn get_standard_versions(
        norisk_token: &str,
        is_experimental: bool,
    ) -> Result<NoriskVersionsConfig> {
        trace!(
            "[NoRisk API] Fetching standard version profiles. Experimental: {}",
            is_experimental
        );
        Self::get_from_norisk_endpoint("launcher/versions-v3", norisk_token, None, is_experimental)
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

    /// Request GitHub link status
    pub async fn github_link_status(
        norisk_token: &str,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<bool> {
        debug!(
            "[NoRisk API] Requesting GitHub link status with UUID: {}",
            request_uuid
        );
        Self::get_from_norisk_endpoint(
            "core/oauth/github/check",
            norisk_token,
            Some(request_uuid),
            is_experimental,
        )
            .await
    }

    /// Request to unlink GitHub account
    pub async fn unlink_github(
        norisk_token: &str,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<String> {
        debug!(
            "[NoRisk API] Requesting GitHub unlink with UUID: {}",
            request_uuid
        );
        let mut extra_params = HashMap::new();
        extra_params.insert("uuid", request_uuid);

        Self::delete_from_norisk_endpoint_text_with_parameters(
            "core/oauth/github/unlink",
            norisk_token,
            Some(extra_params),
            is_experimental,
        )
            .await
    }

    /// Analyze a crash log; returns the launcher verdict (CrashCheckResult JSON). Served by the
    /// discord-bot API (same route also lives in core-backend; base can be switched later).
    pub async fn check_crash_log(
        norisk_token: &str,
        crash_log_data: &CrashlogDto,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<serde_json::Value> {
        let base_url = if is_experimental {
            "https://discord-api-staging.norisk.gg/api/v1/discord"
        } else {
            "https://discord-api.norisk.gg/api/v1/discord"
        };
        let endpoint = "crashlog/check";
        let url = format!("{}/{}", base_url, endpoint);

        debug!("[NoRisk API] Checking crash log at: {}", url);

        nrc_post(url)
            .bearer(norisk_token)
            .query(&[("uuid", request_uuid)])
            .json_body(crash_log_data)
            .json::<serde_json::Value>(endpoint)
            .await
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
        trace!("[NoRisk API] Full URL: {}", url);

        nrc_get(url)
            .bearer(norisk_token)
            .query(&[("uuid", request_uuid)])
            .text("McReal app token")
            .await
    }

    pub async fn get_user_permissions(
        norisk_token: &str,
        player_uuid: &str,
        is_experimental: bool,
    ) -> Result<Vec<String>> {
        let base_url = Self::get_api_base(is_experimental);
        let endpoint = "core/permissions";
        let url = format!("{}/{}", base_url, endpoint);

        trace!("[NoRisk API] Requesting user permissions for {}", player_uuid);
        trace!("[NoRisk API] Full URL: {}", url);

        nrc_get(url)
            .bearer(norisk_token)
            .query(&[("uuid", player_uuid)])
            .json::<Vec<String>>("NoRisk permissions")
            .await
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
        trace!("[NoRisk API] Full URL: {}", url);

        nrc_post(url)
            .bearer(norisk_token)
            .query(&[("uuid", request_uuid)])
            .text("McReal app token reset")
            .await
    }

    /// Fetches the advent calendar data from the NoRisk API.
    pub async fn get_advent_calendar(
        norisk_token: &str,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<Vec<AdventCalendarDay>> {
        debug!(
            "[NoRisk API] Fetching advent calendar. Experimental: {}",
            is_experimental
        );
        let base_url = Self::get_api_base(is_experimental);
        let endpoint = "core/advent/calendar";
        let url = format!("{}/{}", base_url, endpoint);

        trace!("[NoRisk API] Making GET request to endpoint: {}", endpoint);
        trace!("[NoRisk API] Full URL: {}", url);

        let mut extra_params = HashMap::new();
        extra_params.insert("uuid", request_uuid);

        nrc_get(url)
            .bearer(norisk_token)
            .query(&extra_params)
            .json::<Vec<AdventCalendarDay>>("Advent calendar")
            .await
    }

    /// Claims a reward for a specific day in the advent calendar.
    pub async fn claim_advent_calendar_day(
        norisk_token: &str,
        tag: u32,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<AdventCalendarDay> {
        let base_url = Self::get_api_base(is_experimental);
        let endpoint = format!("core/advent/claim/{}", tag);
        let url = format!("{}/{}", base_url, endpoint);

        debug!(
            "[NoRisk API] Claiming advent calendar day {}",
            tag
        );
        trace!("[NoRisk API] Full URL: {}", url);
        trace!("[NoRisk API] With request UUID: {}", request_uuid);

        nrc_post(url)
            .bearer(norisk_token)
            .query(&[("uuid", request_uuid)])
            .json::<AdventCalendarDay>("Advent calendar claim")
            .await
    }

    /// Report a referral code to the backend for tracking.
    /// Used for affiliate links, friend referrals, etc.
    ///
    /// SECURITY: Uses Bearer token authentication to ensure the request is legitimate.
    /// The account UUID is sent as a query parameter.
    pub async fn report_referral_code(
        norisk_token: &str,
        code: &str,
        account_id: Uuid,
        is_experimental: bool,
    ) -> Result<()> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/launcher/referral/report", base_url);

        info!("[NoRisk API] Reporting referral code: {} for account: {}", code, account_id);
        trace!("[NoRisk API] Full URL: {}", url);

        #[derive(Serialize)]
        struct ReferralReportRequest<'a> {
            code: &'a str,
        }

        let request_body = ReferralReportRequest { code };

        nrc_post(&url)
            .bearer(norisk_token)
            .query(&[("uuid", account_id.to_string())])
            .json_body(&request_body)
            .expect_success("Referral report")
            .await
    }

    /// Get information about a referral code (public endpoint, no auth required).
    /// Used to display referrer info in the UI before login.
    pub async fn get_referral_info(code: &str, is_experimental: bool) -> Result<ReferralInfo> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/launcher/referral/info", base_url);

        info!("[NoRisk API] Fetching referral info for code: {}", code);
        trace!("[NoRisk API] Full URL: {}", url);

        nrc_get(&url)
            .query(&[("code", code)])
            .json::<ReferralInfo>("Referral info")
            .await
    }

    /// Get all notifications for the current user
    pub async fn get_notifications(
        norisk_token: &str,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<Vec<UserNotification>> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/core/notifications", base_url);

        trace!("[NoRisk API] Fetching notifications from: {}", url);

        nrc_get(&url)
            .bearer(norisk_token)
            .query(&[("uuid", request_uuid)])
            .json::<Vec<UserNotification>>("Notifications")
            .await
    }

    /// Mark all notifications as read
    pub async fn mark_all_notifications_read(
        norisk_token: &str,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/core/notifications/read/all", base_url);

        debug!("[NoRisk API] Marking all notifications as read");

        nrc_put(&url)
            .bearer(norisk_token)
            .query(&[("uuid", request_uuid)])
            .expect_success("Mark all notifications read")
            .await
    }

    /// Mark a specific notification as read
    /// https://api.norisk.gg/api/v1/core/notifications/read?notificationId=695623e0bc1b0644b2e97ba3
    /// Method: PUT
    pub async fn mark_notification_read(
        norisk_token: &str,
        notification_id: &str,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/core/notifications/read", base_url);
        debug!(
            "[NoRisk API] Marking notification {} as read",
            notification_id
        );
        nrc_put(&url)
            .bearer(norisk_token)
            .query(&[("uuid", request_uuid), ("notificationId", notification_id)])
            .expect_success("Mark notification read")
            .await
    }

    /// Confirm an auth bridge session for website authentication.
    /// POST /auth/bridge/confirm?sessionId=xxx
    pub async fn confirm_auth_bridge(
        norisk_token: &str,
        session_id: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/launcher/auth/bridge/confirm", base_url);

        debug!(
            "[NoRisk API] Confirming auth bridge session: {}",
            crate::utils::security_utils::mask_identifier(session_id)
        );

        nrc_post(&url)
            .bearer(norisk_token)
            .query(&[("sessionId", session_id)])
            .expect_success("Auth bridge confirm")
            .await
    }

    /// Fetches the unique players (last 24h) stat from the NoRisk API.
    /// Public stats endpoint — no authentication required. Backend caches the
    /// underlying Mongo count for 30 minutes.
    pub async fn get_unique_players_24h(is_experimental: bool) -> Result<UniquePlayersResponse> {
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/core/stats/uniquePlayers24h", base_url);

        debug!("[NoRisk API] GET {}", url);

        nrc_get(&url)
            .json::<UniquePlayersResponse>("UniquePlayers24h")
            .await
    }
}

// === NOTIFICATION TYPES ===

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserNotification {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    pub seen: bool,
    pub notification: NotificationContent,
    #[serde(rename = "deletionDate")]
    pub deletion_date: Option<String>,
}

// User displayable info (for friends, grantors, etc.)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotificationUser {
    pub uuid: String,
    pub name: String,
    pub rank: String,
}

// Shop item minimal info
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotificationShopItem {
    pub id: String,
    pub name: String,
    pub rarity: String,
}

/// Wrapper enum that tries known notification types first, then falls back to Unknown.
/// This prevents parsing failures when new notification types are added to the backend.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum NotificationContent {
    Known(KnownNotificationContent),
    Unknown(serde_json::Value),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum KnownNotificationContent {
    // === Base Notifications ===
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.SimpleTextNotification")]
    SimpleText {
        message: String,
        #[serde(rename = "createdAt")]
        created_at: String,
    },
    #[serde(rename = "string")]
    StringNotification {
        #[serde(rename = "translationKey")]
        translation_key: Option<String>,
        fallback: String,
        #[serde(default)]
        args: std::collections::HashMap<String, String>,
        #[serde(rename = "createdAt")]
        created_at: String,
    },

    // === Friend Notifications ===
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.FriendRequestReceivedNotifications")]
    FriendRequestReceived {
        #[serde(rename = "createdAt")]
        created_at: String,
        friend: NotificationUser,
    },
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.FriendRequestAcceptedNotifications")]
    FriendRequestAccepted {
        #[serde(rename = "createdAt")]
        created_at: String,
        friend: NotificationUser,
    },

    // === Shop Notifications ===
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.ShopGiftReceivedNotification")]
    ShopGiftReceived {
        #[serde(rename = "createdAt")]
        created_at: String,
        #[serde(rename = "shopItem")]
        shop_item: NotificationShopItem,
        grantor: NotificationUser,
        #[serde(rename = "expirationDate")]
        expiration_date: Option<String>,
    },
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.ShopItemBoughtNotification")]
    ShopItemBought {
        #[serde(rename = "createdAt")]
        created_at: String,
        #[serde(rename = "shopItem")]
        shop_item: NotificationShopItem,
        #[serde(rename = "expirationDate")]
        expiration_date: Option<String>,
    },
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.ShopItemExpiringSoonNotification")]
    ShopItemExpiringSoon {
        #[serde(rename = "createdAt")]
        created_at: String,
        #[serde(rename = "shopItem")]
        shop_item: NotificationShopItem,
        #[serde(rename = "expirationDate")]
        expiration_date: String,
    },
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.ShopItemExpiredNotification")]
    ShopItemExpired {
        #[serde(rename = "createdAt")]
        created_at: String,
        #[serde(rename = "shopItem")]
        shop_item: NotificationShopItem,
    },

    // === McReal Notifications ===
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.McRealPunishmentNotification")]
    McRealPunishment {
        #[serde(rename = "createdAt")]
        created_at: String,
        duration: String,
        reason: String,
        #[serde(rename = "expirationDate")]
        expiration_date: Option<String>,
    },
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.McRealPunishmentRevokedNotification")]
    McRealPunishmentRevoked {
        #[serde(rename = "createdAt")]
        created_at: String,
    },
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.McRealPostCommentedNotification")]
    McRealPostCommented {
        #[serde(rename = "createdAt")]
        created_at: String,
        #[serde(rename = "postId")]
        post_id: String,
        #[serde(rename = "commentId")]
        comment_id: String,
        commenter: String,
        #[serde(rename = "commenterInfo")]
        commenter_info: Option<NotificationUser>,
        #[serde(rename = "commentPreview")]
        comment_preview: Option<String>,
    },
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.McRealCommentCommentedNotification")]
    McRealCommentCommented {
        #[serde(rename = "createdAt")]
        created_at: String,
        #[serde(rename = "parentCommentId")]
        parent_comment_id: String,
        #[serde(rename = "commentId")]
        comment_id: String,
        commenter: String,
        #[serde(rename = "commenterInfo")]
        commenter_info: Option<NotificationUser>,
        #[serde(rename = "commentPreview")]
        comment_preview: Option<String>,
    },
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.McRealPostedNotification")]
    McRealPosted {
        #[serde(rename = "createdAt")]
        created_at: String,
        #[serde(rename = "postId")]
        post_id: String,
        author: String,
        #[serde(rename = "authorInfo")]
        author_info: Option<NotificationUser>,
    },
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.McRealMentionedInPostNotification")]
    McRealMentionedInPost {
        #[serde(rename = "createdAt")]
        created_at: String,
        #[serde(rename = "postId")]
        post_id: String,
        author: String,
        #[serde(rename = "authorInfo")]
        author_info: Option<NotificationUser>,
    },
    #[serde(rename = "gg.norisk.networking.model.notifications.notification.McRealMentionedInCommentNotification")]
    McRealMentionedInComment {
        #[serde(rename = "createdAt")]
        created_at: String,
        #[serde(rename = "commentId")]
        comment_id: String,
        author: String,
        #[serde(rename = "authorInfo")]
        author_info: Option<NotificationUser>,
        #[serde(rename = "commentPreview")]
        comment_preview: Option<String>,
    },
}
