use crate::error::{AppError, Result};
use futures::future::join_all;
use log::{self, error, info};
use reqwest;
use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;

use crate::utils::string_utils::safe_truncate;

// Base URL for Modrinth API v2
const MODRINTH_API_BASE_URL: &str = "https://api.modrinth.com/v2";

// Structures for deserializing Modrinth API responses (Search)
// Based on https://docs.modrinth.com/api-spec/#tag/projects/operation/searchProjects

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthSearchResponse {
    pub hits: Vec<ModrinthSearchHit>,
    pub offset: u32,
    pub limit: u32,
    pub total_hits: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthSearchHit {
    pub project_id: String,      // Project ID (slug or ID)
    pub project_type: String,    // Type of project (e.g., "mod")
    pub slug: String,            // Project slug
    pub author: Option<String>,  // Author username (Added based on actual response)
    pub title: String,           // Project title
    pub description: String,     // Short description
    pub categories: Vec<String>, // Categories/tags
    pub display_categories: Vec<String>,
    pub client_side: String, // Support status ("required", "optional", "unsupported")
    pub server_side: String, // Support status
    pub downloads: u64,
    pub follows: u64,                   // Sometimes called subscribers
    pub icon_url: Option<String>,       // URL of the project icon
    pub latest_version: Option<String>, // Version number of the latest version
    pub date_created: String,           // ISO 8601 timestamp
    pub date_modified: String,          // ISO 8601 timestamp
    pub license: String,                // SPDX license identifier
    pub gallery: Vec<String>,           // List of image URLs
                                        // author field seems deprecated or missing in examples, use project relationship later if needed
                                        // versions field is also missing in search results, need separate call for version details
}

// Structures for deserializing Modrinth API responses (Project Versions)
// Based on https://docs.modrinth.com/api-spec/#tag/versions/operation/getProjectVersions

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthVersion {
    pub id: String,                            // Version ID (e.g., "tFw0iWAk")
    pub project_id: String,                    // Associated project ID
    pub author_id: Option<String>,             // ID of the user who published the version
    pub featured: bool,                        // Whether the version is featured
    pub name: String,                          // Version title/name
    pub version_number: String,                // Version number (e.g., "0.100.0+1.21.5")
    pub changelog: Option<String>,             // Changelog text (or null)
    pub dependencies: Vec<ModrinthDependency>, // List of dependencies
    pub game_versions: Vec<String>,            // Compatible game versions
    pub version_type: ModrinthVersionType,     // alpha, beta, release
    pub loaders: Vec<String>,                  // Compatible loaders
    pub files: Vec<ModrinthFile>,              // Files associated with this version
    pub date_published: String,                // ISO 8601 timestamp
    #[serde(default)]
    pub downloads: u64,   // Download count for this specific version
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthDependency {
    pub version_id: Option<String>, // Version ID of the dependency (optional)
    pub project_id: Option<String>, // Project ID of the dependency (optional)
    pub file_name: Option<String>,  // File name of the dependency (optional, for JAR-in-JAR)
    pub dependency_type: ModrinthDependencyType, // required, optional, incompatible, embedded
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ModrinthDependencyType {
    Required,
    Optional,
    Incompatible,
    Embedded,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ModrinthVersionType {
    Release,
    Beta,
    Alpha,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthFile {
    pub hashes: ModrinthHashes,    // Hashes of the file
    pub url: String,               // Download URL
    pub filename: String,          // File name
    pub primary: bool,             // Whether this is the primary file for the version
    pub size: u64,                 // File size in bytes
    pub file_type: Option<String>, // Type of file (e.g., "required-resource-pack", null if main mod file)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthHashes {
    pub sha512: Option<String>,
    pub sha1: Option<String>,
}

// --- Structures for Bulk Hash Lookup ---

#[derive(Serialize)]
struct HashesRequestBody {
    hashes: Vec<String>,
    algorithm: String, // "sha1" or "sha512"
}

// The response is a HashMap<String, ModrinthVersion>
// Key: The hash provided in the request
// Value: The corresponding ModrinthVersion object if found

// --- End Structures for Bulk Hash Lookup ---

// --- Structures for Bulk Project Lookup ---

// Structures for deserializing Modrinth API responses (Bulk Project Details)
// Based on https://docs.modrinth.com/api/operations/getprojects/
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthProject {
    pub id: String, // The ID of the project, encoded as a base62 string
    pub slug: String,
    pub project_type: ModrinthProjectType, // Reuse existing enum
    pub team: String,                      // The ID of the team that has ownership of this project
    pub organization: Option<String>,      // Added: Can be null
    pub title: String,
    pub description: String,              // Short description
    pub body: String,                     // Long description
    pub body_url: Option<String>,         // Ensured Option: Can be null
    pub published: String,                // ISO 8601
    pub updated: String,                  // ISO 8601
    pub approved: Option<String>,         // ISO 8601
    pub queued: Option<String>,           // Added: Can be null
    pub status: String,                   // e.g., "approved"
    pub requested_status: Option<String>, // Ensured Option: Can be null
    pub moderator_message: Option<ModrinthModeratorMessage>,
    pub license: ModrinthLicense,
    pub client_side: String, // "required", "optional", "unsupported", "unknown"
    pub server_side: String, // "required", "optional", "unsupported", "unknown"
    pub downloads: u64,
    pub followers: u64,
    pub categories: Vec<String>,
    #[serde(default)] // Added default in case it's missing or empty
    pub additional_categories: Option<Vec<String>>, // Added: Can be an array or missing
    pub versions: Vec<String>,    // List of version IDs
    pub icon_url: Option<String>, // The field we often need
    pub color: Option<i32>,
    pub thread_id: Option<String>, // Ensured Option: Can be present as string or null
    pub monetization_status: Option<String>, // Ensured Option: Can be present as string or null
    pub issues_url: Option<String>,
    pub source_url: Option<String>,
    pub wiki_url: Option<String>,
    pub discord_url: Option<String>,
    pub donation_urls: Option<Vec<ModrinthDonationUrl>>,
    pub gallery: Vec<ModrinthGalleryImage>,
    #[serde(default)]
    pub game_versions: Option<Vec<String>>,
    #[serde(default)]
    pub loaders: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthModeratorMessage {
    pub message: String,
    pub body: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthDonationUrl {
    pub id: String,
    pub platform: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthLicense {
    pub id: String, // SPDX identifier
    pub name: String,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthGalleryImage {
    pub url: String,
    pub featured: bool,
    pub title: Option<String>,
    pub description: Option<String>,
    pub created: String, // ISO 8601
    pub ordering: i32,
    pub raw_url: Option<String>, // Added: Can be present as string or null
}

// --- End Structures for Bulk Project Lookup ---

// --- Structures for Tags/Categories ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthCategory {
    pub icon: String,         // SVG icon content
    pub name: String,         // Name of the category (e.g., "adventure")
    pub project_type: String, // Project type this category applies to (e.g., "mod")
    pub header: String,       // Header for grouping (e.g., "gameplay")
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthLoader {
    pub icon: String,
    pub name: String,
    pub supported_project_types: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthGameVersion {
    pub version: String,      // The name/number of the game version (e.g., "1.18.1")
    pub version_type: String, // Type: "release", "snapshot", "alpha", "beta"
    pub date: String,         // ISO 8601 date string
    pub major: bool,          // Whether it's a major version
}
// --- End Structures for Tags/Categories ---

// --- Structures for Team Members ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthTeamMember {
    pub team_id: String,
    pub user: ModrinthUser,
    pub role: String,
    pub ordering: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthUser {
    pub id: String,
    pub username: String,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub role: Option<String>, // User's site-wide role, not team role
}
// --- End Structures for Team Members ---

// NEUE Struktur für den Input der Bulk-Abfrage
#[derive(Serialize, Deserialize, Debug, Clone, Eq, PartialEq, Hash)]
pub struct ModrinthProjectContext {
    pub project_id: String, // Modrinth Project ID (oder Slug)
    pub loader: String,     // Der spezifische Loader-Filter für dieses Projekt
    pub game_version: String, // Die spezifische Game-Version für dieses Projekt
                            // Optional: Könnte man erweitern, z.B. um die aktuell installierte version_id für direkten Vergleich
                            // pub current_version_id: Option<String>,
}

// Enum for project types
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ModrinthProjectType {
    Mod,
    Modpack,
    ResourcePack,
    Shader,
    Datapack,
}

impl ModrinthProjectType {
    pub fn to_string(&self) -> String {
        match self {
            ModrinthProjectType::Mod => "mod".to_string(),
            ModrinthProjectType::Modpack => "modpack".to_string(),
            ModrinthProjectType::ResourcePack => "resourcepack".to_string(),
            ModrinthProjectType::Shader => "shader".to_string(),
            ModrinthProjectType::Datapack => "datapack".to_string(),
        }
    }
}

// Enum for sort options
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ModrinthSortType {
    Relevance,
    Downloads,
    Follows,
    Newest,
    Updated,
}

impl ModrinthSortType {
    pub fn to_string(&self) -> String {
        match self {
            ModrinthSortType::Relevance => "relevance".to_string(),
            ModrinthSortType::Downloads => "downloads".to_string(),
            ModrinthSortType::Follows => "follows".to_string(),
            ModrinthSortType::Newest => "newest".to_string(),
            ModrinthSortType::Updated => "updated".to_string(),
        }
    }
}

// Function to search for projects on Modrinth
pub async fn search_projects(
    query: String,
    project_type: ModrinthProjectType,
    game_version: Option<String>,
    loader: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
    sort: Option<ModrinthSortType>,
    categories_filter: Option<Vec<String>>,
    client_side_filter: Option<String>,
    server_side_filter: Option<String>,
) -> Result<ModrinthSearchResponse> {
    let client = reqwest::Client::new();
    let base_url = format!("{}/search", MODRINTH_API_BASE_URL);

    let mut query_params: Vec<(String, String)> = Vec::new();

    // Add mandatory query
    query_params.push(("query".to_string(), query));
    log::debug!(
        "Modrinth search - Query: {}",
        query_params.last().unwrap().1
    );

    // Add limit (default or specified)
    query_params.push(("limit".to_string(), limit.unwrap_or(20).to_string()));
    log::debug!(
        "Modrinth search - Limit: {}",
        query_params.last().unwrap().1
    );

    // Add offset for pagination (default is 0)
    if let Some(offset_value) = offset {
        query_params.push(("offset".to_string(), offset_value.to_string()));
        log::debug!("Modrinth search - Offset: {}", offset_value);
    }

    // Add sorting
    if let Some(sort_type) = sort {
        query_params.push(("index".to_string(), sort_type.to_string()));
        log::debug!("Modrinth search - Sort: {}", sort_type.to_string());
    }

    // Construct facets for filtering
    let mut facets: Vec<String> = Vec::new();

    // Add project type facet
    facets.push(format!("project_type:{}", project_type.to_string()));

    if let Some(gv) = game_version {
        let version_facet = format!("versions:{}", gv);
        log::debug!("Modrinth search - Adding version facet: {}", version_facet);
        facets.push(version_facet);
    }
    if let Some(ld) = loader {
        // Use lowercased loader string for Modrinth category filter
        let loader_facet = format!("categories:{}", ld.to_lowercase());
        log::debug!("Modrinth search - Adding loader facet: {}", loader_facet);
        facets.push(loader_facet);
    }

    // Add categories filter (can be multiple)
    if let Some(cats) = categories_filter {
        for cat_value in cats {
            if !cat_value.is_empty() {
                let category_facet = format!("categories:{}", cat_value.to_lowercase()); // Assuming categories are best lowercased
                log::debug!(
                    "Modrinth search - Adding category facet: {}",
                    category_facet
                );
                facets.push(category_facet);
            }
        }
    }

    // Add client_side filter
    if let Some(cs_filter_val) = client_side_filter {
        if !cs_filter_val.is_empty() {
            let client_facet = format!("client_side:{}", cs_filter_val);
            log::debug!(
                "Modrinth search - Adding client_side facet: {}",
                client_facet
            );
            facets.push(client_facet);
        }
    }

    // Add server_side filter
    if let Some(ss_filter_val) = server_side_filter {
        if !ss_filter_val.is_empty() {
            let server_facet = format!("server_side:{}", ss_filter_val);
            log::debug!(
                "Modrinth search - Adding server_side facet: {}",
                server_facet
            );
            facets.push(server_facet);
        }
    }

    // Modrinth expects facets like: [["versions:1.20.1"],["categories:fabric"]]
    // So we need to wrap each facet string in ["..."] and then join them within an outer [
    let facet_list: Vec<String> = facets
        .iter()
        .map(|f| format!("[\"{}\"]", f)) // Wrap each item like ["key:value"]
        .collect();

    let facets_str = format!("[{}]", facet_list.join(","));
    log::debug!("Modrinth search - Final facets string: {}", facets_str);
    query_params.push(("facets".to_string(), facets_str));

    // Build the final URL with query parameters
    let final_url = reqwest::Url::parse_with_params(&base_url, &query_params)
        .map_err(|e| AppError::Other(format!("Failed to build Modrinth search URL: {}", e)))?;

    log::info!("Searching Modrinth: {}", final_url);

    let response = client
        .get(final_url)
        // It's good practice to set a User-Agent
        // Use format! correctly and ensure CARGO_PKG_VERSION is available
        .header(
            "User-Agent",
            format!(
                "NoRiskClient-Launcher/{} (contact@noriskclient.de)",
                env!("CARGO_PKG_VERSION")
            ),
        )
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Modrinth API request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        log::error!("Modrinth API error ({}): {}", status, error_text);
        return Err(AppError::Other(format!(
            "Modrinth API returned error {}: {}",
            status, error_text
        )));
    }

    response
        .json::<ModrinthSearchResponse>()
        .await
        .map_err(|e| AppError::Other(format!("Failed to parse Modrinth response: {}", e)))
}

// Keep the old function for backward compatibility
pub async fn search_mods(
    query: String,
    game_version: Option<String>,
    loader: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ModrinthSearchHit>> {
    let result = search_projects(
        query,
        ModrinthProjectType::Mod,
        game_version,
        loader,
        limit,
        None,
        None,
        None,
        None,
        None,
    )
    .await?;

    Ok(result.hits)
}

// Function to get versions for a specific Modrinth project
pub async fn get_mod_versions(
    project_id_or_slug: String,
    loaders: Option<Vec<String>>,
    game_versions: Option<Vec<String>>,
) -> Result<Vec<ModrinthVersion>> {
    let client = reqwest::Client::new();
    let url = format!(
        "{}/project/{}/version",
        MODRINTH_API_BASE_URL, project_id_or_slug
    );

    let mut query_params: Vec<(String, String)> = Vec::new();

    // Add filters if provided
    if let Some(loaders_vec) = loaders {
        if !loaders_vec.is_empty() {
            // Needs to be a JSON array string, e.g., ["fabric", "quilt"]
            let loaders_json = serde_json::to_string(&loaders_vec).map_err(|e| {
                AppError::Other(format!("Failed to serialize loaders filter: {}", e))
            })?;
            query_params.push(("loaders".to_string(), loaders_json));
            log::debug!(
                "Modrinth versions - Adding loaders filter: {}",
                query_params.last().unwrap().1
            );
        }
    }
    if let Some(versions_vec) = game_versions {
        if !versions_vec.is_empty() {
            // Needs to be a JSON array string, e.g., ["1.20.1", "1.20"]
            let versions_json = serde_json::to_string(&versions_vec).map_err(|e| {
                AppError::Other(format!("Failed to serialize game_versions filter: {}", e))
            })?;
            query_params.push(("game_versions".to_string(), versions_json));
            log::debug!(
                "Modrinth versions - Adding game_versions filter: {}",
                query_params.last().unwrap().1
            );
        }
    }

    // Build the final URL with query parameters
    let final_url = reqwest::Url::parse_with_params(&url, &query_params)
        .map_err(|e| AppError::Other(format!("Failed to build Modrinth versions URL: {}", e)))?;

    log::info!("Getting Modrinth versions: {}", final_url);

    let response = client
        .get(final_url)
        .header(
            "User-Agent",
            format!(
                "NoRiskClient-Launcher/{} (contact@noriskclient.de)",
                env!("CARGO_PKG_VERSION")
            ),
        )
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Modrinth API request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        log::error!(
            "Modrinth API error getting versions ({}): {}",
            status,
            error_text
        );
        return Err(AppError::Other(format!(
            "Modrinth API returned error {}: {}",
            status, error_text
        )));
    }

    let versions_result = response.json::<Vec<ModrinthVersion>>().await.map_err(|e| {
        AppError::Other(format!("Failed to parse Modrinth versions response: {}", e))
    })?;

    Ok(versions_result)
}

// Function to get details for a specific Modrinth version ID
// Based on https://docs.modrinth.com/api-spec/#tag/versions/operation/getVersion
pub async fn get_version_details(version_id: String) -> Result<ModrinthVersion> {
    let client = reqwest::Client::new();
    let url = format!("{}/version/{}", MODRINTH_API_BASE_URL, version_id);

    log::info!("Getting Modrinth version details: {}", url);

    let response = client
        .get(url)
        .header(
            "User-Agent",
            format!(
                "NoRiskClient-Launcher/{} (contact@noriskclient.de)",
                env!("CARGO_PKG_VERSION")
            ),
        )
        .send()
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Modrinth API request failed for version {}: {}",
                version_id, e
            ))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        log::error!(
            "Modrinth API error getting version {} details ({}): {}",
            version_id,
            status,
            error_text
        );
        return Err(AppError::Other(format!(
            "Modrinth API returned error {} getting version details: {}",
            status, error_text
        )));
    }

    let version_details = response.json::<ModrinthVersion>().await.map_err(|e| {
        AppError::Other(format!(
            "Failed to parse Modrinth version details response for {}: {}",
            version_id, e
        ))
    })?;

    Ok(version_details)
}

/// Fetches ALL compatible versions for a list of Modrinth projects concurrently,
/// using specific filters for each project.
///
/// Returns a HashMap mapping the input project context to a Result containing either
/// the Vec<ModrinthVersion> or an AppError specific to that context's fetch.
pub async fn get_all_versions_for_projects(
    contexts: Vec<ModrinthProjectContext>,
) -> Result<HashMap<ModrinthProjectContext, Result<Vec<ModrinthVersion>>>> {
    if contexts.is_empty() {
        return Ok(HashMap::new());
    }

    info!(
        "Fetching all compatible versions for {} project contexts.",
        contexts.len()
    );

    let client = reqwest::Client::new();

    // Create a list of futures, one for each context
    let futures = contexts.into_iter().map(|context| {
        let client = client.clone();
        let original_context = context.clone();

        async move {
            let loaders = Some(vec![context.loader]);
            let game_versions = Some(vec![context.game_version]);

            // Call get_mod_versions and return the Result directly
            let versions_result: Result<Vec<ModrinthVersion>> =
                get_mod_versions(context.project_id, loaders, game_versions).await;

            // Log success or failure for this specific context
            match &versions_result {
                Ok(versions) => info!(
                    "Successfully fetched {} versions for project '{}'",
                    versions.len(),
                    original_context.project_id
                ),
                Err(e) => error!(
                    "Failed to fetch versions for project '{}': {}",
                    original_context.project_id, e
                ),
            };

            // Return the context and the Result<Vec<ModrinthVersion>>
            (original_context, versions_result)
        }
    });

    // Execute all futures concurrently
    let results: Vec<(ModrinthProjectContext, Result<Vec<ModrinthVersion>>)> =
        join_all(futures).await;

    // Collect results into a HashMap
    let version_map: HashMap<ModrinthProjectContext, Result<Vec<ModrinthVersion>>> =
        results.into_iter().collect();

    info!(
        "Finished fetching all versions. Got results for {} project contexts.",
        version_map.len()
    );
    // The outer Result is for potential errors during the setup/collection,
    // individual fetch errors are inside the map values.
    Ok(version_map)
}

/// Fetches version details from Modrinth using a file hash (SHA1 or SHA512).
/// https://docs.modrinth.com/api-spec/#tag/version_files/operation/getVersionByHash
pub async fn get_version_by_hash(file_hash: String) -> Result<ModrinthVersion> {
    // Determine hash algorithm based on length (SHA1: 40 chars, SHA512: 128 chars)
    let algorithm = match file_hash.len() {
        40 => "sha1",
        128 => "sha512",
        _ => {
            return Err(AppError::Other(format!(
                "Invalid hash length provided: {}",
                file_hash.len()
            )))
        }
    };

    let client = reqwest::Client::new();
    let url = format!(
        "{}/version_file/{}?algorithm={}", // Correct endpoint path
        MODRINTH_API_BASE_URL, file_hash, algorithm
    );

    log::info!(
        "Getting Modrinth version details by hash ({}): {}",
        algorithm,
        url
    );

    let response = client
        .get(&url) // Pass URL by reference
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
            AppError::Other(format!(
                "Modrinth API request failed for hash {}: {}",
                file_hash, e
            ))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        log::error!(
            "Modrinth API error getting version by hash {} ({}): {}",
            file_hash,
            status,
            error_text
        );
        // Handle 404 specifically as "hash not found"
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::ModrinthHashNotFound(file_hash));
        }
        return Err(AppError::Other(format!(
            "Modrinth API returned error {} getting version by hash: {}",
            status, error_text
        )));
    }

    let version_details = response
        .json::<ModrinthVersion>() // The endpoint returns a Version object
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Failed to parse Modrinth version details response for hash {}: {}",
                file_hash, e
            ))
        })?;

    Ok(version_details)
}

