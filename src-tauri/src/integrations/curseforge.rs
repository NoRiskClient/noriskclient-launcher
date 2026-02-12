use crate::config::HTTP_CLIENT;
use crate::error::{AppError, Result};
use crate::state::event_state::{EventPayload, EventType};
use crate::state::profile_state::{Mod, ModLoader, ModPackInfo, ModPackSource, ModSource, Profile, ProfileSettings, ProfileState};
use log::{debug, error, info, warn};
use reqwest;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::fs;
use uuid::Uuid;
use chrono::Utc;
use sanitize_filename;
use async_zip::tokio::read::seek::ZipFileReader;
use tokio::io::BufReader;
use futures::future::try_join_all;
use tempfile;
use tokio_util::compat::FuturesAsyncReadCompatExt;
use sysinfo::System;

// Import for profile image upload functionality
use crate::commands::path_commands::UploadProfileImagesPayload;
use crate::utils::serde_utils::deserialize_optional_u64_from_string;

use crate::utils::string_utils::safe_truncate;

// Base URL for CurseForge API
const CURSEFORGE_API_BASE_URL: &str = "https://api.curseforge.com/v1";

// Public CurseForge API Key (from PrismLauncher/MultiMC)
const CURSEFORGE_API_KEY: &str = "$2a$10$bL4bIL5pUWqfcO7KQtnMReakwtfHbNKh6v1uTpKlzhwoueEJQnPnm";

/// Gets the total system RAM in MB
fn get_system_ram_mb() -> u64 {
    let mut sys = System::new_all();
    sys.refresh_memory();
    let total_memory_bytes = sys.total_memory();
    total_memory_bytes / (1024 * 1024)
}

/// Determines appropriate memory settings based on recommended RAM and system capabilities
fn determine_memory_settings(recommended_ram_mb: Option<u64>) -> crate::state::profile_state::MemorySettings {
    use crate::state::profile_state::MemorySettings;

    let system_ram_mb = get_system_ram_mb();
    info!("System RAM detected: {} MB", system_ram_mb);

    match recommended_ram_mb {
        Some(recommended) => {
            info!("CurseForge pack recommends {} MB RAM", recommended);

            // Reserve some RAM for the system (leave at least 2GB for system)
            let available_ram_mb = system_ram_mb.saturating_sub(2048);

            if recommended > available_ram_mb {
                warn!(
                    "Recommended RAM ({} MB) exceeds available system RAM ({} MB after reserving 2GB for system). Using adjusted amount instead.",
                    recommended, available_ram_mb
                );

                // Use available RAM, but cap at a reasonable maximum
                let ram_amount = available_ram_mb.min(16384).max(1024); // Use available RAM with caps, min 1GB

                MemorySettings {
                    min: ram_amount as u32,
                    max: ram_amount as u32,
                }
            } else {
                // Use recommended RAM, but ensure reasonable bounds
                let ram_amount = recommended.min(available_ram_mb).min(16384).max(1024); // Use recommended RAM with caps, min 1GB

                info!("Using recommended RAM settings: {} MB", ram_amount);
                MemorySettings {
                    min: ram_amount as u32,
                    max: ram_amount as u32,
                }
            }
        }
        None => {
            info!("No recommended RAM specified in CurseForge pack, using defaults");
            // Use system-aware defaults
            let ram_amount = (system_ram_mb / 2).min(4096).max(3048); // 1/4 of system RAM, min 2GB, max 4GB

            MemorySettings {
                min: ram_amount as u32,
                max: ram_amount as u32,
            }
        }
    }
}

