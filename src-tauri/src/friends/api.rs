use crate::config::HTTP_CLIENT;
use crate::error::{AppError, Result};
use crate::friends::models::{
    ApiFriendsInformationDto, ApiFriendsFriendUser, ApiFriendsUser, FriendRequestState,
    FriendRequestUser, FriendRequestWithUsers, FriendsFriendUser, FriendsUser, OnlineState,
};
use crate::minecraft::api::norisk_api::NoRiskApi;
use log::{debug, error};
use uuid::Uuid;

const MOJANG_API_URL: &str = "https://api.mojang.com";

pub struct FriendsInformationDto {
    pub friends: Vec<FriendsFriendUser>,
    pub pending: Vec<FriendRequestWithUsers>,
}

pub struct FriendsApi;

impl FriendsApi {
    async fn get_uuid_from_username(username: &str) -> Result<Uuid> {
        let url = format!("{}/users/profiles/minecraft/{}", MOJANG_API_URL, username);

        debug!("[Friends API] Looking up UUID for username: {}", username);

        let response = HTTP_CLIENT
            .get(&url)
            .send()
            .await
            .map_err(|e| {
                error!("[Friends API] Mojang API request failed: {}", e);
                AppError::RequestError(format!("Failed to lookup player: {}", e))
            })?;

        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::RequestError(format!("Player '{}' not found", username)));
        }
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            error!("[Friends API] Mojang API error: {} - {}", status, error_body);
            return Err(AppError::RequestError(format!("Mojang API error: {}", status)));
        }

        let body: serde_json::Value = response.json().await.map_err(|e| {
            error!("[Friends API] Failed to parse Mojang response: {}", e);
            AppError::ParseError(format!("Failed to parse Mojang response: {}", e))
        })?;

        let id_str = body.get("id").and_then(|v| v.as_str()).ok_or_else(|| {
            AppError::ParseError("Missing 'id' in Mojang response".to_string())
        })?;

        let formatted_uuid = format!(
            "{}-{}-{}-{}-{}",
            &id_str[0..8],
            &id_str[8..12],
            &id_str[12..16],
            &id_str[16..20],
            &id_str[20..32]
        );

        Uuid::parse_str(&formatted_uuid).map_err(|e| {
            AppError::ParseError(format!("Invalid UUID format: {}", e))
        })
    }

    pub async fn get_friends(
        norisk_token: &str,
        uuid: &Uuid,
        is_experimental: bool,
    ) -> Result<FriendsInformationDto> {
        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/friends/{}", base_url, uuid);

        debug!("[Friends API] Fetching friends for {}", uuid);

        let response = HTTP_CLIENT
            .get(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|e| {
                error!("[Friends API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to fetch friends: {}", e))
            })?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            error!("[Friends API] Error response: {} - {}", status, error_body);
            return Err(AppError::RequestError(format!(
                "Friends API error: {} - {}",
                status, error_body
            )));
        }

        let body_text = response.text().await.map_err(|e| {
            error!("[Friends API] Failed to get response body: {}", e);
            AppError::ParseError(format!("Failed to get response body: {}", e))
        })?;

        debug!("[Friends API] Response body: {}", &body_text[..body_text.len().min(500)]);

        let api_response: ApiFriendsInformationDto = serde_json::from_str(&body_text).map_err(|e| {
            error!("[Friends API] Parse error: {} - Body: {}", e, &body_text[..body_text.len().min(500)]);
            AppError::ParseError(format!("Failed to parse friends response: {}", e))
        })?;

        debug!("[Friends API] Raw pending count: {}", api_response.pending.len());
        for (i, val) in api_response.pending.iter().enumerate() {
            debug!("[Friends API] Pending item {}: {}", i, val);
        }

        let pending: Vec<FriendRequestWithUsers> = api_response
            .pending
            .into_iter()
            .filter_map(|val| {
                let obj = match val.as_object() {
                    Some(o) => o,
                    None => {
                        debug!("[Friends API] Pending item is not an object: {}", val);
                        return None;
                    }
                };

                let req = match obj.get("friendRequest").and_then(|v| v.as_object()) {
                    Some(r) => r,
                    None => {
                        debug!("[Friends API] Missing friendRequest in: {:?}", obj.keys().collect::<Vec<_>>());
                        return None;
                    }
                };

                let users_arr = match obj.get("users").and_then(|v| v.as_array()) {
                    Some(u) => u,
                    None => {
                        debug!("[Friends API] Missing users in: {:?}", obj.keys().collect::<Vec<_>>());
                        return None;
                    }
                };

                let id = match req.get("_id").and_then(|v| v.as_str()) {
                    Some(id) => id.to_string(),
                    None => {
                        debug!("[Friends API] Missing _id in friendRequest: {:?}", req.keys().collect::<Vec<_>>());
                        return None;
                    }
                };

                let sender = match req.get("sender").and_then(|v| v.as_str()).and_then(|s| Uuid::parse_str(s).ok()) {
                    Some(s) => s,
                    None => {
                        debug!("[Friends API] Failed to parse sender: {:?}", req.get("sender"));
                        return None;
                    }
                };

                let receiver = match req.get("receiver").and_then(|v| v.as_str()).and_then(|s| Uuid::parse_str(s).ok()) {
                    Some(r) => r,
                    None => {
                        debug!("[Friends API] Failed to parse receiver: {:?}", req.get("receiver"));
                        return None;
                    }
                };

                let state_str = req.get("currentState").and_then(|v| v.as_str()).unwrap_or("NONE");
                let state = match state_str {
                    "PENDING" => FriendRequestState::Pending,
                    "ACCEPTED" => FriendRequestState::Accepted,
                    "DENIED" => FriendRequestState::Denied,
                    "WITHDRAWN" => FriendRequestState::Withdrawn,
                    _ => FriendRequestState::None,
                };
                let timestamp = req.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);

                let users: Vec<FriendRequestUser> = users_arr
                    .iter()
                    .filter_map(|u| {
                        let obj = u.as_object()?;
                        Some(FriendRequestUser {
                            uuid: Uuid::parse_str(obj.get("uuid")?.as_str()?).ok()?,
                            username: obj.get("ign")?.as_str()?.to_string(),
                        })
                    })
                    .collect();

                debug!("[Friends API] Parsed request: id={}, sender={}, receiver={}", id, sender, receiver);

                Some(FriendRequestWithUsers {
                    id,
                    sender,
                    receiver,
                    state,
                    timestamp,
                    users,
                })
            })
            .collect();

        debug!("[Friends API] Final pending count: {}", pending.len());

        Ok(FriendsInformationDto {
            friends: api_response.friends.into_iter().map(|f| f.into()).collect(),
            pending,
        })
    }

    pub async fn get_current_user(
        norisk_token: &str,
        username: &str,
        is_experimental: bool,
    ) -> Result<FriendsUser> {
        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/friends/user", base_url);

        debug!("[Friends API] Fetching current user data");

        let response = HTTP_CLIENT
            .get(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|e| {
                error!("[Friends API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to fetch user data: {}", e))
            })?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            error!("[Friends API] Error response: {} - {}", status, error_body);
            return Err(AppError::RequestError(format!(
                "Friends API error: {} - {}",
                status, error_body
            )));
        }

        let body_text = response.text().await.map_err(|e| {
            error!("[Friends API] Failed to get response body: {}", e);
            AppError::ParseError(format!("Failed to get response body: {}", e))
        })?;

        debug!("[Friends API] User response body: {}", &body_text[..body_text.len().min(500)]);

        let api_response: ApiFriendsUser = serde_json::from_str(&body_text).map_err(|e| {
            error!("[Friends API] Parse error: {} - Body: {}", e, &body_text[..body_text.len().min(500)]);
            AppError::ParseError(format!("Failed to parse user response: {}", e))
        })?;

        Ok(FriendsUser::from_api(api_response, username.to_string()))
    }

    pub async fn send_friend_request(
        norisk_token: &str,
        target_name: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let target_uuid = Self::get_uuid_from_username(target_name).await?;

        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/friends/{}/add", base_url, target_uuid);

        debug!("[Friends API] Sending friend request to {} ({})", target_name, target_uuid);

        let response = HTTP_CLIENT
            .post(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|e| {
                error!("[Friends API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to send friend request: {}", e))
            })?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            error!("[Friends API] Error response: {} - {}", status, error_body);
            return Err(AppError::RequestError(format!(
                "Failed to send friend request: {} - {}",
                status, error_body
            )));
        }

        Ok(())
    }

    pub async fn accept_friend_request(
        norisk_token: &str,
        target_name: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let target_uuid = Self::get_uuid_from_username(target_name).await?;

        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/friends/{}/add", base_url, target_uuid);

        debug!("[Friends API] Accepting friend request from {} ({})", target_name, target_uuid);

        let response = HTTP_CLIENT
            .post(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|e| {
                error!("[Friends API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to accept friend request: {}", e))
            })?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            error!("[Friends API] Error response: {} - {}", status, error_body);
            return Err(AppError::RequestError(format!(
                "Failed to accept friend request: {} - {}",
                status, error_body
            )));
        }

        Ok(())
    }

    pub async fn deny_friend_request(
        norisk_token: &str,
        target_name: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let target_uuid = Self::get_uuid_from_username(target_name).await?;

        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/friends/{}/remove", base_url, target_uuid);

        debug!("[Friends API] Denying friend request from {} ({})", target_name, target_uuid);

        let response = HTTP_CLIENT
            .delete(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|e| {
                error!("[Friends API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to deny friend request: {}", e))
            })?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            error!("[Friends API] Error response: {} - {}", status, error_body);
            return Err(AppError::RequestError(format!(
                "Failed to deny friend request: {} - {}",
                status, error_body
            )));
        }

        Ok(())
    }

    pub async fn remove_friend(
        norisk_token: &str,
        target_name: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let target_uuid = Self::get_uuid_from_username(target_name).await?;

        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/friends/{}/remove", base_url, target_uuid);

        debug!("[Friends API] Removing friend {} ({})", target_name, target_uuid);

        let response = HTTP_CLIENT
            .delete(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|e| {
                error!("[Friends API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to remove friend: {}", e))
            })?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            error!("[Friends API] Error response: {} - {}", status, error_body);
            return Err(AppError::RequestError(format!(
                "Failed to remove friend: {} - {}",
                status, error_body
            )));
        }

        Ok(())
    }

    pub async fn update_status(
        norisk_token: &str,
        new_status: OnlineState,
        is_experimental: bool,
    ) -> Result<OnlineState> {
        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/friends/status", base_url);

        debug!("[Friends API] Updating status to {:?}", new_status);

        let response = HTTP_CLIENT
            .post(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .header("Content-Type", "application/json")
            .json(&new_status)
            .send()
            .await
            .map_err(|e| {
                error!("[Friends API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to update status: {}", e))
            })?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            error!("[Friends API] Error response: {} - {}", status, error_body);
            return Err(AppError::RequestError(format!(
                "Failed to update status: {} - {}",
                status, error_body
            )));
        }

        let body_text = response.text().await.map_err(|e| {
            error!("[Friends API] Failed to get response body: {}", e);
            AppError::ParseError(format!("Failed to get response body: {}", e))
        })?;

        debug!("[Friends API] Status response: {}", &body_text[..body_text.len().min(500)]);

        serde_json::from_str(&body_text).map_err(|e| {
            error!("[Friends API] Parse error: {} - Body: {}", e, &body_text[..body_text.len().min(500)]);
            AppError::ParseError(format!("Failed to parse status response: {}", e))
        })
    }

    pub async fn update_privacy_setting(
        norisk_token: &str,
        setting: &str,
        value: bool,
        is_experimental: bool,
    ) -> Result<()> {
        let base_url = NoRiskApi::get_api_base(is_experimental);

        let endpoint = match setting {
            "showServer" => "show-server",
            "allowRequests" => "allow-friend-requests",
            "allowServerInvites" => "allow-server-invites",
            _ => setting,
        };

        let url = format!("{}/friends/privacy/{}", base_url, endpoint);

        debug!("[Friends API] Updating privacy {} to {}", endpoint, value);

        let response = HTTP_CLIENT
            .put(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .header("Content-Type", "application/json")
            .json(&value)
            .send()
            .await
            .map_err(|e| {
                error!("[Friends API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to update privacy setting: {}", e))
            })?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            error!("[Friends API] Error response: {} - {}", status, error_body);
            return Err(AppError::RequestError(format!(
                "Failed to update privacy setting: {} - {}",
                status, error_body
            )));
        }

        Ok(())
    }

    pub async fn toggle_ping(
        norisk_token: &str,
        friend_name: &str,
        is_experimental: bool,
    ) -> Result<bool> {
        let target_uuid = Self::get_uuid_from_username(friend_name).await?;

        let base_url = NoRiskApi::get_api_base(is_experimental);
        let url = format!("{}/friends/{}/toggle-ping", base_url, target_uuid);

        debug!("[Friends API] Toggling ping for {} ({})", friend_name, target_uuid);

        let response = HTTP_CLIENT
            .post(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|e| {
                error!("[Friends API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to toggle ping: {}", e))
            })?;

        let status = response.status();
        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            error!("[Friends API] Error response: {} - {}", status, error_body);
            return Err(AppError::RequestError(format!(
                "Failed to toggle ping: {} - {}",
                status, error_body
            )));
        }

        let body_text = response.text().await.map_err(|e| {
            error!("[Friends API] Failed to get response body: {}", e);
            AppError::ParseError(format!("Failed to get response body: {}", e))
        })?;

        debug!("[Friends API] Toggle ping response: {}", &body_text[..body_text.len().min(500)]);

        serde_json::from_str(&body_text).map_err(|e| {
            error!("[Friends API] Parse error: {} - Body: {}", e, &body_text[..body_text.len().min(500)]);
            AppError::ParseError(format!("Failed to parse toggle ping response: {}", e))
        })
    }
}