/// Fetches version details for multiple files from Modrinth using a list of hashes (SHA1 or SHA512).
/// https://docs.modrinth.com/api-spec/#tag/version_files/operation/getVersionsByHashes
pub async fn get_versions_by_hashes(
    hashes: Vec<String>,
    algorithm: &str, // Expecting "sha1" or "sha512"
) -> Result<HashMap<String, ModrinthVersion>> {
    if hashes.is_empty() {
        return Ok(HashMap::new()); // Nothing to fetch
    }
    if algorithm != "sha1" && algorithm != "sha512" {
        return Err(AppError::Other(format!(
            "Invalid hash algorithm provided: {}",
            algorithm
        )));
    }

    let client = reqwest::Client::new();
    let url = format!("{}/version_files", MODRINTH_API_BASE_URL); // POST endpoint

    let request_body = HashesRequestBody {
        hashes: hashes.clone(), // Clone hashes for the body
        algorithm: algorithm.to_string(),
    };

    log::info!(
        "Getting Modrinth versions for {} hashes ({}): {}",
        hashes.len(),
        algorithm,
        url
    );

    let response = client
        .post(&url) // Use POST
        .header(
            "User-Agent",
            format!(
                "NoRiskClient-Launcher/{} (support@norisk.gg)",
                env!("CARGO_PKG_VERSION")
            ),
        )
        .header("Content-Type", "application/json") // Set content type
        .json(&request_body) // Send the serialized request body
        .send()
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Modrinth API POST request failed for hashes: {}",
                e
            ))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        log::error!(
            "Modrinth API error getting versions by hashes (Algorithm: {}) ({}): {}",
            algorithm,
            status,
            error_text
        );
        return Err(AppError::Other(format!(
            "Modrinth API returned error {} getting versions by hashes: {}",
            status, error_text
        )));
    }

    // The response is a map where keys are the *input* hashes and values are the Version objects.
    // Hashes not found are simply omitted from the response map.
    let versions_map = response
        .json::<HashMap<String, ModrinthVersion>>()
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Failed to parse Modrinth versions by hashes response: {}",
                e
            ))
        })?;

    log::info!(
        "Successfully retrieved version info for {} out of {} requested hashes.",
        versions_map.len(),
        hashes.len()
    );

    Ok(versions_map)
}

