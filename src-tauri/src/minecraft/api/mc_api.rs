use crate::config::{ProjectDirsExt, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::dto::minecraft_profile::MinecraftProfile;
use crate::minecraft::dto::piston_meta::PistonMeta;
use crate::minecraft::dto::version_manifest::VersionManifest;
use log::{debug, error};
use reqwest;
use serde::{Deserialize, Serialize};
use serde_json::{self, Value};
use sha1::{Digest, Sha1};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use urlencoding;
use rand;
use tokio;
use tokio::fs as tokio_fs;

const VERSION_MANIFEST_URL: &str = "https://launchermeta.mojang.com/mc/game/version_manifest.json";
const MOJANG_API_URL: &str = "https://api.mojang.com";
const MOJANG_SESSION_URL: &str = "https://sessionserver.mojang.com";

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct JoinServerRequest {
    access_token: String,
    selected_profile: String,
    server_id: String,
}

pub struct MinecraftApiService {
    cache_dir: PathBuf,
}

impl MinecraftApiService {
    pub fn new() -> Self {
        let cache_dir = LAUNCHER_DIRECTORY.meta_dir().join("minecraft_cache");
        if !cache_dir.exists() {
            std::fs::create_dir_all(&cache_dir).unwrap_or_else(|e| {
                error!("Failed to create Minecraft cache directory: {}", e);
            });
        }
        Self { cache_dir }
    }

    async fn fetch_and_cache_manifest(cache_path: &PathBuf) -> Result<VersionManifest> {
        debug!("Fetching Minecraft version manifest from: {}", VERSION_MANIFEST_URL);
        
        let response = HTTP_CLIENT.get(VERSION_MANIFEST_URL)
            .send()
            .await
            .map_err(AppError::MinecraftApi)?;

        let manifest = response
            .json::<VersionManifest>()
            .await
            .map_err(AppError::MinecraftApi)?;

        // Cache the result
        let json_data = serde_json::to_string_pretty(&manifest).map_err(|e| {
            AppError::Other(format!("Failed to serialize manifest: {}", e))
        })?;

        if let Err(e) = tokio_fs::write(cache_path, json_data).await {
            error!("Failed to write Minecraft manifest cache: {}", e);
        } else {
            debug!("Cached Minecraft version manifest: {:?}", cache_path);
        }

        Ok(manifest)
    }

    async fn background_update(cache_path: PathBuf) {
        debug!("[BG] Updating Minecraft version manifest");
        if let Err(e) = Self::fetch_and_cache_manifest(&cache_path).await {
            error!("[BG] Failed to update Minecraft manifest cache: {}", e);
        }
    }

    pub async fn get_version_manifest(&self) -> Result<VersionManifest> {
        let cache_path = self.cache_dir.join("version_manifest.json");

        if cache_path.exists() {
            debug!("Cache hit for Minecraft version manifest: {:?}", cache_path);
            
            // Return cached data immediately
            match tokio_fs::read_to_string(&cache_path).await {
                Ok(cached_data) => {
                    match serde_json::from_str::<VersionManifest>(&cached_data) {
                        Ok(cached_manifest) => {
                            // Spawn background update
                            let cache_path_clone = cache_path.clone();
                            
                            tokio::spawn(async move {
                                Self::background_update(cache_path_clone).await;
                            });
                            
                            return Ok(cached_manifest);
                        }
                        Err(e) => {
                            error!("Failed to parse cached Minecraft manifest: {}", e);
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to read Minecraft manifest cache: {}", e);
                }
            }
        }

        // Cache miss or invalid cache - fetch in foreground
        debug!("Cache miss for Minecraft version manifest, fetching...");
        Self::fetch_and_cache_manifest(&cache_path).await
    }

    async fn fetch_and_cache_piston_meta(cache_path: &PathBuf, url: &str) -> Result<PistonMeta> {
        debug!("Fetching Piston Meta from: {}", url);
        
        let response = HTTP_CLIENT.get(url)
            .send()
            .await
            .map_err(AppError::MinecraftApi)?;

        let meta = response
            .json::<PistonMeta>()
            .await
            .map_err(AppError::MinecraftApi)?;

        // Cache the result
        let json_data = serde_json::to_string_pretty(&meta).map_err(|e| {
            AppError::Other(format!("Failed to serialize piston meta: {}", e))
        })?;

        if let Err(e) = tokio_fs::write(cache_path, json_data).await {
            error!("Failed to write Piston Meta cache: {}", e);
        } else {
            debug!("Cached Piston Meta: {:?}", cache_path);
        }

        Ok(meta)
    }

    async fn background_update_piston_meta(cache_path: PathBuf, url: String) {
        debug!("[BG] Updating Piston Meta");
        if let Err(e) = Self::fetch_and_cache_piston_meta(&cache_path, &url).await {
            error!("[BG] Failed to update Piston Meta cache: {}", e);
        }
    }

    pub async fn get_piston_meta(&self, url: &str) -> Result<PistonMeta> {
        // Create cache filename from URL hash
        let mut hasher = Sha1::new();
        hasher.update(url.as_bytes());
        let hash = format!("{:x}", hasher.finalize());
        let cache_path = self.cache_dir.join(format!("piston_meta_{}.json", hash));

        if cache_path.exists() {
            debug!("Cache hit for Piston Meta: {:?}", cache_path);
            
            // Return cached data immediately
            match tokio_fs::read_to_string(&cache_path).await {
                Ok(cached_data) => {
                    match serde_json::from_str::<PistonMeta>(&cached_data) {
                        Ok(cached_meta) => {
                            // Spawn background update
                            let cache_path_clone = cache_path.clone();
                            let url_clone = url.to_string();
                            
                            tokio::spawn(async move {
                                Self::background_update_piston_meta(cache_path_clone, url_clone).await;
                            });
                            
                            return Ok(cached_meta);
                        }
                        Err(e) => {
                            error!("Failed to parse cached Piston Meta: {}", e);
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to read Piston Meta cache: {}", e);
                }
            }
        }

        // Cache miss or invalid cache - fetch in foreground
        debug!("Cache miss for Piston Meta, fetching...");
        Self::fetch_and_cache_piston_meta(&cache_path, url).await
    }

    // Get user profile including skin information
    pub async fn get_user_profile(&self, uuid: &str) -> Result<MinecraftProfile> {
        debug!("API call: get_user_profile for UUID: {}", uuid);
        let url = format!("{}/session/minecraft/profile/{}", MOJANG_SESSION_URL, uuid);
        debug!("Request URL: {}", url);

        let response = match HTTP_CLIENT.get(&url).send().await {
            Ok(resp) => {
                debug!("Received response with status: {}", resp.status());
                resp
            }
            Err(e) => {
                debug!("API request failed: {:?}", e);
                return Err(AppError::MinecraftApi(e));
            }
        };

        let profile = match response.json::<MinecraftProfile>().await {
            Ok(p) => {
                debug!("Successfully parsed profile data for UUID: {}", uuid);
                p
            }
            Err(e) => {
                debug!("Failed to parse profile data: {:?}", e);
                return Err(AppError::MinecraftApi(e));
            }
        };

        debug!("API call completed: get_user_profile");
        Ok(profile)
    }

    pub async fn get_profile_by_name_or_uuid(
        &self,
        name_or_uuid_query: &str,
    ) -> Result<MinecraftProfile> {
        debug!(
            "API call: get_profile_by_name_or_uuid for query: {}",
            name_or_uuid_query
        );

        // Check if the query is a valid UUID
        if Uuid::parse_str(name_or_uuid_query).is_ok() {
            debug!("Query is a UUID. Fetching profile directly.");
            return self.get_user_profile(name_or_uuid_query).await;
        }

        // If not a UUID, assume it's a username and try to resolve it
        debug!("Query is likely a username. Attempting to resolve to UUID.");
        let username_lookup_url = format!(
            "{}/users/profiles/minecraft/{}",
            MOJANG_API_URL, name_or_uuid_query
        );
        debug!("Username lookup URL: {}", username_lookup_url);

        let response = HTTP_CLIENT.get(&username_lookup_url).send().await.map_err(|e| {
            debug!("Failed to call Mojang API for username lookup: {:?}", e);
            AppError::MinecraftApi(e)
        })?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| format!("HTTP Error {}", status));
            debug!(
                "Mojang API username lookup failed with status {}: {}",
                status, error_text
            );
            return Err(AppError::Other(format!(
                "Failed to find player by name '{}': {}",
                name_or_uuid_query,
                if status == 404 {
                    "Player not found".to_string()
                } else {
                    error_text
                }
            )));
        }

        let player_data = response.json::<Value>().await.map_err(|e| {
            debug!(
                "Failed to parse Mojang API response for username lookup: {:?}",
                e
            );
            AppError::MinecraftApi(e)
        })?;

        if let Some(uuid_str) = player_data.get("id").and_then(Value::as_str) {
            debug!("Successfully resolved username to UUID: {}", uuid_str);
            self.get_user_profile(uuid_str).await
        } else {
            debug!(
                "Could not extract UUID from Mojang API response. Response: {:?}",
                player_data
            );
            Err(AppError::Other(format!(
                "Could not find UUID for player name: {}",
                name_or_uuid_query
            )))
        }
    }

    // Change skin using access token (requires authentication)
    pub async fn change_skin(
        &self,
        access_token: &str,
        uuid: &str,
        skin_path: &str,
        skin_variant: &str,
    ) -> Result<()> {
        debug!(
            "API call: change_skin for UUID: {} with variant: {}",
            uuid, skin_variant
        );
        debug!("Skin file path: {}", skin_path);

        let url = format!("https://api.minecraftservices.com/minecraft/profile/skins");
        debug!("Request URL: {}", url);

        // Read skin file as bytes
        debug!("Reading skin file");
        let file_content = match fs::read(skin_path) {
            Ok(content) => {
                debug!("Successfully read skin file ({} bytes)", content.len());
                content
            }
            Err(e) => {
                debug!("Failed to read skin file: {}", e);
                return Err(AppError::Other(format!("Failed to read skin file: {}", e)));
            }
        };

        // Get filename from path
        let filename = Path::new(skin_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("skin.png");
        debug!("Using filename: {}", filename);

        let client = reqwest::Client::new();
        debug!("Creating multipart form with file and variant");

        // Create form with file part and variant part
        let mime_result = reqwest::multipart::Part::bytes(file_content)
            .file_name(filename.to_string())
            .mime_str("image/png");

        if let Err(ref e) = mime_result {
            debug!("Failed to set MIME type: {}", e);
        }

        let form = reqwest::multipart::Form::new()
            .part(
                "file",
                mime_result.map_err(|e| AppError::Other(format!("Invalid MIME type: {}", e)))?,
            )
            .text("variant", skin_variant.to_string());

        debug!("Sending skin upload request to Minecraft API");
        // Send multipart request
        let response_result = client
            .post(url)
            .header("Authorization", format!("Bearer {}", access_token))
            .multipart(form)
            .send()
            .await;

        if let Err(ref e) = response_result {
            debug!("API request failed: {:?}", e);
        }

        let response = response_result.map_err(AppError::MinecraftApi)?;
        debug!("Received response with status: {}", response.status());

        // Check if successful
        if !response.status().is_success() {
            let error_text_result = response.text().await;

            if let Err(ref e) = error_text_result {
                debug!("Failed to read error response: {:?}", e);
            }

            let error_text = error_text_result.map_err(AppError::MinecraftApi)?;
            debug!("Skin upload failed: {}", error_text);
            return Err(AppError::Other(format!(
                "Failed to change skin: {}",
                error_text
            )));
        }

        debug!("API call completed: change_skin - Skin uploaded successfully");
        Ok(())
    }

    // Reset skin to default
    pub async fn reset_skin(&self, access_token: &str, uuid: &str) -> Result<()> {
        debug!("API call: reset_skin for UUID: {}", uuid);

        let url = format!("{}/user/profile/{}/skin", MOJANG_API_URL, uuid);
        debug!("Request URL: {}", url);

        let client = reqwest::Client::new();
        debug!("Sending skin reset request to Minecraft API");

        let response_result = client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await;

        if let Err(ref e) = response_result {
            debug!("API request failed: {:?}", e);
        }

        let response = response_result.map_err(AppError::MinecraftApi)?;
        debug!("Received response with status: {}", response.status());

        // Check if successful
        if !response.status().is_success() {
            let error_text_result = response.text().await;

            if let Err(ref e) = error_text_result {
                debug!("Failed to read error response: {:?}", e);
            }

            let error_text = error_text_result.map_err(AppError::MinecraftApi)?;
            debug!("Skin reset failed: {}", error_text);
            return Err(AppError::Other(format!(
                "Failed to reset skin: {}",
                error_text
            )));
        }

        debug!("API call completed: reset_skin - Skin reset successfully");
        Ok(())
    }

    // Change skin using base64 data (requires authentication)
    pub async fn change_skin_from_base64(
        &self,
        access_token: &str,
        base64_data: &str,
        skin_variant: &str,
    ) -> Result<()> {
        debug!(
            "API call: change_skin_from_base64 with variant: {}",
            skin_variant
        );
        debug!("Base64 data length: {} characters", base64_data.len());

        let url = format!("https://api.minecraftservices.com/minecraft/profile/skins");
        debug!("Request URL: {}", url);

        // Decode base64 data to bytes
        debug!("Decoding base64 data");
        let file_content = match base64::decode(base64_data) {
            Ok(content) => {
                debug!("Successfully decoded base64 data ({} bytes)", content.len());
                content
            }
            Err(e) => {
                debug!("Failed to decode base64 data: {}", e);
                return Err(AppError::Other(format!(
                    "Failed to decode base64 skin data: {}",
                    e
                )));
            }
        };

        let client = reqwest::Client::new();
        debug!("Creating multipart form with file and variant");

        // Create form with file part and variant part
        let mime_result = reqwest::multipart::Part::bytes(file_content)
            .file_name("skin.png")
            .mime_str("image/png");

        if let Err(ref e) = mime_result {
            debug!("Failed to set MIME type: {}", e);
        }

        let form = reqwest::multipart::Form::new()
            .part(
                "file",
                mime_result.map_err(|e| AppError::Other(format!("Invalid MIME type: {}", e)))?,
            )
            .text("variant", skin_variant.to_string());

        debug!("Sending skin upload request to Minecraft API");
        // Send multipart request
        let response_result = client
            .post(url)
            .header("Authorization", format!("Bearer {}", access_token))
            .multipart(form)
            .send()
            .await;

        if let Err(ref e) = response_result {
            debug!("API request failed: {:?}", e);
        }

        let response = response_result.map_err(AppError::MinecraftApi)?;
        debug!("Received response with status: {}", response.status());

        // Check if successful
        if !response.status().is_success() {
            let error_text_result = response.text().await;

            if let Err(ref e) = error_text_result {
                debug!("Failed to read error response: {:?}", e);
            }

            let error_text = error_text_result.map_err(AppError::MinecraftApi)?;
            debug!("Skin upload failed: {}", error_text);
            return Err(AppError::Other(format!(
                "Failed to change skin: {}",
                error_text
            )));
        }

        debug!("API call completed: change_skin_from_base64 - Skin uploaded successfully");
        Ok(())
    }

    // Join server session - client side authentication for Minecraft servers
    pub async fn join_server_session(
        &self,
        access_token: &str,
        selected_profile: &str,
        server_id: &str,
    ) -> Result<()> {
        debug!(
            "API call: join_server_session for profile: {} server_id: {}",
            selected_profile, server_id
        );

        let url = format!("{}/session/minecraft/join", MOJANG_SESSION_URL);
        debug!("Request URL: {}", url);

        let join_request = JoinServerRequest {
            access_token: access_token.to_string(),
            selected_profile: selected_profile.to_string(),
            server_id: server_id.to_string(),
        };

        debug!("Join request - selected_profile: {}, server_id: {}", selected_profile, server_id);

        let client = reqwest::Client::new();
        debug!("Sending join server request to Minecraft Session API");

        let response_result = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&join_request)
            .send()
            .await;

        if let Err(ref e) = response_result {
            debug!("API request failed: {:?}", e);
        }

        let response = response_result.map_err(AppError::MinecraftApi)?;
        debug!("Received response with status: {}", response.status());

        // Check if successful (should return 204 No Content on success)
        if !response.status().is_success() {
            let error_text_result = response.text().await;

            if let Err(ref e) = error_text_result {
                debug!("Failed to read error response: {:?}", e);
            }

            let error_text = error_text_result.map_err(AppError::MinecraftApi)?;
            debug!("Join server session failed: {}", error_text);
            return Err(AppError::Other(format!(
                "Failed to join server session: {}",
                error_text
            )));
        }

        debug!("API call completed: join_server_session - Successfully joined server session");
        Ok(())
    }

    // Verify login session on server - check if player has joined with the given server ID
    pub async fn has_joined(
        &self,
        username: &str,
        server_id: &str,
        client_ip: Option<&str>,
    ) -> Result<Option<MinecraftProfile>> {
        debug!(
            "API call: has_joined for username: {} server_id: {}{}",
            username,
            server_id,
            if let Some(ip) = client_ip {
                format!(" client_ip: {}", ip)
            } else {
                String::new()
            }
        );

        // Build the URL with query parameters
        let mut url = format!(
            "{}/session/minecraft/hasJoined?username={}&serverId={}",
            MOJANG_SESSION_URL,
            urlencoding::encode(username),
            urlencoding::encode(server_id)
        );

        // Add optional IP parameter
        if let Some(ip) = client_ip {
            url.push_str(&format!("&ip={}", urlencoding::encode(ip)));
        }

        debug!("Request URL: {}", url);

        let response_result = HTTP_CLIENT.get(&url).send().await;

        if let Err(ref e) = response_result {
            debug!("API request failed: {:?}", e);
        }

        let response = response_result.map_err(AppError::MinecraftApi)?;
        debug!("Received response with status: {}", response.status());

        // Handle different response cases
        match response.status().as_u16() {
            200 => {
                // Success - player has joined, return profile
                let profile = response
                    .json::<MinecraftProfile>()
                    .await
                    .map_err(AppError::MinecraftApi)?;
                
                debug!("Player verification successful for username: {}", username);
                Ok(Some(profile))
            }
            204 => {
                // No Content - player has not joined or verification failed
                debug!("Player verification failed - player has not joined: {}", username);
                Ok(None)
            }
            _ => {
                // Other status codes indicate errors
                let error_text_result = response.text().await;

                if let Err(ref e) = error_text_result {
                    debug!("Failed to read error response: {:?}", e);
                }

                let error_text = error_text_result.map_err(AppError::MinecraftApi)?;
                debug!("Player verification request failed: {}", error_text);
                
                Err(AppError::Other(format!(
                    "Failed to verify player session: {}",
                    error_text
                )))
            }
        }
    }

    // Test method with real server simulation (more realistic test)
    pub async fn test_authentication_with_random_server_id(
        &self,
        access_token: &str,
        selected_profile: &str,
        username: &str,
    ) -> Result<bool> {
        debug!("=== Starting Realistic Minecraft Server Authentication Test ===");
        
        // Generate a random server ID (simulating what a real server would do)
        let server_id = format!("{:x}", rand::random::<u64>());
        debug!("Generated random server ID: {}", server_id);

        // Step 1: Join server session
        debug!("Step 1: Client joining server session with random server ID");
        match self.join_server_session(access_token, selected_profile, &server_id).await {
            Ok(_) => {
                debug!("✅ Client successfully joined server session");
            }
            Err(e) => {
                debug!("❌ Client failed to join server session: {:?}", e);
                return Err(e);
            }
        }

        // Step 2: Small delay for propagation
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // Step 3: Server verifies the session
        debug!("Step 2: Server verifying client session");
        match self.has_joined(username, &server_id, None).await {
            Ok(Some(profile)) => {
                debug!("✅ Server verification successful!");
                debug!("Authenticated player: {} (UUID: {})", profile.name, profile.id);
                debug!("=== Realistic Authentication Test PASSED ===");
                Ok(true)
            }
            Ok(None) => {
                debug!("❌ Server verification failed");
                debug!("=== Realistic Authentication Test FAILED ===");
                Ok(false)
            }
            Err(e) => {
                debug!("❌ Server verification error: {:?}", e);
                Err(e)
            }
        }
    }

    // Test Minecraft authentication API using credentials from MinecraftAuthStore
    pub async fn test_minecraft_auth_api() -> Result<bool> {
        debug!("=== Starting Minecraft Auth API Test with Real Credentials ===");

        // Import State to access MinecraftAuthStore
        use crate::state::state_manager::State;

        // Get the current state
        let state = State::get().await?;

        // Get the active account from MinecraftAuthStore
        let active_account = state
            .minecraft_account_manager_v2
            .get_active_account()
            .await?;

        let account = match active_account {
            Some(acc) => {
                debug!("✅ Found active account: {}", acc.username);
                debug!("Account ID: {}", acc.id);
                debug!("Token expires at: {}", acc.expires);
                acc
            }
            None => {
                debug!("❌ No active account found in MinecraftAuthStore");
                return Err(AppError::Other(
                    "No active Minecraft account found. Please login first.".to_string(),
                ));
            }
        };

        // Create MinecraftApiService instance
        let api_service = MinecraftApiService::new();

        // Test the authentication flow
        debug!("🚀 Starting authentication test with real credentials");
        let result = api_service
            .test_authentication_with_random_server_id(
                &account.access_token,
                &account.id.to_string().replace("-", ""), // UUID without dashes
                &account.username,
            )
            .await?;

        if result {
            debug!("🎉 Authentication test PASSED!");
            debug!("✅ The Minecraft authentication API is working correctly");
        } else {
            debug!("❌ Authentication test FAILED!");
            debug!("⚠️ There might be an issue with the authentication flow");
        }

        Ok(result)
    }
}
