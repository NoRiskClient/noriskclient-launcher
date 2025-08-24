use crate::{
    config::HTTP_CLIENT,
    error::{AppError, Result},
};
use log::{debug, error, info};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::fs;
use uuid::Uuid;

/// Represents a cosmetic cape
#[derive(Debug, Serialize, Deserialize)]
pub struct CosmeticCape {
    /// Hash of the cape image (ID)
    #[serde(rename = "_id")]
    pub hash: String,
    /// Whether the cape is accepted
    pub accepted: bool,
    /// Number of times this cape has been used
    pub uses: i32,
    /// UUID of the first player who used this cape
    #[serde(rename = "firstSeen")]
    pub first_seen: Uuid,
    /// Moderator message
    #[serde(default = "default_in_review", rename = "moderatorMessage")]
    pub moderator_message: String,
    /// Creation date in milliseconds since epoch
    #[serde(default = "current_time_millis", rename = "creationDate")]
    pub creation_date: i64,
    /// Whether the cape has elytra
    #[serde(default = "default_true")]
    pub elytra: bool,
}

impl CosmeticCape {
    const IN_REVIEW: &'static str = "In Review";
}

fn default_in_review() -> String {
    CosmeticCape::IN_REVIEW.to_string()
}

fn current_time_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn default_true() -> bool {
    true
}

/// Pagination information for browse responses
#[derive(Debug, Serialize, Deserialize)]
pub struct PaginationInfo {
    /// Current page number (0-based)
    #[serde(rename = "currentPage")]
    pub current_page: i32,
    /// Number of items per page
    #[serde(rename = "pageSize")]
    pub page_size: i32,
    /// Total number of items
    #[serde(rename = "totalItems")]
    pub total_items: i32,
    /// Total number of pages
    #[serde(rename = "totalPages")]
    pub total_pages: i32,
}

/// Response for cape browse endpoints
#[derive(Debug, Serialize, Deserialize)]
pub struct CapesBrowseResponse {
    /// List of capes
    pub capes: Vec<CosmeticCape>,
    /// Pagination information
    pub pagination: PaginationInfo,
}

pub struct CapeApi;

impl CapeApi {
    pub fn new() -> Self {
        Self
    }

    /// Get the base URL for the cosmetics API
    fn get_api_base(is_experimental: bool) -> String {
        if is_experimental {
            debug!("[Cape API] Using experimental API endpoint");
            String::from("https://api-staging.norisk.gg/api/v1/cosmetics")
        } else {
            debug!("[Cape API] Using production API endpoint");
            String::from("https://api.norisk.gg/api/v1/cosmetics")
        }
    }

    /// Browse capes with optional parameters
    ///
    /// Parameters:
    /// - page: Page number (default: 0)
    /// - pageSize: Number of items per page (default: 20)
    /// - sortBy: Sort order (newest, oldest, mostUsed)
    /// - filterHasElytra: Filter capes with elytra (true/false)
    /// - filterCreator: Filter by creator UUID
    /// - timeFrame: Time frame filter (weekly, monthly)
    /// - request_uuid: UUID for tracking the request
    pub async fn browse_capes(
        &self,
        norisk_token: &str,
        page: Option<u32>,
        page_size: Option<u32>,
        sort_by: Option<&str>,
        filter_has_elytra: Option<bool>,
        filter_creator: Option<&Uuid>,
        time_frame: Option<&str>,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<CapesBrowseResponse> {
        let endpoint = "cape/browse";
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        debug!("[Cape API] Making request to browse capes endpoint");
        debug!("[Cape API] Full URL: {}", url);

        let mut query_params = HashMap::new();

        // Add request UUID for tracking
        query_params.insert("uuid", request_uuid.to_string());

        if let Some(p) = page {
            query_params.insert("page", p.to_string());
        }

        if let Some(ps) = page_size {
            query_params.insert("pageSize", ps.to_string());
        }

        if let Some(sb) = sort_by {
            query_params.insert("sortBy", sb.to_string());
        }

        if let Some(he) = filter_has_elytra {
            query_params.insert("filterHasElytra", he.to_string());
        }

        if let Some(fc) = filter_creator {
            query_params.insert("filterCreator", fc.to_string());
        }

        if let Some(tf) = time_frame {
            query_params.insert("timeFrame", tf.to_string());
        }

        debug!(
            "[Cape API] Sending GET request with parameters: {:?}",
            query_params
        );

        let response = HTTP_CLIENT
            .get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&query_params)
            .send()
            .await
            .map_err(|e| {
                error!("[Cape API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to send request to Cape API: {}", e))
            })?;