/// Structure for bulk update check request body
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthBulkUpdateRequestBody {
    pub hashes: Vec<String>,
    pub algorithm: String,
    pub loaders: Vec<String>,
    pub game_versions: Vec<String>,
}

impl ModrinthBulkUpdateRequestBody {
    /// Create a new BulkUpdateRequestBody with validation
    pub fn new(
        hashes: Vec<String>,
        algorithm: String,
        loaders: Vec<String>,
        game_versions: Vec<String>,
    ) -> Result<Self> {
        if hashes.is_empty() {
            return Err(AppError::Other(
                "No hashes provided for update check".to_string(),
            ));
        }

        if algorithm != "sha1" && algorithm != "sha512" {
            return Err(AppError::Other(format!(
                "Invalid hash algorithm provided: {}",
                algorithm
            )));
        }

        Ok(Self {
            hashes,
            algorithm,
            loaders,
            game_versions,
        })
    }
}

/// Efficiently checks for updates to multiple mods using a single API call.
/// Takes a BulkUpdateRequestBody struct and returns the latest available version for each mod.
/// This is specifically designed for update checking and is more efficient than
/// fetching all versions for each project.
///
/// Returns a HashMap where:
/// - Keys are the input file hashes
/// - Values are the latest available ModrinthVersion objects that match the filters
/// - Mods without updates or not found on Modrinth are omitted from the results
pub async fn check_bulk_updates(
    request: ModrinthBulkUpdateRequestBody,
) -> Result<HashMap<String, ModrinthVersion>> {
    let client = reqwest::Client::new();
    let url = format!("{}/version_files/update", MODRINTH_API_BASE_URL); // Update check endpoint

    log::info!(
        "Checking for updates for {} mods via Modrinth bulk API",
        request.hashes.len()
    );

    let response = client
        .post(&url)
        .header(
            "User-Agent",
            format!(
                "NoRiskClient-Launcher/{} (support@norisk.gg)",
                env!("CARGO_PKG_VERSION")
            ),
        )
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Modrinth API bulk update check request failed: {}",
                e
            ))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        log::error!(
            "Modrinth API error checking for updates (Algorithm: {}) ({}): {}",
            request.algorithm,
            status,
            error_text
        );
        return Err(AppError::Other(format!(
            "Modrinth API returned error {} checking for updates: {}",
            status, error_text
        )));
    }

    // The response is a map where keys are the input hashes and values are the latest Version objects.
    // Hashes without updates available are omitted from the response map.
    let updates_map = response
        .json::<HashMap<String, ModrinthVersion>>()
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Failed to parse Modrinth bulk update response: {}",
                e
            ))
        })?;

    let update_count = updates_map.len();
    log::info!(
        "Found updates for {}/{} mods checked",
        update_count,
        request.hashes.len()
    );

    Ok(updates_map)
}