// Structures for deserializing CurseForge API responses (Search)
// Based on https://docs.curseforge.com/rest-api/?javascript#tocS_Search%20Mods%20Response

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeSearchResponse {
    pub data: Vec<CurseForgeMod>,
    pub pagination: CurseForgePagination,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgePagination {
    pub index: u32,
    pub pageSize: u32,
    pub resultCount: u32,
    pub totalCount: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeMod {
    pub id: u32,
    pub gameId: u32,
    pub name: String,
    pub slug: String,
    pub links: CurseForgeLinks,
    pub summary: String,
    pub status: u32,
    pub downloadCount: u64,
    pub isFeatured: bool,
    pub primaryCategoryId: u32,
    pub categories: Vec<CurseForgeCategory>,
    pub classId: Option<u32>,
    pub authors: Vec<CurseForgeAuthor>,
    pub logo: Option<CurseForgeAttachment>,
    pub screenshots: Vec<CurseForgeAttachment>,
    pub mainFileId: u32,
    pub latestFiles: Vec<CurseForgeFile>,
    pub latestFilesIndexes: Vec<CurseForgeFileIndex>,
    pub latestEarlyAccessFilesIndexes: Vec<CurseForgeFileIndex>,
    pub dateCreated: String,
    pub dateModified: String,
    pub dateReleased: String,
    pub allowModDistribution: Option<bool>,
    pub gamePopularityRank: u32,
    pub isAvailable: bool,
    pub thumbsUpCount: u32,
    pub rating: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeCategory {
    pub id: u32,
    pub gameId: u32,
    pub name: String,
    pub slug: String,
    pub url: String,
    pub iconUrl: String,
    pub dateModified: String,
    pub isClass: Option<bool>,
    pub classId: Option<u32>,
    pub parentCategoryId: Option<u32>,
    pub displayIndex: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeAuthor {
    pub id: u32,
    pub name: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeAttachment {
    pub id: u32,
    pub modId: u32,
    pub title: String,
    pub description: String,
    pub thumbnailUrl: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeLinks {
    pub websiteUrl: String,
    pub wikiUrl: Option<String>,
    pub issuesUrl: Option<String>,
    pub sourceUrl: Option<String>,
}

// Additional structures for files
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeFile {
    pub id: u32,
    pub gameId: u32,
    pub modId: u32,
    pub isAvailable: bool,
    pub displayName: String,
    pub fileName: String,
    pub releaseType: u32,
    pub fileStatus: u32,
    pub hashes: Vec<CurseForgeFileHash>,
    pub fileDate: String,
    pub fileLength: u64,
    pub downloadCount: u64,
    pub fileSizeOnDisk: Option<u64>, // Made optional as per API docs
    pub downloadUrl: String, // Not optional per API docs
    pub gameVersions: Vec<String>,
    pub sortableGameVersions: Vec<CurseForgeSortableGameVersion>,
    pub dependencies: Vec<CurseForgeDependency>,
    pub exposeAsAlternative: Option<bool>,
    pub parentProjectFileId: Option<u32>,
    pub alternateFileId: Option<u32>,
    pub isServerPack: Option<bool>,
    pub serverPackFileId: Option<u32>,
    pub isEarlyAccessContent: Option<bool>,
    pub earlyAccessEndDate: Option<String>,
    pub fileFingerprint: u64,
    #[serde(default, deserialize_with = "parse_vec_default_on_null")]
    pub modules: Vec<CurseForgeModule>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeFileHash {
    pub value: String,
    pub algo: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeSortableGameVersion {
    pub gameVersionName: String,
    pub gameVersionPadded: String,
    pub gameVersion: String,
    pub gameVersionReleaseDate: String,
    pub gameVersionTypeId: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeDependency {
    pub modId: u32,
    pub relationType: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeModule {
    pub name: String,
    pub fingerprint: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeFileIndex {
    pub gameVersion: String,
    pub fileId: u32,
    pub filename: String,
    pub releaseType: u32,
    pub gameVersionTypeId: Option<u32>,
    pub modLoader: Option<u32>,
}

fn parse_vec_default_on_null<'de, D, T>(deserializer: D) -> std::result::Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}

// Function to search for mods on CurseForge
pub async fn search_mods(
    game_id: u32,
    search_filter: Option<String>,
    class_id: Option<u32>,
    category_id: Option<u32>,
    game_version: Option<String>,
    sort_field: Option<CurseForgeModSearchSortField>,
    sort_order: Option<CurseForgeSortOrder>,
    mod_loader_types: Option<Vec<CurseForgeModLoaderType>>,
    game_version_type_id: Option<u32>,
    index: Option<u32>,
    page_size: Option<u32>,
) -> Result<CurseForgeSearchResponse> {
    let url = format!("{}/mods/search", CURSEFORGE_API_BASE_URL);

    let mut query_params: Vec<(String, String)> = Vec::new();

    // Add required gameId
    query_params.push(("gameId".to_string(), game_id.to_string()));

    // Add optional searchFilter
    if let Some(filter) = search_filter {
        query_params.push(("searchFilter".to_string(), filter.clone()));
        log::debug!("CurseForge search - Search filter: {}", filter);
    }

    // Add optional classId
    if let Some(class) = class_id {
        query_params.push(("classId".to_string(), class.to_string()));
        log::debug!("CurseForge search - Class ID: {}", class);
    }

    // Add optional categoryId
    if let Some(category) = category_id {
        query_params.push(("categoryId".to_string(), category.to_string()));
        log::debug!("CurseForge search - Category ID: {}", category);
    }

    // Add optional gameVersion
    if let Some(version) = game_version {
        query_params.push(("gameVersion".to_string(), version.clone()));
        log::debug!("CurseForge search - Game version: {}", version);
    }

    // Add optional sortField
    if let Some(sort) = sort_field {
        query_params.push(("sortField".to_string(), (sort.clone() as u32).to_string()));
        log::debug!("CurseForge search - Sort field: {:?}", sort);
    }

    // Add optional sortOrder
    if let Some(order) = sort_order {
        query_params.push(("sortOrder".to_string(), order.to_string()));
        log::debug!("CurseForge search - Sort order: {:?}", order);
    }

    // Add optional modLoaderTypes
    if let Some(loader_types) = mod_loader_types {
        if !loader_types.is_empty() {
            let loader_ids: Vec<String> = loader_types
                .iter()
                .map(|loader| (*loader as u32).to_string())
                .collect();
            query_params.push(("modLoaderTypes".to_string(), format!("[{}]", loader_ids.join(","))));
            log::debug!("CurseForge search - Mod loader types: {:?}", loader_types);
        }
    }

    // Add optional gameVersionTypeId
    if let Some(version_type) = game_version_type_id {
        query_params.push(("gameVersionTypeId".to_string(), version_type.to_string()));
        log::debug!("CurseForge search - Game version type ID: {}", version_type);
    }

    // Add optional index for pagination
    if let Some(idx) = index {
        query_params.push(("index".to_string(), idx.to_string()));
        log::debug!("CurseForge search - Index: {}", idx);
    }

    // Add optional pageSize
    if let Some(size) = page_size {
        query_params.push(("pageSize".to_string(), size.to_string()));
        log::debug!("CurseForge search - Page size: {}", size);
    }

    // Build the final URL with query parameters
    let final_url = reqwest::Url::parse_with_params(&url, &query_params)
        .map_err(|e| AppError::Other(format!("Failed to build CurseForge search URL: {}", e)))?;

    log::info!("Searching CurseForge: {}", final_url);

    let response = HTTP_CLIENT
        .get(final_url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("CurseForge API request failed: {}", e)))?;

    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .map(|ct| ct.to_str().unwrap_or("unknown"))
        .unwrap_or("missing");

    log::debug!("CurseForge API response - Status: {}, Content-Type: {}", status, content_type);

    // Always read the response body as text first for better error handling
    let response_text = response
        .text()
        .await
        .map_err(|e| AppError::Other(format!("Failed to read CurseForge response body: {}", e)))?;

    // Log response body for debugging (truncated if too long)
    const MAX_BODY_LOG_LENGTH: usize = 2000;
    let logged_body = if response_text.len() > MAX_BODY_LOG_LENGTH {
        format!("{}... (truncated, full length: {})", safe_truncate(&response_text, MAX_BODY_LOG_LENGTH), response_text.len())
    } else {
        response_text.clone()
    };
    log::debug!("CurseForge API response body: {}", logged_body);

    // Check for HTTP errors
    if !status.is_success() {
        log::error!("CurseForge API HTTP error ({}): {}", status, response_text);
        return Err(AppError::Other(format!(
            "CurseForge API returned HTTP error {}: {}",
            status, response_text
        )));
    }

    // Try to parse the JSON response
    let search_response: CurseForgeSearchResponse = match serde_json::from_str(&response_text) {
        Ok(parsed) => parsed,
        Err(parse_err) => {
            log::error!(
                "CurseForge JSON parsing failed. Parse error: {}. Response body (first 500 chars): {}",
                parse_err,
                safe_truncate(&response_text, 500)
            );

            // Try to parse as error response
            if let Ok(error_response) = serde_json::from_str::<serde_json::Value>(&response_text) {
                log::error!("Parsed response as generic JSON: {}", error_response);
            }

            return Err(AppError::Other(format!(
                "Failed to parse CurseForge JSON response: {}. Response starts with: {}",
                parse_err,
                safe_truncate(&response_text, 200)
            )));
        }
    };

    log::info!(
        "Found {} mods out of {} total",
        search_response.data.len(),
        search_response.pagination.totalCount
    );

    Ok(search_response)
}

// Enum for sort fields in mod search
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum CurseForgeModSearchSortField {
    Featured = 1,
    Popularity = 2,
    LastUpdated = 3,
    Name = 4,
    Author = 5,
    TotalDownloads = 6,
    Category = 7,
    GameVersion = 8,
    EarlyAccess = 9,
    FeaturedReleased = 10,
    ReleasedDate = 11,
    Rating = 12,
}

// Enum for sort order
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum CurseForgeSortOrder {
    Asc = 1,
    Desc = 2,
}

impl CurseForgeSortOrder {
    pub fn to_string(&self) -> String {
        match self {
            CurseForgeSortOrder::Asc => "asc".to_string(),
            CurseForgeSortOrder::Desc => "desc".to_string(),
        }
    }
}

// Enum for mod loader types
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub enum CurseForgeModLoaderType {
    Any = 0,
    Forge = 1,
    Cauldron = 2,
    LiteLoader = 3,
    Fabric = 4,
    Quilt = 5,
    NeoForge = 6,
}

impl CurseForgeModLoaderType {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(CurseForgeModLoaderType::Any),
            1 => Some(CurseForgeModLoaderType::Forge),
            2 => Some(CurseForgeModLoaderType::Cauldron),
            3 => Some(CurseForgeModLoaderType::LiteLoader),
            4 => Some(CurseForgeModLoaderType::Fabric),
            5 => Some(CurseForgeModLoaderType::Quilt),
            6 => Some(CurseForgeModLoaderType::NeoForge),
            _ => None,
        }
    }
}

pub enum CurseForgeFileRelationType {
    EmbeddedLibrary = 1,
    OptionalDependency = 2,
    RequiredDependency = 3,
    Tool = 4,
    Incompatible = 5,
    Include = 6,
}

impl CurseForgeFileRelationType {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            1 => Some(CurseForgeFileRelationType::EmbeddedLibrary),
            2 => Some(CurseForgeFileRelationType::OptionalDependency),
            3 => Some(CurseForgeFileRelationType::RequiredDependency),
            4 => Some(CurseForgeFileRelationType::Tool),
            5 => Some(CurseForgeFileRelationType::Incompatible),
            6 => Some(CurseForgeFileRelationType::Include),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            CurseForgeFileRelationType::EmbeddedLibrary => "EmbeddedLibrary",
            CurseForgeFileRelationType::OptionalDependency => "OptionalDependency",
            CurseForgeFileRelationType::RequiredDependency => "RequiredDependency",
            CurseForgeFileRelationType::Tool => "Tool",
            CurseForgeFileRelationType::Incompatible => "Incompatible",
            CurseForgeFileRelationType::Include => "Include",
        }
    }

    pub fn is_required(&self) -> bool {
        matches!(self, CurseForgeFileRelationType::RequiredDependency)
    }

    pub fn should_install(&self) -> bool {
        matches!(self, CurseForgeFileRelationType::RequiredDependency | CurseForgeFileRelationType::Include)
    }
}

// Enum for hash algorithms used in CurseForge file hashes
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum CurseForgeHashAlgo {
    Sha1 = 1,
    Md5 = 2,
}

impl CurseForgeHashAlgo {
    pub fn to_string(&self) -> String {
        match self {
            CurseForgeHashAlgo::Sha1 => "sha1".to_string(),
            CurseForgeHashAlgo::Md5 => "md5".to_string(),
        }
    }

    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            1 => Some(CurseForgeHashAlgo::Sha1),
            2 => Some(CurseForgeHashAlgo::Md5),
            _ => None,
        }
    }
}

// Structure for CurseForge mod files response
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeFilesResponse {
    pub data: Vec<CurseForgeFile>,
    pub pagination: CurseForgePagination,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeModResponse {
    pub data: CurseForgeMod,
}

// Structure for Get Mods by IDs request body
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GetModsByIdsRequestBody {
    pub modIds: Vec<u32>,
    pub filterPcOnly: Option<bool>,
}

// Structure for Get Files by IDs request body
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GetModFilesRequestBody {
    pub fileIds: Vec<u32>,
}

// Structure for Get Files by IDs response
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GetModFilesResponse {
    pub data: Vec<CurseForgeFile>,
}

// Structure for Get Mods by IDs response
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeModsResponse {
    pub data: Vec<CurseForgeMod>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeFileResponse {
    pub data: CurseForgeFile,
}

// Function to get files/versions for a specific CurseForge mod
// Based on CurseForge API: GET /v1/mods/{modId}/files
pub async fn get_mod_files(
    mod_id: u32,
    game_version: Option<String>,
    mod_loader_type: Option<CurseForgeModLoaderType>,
    game_version_type_id: Option<u32>, // Added: Filter by game version type ID
    index: Option<u32>,
    page_size: Option<u32>,
) -> Result<CurseForgeFilesResponse> {
    let url = format!("{}/mods/{}/files", CURSEFORGE_API_BASE_URL, mod_id);

    let mut query_params: Vec<(String, String)> = Vec::new();

    // Add optional gameVersion
    if let Some(version) = game_version {
        query_params.push(("gameVersion".to_string(), version.clone()));
        log::debug!("CurseForge files - Game version: {}", version);
    }

    // Add optional modLoaderType
    if let Some(loader) = mod_loader_type {
        query_params.push(("modLoaderType".to_string(), (loader.clone() as u32).to_string()));
        log::debug!("CurseForge files - Mod loader type: {:?}", loader);
    }

    // Add optional gameVersionTypeId
    if let Some(version_type_id) = game_version_type_id {
        query_params.push(("gameVersionTypeId".to_string(), version_type_id.to_string()));
        log::debug!("CurseForge files - Game version type ID: {}", version_type_id);
    }

    // Add optional index for pagination
    if let Some(idx) = index {
        query_params.push(("index".to_string(), idx.to_string()));
        log::debug!("CurseForge files - Index: {}", idx);
    }

    // Add optional pageSize (default/maximum is 50 according to API docs)
    if let Some(size) = page_size {
        let clamped_size = size.min(50); // Ensure we don't exceed the maximum
        query_params.push(("pageSize".to_string(), clamped_size.to_string()));
        log::debug!("CurseForge files - Page size: {} (clamped to max 50)", clamped_size);
    }

    // Build the final URL with query parameters
    let final_url = reqwest::Url::parse_with_params(&url, &query_params)
        .map_err(|e| AppError::Other(format!("Failed to build CurseForge files URL: {}", e)))?;

    log::info!("Getting CurseForge files: {}", final_url);

    let response = HTTP_CLIENT
        .get(final_url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("CurseForge API request failed: {}", e)))?;

    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .map(|ct| ct.to_str().unwrap_or("unknown"))
        .unwrap_or("missing");

    log::debug!("CurseForge files API response - Status: {}, Content-Type: {}", status, content_type);

    // Always read the response body as text first for better error handling
    let response_text = response
        .text()
        .await
        .map_err(|e| AppError::Other(format!("Failed to read CurseForge files response body: {}", e)))?;

    // Log response body for debugging (truncated if too long)
    const MAX_BODY_LOG_LENGTH: usize = 2000;
    let logged_body = if response_text.len() > MAX_BODY_LOG_LENGTH {
        format!("{}... (truncated, full length: {})", safe_truncate(&response_text, MAX_BODY_LOG_LENGTH), response_text.len())
    } else {
        response_text.clone()
    };
    log::debug!("CurseForge files API response body: {}", logged_body);

    // Check for HTTP errors
    if !status.is_success() {
        log::error!("CurseForge files API HTTP error ({}): {}", status, response_text);
        return Err(AppError::Other(format!(
            "CurseForge API returned HTTP error {}: {}",
            status, response_text
        )));
    }

    // Try to parse the JSON response
    let files_response: CurseForgeFilesResponse = match serde_json::from_str(&response_text) {
        Ok(parsed) => parsed,
        Err(parse_err) => {
            log::error!(
                "CurseForge files JSON parsing failed. Parse error: {}. Response body (first 500 chars): {}",
                parse_err,
                safe_truncate(&response_text, 500)
            );

            // Try to parse as error response
            if let Ok(error_response) = serde_json::from_str::<serde_json::Value>(&response_text) {
                log::error!("Parsed response as generic JSON: {}", error_response);
            }

            return Err(AppError::Other(format!(
                "Failed to parse CurseForge files JSON response: {}. Response starts with: {}",
                parse_err,
                safe_truncate(&response_text, 200)
            )));
        }
    };

    log::info!(
        "Found {} files out of {} total for mod {}",
        files_response.data.len(),
        files_response.pagination.totalCount,
        mod_id
    );

    Ok(files_response)
}

/// Get detailed information about a specific file
pub async fn get_file_details(mod_id: u32, file_id: u32) -> Result<CurseForgeFile> {
    let url = format!("{}/mods/{}/files/{}", CURSEFORGE_API_BASE_URL, mod_id, file_id);

    log::info!("Getting CurseForge file details: mod_id={}, file_id={}", mod_id, file_id);

    let response = HTTP_CLIENT
        .get(&url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Failed to get CurseForge file details: {}", e)))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        log::error!("CurseForge file details API error ({}): {}", status, error_text);
        return Err(AppError::Other(format!("CurseForge API error {}: {}", status, error_text)));
    }

    let file_response: CurseForgeFileResponse = response
        .json()
        .await
        .map_err(|e| AppError::Other(format!("Failed to parse CurseForge file details: {}", e)))?;

    log::debug!("Successfully retrieved file details for file ID {}", file_id);

    Ok(file_response.data)
}

/// Get basic information about a mod
pub async fn get_mod_info(mod_id: u32) -> Result<CurseForgeMod> {
    let url = format!("{}/mods/{}", CURSEFORGE_API_BASE_URL, mod_id);

    log::info!("Getting CurseForge mod info: mod_id={}", mod_id);

    let response = HTTP_CLIENT
        .get(&url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Failed to get CurseForge mod info: {}", e)))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        log::error!("CurseForge mod info API error ({}): {}", status, error_text);
        return Err(AppError::Other(format!("CurseForge API error {}: {}", status, error_text)));
    }

    let mod_response: CurseForgeModResponse = response
        .json()
        .await
        .map_err(|e| AppError::Other(format!("Failed to parse CurseForge mod info: {}", e)))?;

    log::debug!("Successfully retrieved mod info for mod ID {}", mod_id);

    Ok(mod_response.data)
}

/// Response structure for CurseForge changelog API
#[derive(Serialize, Deserialize, Debug)]
pub struct CurseForgeChangelogResponse {
    pub data: String,
}

/// Get the changelog for a specific CurseForge file
/// Returns HTML formatted changelog
pub async fn get_file_changelog(mod_id: u32, file_id: u32) -> Result<String> {
    let url = format!("{}/mods/{}/files/{}/changelog", CURSEFORGE_API_BASE_URL, mod_id, file_id);

    log::info!("Getting CurseForge file changelog: mod_id={}, file_id={}", mod_id, file_id);

    let response = HTTP_CLIENT
        .get(&url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Failed to get CurseForge file changelog: {}", e)))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        log::warn!("CurseForge file changelog API returned {}: {}", status, error_text);
        // Return empty string instead of error for better UX when no changelog exists
        return Ok(String::new());
    }

    let response_text = response
        .text()
        .await
        .map_err(|e| AppError::Other(format!("Failed to read CurseForge changelog response: {}", e)))?;

    // Parse the JSON response
    let changelog_response: CurseForgeChangelogResponse = match serde_json::from_str(&response_text) {
        Ok(parsed) => parsed,
        Err(parse_err) => {
            log::error!(
                "Failed to parse CurseForge changelog JSON response: {}. Response: {}",
                parse_err,
                safe_truncate(&response_text, 200)
            );
            // Try to return the raw response if it's not JSON (fallback)
            if response_text.trim().is_empty() {
                return Ok(String::new());
            } else {
                return Ok(response_text);
            }
        }
    };

    log::debug!("Successfully retrieved changelog for file ID {} (HTML length: {} chars)", file_id, changelog_response.data.len());

    Ok(changelog_response.data)
}

/// Response structure for CurseForge description API
#[derive(Serialize, Deserialize, Debug)]
pub struct CurseForgeDescriptionResponse {
    pub data: String,
}

/// Get the full description for a CurseForge mod
/// Returns HTML formatted description
pub async fn get_mod_description(mod_id: u32) -> Result<String> {
    let url = format!("{}/mods/{}/description", CURSEFORGE_API_BASE_URL, mod_id);

    log::info!("Getting CurseForge mod description: mod_id={}", mod_id);

    let response = HTTP_CLIENT
        .get(&url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Failed to get CurseForge mod description: {}", e)))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        log::warn!("CurseForge mod description API returned {}: {}", status, error_text);
        return Ok(String::new());
    }

    let response_text = response
        .text()
        .await
        .map_err(|e| AppError::Other(format!("Failed to read CurseForge description response: {}", e)))?;

    // Parse the JSON response
    let description_response: CurseForgeDescriptionResponse = match serde_json::from_str(&response_text) {
        Ok(parsed) => parsed,
        Err(parse_err) => {
            log::error!(
                "Failed to parse CurseForge description JSON response: {}. Response: {}",
                parse_err,
                safe_truncate(&response_text, 200)
            );
            if response_text.trim().is_empty() {
                return Ok(String::new());
            } else {
                return Ok(response_text);
            }
        }
    };

    log::debug!("Successfully retrieved description for mod ID {} (HTML length: {} chars)", mod_id, description_response.data.len());

    Ok(description_response.data)
}

/// Get multiple mods by their IDs
pub async fn get_mods_by_ids(
    mod_ids: Vec<u32>,
    filter_pc_only: Option<bool>,
) -> Result<CurseForgeModsResponse> {
    let url = format!("{}/mods", CURSEFORGE_API_BASE_URL);

    let request_body = GetModsByIdsRequestBody {
        modIds: mod_ids.clone(),
        filterPcOnly: filter_pc_only,
    };

    log::info!("Getting CurseForge mods by IDs: {:?}", mod_ids);

    let response = HTTP_CLIENT
        .post(&url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Failed to get CurseForge mods by IDs: {}", e)))?;

    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .map(|ct| ct.to_str().unwrap_or("unknown"))
        .unwrap_or("missing");

    log::debug!("CurseForge get mods by IDs API response - Status: {}, Content-Type: {}", status, content_type);

    // Always read the response body as text first for better error handling
    let response_text = response
        .text()
        .await
        .map_err(|e| AppError::Other(format!("Failed to read CurseForge get mods by IDs response body: {}", e)))?;

    // Log response body for debugging (truncated if too long)
    const MAX_BODY_LOG_LENGTH: usize = 2000;
    let logged_body = if response_text.len() > MAX_BODY_LOG_LENGTH {
        format!("{}... (truncated, full length: {})", safe_truncate(&response_text, MAX_BODY_LOG_LENGTH), response_text.len())
    } else {
        response_text.clone()
    };
    log::debug!("CurseForge get mods by IDs API response body: {}", logged_body);

    // Check for HTTP errors
    if !status.is_success() {
        log::error!("CurseForge get mods by IDs API HTTP error ({}): {}", status, response_text);
        return Err(AppError::Other(format!(
            "CurseForge API returned HTTP error {}: {}",
            status, response_text
        )));
    }

    // Try to parse the JSON response
    let mods_response: CurseForgeModsResponse = match serde_json::from_str(&response_text) {
        Ok(parsed) => parsed,
        Err(parse_err) => {
            log::error!(
                "CurseForge get mods by IDs JSON parsing failed. Parse error: {}. Response body (first 500 chars): {}",
                parse_err,
                safe_truncate(&response_text, 500)
            );

            // Try to parse as error response
            if let Ok(error_response) = serde_json::from_str::<serde_json::Value>(&response_text) {
                log::error!("Parsed response as generic JSON: {}", error_response);
            }

            return Err(AppError::Other(format!(
                "Failed to parse CurseForge get mods by IDs JSON response: {}. Response starts with: {}",
                parse_err,
                safe_truncate(&response_text, 200)
            )));
        }
    };

    log::info!(
        "Successfully retrieved {} mods by IDs",
        mods_response.data.len()
    );

    Ok(mods_response)
}

/// Get multiple files by their IDs in bulk
/// This is more efficient than calling get_file_details for each file individually
/// Uses the POST /v1/mods/files endpoint
pub async fn get_files_by_ids(file_ids: Vec<u32>) -> Result<Vec<CurseForgeFile>> {
    if file_ids.is_empty() {
        return Ok(Vec::new());
    }

    let url = format!("{}/mods/files", CURSEFORGE_API_BASE_URL);

    let request_body = GetModFilesRequestBody {
        fileIds: file_ids.clone(),
    };

    log::info!("Getting CurseForge files by IDs: {} files", file_ids.len());

    let response = HTTP_CLIENT
        .post(&url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Failed to get CurseForge files by IDs: {}", e)))?;

    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .map(|ct| ct.to_str().unwrap_or("unknown"))
        .unwrap_or("missing");

    log::debug!("CurseForge get files by IDs API response - Status: {}, Content-Type: {}", status, content_type);

    // Always read the response body as text first for better error handling
    let response_text = response
        .text()
        .await
        .map_err(|e| AppError::Other(format!("Failed to read CurseForge get files by IDs response body: {}", e)))?;

    // Log response body for debugging (truncated if too long)
    const MAX_BODY_LOG_LENGTH: usize = 2000;
    let logged_body = if response_text.len() > MAX_BODY_LOG_LENGTH {
        format!("{}... (truncated, full length: {})", safe_truncate(&response_text, MAX_BODY_LOG_LENGTH), response_text.len())
    } else {
        response_text.clone()
    };
    log::debug!("CurseForge get files by IDs API response body: {}", logged_body);

    // Check for HTTP errors
    if !status.is_success() {
        log::error!("CurseForge get files by IDs API HTTP error ({}): {}", status, response_text);
        return Err(AppError::Other(format!(
            "CurseForge API returned HTTP error {}: {}",
            status, response_text
        )));
    }

    // Try to parse the JSON response
    let files_response: GetModFilesResponse = match serde_json::from_str(&response_text) {
        Ok(parsed) => parsed,
        Err(parse_err) => {
            log::error!(
                "CurseForge get files by IDs JSON parsing failed. Parse error: {}. Response body (first 500 chars): {}",
                parse_err,
                safe_truncate(&response_text, 500)
            );

            // Try to parse as error response
            if let Ok(error_response) = serde_json::from_str::<serde_json::Value>(&response_text) {
                log::error!("Parsed response as generic JSON: {}", error_response);
            }

            return Err(AppError::Other(format!(
                "Failed to parse CurseForge get files by IDs JSON response: {}. Response starts with: {}",
                parse_err,
                safe_truncate(&response_text, 200)
            )));
        }
    };

    log::info!(
        "Successfully retrieved {} files by IDs",
        files_response.data.len()
    );

    Ok(files_response.data)
}

// ===== CurseForge Modpack Import Structures =====

/// Represents the overall structure of a CurseForge manifest.json file
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeManifest {
    pub minecraft: CurseForgeMinecraft,
    #[serde(rename = "manifestType")]
    pub manifest_type: String, // Usually "minecraftModpack"
    #[serde(rename = "manifestVersion")]
    pub manifest_version: u32, // Usually 1
    pub name: String,
    pub version: Option<String>, // Optional pack version
    pub author: Option<String>, // Optional author field
    pub description: Option<String>, // Optional description
    pub files: Vec<CurseForgeManifestFile>,
    pub overrides: Option<String>, // Usually "overrides" - optional in some manifests
}

/// Represents the Minecraft section in CurseForge manifest
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeMinecraft {
    pub version: String,
    #[serde(rename = "modLoaders")]
    pub mod_loaders: Vec<CurseForgeModLoader>,
    #[serde(rename = "recommendedRam", default, deserialize_with = "deserialize_optional_u64_from_string")]
    pub recommended_ram: Option<u64>, // Optional field for recommended RAM (can be string or number)
}

/// Represents a mod loader entry in CurseForge manifest
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeModLoader {
    pub id: String,
    pub primary: Option<bool>, // Some manifests might not specify primary
}

/// Represents a file entry within the CurseForge manifest
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeManifestFile {
    #[serde(rename = "projectID")]
    pub project_id: u32,
    #[serde(rename = "fileID")]
    pub file_id: u32,
    #[serde(default = "default_required")]
    pub required: bool,
}

/// Default value for required field - defaults to true
fn default_required() -> bool {
    true
}

/// Determines the ModLoader from CurseForge mod loader string
fn determine_loader_from_curseforge_string(loader_string: &str) -> ModLoader {
    let lower = loader_string.to_lowercase();

    // Check for specific loaders first (neoforge before forge)
    if lower.contains("neoforge") {
        ModLoader::NeoForge
    } else if lower.contains("fabric") {
        ModLoader::Fabric
    } else if lower.contains("quilt") {
        ModLoader::Quilt
    } else if lower.contains("forge") {
        ModLoader::Forge
    } else {
        ModLoader::Vanilla
    }
}

/// Extracts loader version from CurseForge loader string
fn extract_loader_version(loader_string: &str) -> Option<String> {
    // Examples: "fabric-loader-0.15.11", "neoforge-21.1.203", "forge-50.0.0"
    let parts: Vec<&str> = loader_string.split('-').collect();
    if parts.len() >= 2 {
        Some(parts[1..].join("-"))
    } else {
        None
    }
}

/// Determines the ModLoader and version from CurseForge mod loaders
fn determine_loader_from_curseforge_loaders(loaders: &[CurseForgeModLoader]) -> (ModLoader, Option<String>) {
    // First, try to find a loader marked as primary
    for loader in loaders {
        if loader.primary.unwrap_or(false) {
            let loader_type = determine_loader_from_curseforge_string(&loader.id);
            let version = extract_loader_version(&loader.id);
            return (loader_type, version);
        }
    }

    // If no primary loader found, use the first one
    if let Some(loader) = loaders.first() {
        let loader_type = determine_loader_from_curseforge_string(&loader.id);
        let version = extract_loader_version(&loader.id);
        (loader_type, version)
    } else {
        (ModLoader::Vanilla, None)
    }
}

/// Common trait for extracting modpack information from different manifest formats
/// This allows uniform access to Minecraft version, loader type and loader version
/// from both CurseForge manifests and Modrinth index files.
///
/// # Example
/// ```rust,ignore
/// // Works with both CurseForge and Modrinth manifests
/// async fn print_modpack_info<T: ModpackManifest>(manifest: &T) {
///     println!("MC Version: {:?}", manifest.get_minecraft_version());
///     println!("Loader: {:?}", manifest.get_loader());
///     println!("Loader Version: {:?}", manifest.get_loader_version());
///
///     // Get detailed mod information (requires API calls)
///     match manifest.get_mods_structs().await {
///         Ok(mods) => {
///             println!("Found {} mods:", mods.len());
///             for mod_info in mods {
///                 println!("  - {} (v{})", mod_info.display_name.as_deref().unwrap_or("Unknown"), mod_info.version.as_deref().unwrap_or("Unknown"));
///             }
///         }
///         Err(e) => println!("Error getting mods: {}", e),
///     }
/// }
///
/// // Usage with both manifest types:
/// async fn process_manifest(manifest: &impl ModpackManifest) {
///     let mc_version = manifest.get_minecraft_version().unwrap_or_else(|| "Unknown".to_string());
///     let loader = manifest.get_loader().map(|l| format!("{:?}", l)).unwrap_or_else(|| "Vanilla".to_string());
///
///     println!("Modpack: MC {} with {}", mc_version, loader);
///
///     // This will make API calls to resolve mod details
///     let mods = manifest.get_mods_structs().await?;
///     println!("Contains {} mods", mods.len());
/// }
/// ```
pub trait ModpackManifest {
    /// Returns the Minecraft version if available
    fn get_minecraft_version(&self) -> Option<String>;

    /// Returns the mod loader type if available (None for Vanilla)
    fn get_loader(&self) -> Option<ModLoader>;

    /// Returns the loader version if available
    fn get_loader_version(&self) -> Option<String>;

    /// Returns a list of mods as Mod structs (requires API calls)
    async fn get_mods_structs(&self) -> Result<Vec<Mod>>;
}

impl ModpackManifest for CurseForgeManifest {
    fn get_minecraft_version(&self) -> Option<String> {
        Some(self.minecraft.version.clone())
    }

    fn get_loader(&self) -> Option<ModLoader> {
        let (loader, _) = determine_loader_from_curseforge_loaders(&self.minecraft.mod_loaders);
        if loader == ModLoader::Vanilla {
            None
        } else {
            Some(loader)
        }
    }

    fn get_loader_version(&self) -> Option<String> {
        let (_, version) = determine_loader_from_curseforge_loaders(&self.minecraft.mod_loaders);
        version
    }

    async fn get_mods_structs(&self) -> Result<Vec<Mod>> {
        resolve_curseforge_manifest_files(self).await
    }
}

/// Processes a CurseForge modpack manifest from ZIP file and creates a potential Profile struct
pub async fn process_curseforge_pack_from_zip(pack_path: &Path) -> Result<(Profile, CurseForgeManifest)> {
    info!("Processing CurseForge manifest from ZIP file: {:?}", pack_path);

    // Read the manifest file directly from the ZIP
    let manifest_content = read_manifest_from_zip(pack_path).await.map_err(|e| {
        error!("Failed to read CurseForge manifest from ZIP {:?}: {}", pack_path, e);
        e
    })?;

    // Parse the manifest
    let manifest: CurseForgeManifest = serde_json::from_str(&manifest_content).map_err(|e| {
        error!("Failed to parse CurseForge manifest: {}", e);
        AppError::Json(e)
    })?;
    info!("Parsed CurseForge manifest for pack: '{}'", manifest.name);

    // Determine loader and version
    let (loader, loader_version) = determine_loader_from_curseforge_loaders(&manifest.minecraft.mod_loaders);
    let game_version = manifest.minecraft.version.clone();

    info!(
        "Determined requirements: MC={}, Loader={:?}, LoaderVersion={:?}",
        game_version, loader, loader_version
    );

    // Create a potential Profile object
    let profile_name = manifest.name.clone();
    let placeholder_id = Uuid::new_v4();
    let sanitized_name = sanitize_filename::sanitize(&profile_name);
    let potential_path = if sanitized_name.is_empty() {
        format!("imported-pack-{}", Utc::now().timestamp_millis())
    } else {
        sanitized_name
    };

    // Determine memory settings based on recommended RAM and system capabilities
    let memory_settings = determine_memory_settings(manifest.minecraft.recommended_ram);

    let profile = Profile {
        id: placeholder_id,
        name: profile_name,
        path: potential_path,
        game_version,
        loader,
        loader_version,
        created: Utc::now(),
        last_played: None,
        settings: ProfileSettings {
            memory: memory_settings,
            ..ProfileSettings::default()
        },
        state: ProfileState::NotInstalled,
        mods: Vec::new(),
        selected_norisk_pack_id: None,
        disabled_norisk_mods_detailed: std::collections::HashSet::new(),
        source_standard_profile_id: None,
        group: Some("MODPACKS".to_string()),
        is_standard_version: false,
        use_shared_minecraft_folder: false,
        description: manifest.description.clone(),
        norisk_information: None,
        banner: None,
        background: None,
        modpack_info: None,
        preferred_account_id: None,
    };

    info!("Prepared potential profile object for '{}'", profile.name);
    Ok((profile, manifest))
}

/// Reads the manifest.json file directly from a ZIP archive
async fn read_manifest_from_zip(pack_path: &Path) -> Result<String> {
    let file = tokio::fs::File::open(pack_path).await.map_err(|e| {
        error!("Failed to open pack file {:?}: {}", pack_path, e);
        AppError::Io(e)
    })?;
    let mut buf_reader = BufReader::new(file);
    let mut zip = ZipFileReader::with_tokio(&mut buf_reader)
        .await
        .map_err(|e| {
            error!("Failed to read pack as ZIP: {}", e);
            AppError::Other(format!("Failed to read pack zip: {}", e))
        })?;

    let entries = zip.file().entries();
    let manifest_entry_index = entries
        .iter()
        .position(|e| {
            e.filename()
                .as_str()
                .map_or(false, |name| name == "manifest.json")
        })
        .ok_or_else(|| {
            error!("manifest.json not found in pack: {:?}", pack_path);
            AppError::Other("manifest.json not found in pack".into())
        })?;

    // Read the manifest content directly from the ZIP entry
    let entry_reader = zip
        .reader_with_entry(manifest_entry_index)
        .await
        .map_err(|e| {
            error!("Failed to get entry reader for manifest: {}", e);
            AppError::Other(format!("Failed to read manifest entry: {}", e))
        })?;

    let mut entry_reader_tokio = entry_reader.compat();
    let mut buffer = Vec::new();
    tokio::io::copy(&mut entry_reader_tokio, &mut buffer).await.map_err(|e| {
        error!("Failed to read manifest content from ZIP: {}", e);
        AppError::Io(e)
    })?;

    let content = String::from_utf8(buffer).map_err(|e| {
        error!("Failed to convert manifest content to UTF-8: {}", e);
        AppError::Other(format!("Invalid UTF-8 in manifest: {}", e))
    })?;

    Ok(content)
}

/// Resolves CurseForge manifest files against the CurseForge API to create Mod structs
pub async fn resolve_curseforge_manifest_files(manifest: &CurseForgeManifest) -> Result<Vec<Mod>> {
    info!(
        "Resolving {} files from CurseForge manifest '{}' against CurseForge API...",
        manifest.files.len(),
        manifest.name
    );

    let game_version = manifest.minecraft.version.clone();

    // Collect all project IDs and file IDs
    let mut project_ids = Vec::new();
    let mut file_mapping: HashMap<u32, u32> = HashMap::new(); // project_id -> file_id

    for file_entry in &manifest.files {
        if file_entry.required {
            project_ids.push(file_entry.project_id);
            file_mapping.insert(file_entry.project_id, file_entry.file_id);
        }
    }

    if project_ids.is_empty() {
        info!("No required files found in CurseForge manifest.");
        return Ok(Vec::new());
    }

    // Get mod information from CurseForge API
    info!("Getting mod information for {} projects...", project_ids.len());
    let mods_response = get_mods_by_ids(project_ids, Some(true)).await?;
    info!("Received mod information for {} projects.", mods_response.data.len());

    // Collect all file IDs for bulk request
    let file_ids: Vec<u32> = file_mapping.values().cloned().collect();

    if file_ids.is_empty() {
        info!("No file IDs found to fetch.");
        return Ok(Vec::new());
    }

    // Bulk fetch all file details
    info!("Bulk fetching {} file details...", file_ids.len());
    let file_details_list = match get_files_by_ids(file_ids).await {
        Ok(details) => details,
        Err(e) => {
            error!("Failed to bulk fetch file details: {}", e);
            return Err(e);
        }
    };
    info!("Successfully retrieved {} file details", file_details_list.len());

    // Create a mapping from file_id to file details for easy lookup
    let mut file_details_map: HashMap<u32, CurseForgeFile> = HashMap::new();
    for file_detail in file_details_list {
        file_details_map.insert(file_detail.id, file_detail);
    }

    let mut mods_to_add = Vec::new();

    // For each mod, get the specific file details from the bulk response
    for curseforge_mod in mods_response.data {
        let project_id = curseforge_mod.id;
        let file_id = file_mapping.get(&project_id);

        if let Some(&file_id) = file_id {
            // Get file details from bulk response
            let file_details = match file_details_map.get(&file_id) {
                Some(details) => details,
                None => {
                    error!("File details not found for file ID {} in bulk response", file_id);
                    continue;
                }
            };

            // Create Mod struct
            let mod_source = ModSource::CurseForge {
                project_id: project_id.to_string(),
                file_id: file_id.to_string(),
                file_name: file_details.fileName.clone(),
                download_url: file_details.downloadUrl.clone(),
                file_hash_sha1: file_details.hashes.iter()
                    .find(|h| h.algo == 1) // SHA1 = 1
                    .map(|h| h.value.clone()),
                file_fingerprint: Some(file_details.fileFingerprint),
            };

            let new_mod = Mod {
                id: Uuid::new_v4(),
                source: mod_source,
                enabled: true,
                display_name: Some(curseforge_mod.name.clone()),
                version: Some(file_details.displayName.clone()),
                game_versions: Some(vec![game_version.clone()]),
                file_name_override: None,
                associated_loader: Some(determine_loader_from_curseforge_loaders(&manifest.minecraft.mod_loaders).0),
                modpack_origin: Some(format!("curseforge:{}:{}", project_id, file_id)), // From modpack
                updates_enabled: false, // Disable updates for modpack mods (updated with pack)
            };

            info!(
                "Prepared Mod struct for: {} (Enabled: {}, Loader: {:?})",
                new_mod.display_name.as_deref().unwrap_or("Unknown"),
                new_mod.enabled,
                new_mod.associated_loader
            );
            mods_to_add.push(new_mod);
        }
    }

    info!(
        "Successfully resolved {} mods from the CurseForge manifest.",
        mods_to_add.len()
    );
    Ok(mods_to_add)
}

/// Extracts files from the "overrides" directory within a CurseForge modpack archive
/// into the specified target profile directory, using concurrent streaming operations.
/// This function is called with the manifest to determine the overrides directory name.
/// If event_id is provided with progress_offset and progress_scale, progress events will be emitted.
pub async fn extract_curseforge_overrides(
    pack_path: &Path,
    profile: &Profile,
    manifest: &CurseForgeManifest,
    event_id: Option<Uuid>,
    progress_offset: f64,
    progress_scale: f64,
) -> Result<()> {
    let overrides_dir = manifest.overrides.as_deref().unwrap_or("overrides");

    info!(
        "Extracting overrides for profile '{}' from CurseForge pack {:?} using concurrent streaming (overrides dir: '{}')...",
        profile.name, pack_path, overrides_dir
    );

    let state = crate::state::state_manager::State::get().await?;
    let io_semaphore = state.io_semaphore.clone();

    let target_dir = state
        .profile_manager
        .calculate_instance_path_for_profile(profile)?;

    info!("Target profile directory calculated as: {:?}", target_dir);

    if !target_dir.exists() {
        info!(
            "Target profile directory does not exist, creating: {:?}",
            target_dir
        );
        fs::create_dir_all(&target_dir).await.map_err(|e| {
            error!(
                "Failed to create target profile directory {:?}: {}",
                target_dir, e
            );
            AppError::Io(e)
        })?;
    }

    let initial_file_for_listing = tokio::fs::File::open(pack_path).await.map_err(|e| {
        error!(
            "Failed to open CurseForge pack file for listing {:?}: {}",
            pack_path, e
        );
        AppError::Io(e)
    })?;
    let mut initial_buf_reader = BufReader::new(initial_file_for_listing);
    let zip_lister = ZipFileReader::with_tokio(&mut initial_buf_reader)
        .await
        .map_err(|e| {
            error!("Failed to read CurseForge pack as ZIP for listing: {}", e);
            AppError::Other(format!("Failed to read CurseForge pack zip for listing: {}", e))
        })?;

    let num_entries = zip_lister.file().entries().len();
    info!(
        "Found {} entries in the CurseForge pack archive. Preparing concurrent streaming for overrides...",
        num_entries
    );

    // Count override files for progress tracking
    let overrides_prefix_for_count = format!("{}/", overrides_dir);
    let mut override_file_count = 0usize;
    for index in 0..num_entries {
        if let Some(entry) = zip_lister.file().entries().get(index) {
            if let Ok(name) = entry.filename().as_str() {
                if name.starts_with(&overrides_prefix_for_count) && !name.ends_with('/') {
                    override_file_count += 1;
                }
            }
        }
    }

    // Create a counter for tracking extraction progress
    let extraction_counter = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let total_files = override_file_count;

    let mut extraction_tasks = Vec::new();

    for index in 0..num_entries {
        let entry_filename_str;
        let is_entry_dir;
        let entry_uncompressed_size;
        {
            let entry = match zip_lister.file().entries().get(index) {
                Some(e) => e,
                None => {
                    error!(
                        "Failed to get zip entry metadata for index {} during listing",
                        index
                    );
                    continue;
                }
            };
            entry_filename_str = match entry.filename().as_str() {
                Ok(s) => s.to_string(),
                Err(_) => {
                    error!("Non UTF-8 filename at index {} during listing", index);
                    continue;
                }
            };
            is_entry_dir = entry.dir().unwrap_or_else(|_err| {
                warn!("Failed to determine if '{}' is a directory from entry, falling back to path check.", entry_filename_str);
                entry_filename_str.ends_with('/')
            });
            entry_uncompressed_size = entry.uncompressed_size();
        }

        // Check if this is an override file (starts with the overrides directory)
        let overrides_prefix = format!("{}/", overrides_dir);
        let is_override_type = entry_filename_str.starts_with(&overrides_prefix);

        if is_override_type {
            let path_after_prefix = match entry_filename_str.strip_prefix(&overrides_prefix) {
                Some(p_str) if !p_str.is_empty() => p_str,
                _ => continue, // Skip if path after prefix is empty (e.g. just "overrides/")
            };

            // Sanitize each component of the path to prevent directory traversal and invalid names
            let sanitized_relative_path = PathBuf::from(path_after_prefix)
                .components()
                .filter_map(|comp| match comp {
                    // Sanitize normal path components (filenames/directory names)
                    std::path::Component::Normal(os_str) => {
                        let sanitized_comp = sanitize_filename::sanitize(os_str.to_string_lossy().as_ref());
                        // Ensure sanitized component is not empty (e.g. if original was just "..")
                        if sanitized_comp.is_empty() {
                            None
                        } else {
                            Some(sanitized_comp)
                        }
                    }
                    // Disallow ParentDir components to prevent trivial directory traversal
                    std::path::Component::ParentDir => {
                        warn!("Parent directory component '..' found and removed in override path: {}", path_after_prefix);
                        None
                    }
                    // Ignore CurDir, RootDir, Prefix as they shouldn't be in relative archive paths or are handled by join
                    std::path::Component::CurDir => None,
                    std::path::Component::RootDir => None, // Should not appear in relative paths
                    std::path::Component::Prefix(_) => None, // Should not appear in relative paths
                })
                .collect::<PathBuf>();

            // If sanitization results in an empty path (e.g., path was only ".." or similar), skip it.
            if sanitized_relative_path.as_os_str().is_empty() {
                warn!("Skipping empty sanitized relative path for override entry: {} (original relative: {})", entry_filename_str, path_after_prefix);
                continue;
            }

            let final_dest_path = {
                let relative_path_str = sanitized_relative_path.to_string_lossy();
                // Check for both / and \ to be platform-agnostic for path separators within the string
                if relative_path_str.starts_with("mods/") || relative_path_str.starts_with("mods\\")
                {
                    // Construct the new path by taking the part of the string *after* "mods"
                    // e.g., if relative_path_str is "mods/foo.jar", then &relative_path_str["mods".len()..] is "/foo.jar"
                    // We then prepend "custom_mods"
                    let new_relative_path =
                        format!("custom_mods{}", &relative_path_str["mods".len()..]);
                    target_dir.join(new_relative_path)
                } else {
                    // If sanitized_relative_path is used again after this block, ensure it's cloned if needed.
                    // Here, it seems it's only used for final_dest_path construction.
                    target_dir.join(sanitized_relative_path)
                }
            };

            let task_pack_path = pack_path.to_path_buf();
            let task_io_semaphore = io_semaphore.clone();
            let task_final_dest_path = final_dest_path.clone();
            let original_entry_index = index;

            if is_entry_dir {
                extraction_tasks.push(tokio::spawn(async move {
                    let _permit = task_io_semaphore.acquire().await.map_err(|e| {
                        error!(
                            "Failed to acquire semaphore permit for creating dir {}: {}",
                            task_final_dest_path.display(),
                            e
                        );
                        AppError::Other(format!(
                            "Semaphore error for dir {}: {}",
                            task_final_dest_path.display(),
                            e
                        ))
                    })?;

                    if !task_final_dest_path.exists() {
                        debug!(
                            "Creating directory (from override task): {:?}",
                            task_final_dest_path
                        );
                        fs::create_dir_all(&task_final_dest_path)
                            .await
                            .map_err(|e| {
                                error!(
                                    "Failed to create directory {:?} in task: {}",
                                    task_final_dest_path, e
                                );
                                AppError::Io(e)
                            })?;
                    }
                    Ok::<(), AppError>(())
                }));
            } else {
                info!(
                    "Queueing concurrent streaming for override file: '{}' -> {:?} (Size: {} bytes)",
                    entry_filename_str, final_dest_path, entry_uncompressed_size
                );

                let task_counter = extraction_counter.clone();
                let task_total = total_files;
                let task_state = state.clone();
                let task_event_id = event_id;
                let task_progress_offset = progress_offset;
                let task_progress_scale = progress_scale;
                extraction_tasks.push(tokio::spawn(async move {
                    let _permit = task_io_semaphore.acquire().await.map_err(|e| {
                        error!(
                            "Failed to acquire semaphore permit for '{}': {}",
                            task_final_dest_path.display(),
                            e
                        );
                        AppError::Other(format!(
                            "Semaphore error for '{}': {}",
                            task_final_dest_path.display(),
                            e
                        ))
                    })?;

                    if let Some(parent) = task_final_dest_path.parent() {
                        if !parent.exists() {
                            fs::create_dir_all(parent).await.map_err(|e| {
                                error!(
                                    "Task: Failed to create parent directory {:?} for override: {}",
                                    parent, e
                                );
                                AppError::Io(e)
                            })?;
                        }
                    }

                    let task_file = tokio::fs::File::open(&task_pack_path).await.map_err(|e| {
                        error!(
                            "Task: Failed to open CurseForge pack file {:?}: {}",
                            task_pack_path, e
                        );
                        AppError::Io(e)
                    })?;
                    let mut task_buf_reader = BufReader::new(task_file);
                    let mut task_zip_reader = ZipFileReader::with_tokio(&mut task_buf_reader)
                        .await
                        .map_err(|e| {
                            error!(
                                "Task: Failed to read CurseForge pack as ZIP for '{}': {}",
                                task_final_dest_path.display(),
                                e
                            );
                            AppError::Other(format!(
                                "Task: ZIP read error for {}: {}",
                                task_final_dest_path.display(),
                                e
                            ))
                        })?;

                    let entry_reader_futures = task_zip_reader
                        .reader_without_entry(original_entry_index)
                        .await
                        .map_err(|e| {
                            error!(
                                "Task: Failed to get entry reader for '{}' (index {}): {}",
                                task_final_dest_path.display(),
                                original_entry_index,
                                e
                            );
                            AppError::Other(format!(
                                "Task: Entry reader error for {}: {}",
                                task_final_dest_path.display(),
                                e
                            ))
                        })?;
                    let mut entry_reader_tokio = entry_reader_futures.compat();

                    let mut file_writer =
                        fs::File::create(&task_final_dest_path).await.map_err(|e| {
                            error!(
                                "Task: Failed to create destination file {:?} for override: {}",
                                task_final_dest_path, e
                            );
                            AppError::Io(e)
                        })?;

                    let bytes_copied = tokio::io::copy(&mut entry_reader_tokio, &mut file_writer)
                        .await
                        .map_err(|e| {
                            error!(
                                "Task: Failed to stream content for '{}' to {:?}: {}",
                                task_final_dest_path.display(),
                                task_final_dest_path,
                                e
                            );
                            AppError::Io(e)
                        })?;

                    debug!(
                        "Task: Successfully streamed {} bytes for override: {}",
                        bytes_copied,
                        task_final_dest_path.display()
                    );

                    // Increment counter and emit progress
                    let completed = task_counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                    if task_total > 0 {
                        // Scale progress within the provided range
                        let extraction_progress = completed as f64 / task_total as f64;
                        let overall_progress = task_progress_offset + (extraction_progress * task_progress_scale);
                        if let Some(id) = task_event_id {
                            let _ = task_state.event_state.emit(EventPayload {
                                event_id: id,
                                event_type: EventType::TaskProgress,
                                target_id: None,
                                message: format!("Extracting files... ({}/{})", completed, task_total),
                                progress: Some(overall_progress),
                                error: None,
                            }).await;
                        }
                    }

                    Ok::<(), AppError>(())
                }));
            }
        }
    }

    // Wait for all extraction tasks to complete
    let results = try_join_all(extraction_tasks).await.map_err(|e| {
        error!("Error joining override extraction tasks: {}", e);
        AppError::Other(format!(
            "One or more override extraction tasks panicked: {}",
            e
        ))
    })?;

    for result in results {
        result?;
    }

    info!(
        "Finished all concurrent streaming tasks for overrides for profile '{}'.",
        profile.name
    );
    Ok(())
}

/// Imports a profile from a CurseForge modpack, processing, resolving, extracting, and saving it.
/// If project_id and file_id are provided, detailed ModPackInfo will be created.
/// If event_id is provided, progress events will be emitted.
/// progress_offset and progress_scale can be used to adjust progress range (e.g. when called after a download phase).
pub async fn import_curseforge_pack_as_profile(
    pack_path: PathBuf,
    project_id: Option<u32>,
    file_id: Option<u32>,
    event_id: Option<Uuid>,
    progress_offset: f64,
    progress_scale: f64,
) -> Result<Uuid> {
    info!("Starting full import process for CurseForge pack: {:?}", pack_path);

    let state = crate::state::state_manager::State::get().await?;

    // Helper to emit progress if event_id is provided
    // Progress is scaled: actual = offset + (progress * scale)
    let emit_progress = |progress: f64, message: String| {
        let state = state.clone();
        let event_id = event_id;
        let scaled_progress = progress_offset + (progress * progress_scale);
        async move {
            if let Some(id) = event_id {
                let _ = state.event_state.emit(EventPayload {
                    event_id: id,
                    event_type: EventType::TaskProgress,
                    target_id: None,
                    message,
                    progress: Some(scaled_progress),
                    error: None,
                }).await;
            }
        }
    };

    emit_progress(0.05, "Parsing modpack manifest...".to_string()).await;

    // Find manifest.json in the pack and read it directly
    let (profile, manifest) = process_curseforge_pack_from_zip(&pack_path).await?;
    let mut profile = profile;
    info!(
        "Successfully processed CurseForge manifest for '{}'.",
        profile.name
    );

    emit_progress(0.10, format!("Parsed manifest for '{}'", profile.name)).await;
    emit_progress(0.15, format!("Resolving {} mods...", manifest.files.len())).await;

    // 2. Resolve mods from manifest files
    let resolved_mods = resolve_curseforge_manifest_files(&manifest).await?;
    info!(
        "Successfully resolved {} mods from manifest.",
        resolved_mods.len()
    );
    profile.mods = resolved_mods;

    emit_progress(0.40, format!("Resolved {} mods", profile.mods.len())).await;

    // 2.5. Create ModPackInfo for this modpack (if we have the required parameters)
    if let (Some(project_id), Some(file_id)) = (project_id, file_id) {
        let modpack_info = ModPackInfo {
            source: ModPackSource::CurseForge {
                project_id,
                file_id,
            },
            file_hash: None, // Could be added later if needed
        };

        profile.modpack_info = Some(modpack_info);
        info!("Created ModPackInfo for CurseForge pack");
    } else {
        warn!("Missing project_id or file_id for CurseForge pack, skipping ModPackInfo creation");
    }

    // 3. Determine unique profile path segment
    let base_profiles_dir = crate::state::profile_state::default_profile_path();
    let sanitized_base_name = sanitize_filename::sanitize(&profile.name);
    if sanitized_base_name.is_empty() {
        // Handle potential empty name after sanitization (e.g., use default or error)
        let default_name = format!("imported-curseforge-pack-{}", Utc::now().timestamp_millis());
        warn!(
            "Profile name '{}' became empty after sanitization. Using default: {}",
            profile.name, default_name
        );
        profile.name = default_name.clone(); // Use the default name for the profile name too
        let unique_segment = crate::utils::path_utils::find_unique_profile_segment(
            &base_profiles_dir,
            &profile.name,
        )
        .await?;
        profile.path = unique_segment;
    } else {
        let unique_segment = crate::utils::path_utils::find_unique_profile_segment(
            &base_profiles_dir,
            &sanitized_base_name,
        )
        .await?;
        profile.path = unique_segment; // Update the profile path
    }
    info!(
        "Determined unique profile directory segment: {}",
        profile.path
    );

    // Ensure the target profile directory exists before extraction
    let target_dir = base_profiles_dir.join(&profile.path);
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).await.map_err(|e| {
            error!(
                "Failed to create target profile directory {:?}: {}",
                target_dir, e
            );
            AppError::Io(e)
        })?;
    }

    emit_progress(0.45, "Extracting files...".to_string()).await;

    // 4. Extract overrides to the correct final profile location
    info!(
        "Extracting overrides to profile directory: {:?}",
        target_dir
    );
    // Use the absolute path to the pack file for extraction
    // Progress from 0.45 to 0.90 during extraction (45% of the remaining scale)
    let extraction_progress_offset = progress_offset + (0.45 * progress_scale);
    let extraction_progress_scale = 0.45 * progress_scale; // 45% of the total scale for extraction
    extract_curseforge_overrides(&pack_path, &profile, &manifest, event_id, extraction_progress_offset, extraction_progress_scale).await?;
    info!("Successfully extracted overrides.");

    emit_progress(0.90, "Saving profile...".to_string()).await;

    // 5. Save the profile using ProfileManager via State
    info!(
        "Saving the new profile '{}' (ID: {})...",
        profile.name, profile.id
    );
    let profile_id = state.profile_manager.create_profile(profile).await?; // Use create_profile
    info!(
        "Successfully created and saved profile with ID: {}",
        profile_id
    );

    emit_progress(1.0, "Import complete!".to_string()).await;

    Ok(profile_id) // Return the ID of the created profile
}


/// Downloads a CurseForge modpack file and installs it as a new profile
/// If event_id is provided, progress events will be emitted.
pub async fn download_and_install_curseforge_modpack(
    project_id: u32,
    file_id: u32,
    file_name: String,
    download_url: String,
    icon_url: Option<String>,
    event_id: Option<Uuid>,
) -> Result<Uuid> {
    info!(
        "Downloading and installing CurseForge modpack for project {}, file {}, URL: {}",
        project_id, file_id, download_url
    );

    let state = crate::state::state_manager::State::get().await?;

    // Helper to emit progress if event_id is provided
    let emit_progress = |progress: f64, message: String| {
        let state = state.clone();
        let event_id = event_id;
        async move {
            if let Some(id) = event_id {
                let _ = state.event_state.emit(EventPayload {
                    event_id: id,
                    event_type: EventType::TaskProgress,
                    target_id: None,
                    message,
                    progress: Some(progress),
                    error: None,
                }).await;
            }
        }
    };

    emit_progress(0.0, "Downloading modpack...".to_string()).await;

    // Ensure the file name has .zip extension (CurseForge packs are usually .zip)
    let file_name_zip = if !file_name.ends_with(".zip") {
        format!("{}.zip", file_name)
    } else {
        file_name.clone()
    };

    // Create a temporary directory for the download
    let temp_dir = tempfile::tempdir().map_err(|e| {
        error!("Failed to create temporary directory: {}", e);
        AppError::Other(format!("Failed to create temporary directory: {}", e))
    })?;

    let temp_file_path = temp_dir.path().join(&file_name_zip);

    info!("Downloading to temporary file: {:?}", temp_file_path);

    // Download the file
    let client = HTTP_CLIENT.clone();
    let response = client
        .get(&download_url)
        .header(
            "User-Agent",
            format!(
                "NoRiskClient-Launcher/{} (support@norisk.gg)",
                env!("CARGO_PKG_VERSION")
            ),
        )
        .send()
        .await
        .map_err(|e| {
            error!("Failed to download CurseForge modpack: {}", e);
            AppError::Download(format!("Failed to download CurseForge modpack: {}", e))
        })?;

    if !response.status().is_success() {
        return Err(AppError::Download(format!(
            "Failed to download CurseForge modpack: HTTP {}",
            response.status()
        )));
    }

    emit_progress(0.10, "Downloading modpack...".to_string()).await;

    // Get the bytes and write to file
    let bytes = response.bytes().await.map_err(|e| {
        error!("Failed to read CurseForge modpack bytes: {}", e);
        AppError::Download(format!("Failed to read CurseForge modpack bytes: {}", e))
    })?;

    emit_progress(0.18, "Saving downloaded file...".to_string()).await;

    let mut file = tokio::fs::File::create(&temp_file_path).await.map_err(|e| {
        error!("Failed to create temporary file: {}", e);
        AppError::Io(e)
    })?;

    tokio::io::copy(&mut bytes.as_ref(), &mut file).await.map_err(|e| {
        error!("Failed to write downloaded data to temporary file: {}", e);
        AppError::Io(e)
    })?;

    // Ensure the file is fully written to disk
    file.sync_all().await.map_err(|e| {
        error!("Failed to sync CurseForge pack file: {}", e);
        AppError::Io(e)
    })?;

    drop(file); // Explicitly close the file

    emit_progress(0.20, "Download complete, processing...".to_string()).await;

    info!(
        "Successfully downloaded CurseForge modpack to: {:?}",
        temp_file_path
    );

    // Install the modpack as a profile
    // Use progress offset 0.20 and scale 0.80 to continue from download progress
    let profile_id = import_curseforge_pack_as_profile(
        temp_file_path.clone(),
        Some(project_id),
        Some(file_id),
        event_id,
        0.20, // offset: download used 0-20%
        0.80, // scale: import uses remaining 80%
    ).await?;

    info!(
        "Successfully installed CurseForge modpack \"{}\" as profile with ID: {}",
        file_name_zip,
        profile_id
    );

    // If an icon URL was provided, attempt to download and set it for the new profile
    if let Some(url_str) = icon_url {
        info!(
            "Attempting to set profile icon from URL: {} for profile {}",
            url_str,
            profile_id
        );

        let icon_payload = UploadProfileImagesPayload {
            path: None,
            profile_id,
            icon_url: Some(url_str.clone()),
            image_type: "icon".to_string(),
        };

        match crate::commands::path_commands::upload_profile_images(icon_payload).await {
            Ok(relative_icon_path) => {
                info!(
                    "Successfully set profile icon from URL for profile {}. Icon at: {}",
                    profile_id,
                    relative_icon_path
                );
            }
            Err(e) => {
                error!(
                    "Failed to set profile icon from URL {} for profile {}: {:?}",
                    url_str,
                    profile_id,
                    e
                );
                // Don't fail the entire operation if icon download fails
                warn!("Profile created successfully, but icon could not be set");
            }
        }
    }

    // Keep the temp directory alive until we're done (will be cleaned up when it goes out of scope)
    drop(temp_dir);

    Ok(profile_id)
}

// ===== CurseForge Update Checking Structures =====

/// Request structure for CurseForge fingerprint-based update checking
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeFingerprintRequest {
    pub fingerprints: Vec<u64>,
}

/// Structure representing a fingerprint match from CurseForge API
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeFingerprintMatch {
    pub id: u32,
    pub file: CurseForgeFile,
    #[serde(rename = "latestFiles")]
    pub latest_files: Vec<CurseForgeFile>,
}

/// Response structure for CurseForge fingerprint API
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeFingerprintResponse {
    #[serde(rename = "isCacheBuilt")]
    pub is_cache_built: bool,
    #[serde(rename = "exactMatches")]
    pub exact_matches: Vec<CurseForgeFingerprintMatch>,
    #[serde(rename = "exactFingerprints")]
    pub exact_fingerprints: Vec<u64>,
    #[serde(rename = "partialMatches")]
    pub partial_matches: Vec<CurseForgeFingerprintMatch>,
    #[serde(rename = "partialMatchFingerprints")]
    pub partial_match_fingerprints: std::collections::HashMap<String, Vec<u64>>,
    #[serde(rename = "installedFingerprints")]
    pub installed_fingerprints: Vec<u64>,
    #[serde(rename = "unmatchedFingerprints")]
    pub unmatched_fingerprints: Option<Vec<u64>>,
}

/// Wrapper structure for CurseForge fingerprint API response (API returns data wrapped in 'data' field)
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeFingerprintApiResponse {
    pub data: CurseForgeFingerprintResponse,
}

/// Structure for CurseForge update information
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseForgeUpdateInfo {
    pub original_fingerprint: u64,
    pub fingerprint: u32,
    pub project_id: u32,
    pub file_id: u32,
    pub file_name: String,
    pub download_url: String,
    pub release_type: u32,
    pub game_versions: Vec<String>,
    pub dependencies: Vec<CurseForgeDependency>,
    pub hash_sha1: Option<String>,
    pub file_size: u64,
    pub file_date: String,
}

/// Convert CurseForge mod loader ID to string name
/// Maps CurseForge loader IDs (1=Forge, 2=Fabric, etc.) to string names
pub fn curseforge_loader_id_to_string(loader_id: u32) -> &'static str {
    match loader_id {
        1 => "forge",
        2 => "fabric",
        3 => "quilt",
        4 => "neoforge",
        5 => "liteloader",
        6 => "cauldron",
        _ => "unknown"
    }
}

/// Find the best matching file from a list of files based on game versions and loaders
/// Only returns files that match both the exact game version AND loader combination
pub(crate) fn find_best_matching_file<'a>(
    files: &'a [CurseForgeFile],
    game_versions: &[String],
    loaders: &[String],
) -> Option<&'a CurseForgeFile> {
    if files.is_empty() {
        return None;
    }

    // Only accept files that match both game version and loader
    for file in files {
        let file_loaders = crate::integrations::unified_mod::extract_loaders_from_game_versions(&file.gameVersions);
        let has_matching_game_version = game_versions.iter().any(|gv| file.gameVersions.contains(gv));
        let has_matching_loader = loaders.iter().any(|loader| file_loaders.contains(loader));

        if has_matching_game_version && has_matching_loader {
            return Some(file);
        }
    }

    // No compatible file found - don't suggest updates for incompatible versions
    None
}

/// Find the index of the currently installed file in the mod's latestFilesIndexes
/// and check if there are newer compatible versions available
/// Returns only data from latestFilesIndexes without accessing latestFiles
pub fn check_mod_update_by_file_index(
    mod_data: &CurseForgeMod,
    fingerprint_match: &CurseForgeFingerprintMatch,
    game_versions: &[String],
    loaders: &[String],
) -> Option<CurseForgeFileIndex> {
    log::debug!("###Checking mod update by file index for mod {}", mod_data.name);

    // Debug: Show all latestFilesIndexes entries first
    log::debug!("Mod {}: Available latestFilesIndexes entries ({} total):", mod_data.name, mod_data.latestFilesIndexes.len());
    for (i, index_entry) in mod_data.latestFilesIndexes.iter().enumerate() {
        log::debug!("  [{}] FileId: {}, GameVersion: {}, ModLoader: {:?}, Filename: '{}', ReleaseType: {}",
                   i,
                   index_entry.fileId,
                   index_entry.gameVersion,
                   index_entry.modLoader,
                   index_entry.filename,
                   index_entry.releaseType);
    }

    // Find the index of the installed file in the mod's latestFilesIndexes
    let installed_file_id = fingerprint_match.file.id;
    log::debug!("Mod {}: Looking for installed file ID {} in latestFilesIndexes", mod_data.name, installed_file_id);

    // Find the file index entry for our installed file
    let installed_file_index = mod_data.latestFilesIndexes
        .iter()
        .find(|idx| idx.fileId == installed_file_id);

    if let Some(index) = installed_file_index {
        log::debug!("Mod {}: Found installed file ID {} in latestFilesIndexes", mod_data.name, installed_file_id);
    } else {
        log::debug!("Mod {}: Installed file ID {} NOT found in latestFilesIndexes - will return first compatible file from latestFilesIndexes", mod_data.name, installed_file_id);
    }

    // If we found the installed file, log its details
    if let Some(installed_index) = installed_file_index {
        log::debug!(
            "Mod {}: Installed file ID {} found in latestFilesIndexes - GameVersion: {}, FileId: {}, ModLoader: {:?}",
            mod_data.name,
            installed_file_id,
            installed_index.gameVersion,
            installed_index.fileId,
            installed_index.modLoader
        );
    }

    // Now look through latestFilesIndexes for compatible files
    // If we have the installed file, we look for newer ones; otherwise, we take the first compatible one

    let mut compatible_updates = Vec::new();

    for (current_pos, index_entry) in mod_data.latestFilesIndexes.iter().enumerate() {
        // Skip our installed file if we found it
        if index_entry.fileId == installed_file_id {
            continue;
        }

        // If we found the installed file, skip older files (higher indices)
        // Note: In CurseForge latestFilesIndexes, newer versions appear at LOWER indices!
        if let Some(installed_index) = installed_file_index {
            let installed_index_pos = mod_data.latestFilesIndexes
                .iter()
                .position(|idx| idx.fileId == installed_file_id)
                .unwrap_or(usize::MAX);

            if current_pos >= installed_index_pos {
                continue;
            }
        }

        // Check game version compatibility
        let has_matching_game_version = game_versions.iter().any(|gv| {
            gv == &index_entry.gameVersion
        });

        // Check loader compatibility
        let has_matching_loader = if let Some(mod_loader_id) = index_entry.modLoader {
            // Convert loader ID to string and check against our loaders
            let loader_name = curseforge_loader_id_to_string(mod_loader_id);
            loaders.iter().any(|l| l == loader_name)
        } else {
            // If no loader specified, assume compatible (some mods work with any loader)
            true
        };

        if has_matching_game_version && has_matching_loader {
            log::debug!(
                "Mod {}: Found compatible update via latestFilesIndexes - Index: {}, FileId: {}, GameVersion: {}, ModLoader: {:?}, Filename: '{}'",
                mod_data.name,
                current_pos,
                index_entry.fileId,
                index_entry.gameVersion,
                index_entry.modLoader,
                index_entry.filename
            );

            compatible_updates.push((current_pos, index_entry.clone()));
        }
    }

    // Return the latest compatible update (lowest index position = newest)
    // In CurseForge latestFilesIndexes, newer versions have LOWER indices!
    if let Some((latest_pos, latest_update)) = compatible_updates
        .into_iter()
        .min_by_key(|(pos, _)| *pos)
    {
        if installed_file_index.is_some() {
            log::debug!(
                "Mod {}: Returning latest compatible update via latestFilesIndexes - Index: {}, FileId: {}",
                mod_data.name,
                latest_pos,
                latest_update.fileId
            );
        } else {
            log::debug!(
                "Mod {}: Returning first compatible file from latestFilesIndexes (installed file not found) - Index: {}, FileId: {}",
                mod_data.name,
                latest_pos,
                latest_update.fileId
            );
        }
        Some(latest_update)
    } else {
        if installed_file_index.is_some() {
            log::debug!(
                "Mod {}: No newer compatible files found via latestFilesIndexes for installed file ID {}",
                mod_data.name,
                installed_file_id
            );
        } else {
            log::debug!(
                "Mod {}: No compatible files found in latestFilesIndexes",
                mod_data.name
            );
        }
        None
    }
}

/// Check for mod updates using CurseForge's fingerprint API
/// This performs bulk update checking for multiple mods at once
/// Filters results by game versions and loaders to find actual updates
pub async fn check_mod_updates_bulk(
    fingerprints: Vec<u64>,
    game_versions: &[String],
    loaders: &[String],
) -> Result<Vec<CurseForgeUpdateInfo>> {
    if fingerprints.is_empty() {
        info!("No fingerprints provided for CurseForge update check");
        return Ok(Vec::new());
    }
    info!("Checking {} fingerprints for CurseForge updates", fingerprints.len());

    let url = format!("{}/fingerprints", CURSEFORGE_API_BASE_URL);

    let request_body = CurseForgeFingerprintRequest {
        fingerprints: fingerprints.clone(),
    };

    log::debug!("Sending fingerprint request for {} fingerprints", fingerprints.len());

    let response = HTTP_CLIENT
        .post(&url)
        .header("x-api-key", CURSEFORGE_API_KEY)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            error!("Failed to send CurseForge fingerprint request: {}", e);
            AppError::Other(format!("CurseForge fingerprint request failed: {}", e))
        })?;

    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .map(|ct| ct.to_str().unwrap_or("unknown"))
        .unwrap_or("missing");

    log::debug!("CurseForge fingerprint API response - Status: {}, Content-Type: {}", status, content_type);

    // Always read the response body as text first for better error handling
    let response_text = response
        .text()
        .await
        .map_err(|e| {
            error!("Failed to read CurseForge fingerprint response body: {}", e);
            AppError::Other(format!("Failed to read CurseForge fingerprint response: {}", e))
        })?;

    // Log response body for debugging (truncated if too long)
    const MAX_BODY_LOG_LENGTH: usize = 2000;
    let logged_body = if response_text.len() > MAX_BODY_LOG_LENGTH {
        format!("{}... (truncated, full length: {})", safe_truncate(&response_text, MAX_BODY_LOG_LENGTH), response_text.len())
    } else {
        response_text.clone()
    };
    log::debug!("CurseForge fingerprint API response body: {}", logged_body);

    // Check for HTTP errors
    if !status.is_success() {
        error!("CurseForge fingerprint API HTTP error ({}): {}", status, response_text);
        return Err(AppError::Other(format!(
            "CurseForge fingerprint API returned HTTP error {}: {}",
            status, response_text
        )));
    }

    // Try to parse the JSON response
    let api_response: CurseForgeFingerprintApiResponse = match serde_json::from_str(&response_text) {
        Ok(parsed) => parsed,
        Err(parse_err) => {
            error!(
                "CurseForge fingerprint JSON parsing failed. Parse error: {}. Response body (first 500 chars): {}",
                parse_err,
                safe_truncate(&response_text, 500)
            );

            // Try to parse as error response
            if let Ok(error_response) = serde_json::from_str::<serde_json::Value>(&response_text) {
                error!("Parsed response as generic JSON: {}", error_response);
            }

            return Err(AppError::Other(format!(
                "Failed to parse CurseForge fingerprint JSON response: {}. Response starts with: {}",
                parse_err,
                safe_truncate(&response_text, 200)
            )));
        }
    };

    let fingerprint_response = api_response.data;

    info!(
        "CurseForge fingerprint check results - Exact matches: {}, Partial matches: {}, Partial fingerprint matches: {}, Unmatched: {}",
        fingerprint_response.exact_matches.len(),
        fingerprint_response.partial_matches.len(),
        fingerprint_response.partial_match_fingerprints.len(),
        fingerprint_response.unmatched_fingerprints.as_ref().map(|v| v.len()).unwrap_or(0)
    );

    // Collect all project IDs from matches
    let mut project_ids = Vec::new();
    for exact_match in &fingerprint_response.exact_matches {
        project_ids.push(exact_match.id);
    }
    for partial_match in &fingerprint_response.partial_matches {
        if !project_ids.contains(&partial_match.id) {
            project_ids.push(partial_match.id);
        }
    }

    if project_ids.is_empty() {
        info!("No project IDs found from fingerprint matches");
        return Ok(Vec::new());
    }

    info!("Found {} unique projects from fingerprints, fetching mod details", project_ids.len());

    // Get full mod details to access all available files
    let mods_response = match get_mods_by_ids(project_ids, None).await {
        Ok(response) => response,
        Err(e) => {
            error!("Failed to get mod details for update check: {}", e);
            return Err(e);
        }
    };

    // Convert fingerprint matches to update info with proper filtering
    let mut updates = Vec::new();

    // Helper struct to collect update candidates before batch processing
    struct UpdateCandidate<'a> {
        fingerprint_match: &'a CurseForgeFingerprintMatch,
        mod_data: &'a CurseForgeMod,
        update_index: CurseForgeFileIndex,
        original_fingerprint: u64,
        is_exact_match: bool,
    }

    // First pass: Find all potential updates via latestFilesIndexes
    let mut update_candidates = Vec::new();

    // Process exact matches
    for (index, fingerprint_match) in fingerprint_response.exact_matches.iter().enumerate() {
        let Some(mod_data) = mods_response.data.iter().find(|m| m.id == fingerprint_match.id) else {
            continue;
        };

        if let Some(update_index) = check_mod_update_by_file_index(
            mod_data,
            fingerprint_match,
            game_versions,
            loaders
        ) {
            info!(
                "Mod {}: Found update candidate via latestFilesIndexes - FileId: {}, GameVersion: {}, ModLoader: {:?} (exact match)",
                mod_data.name,
                update_index.fileId,
                update_index.gameVersion,
                update_index.modLoader
            );

            update_candidates.push(UpdateCandidate {
                fingerprint_match,
                mod_data,
                update_index,
                original_fingerprint: fingerprint_response.exact_fingerprints[index],
                is_exact_match: true,
            });
        } else {
            debug!("Mod {}: No newer compatible files found via latestFilesIndexes (exact match)", mod_data.name);
        }
    }

    // Process partial matches
    for fingerprint_match in &fingerprint_response.partial_matches {
        let Some(mod_data) = mods_response.data.iter().find(|m| m.id == fingerprint_match.id) else {
            continue;
        };

        if let Some(update_index) = check_mod_update_by_file_index(
            mod_data,
            fingerprint_match,
            game_versions,
            loaders
        ) {
            info!(
                "Mod {}: Found update candidate via latestFilesIndexes - FileId: {}, GameVersion: {}, ModLoader: {:?} (partial match)",
                mod_data.name,
                update_index.fileId,
                update_index.gameVersion,
                update_index.modLoader
            );

            let project_id_key = fingerprint_match.id.to_string();
            let original_fingerprint = fingerprint_response.partial_match_fingerprints
                .get(&project_id_key)
                .and_then(|fingerprints| fingerprints.first().copied())
                .unwrap_or(0);

            update_candidates.push(UpdateCandidate {
                fingerprint_match,
                mod_data,
                update_index,
                original_fingerprint,
                is_exact_match: false,
            });
        } else {
            debug!("Mod {}: No newer compatible files found via latestFilesIndexes (partial match)", mod_data.name);
        }
    }

    // Second pass: Batch fetch detailed file information using POST /v1/mods/files
    if !update_candidates.is_empty() {
        let file_ids: Vec<u32> = update_candidates.iter()
            .map(|candidate| candidate.update_index.fileId)
            .collect();

        info!("Batch fetching {} file details for update candidates", file_ids.len());

        match get_files_by_ids(file_ids).await {
            Ok(update_files) => {
                // Create a lookup map for efficient file data retrieval
                let file_data_map: std::collections::HashMap<u32, &CurseForgeFile> = update_files.iter()
                    .map(|file| (file.id, file))
                    .collect();

                // Process each update candidate
                for candidate in update_candidates {
                    if let Some(update_file) = file_data_map.get(&candidate.update_index.fileId) {
                        info!(
                            "Mod {}: Retrieved detailed file info for FileId {} - Name: '{}', Size: {} bytes ({})",
                            candidate.mod_data.name,
                            update_file.id,
                            update_file.displayName,
                            update_file.fileLength,
                            if candidate.is_exact_match { "exact" } else { "partial" }
                        );

                        let update_info = CurseForgeUpdateInfo {
                            original_fingerprint: candidate.original_fingerprint,
                            fingerprint: candidate.fingerprint_match.id,
                            project_id: candidate.mod_data.id,
                            file_id: update_file.id,
                            file_name: update_file.fileName.clone(),
                            download_url: update_file.downloadUrl.clone(),
                            release_type: update_file.releaseType,
                            game_versions: update_file.gameVersions.clone(),
                            dependencies: update_file.dependencies.clone(),
                            hash_sha1: update_file.hashes.iter()
                                .find(|h| h.algo == 1) // SHA1 = 1
                                .map(|h| h.value.clone()),
                            file_size: update_file.fileLength,
                            file_date: update_file.fileDate.clone(),
                        };

                        updates.push(update_info);
                    } else {
                        error!(
                            "Mod {}: File data not found in batch response for FileId {}",
                            candidate.mod_data.name,
                            candidate.update_index.fileId
                        );
                    }
                }
            }
            Err(e) => {
                error!("Failed to batch fetch file details for {} update candidates: {}", update_candidates.len(), e);
            }
        }
    }

    info!("Found {} CurseForge mod updates after filtering", updates.len());
    Ok(updates)
}