        let status = response.status();
        debug!("[Cape API] Response status: {}", status);

        if !status.is_success() {
            error!("[Cape API] Error response: Status {}", status);
            return Err(AppError::RequestError(format!(
                "Cape API returned error status: {}",
                status
            )));
        }

        debug!("[Cape API] Parsing response body as JSON");
        response.json::<CapesBrowseResponse>().await.map_err(|e| {
            error!("[Cape API] Failed to parse response: {}", e);
            AppError::ParseError(format!("Failed to parse Cape API response: {}", e))
        })
    }

    /// Get capes for a specific player
    ///
    /// Parameters:
    /// - norisk_token: Authentication token
    /// - player_uuid: UUID of the player to get capes for
    /// - request_uuid: UUID for tracking the request
    /// - is_experimental: Whether to use the experimental API endpoint
    pub async fn get_player_capes(
        &self,
        norisk_token: &str,
        player_uuid: &Uuid,
        request_uuid: &str,
        is_experimental: bool,
    ) -> Result<Vec<CosmeticCape>> {
        let endpoint = format!("cape/user/{}", player_uuid);
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        debug!(
            "[Cape API get_player_capes] Making request for player_uuid: {}. Full URL to be called: {}",
            player_uuid, url
        );

        let mut query_params = HashMap::new();
        query_params.insert("uuid", request_uuid.to_string());

        debug!(
            "[Cape API get_player_capes] Authorization token (first/last 8 chars): {}...{}",
            &norisk_token[..std::cmp::min(8, norisk_token.len())],
            &norisk_token[std::cmp::max(0, norisk_token.len().saturating_sub(8))..]
        );
        debug!(
            "[Cape API get_player_capes] Sending GET request with query parameters: {:?}",
            query_params
        );

        let response = HTTP_CLIENT
            .get(&url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&query_params)
            .send()
            .await
            .map_err(|e| {
                error!("[Cape API get_player_capes] Request failed: {}", e);
                AppError::RequestError(format!(
                    "Failed to send request to Cape API for get_player_capes: {}",
                    e
                ))
            })?;

        let status = response.status();
        debug!("[Cape API get_player_capes] Response status: {}", status);

        if !status.is_success() {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            error!(
                "[Cape API get_player_capes] Error response: Status {}, Body: {}",
                status, error_body
            );
            return Err(AppError::RequestError(format!(
                "Cape API (get_player_capes) returned error status: {}. Details: {}",
                status, error_body
            )));
        }

        debug!("[Cape API get_player_capes] Parsing response body as JSON");
        response.json::<Vec<CosmeticCape>>().await.map_err(|e| {
            error!(
                "[Cape API get_player_capes] Failed to parse response: {}",
                e
            );
            AppError::ParseError(format!(
                "Failed to parse Cape API response for get_player_capes: {}",
                e
            ))
        })
    }

    /// Equip a specific cape for a player
    ///
    /// Parameters:
    /// - norisk_token: Authentication token
    /// - player_uuid: UUID of the player
    /// - cape_hash: Hash of the cape to equip
    /// - is_experimental: Whether to use the experimental API endpoint
    pub async fn equip_cape(
        &self,
        norisk_token: &str,
        player_uuid: &Uuid,
        cape_hash: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let endpoint = format!("cape/{}/equip", cape_hash);
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        debug!(
            "[Cape API] Making request to equip cape endpoint for player: {}",
            player_uuid
        );
        debug!("[Cape API] Full URL: {}", url);

        let mut query_params = HashMap::new();
        query_params.insert("uuid", player_uuid.to_string());

        debug!(
            "[Cape API] Sending POST request with parameters: {:?}",
            query_params
        );

        let response = HTTP_CLIENT
            .post(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&query_params)
            .send()
            .await
            .map_err(|e| {
                error!("[Cape API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to send equip cape request: {}", e))
            })?;

        let status = response.status();
        debug!("[Cape API] Response status: {}", status);

        match status {
            StatusCode::OK => {
                info!(
                    "[Cape API] Cape {} equipped successfully for player {}",
                    cape_hash, player_uuid
                );
                Ok(())
            }
            _ => {
                let response_text = response
                    .text()
                    .await
                    .unwrap_or_else(|e| format!("Error reading error response body: {}", e));
                error!(
                    "[Cape API] Error equipping cape: Status {}, Response: {}",
                    status, response_text
                );
                Err(AppError::RequestError(format!(
                    "Failed to equip cape. Status: {}, Details: {}",
                    status, response_text
                )))
            }
        }
    }

    /// Delete a specific cape owned by the player
    ///
    /// Parameters:
    /// - norisk_token: Authentication token
    /// - player_uuid: UUID of the player who owns the cape
    /// - cape_hash: Hash of the cape to delete
    /// - is_experimental: Whether to use the experimental API endpoint
    pub async fn delete_cape(
        &self,
        norisk_token: &str,
        player_uuid: &Uuid,
        cape_hash: &str,
        is_experimental: bool,
    ) -> Result<()> {
        let endpoint = format!("cape/{}", cape_hash);
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        debug!(
            "[Cape API] Making request to delete cape endpoint for player: {} cape: {}",
            player_uuid, cape_hash
        );
        debug!("[Cape API] Full URL: {}", url);

        let mut query_params = HashMap::new();
        query_params.insert("uuid", player_uuid.to_string());

        debug!(
            "[Cape API] Sending DELETE request with parameters: {:?}",
            query_params
        );

        let response = HTTP_CLIENT
            .delete(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&query_params)
            .send()
            .await
            .map_err(|e| {
                error!("[Cape API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to send delete cape request: {}", e))
            })?;

        let status = response.status();
        debug!("[Cape API] Response status: {}", status);

        match status {
            StatusCode::OK => {
                info!(
                    "[Cape API] Cape {} deleted successfully for player {}",
                    cape_hash, player_uuid
                );
                Ok(())
            }
            _ => {
                let response_text = response
                    .text()
                    .await
                    .unwrap_or_else(|e| format!("Error reading error response body: {}", e));
                error!(
                    "[Cape API] Error deleting cape: Status {}, Response: {}",
                    status, response_text
                );
                Err(AppError::RequestError(format!(
                    "Failed to delete cape. Status: {}, Details: {}",
                    status, response_text
                )))
            }
        }
    }

    /// Upload a new cape image for a player
    ///
    /// Parameters:
    /// - norisk_token: Authentication token
    /// - player_uuid: UUID of the player uploading the cape
    /// - image_path: Path to the cape image file (PNG)
    /// - is_experimental: Whether to use the experimental API endpoint
    ///
    /// Returns:
    /// - Result containing the response text from the API (e.g., new cape hash or confirmation) on success.
    pub async fn upload_cape(
        &self,
        norisk_token: &str,
        player_uuid: &Uuid,
        image_path: &PathBuf,
        is_experimental: bool,
    ) -> Result<String> {
        let endpoint = "cape";
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        debug!(
            "[Cape API] Making request to upload cape endpoint for player: {}",
            player_uuid
        );
        debug!("[Cape API] Image path: {:?}", image_path);
        debug!("[Cape API] Full URL: {}", url);

        // Read the image file content asynchronously
        let image_data = fs::read(image_path).await.map_err(|e| {
            error!(
                "[Cape API] Failed to read image file {:?}: {}",
                image_path, e
            );
            AppError::Io(e)
        })?;

        let mut query_params = HashMap::new();
        query_params.insert("uuid", player_uuid.to_string());

        debug!(
            "[Cape API] Sending POST request with image data ({} bytes) and parameters: {:?}",
            image_data.len(),
            query_params
        );

        let response = HTTP_CLIENT
            .post(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&query_params)
            .body(image_data)
            .send()
            .await
            .map_err(|e| {
                error!("[Cape API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to send upload cape request: {}", e))
            })?;

        let status = response.status();
        debug!("[Cape API] Response status: {}", status);

        let response_text = response.text().await.map_err(|e| {
            error!("[Cape API] Failed to read response text: {}", e);
            AppError::RequestError(format!("Failed to read upload cape response text: {}", e))
        })?;

        if status.is_success() {
            info!(
                "[Cape API] Cape uploaded successfully for player {}. Response: {}",
                player_uuid, response_text
            );
            Ok(response_text)
        } else {
            error!(
                "[Cape API] Error uploading cape: Status {}, Response: {}",
                status, response_text
            );
            Err(AppError::RequestError(format!(
                "Failed to upload cape. Status: {}, Details: {}",
                status, response_text
            )))
        }
    }

    /// Fetch multiple capes by hashes (max 100)
    pub async fn get_capes_by_hashes(
        &self,
        norisk_token: &str,
        hashes: &[String],
        is_experimental: bool,
    ) -> Result<Vec<CosmeticCape>> {
        let endpoint = "cape/many";
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        let joined: String = hashes.iter().take(100).cloned().collect::<Vec<_>>().join(",");
        debug!(
            "[Cape API] Requesting multiple capes (count={}): {}",
            hashes.len().min(100),
            joined
        );
        debug!("[Cape API] Full URL: {}", url);

        let response = HTTP_CLIENT
            .get(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&[("hash", joined)])
            .send()
            .await
            .map_err(|e| {
                error!("[Cape API] Request failed: {}", e);
                AppError::RequestError(format!(
                    "Failed to send get capes by hashes request: {}",
                    e
                ))
            })?;

        let status = response.status();
        debug!("[Cape API] Response status: {}", status);

        if !status.is_success() {
            let response_text = response
                .text()
                .await
                .unwrap_or_else(|e| format!("Error reading error response body: {}", e));
            error!(
                "[Cape API] Error getting capes by hashes: Status {}, Response: {}",
                status, response_text
            );
            return Err(AppError::RequestError(format!(
                "Failed to get capes by hashes. Status: {}, Details: {}",
                status, response_text
            )));
        }

        response.json::<Vec<CosmeticCape>>().await.map_err(|e| {
            error!(
                "[Cape API] Failed to parse get capes by hashes response body: {}",
                e
            );
            AppError::ParseError(format!(
                "Failed to parse get capes by hashes response body: {}",
                e
            ))
        })
    }

    /// Add a cape to user's favorites
    ///
    /// Parameters:
    /// - norisk_token: Authentication token
    /// - cape_hash: Hash of the cape to favorite
    /// - is_experimental: Whether to use the experimental API endpoint
    ///
    /// Returns: Updated list of favorite cape hashes
    pub async fn add_favorite_cape(
        &self,
        norisk_token: &str,
        cape_hash: &str,
        is_experimental: bool,
    ) -> Result<Vec<String>> {
        let endpoint = format!("cape/favorite/{}", cape_hash);
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        debug!(
            "[Cape API] Making request to add favorite cape: {}",
            cape_hash
        );
        debug!("[Cape API] Full URL: {}", url);

        let response = HTTP_CLIENT
            .put(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|e| {
                error!("[Cape API] Request failed: {}", e);
                AppError::RequestError(format!(
                    "Failed to send add favorite cape request: {}",
                    e
                ))
            })?;

        let status = response.status();
        debug!("[Cape API] Response status: {}", status);

        if status.is_success() {
            let favorites = response.json::<Vec<String>>().await.map_err(|e| {
                error!(
                    "[Cape API] Failed to parse add favorite response body: {}",
                    e
                );
                AppError::ParseError(format!(
                    "Failed to parse add favorite cape response body: {}",
                    e
                ))
            })?;
            info!(
                "[Cape API] Cape {} added to favorites successfully. Total favorites: {}",
                cape_hash,
                favorites.len()
            );
            Ok(favorites)
        } else {
            let response_text = response
                .text()
                .await
                .unwrap_or_else(|e| format!("Error reading error response body: {}", e));
            error!(
                "[Cape API] Error adding favorite cape: Status {}, Response: {}",
                status, response_text
            );
            Err(AppError::RequestError(format!(
                "Failed to add favorite cape. Status: {}, Details: {}",
                status, response_text
            )))
        }
    }

    /// Remove a cape from user's favorites
    ///
    /// Parameters:
    /// - norisk_token: Authentication token
    /// - cape_hash: Hash of the cape to remove from favorites
    /// - is_experimental: Whether to use the experimental API endpoint
    ///
    /// Returns: Updated list of favorite cape hashes
    pub async fn remove_favorite_cape(
        &self,
        norisk_token: &str,
        cape_hash: &str,
        is_experimental: bool,
    ) -> Result<Vec<String>> {
        let endpoint = format!("cape/favorite/{}", cape_hash);
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        debug!(
            "[Cape API] Making request to remove favorite cape: {}",
            cape_hash
        );
        debug!("[Cape API] Full URL: {}", url);

        let response = HTTP_CLIENT
            .delete(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .send()
            .await
            .map_err(|e| {
                error!("[Cape API] Request failed: {}", e);
                AppError::RequestError(format!(
                    "Failed to send remove favorite cape request: {}",
                    e
                ))
            })?;

        let status = response.status();
        debug!("[Cape API] Response status: {}", status);

        if status.is_success() {
            let favorites = response.json::<Vec<String>>().await.map_err(|e| {
                error!(
                    "[Cape API] Failed to parse remove favorite response body: {}",
                    e
                );
                AppError::ParseError(format!(
                    "Failed to parse remove favorite cape response body: {}",
                    e
                ))
            })?;
            info!(
                "[Cape API] Cape {} removed from favorites successfully. Total favorites: {}",
                cape_hash,
                favorites.len()
            );
            Ok(favorites)
        } else {
            let response_text = response
                .text()
                .await
                .unwrap_or_else(|e| format!("Error reading error response body: {}", e));
            error!(
                "[Cape API] Error removing favorite cape: Status {}, Response: {}",
                status, response_text
            );
            Err(AppError::RequestError(format!(
                "Failed to remove favorite cape. Status: {}, Details: {}",
                status, response_text
            )))
        }
    }

    /// Unequip the currently equipped cape for a player
    ///
    /// Parameters:
    /// - norisk_token: Authentication token
    /// - player_uuid: UUID of the player
    /// - is_experimental: Whether to use the experimental API endpoint
    pub async fn unequip_cape(
        &self,
        norisk_token: &str,
        player_uuid: &Uuid,
        is_experimental: bool,
    ) -> Result<()> {
        let endpoint = "cape/unequip";
        let base_url = Self::get_api_base(is_experimental);
        let url = format!("{}/{}", base_url, endpoint);

        debug!(
            "[Cape API] Making request to unequip cape endpoint for player: {}",
            player_uuid
        );
        debug!("[Cape API] Full URL: {}", url);

        let mut query_params = HashMap::new();
        query_params.insert("uuid", player_uuid.to_string());

        debug!(
            "[Cape API] Sending DELETE request to unequip with parameters: {:?}",
            query_params
        );

        // Note: Using DELETE method as per the original code for the unequip endpoint
        let response = HTTP_CLIENT
            .delete(url)
            .header("Authorization", format!("Bearer {}", norisk_token))
            .query(&query_params)
            .send()
            .await
            .map_err(|e| {
                error!("[Cape API] Request failed: {}", e);
                AppError::RequestError(format!("Failed to send unequip cape request: {}", e))
            })?;

        let status = response.status();
        debug!("[Cape API] Response status: {}", status);

        match status {
            StatusCode::OK => {
                info!(
                    "[Cape API] Cape unequipped successfully for player {}",
                    player_uuid
                );
                Ok(())
            }
            _ => {
                let response_text = response
                    .text()
                    .await
                    .unwrap_or_else(|e| format!("Error reading error response body: {}", e));
                error!(
                    "[Cape API] Error unequipping cape: Status {}, Response: {}",
                    status, response_text
                );
                Err(AppError::RequestError(format!(
                    "Failed to unequip cape. Status: {}, Details: {}",
                    status, response_text
                )))
            }
        }
    }
}