/// Fetches project details for multiple projects from Modrinth using a list of IDs or slugs.
/// https://docs.modrinth.com/api/operations/getprojects/
pub async fn get_multiple_projects(ids: Vec<String>) -> Result<Vec<ModrinthProject>> {
    if ids.is_empty() {
        return Ok(Vec::new()); // Nothing to fetch
    }

    // Modrinth expects the IDs as a JSON array string in the query parameter
    let ids_json = serde_json::to_string(&ids).map_err(|e| AppError::Json(e))?; // Use appropriate error type

    let client = reqwest::Client::new();
    // Note: No trailing slash needed for the base URL when using parse_with_params
    let base_url = format!("{}/projects", MODRINTH_API_BASE_URL);

    let final_url =
        reqwest::Url::parse_with_params(&base_url, &[("ids", ids_json)]).map_err(|e| {
            AppError::Other(format!("Failed to build Modrinth bulk projects URL: {}", e))
        })?;

    log::info!(
        "Getting Modrinth project details for {} projects: {}",
        ids.len(),
        final_url
    );

    let response = client
        .get(final_url)
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
            AppError::RequestError(format!(
                "Modrinth API request failed for bulk projects: {}",
                e
            ))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body".to_string());
        log::error!(
            "Modrinth API error getting bulk project details (Status: {}): {}",
            status,
            error_text
        );
        return Err(AppError::Other(format!(
            "Modrinth API returned error {} getting bulk project details: {}",
            status, error_text
        )));
    }

    // Read the response body as text first for debugging
    let response_body_text = response.text().await.map_err(|e| {
        AppError::RequestError(format!(
            "Failed to read Modrinth bulk projects response body as text: {}",
            e
        ))
    })?;

    // Prepare a version of the body for logging, possibly truncated if too long
    let logged_response_body_display: String;
    const MAX_RAW_BODY_LOG_LENGTH: usize = 5000; // Corrected back to 5000

    if response_body_text.len() > MAX_RAW_BODY_LOG_LENGTH {
        logged_response_body_display = format!(
            "{}... (body truncated, original length: {})",
            safe_truncate(&response_body_text, MAX_RAW_BODY_LOG_LENGTH),
            response_body_text.len()
        );
    } else {
        logged_response_body_display = response_body_text.clone();
    }

    log::debug!(
        "Modrinth bulk projects raw response body: {}",
        logged_response_body_display
    );

    // Now parse the original, full text
    let projects =
        serde_json::from_str::<Vec<ModrinthProject>>(&response_body_text).map_err(|e| {
            let error_message = format!(
                "Failed to parse Modrinth bulk projects response: {}. Body (logged version): {}",
                e, logged_response_body_display
            );
            log::error!(
                "JSON Parsing Error in get_multiple_projects: {}",
                error_message
            ); // Added explicit error log
            AppError::RequestError(error_message)
        })?;

    log::info!(
        "Successfully retrieved details for {} projects.",
        projects.len()
    );

    Ok(projects)
}

/// Fetches a list of all categories from Modrinth.
/// https://docs.modrinth.com/api/operations/categorylist/
pub async fn get_modrinth_categories() -> Result<Vec<ModrinthCategory>> {
    let client = reqwest::Client::new();
    let url = format!("{}/tag/category", MODRINTH_API_BASE_URL);

    log::info!("Fetching Modrinth categories from: {}", url);

    let response = client
        .get(&url)
        .header(
            "User-Agent",
            format!(
                "NoRiskClient-Launcher/{} (contact@noriskclient.de)",
                env!("CARGO_PKG_VERSION")
            ),
        )
        .send()
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Modrinth API request to fetch categories failed: {}",
                e
            ))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body from categories endpoint".to_string());
        log::error!(
            "Modrinth API error fetching categories (Status: {}): {}",
            status,
            error_text
        );
        return Err(AppError::Other(format!(
            "Modrinth API returned error {} fetching categories: {}",
            status, error_text
        )));
    }

    let categories = response
        .json::<Vec<ModrinthCategory>>()
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Failed to parse Modrinth categories response: {}",
                e
            ))
        })?;

    log::info!("Successfully fetched {} categories.", categories.len());
    Ok(categories)
}

/// Fetches a list of all loaders from Modrinth.
/// https://docs.modrinth.com/api/operations/loaderlist/
pub async fn get_modrinth_loaders() -> Result<Vec<ModrinthLoader>> {
    let client = reqwest::Client::new();
    let url = format!("{}/tag/loader", MODRINTH_API_BASE_URL);

    log::info!("Fetching Modrinth loaders from: {}", url);

    let response = client
        .get(&url)
        .header(
            "User-Agent",
            format!(
                "NoRiskClient-Launcher/{} (contact@noriskclient.de)",
                env!("CARGO_PKG_VERSION")
            ),
        )
        .send()
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Modrinth API request to fetch loaders failed: {}",
                e
            ))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body from loaders endpoint".to_string());
        log::error!(
            "Modrinth API error fetching loaders (Status: {}): {}",
            status,
            error_text
        );
        return Err(AppError::Other(format!(
            "Modrinth API returned error {} fetching loaders: {}",
            status, error_text
        )));
    }

    let loaders = response.json::<Vec<ModrinthLoader>>().await.map_err(|e| {
        AppError::Other(format!("Failed to parse Modrinth loaders response: {}", e))
    })?;

    log::info!("Successfully fetched {} loaders.", loaders.len());
    Ok(loaders)
}

/// Fetches a list of all game versions from Modrinth.
/// https://docs.modrinth.com/api/operations/versionlist/
pub async fn get_modrinth_game_versions() -> Result<Vec<ModrinthGameVersion>> {
    let client = reqwest::Client::new();
    let url = format!("{}/tag/game_version", MODRINTH_API_BASE_URL);

    log::info!("Fetching Modrinth game versions from: {}", url);

    let response = client
        .get(&url)
        .header(
            "User-Agent",
            format!(
                "NoRiskClient-Launcher/{} (contact@noriskclient.de)",
                env!("CARGO_PKG_VERSION")
            ),
        )
        .send()
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Modrinth API request to fetch game versions failed: {}",
                e
            ))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| {
            "Failed to read error body from game versions endpoint".to_string()
        });
        log::error!(
            "Modrinth API error fetching game versions (Status: {}): {}",
            status,
            error_text
        );
        return Err(AppError::Other(format!(
            "Modrinth API returned error {} fetching game versions: {}",
            status, error_text
        )));
    }

    let game_versions = response
        .json::<Vec<ModrinthGameVersion>>()
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Failed to parse Modrinth game versions response: {}",
                e
            ))
        })?;

    log::info!(
        "Successfully fetched {} game versions.",
        game_versions.len()
    );
    Ok(game_versions)
}

/// Fetches team members for a specific project from Modrinth.
/// https://docs.modrinth.com/api/operations/getprojectteammembers/
pub async fn get_project_members(project_id_or_slug: String) -> Result<Vec<ModrinthTeamMember>> {
    let client = reqwest::Client::new();
    let url = format!(
        "{}/project/{}/members",
        MODRINTH_API_BASE_URL, project_id_or_slug
    );

    log::info!("Fetching Modrinth project members from: {}", url);

    let response = client
        .get(&url)
        .header(
            "User-Agent",
            format!(
                "NoRiskClient-Launcher/{} (contact@noriskclient.de)",
                env!("CARGO_PKG_VERSION")
            ),
        )
        .send()
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Modrinth API request to fetch project members failed: {}",
                e
            ))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error body from project members endpoint".to_string());
        log::error!(
            "Modrinth API error fetching project members (Status: {}): {}",
            status,
            error_text
        );
        return Err(AppError::Other(format!(
            "Modrinth API returned error {} fetching project members: {}",
            status, error_text
        )));
    }

    let members = response
        .json::<Vec<ModrinthTeamMember>>()
        .await
        .map_err(|e| {
            AppError::Other(format!(
                "Failed to parse Modrinth project members response: {}",
                e
            ))
        })?;

    log::info!(
        "Successfully fetched {} team members for project {}.",
        members.len(),
        project_id_or_slug
    );
    Ok(members)
}
