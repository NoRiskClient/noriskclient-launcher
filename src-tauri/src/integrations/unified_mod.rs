use crate::integrations::curseforge;
use crate::integrations::curseforge::ModpackManifest;
use crate::integrations::modrinth;
use crate::state::profile_state::{ModPackSource, ProfileManager, Profile};
use crate::state::state_manager::State;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use log::{debug, error, info, warn};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum ModPlatform {
    Modrinth,
    CurseForge,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum UnifiedProjectType {
    Mod,
    Modpack,
    ResourcePack,
    Shader,
    Datapack,
}

impl UnifiedProjectType {
    pub fn to_string(&self) -> String {
        match self {
            UnifiedProjectType::Mod => "mod".to_string(),
            UnifiedProjectType::Modpack => "modpack".to_string(),
            UnifiedProjectType::ResourcePack => "resourcepack".to_string(),
            UnifiedProjectType::Shader => "shader".to_string(),
            UnifiedProjectType::Datapack => "datapack".to_string(),
        }
    }

    pub fn to_curseforge_class_id(&self) -> Option<u32> {
        match self {
            UnifiedProjectType::Mod => Some(6), // Minecraft Mods
            UnifiedProjectType::Modpack => Some(4471), // Minecraft Modpacks
            UnifiedProjectType::ResourcePack => Some(12), // Minecraft Resource Packs
            UnifiedProjectType::Shader => Some(6552), // Minecraft Shaders
            UnifiedProjectType::Datapack => Some(119), // Minecraft Data Packs
        }
    }

    pub fn from_curseforge_class_id(class_id: u32) -> Option<Self> {
        match class_id {
            6 => Some(UnifiedProjectType::Mod), // Minecraft Mods
            4471 => Some(UnifiedProjectType::Modpack), // Minecraft Modpacks
            12 => Some(UnifiedProjectType::ResourcePack), // Minecraft Resource Packs
            6552 => Some(UnifiedProjectType::Shader), // Minecraft Shaders
            119 => Some(UnifiedProjectType::Datapack), // Minecraft Data Packs
            _ => None,
        }
    }

    pub fn to_modrinth_project_type(&self) -> modrinth::ModrinthProjectType {
        match self {
            UnifiedProjectType::Mod => modrinth::ModrinthProjectType::Mod,
            UnifiedProjectType::Modpack => modrinth::ModrinthProjectType::Modpack,
            UnifiedProjectType::ResourcePack => modrinth::ModrinthProjectType::ResourcePack,
            UnifiedProjectType::Shader => modrinth::ModrinthProjectType::Shader,
            UnifiedProjectType::Datapack => modrinth::ModrinthProjectType::Datapack,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum UnifiedSortType {
    Relevance,
    Downloads,
    Follows,
    Newest,
    Updated,
    Name,
    Author,
    Featured,
    Popularity,
    Category,
    GameVersion,
}

impl UnifiedSortType {
    pub fn to_string(&self) -> String {
        match self {
            UnifiedSortType::Relevance => "relevance".to_string(),
            UnifiedSortType::Downloads => "downloads".to_string(),
            UnifiedSortType::Follows => "follows".to_string(),
            UnifiedSortType::Newest => "newest".to_string(),
            UnifiedSortType::Updated => "updated".to_string(),
            UnifiedSortType::Name => "name".to_string(),
            UnifiedSortType::Author => "author".to_string(),
            UnifiedSortType::Featured => "featured".to_string(),
            UnifiedSortType::Popularity => "popularity".to_string(),
            UnifiedSortType::Category => "category".to_string(),
            UnifiedSortType::GameVersion => "game_version".to_string(),
        }
    }

    pub fn to_modrinth_sort_type(&self) -> Option<modrinth::ModrinthSortType> {
        match self {
            UnifiedSortType::Relevance => Some(modrinth::ModrinthSortType::Relevance),
            UnifiedSortType::Downloads => Some(modrinth::ModrinthSortType::Downloads),
            UnifiedSortType::Follows => Some(modrinth::ModrinthSortType::Follows),
            UnifiedSortType::Newest => Some(modrinth::ModrinthSortType::Newest),
            UnifiedSortType::Updated => Some(modrinth::ModrinthSortType::Updated),
            // These don't have direct Modrinth equivalents, so use Relevance as fallback
            UnifiedSortType::Name | UnifiedSortType::Author | UnifiedSortType::Featured |
            UnifiedSortType::Popularity | UnifiedSortType::Category | UnifiedSortType::GameVersion => {
                Some(modrinth::ModrinthSortType::Relevance)
            }
        }
    }

    pub fn to_curseforge_sort_field_and_order(&self) -> (Option<curseforge::CurseForgeModSearchSortField>, Option<curseforge::CurseForgeSortOrder>) {
        match self {
            UnifiedSortType::Relevance => (Some(curseforge::CurseForgeModSearchSortField::Featured), Some(curseforge::CurseForgeSortOrder::Desc)),
            UnifiedSortType::Downloads => (Some(curseforge::CurseForgeModSearchSortField::TotalDownloads), Some(curseforge::CurseForgeSortOrder::Desc)),
            UnifiedSortType::Newest => (Some(curseforge::CurseForgeModSearchSortField::LastUpdated), Some(curseforge::CurseForgeSortOrder::Desc)),
            UnifiedSortType::Updated => (Some(curseforge::CurseForgeModSearchSortField::LastUpdated), Some(curseforge::CurseForgeSortOrder::Desc)),
            UnifiedSortType::Name => (Some(curseforge::CurseForgeModSearchSortField::Name), Some(curseforge::CurseForgeSortOrder::Desc)),
            UnifiedSortType::Author => (Some(curseforge::CurseForgeModSearchSortField::Author), Some(curseforge::CurseForgeSortOrder::Desc)),
            UnifiedSortType::Featured => (Some(curseforge::CurseForgeModSearchSortField::Featured), Some(curseforge::CurseForgeSortOrder::Desc)),
            UnifiedSortType::Popularity => (Some(curseforge::CurseForgeModSearchSortField::Popularity), Some(curseforge::CurseForgeSortOrder::Desc)),
            UnifiedSortType::Category => (Some(curseforge::CurseForgeModSearchSortField::Category), Some(curseforge::CurseForgeSortOrder::Desc)),
            UnifiedSortType::GameVersion => (Some(curseforge::CurseForgeModSearchSortField::GameVersion), Some(curseforge::CurseForgeSortOrder::Desc)),
            // Follows doesn't have a direct CurseForge equivalent, use Popularity as fallback
            UnifiedSortType::Follows => (Some(curseforge::CurseForgeModSearchSortField::Popularity), Some(curseforge::CurseForgeSortOrder::Desc)),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnifiedModSearchResult {
    pub project_id: String, // ID field used in UI
    pub source: ModPlatform,
    pub title: String, // Name field used in UI
    pub slug: String,
    pub description: String,
    pub author: String,
    pub categories: Vec<String>,
    pub display_categories: Vec<String>,
    pub client_side: Option<String>,
    pub server_side: Option<String>,
    pub downloads: u64,
    pub follows: Option<u64>,
    pub icon_url: Option<String>,
    pub project_url: String,
    pub project_type: Option<String>, // "mod", "modpack", etc.
    pub latest_version: Option<String>,
    pub date_created: Option<String>,
    pub date_modified: Option<String>,
    pub license: Option<String>,
    pub gallery: Vec<String>,
    pub versions: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnifiedPagination {
    pub index: u32,
    pub page_size: u32,
    pub result_count: u32,
    pub total_count: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnifiedModSearchParams {
    pub query: String,
    pub source: ModPlatform,
    pub project_type: UnifiedProjectType,
    pub game_version: Option<String>,
    pub categories: Option<Vec<String>>,
    pub mod_loaders: Option<Vec<String>>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub sort: Option<UnifiedSortType>,
    pub client_side_filter: Option<String>,
    pub server_side_filter: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnifiedModVersionsParams {
    pub source: ModPlatform,
    pub project_id: String,
    pub loaders: Option<Vec<String>>,
    pub game_versions: Option<Vec<String>>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnifiedModSearchResponse {
    pub results: Vec<UnifiedModSearchResult>,
    pub pagination: UnifiedPagination,
}

// Unified version/file structure for both platforms
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnifiedVersion {
    pub id: String,
    pub project_id: String,
    pub source: ModPlatform,
    pub name: String,
    pub version_number: String,
    pub changelog: Option<String>,
    pub dependencies: Vec<UnifiedDependency>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub files: Vec<UnifiedVersionFile>,
    pub date_published: String,
    pub downloads: u64,
    pub release_type: UnifiedVersionType,
    pub url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnifiedVersionFile {
    pub filename: String,
    pub url: String,
    pub size: u64,
    pub hashes: HashMap<String, String>,
    pub primary: bool,
    pub fingerprint: Option<u64>, // CurseForge fingerprint for update checking
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnifiedDependency {
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub file_name: Option<String>,
    pub dependency_type: UnifiedDependencyType,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum UnifiedDependencyType {
    Required,
    Optional,
    Incompatible,
    Embedded,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum UnifiedVersionType {
    Release,
    Beta,
    Alpha,
}

// Response structure for unified version requests
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnifiedVersionResponse {
    pub versions: Vec<UnifiedVersion>,
    pub total_count: u64,
}

/// Response structure for modpack version requests
/// Includes the specific installed version and all available versions
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnifiedModpackVersionsResponse {
    /// The specific installed version (if found)
    pub installed_version: Option<UnifiedVersion>,
    /// All available versions for this modpack
    pub all_versions: Vec<UnifiedVersion>,
    /// Whether updates are available (newer versions exist)
    pub updates_available: bool,
    /// Latest available version
    pub latest_version: Option<UnifiedVersion>,
}

impl From<modrinth::ModrinthSearchHit> for UnifiedModSearchResult {
    fn from(hit: modrinth::ModrinthSearchHit) -> Self {
        let slug = hit.slug.clone();
        let project_type = hit.project_type.clone();

        UnifiedModSearchResult {
            project_id: hit.project_id,
            source: ModPlatform::Modrinth,
            title: hit.title,
            slug: hit.slug,
            description: hit.description,
            author: hit.author.unwrap_or_else(|| "Unknown".to_string()),
            categories: hit.categories,
            display_categories: hit.display_categories,
            client_side: Some(hit.client_side),
            server_side: Some(hit.server_side),
            downloads: hit.downloads,
            follows: Some(hit.follows),
            icon_url: hit.icon_url,
            project_url: format!("https://modrinth.com/{}/{}", project_type, slug),
            project_type: Some(hit.project_type),
            latest_version: hit.latest_version,
            date_created: Some(hit.date_created),
            date_modified: Some(hit.date_modified),
            license: Some(hit.license),
            gallery: hit.gallery,
            versions: None, // ModrinthSearchHit doesn't provide versions in search results
        }
    }
}

impl From<curseforge::CurseForgeMod> for UnifiedModSearchResult {
    fn from(mod_info: curseforge::CurseForgeMod) -> Self {
        let author = mod_info.authors.first()
            .map(|a| a.name.clone())
            .unwrap_or_else(|| "Unknown".to_string());

        let categories: Vec<String> = mod_info.categories
            .iter()
            .map(|cat| cat.name.clone())
            .collect();

        // Map CurseForge classId to unified project type
        let project_type = mod_info.classId
            .and_then(|class_id| UnifiedProjectType::from_curseforge_class_id(class_id))
            .map(|pt| pt.to_string());

        UnifiedModSearchResult {
            project_id: mod_info.id.to_string(),
            source: ModPlatform::CurseForge,
            title: mod_info.name,
            slug: mod_info.slug,
            description: mod_info.summary,
            author,
            categories: categories.clone(),
            display_categories: categories, // Use same as categories for CurseForge
            client_side: None, // CurseForge doesn't provide this
            server_side: None, // CurseForge doesn't provide this
            downloads: mod_info.downloadCount,
            follows: None, // CurseForge doesn't provide this
            icon_url: mod_info.logo.map(|logo| logo.url),
            project_url: mod_info.links.websiteUrl,
            project_type, // Now properly mapped from classId
            latest_version: None, // CurseForge doesn't provide this
            date_created: None, // CurseForge doesn't provide this
            date_modified: None, // CurseForge doesn't provide this
            license: None, // CurseForge doesn't provide this
            gallery: vec![], // CurseForge doesn't provide this
            versions: None, // CurseForge doesn't provide this
        }
    }
}

impl From<modrinth::ModrinthVersion> for UnifiedVersion {
    fn from(version: modrinth::ModrinthVersion) -> Self {
        let unified_files: Vec<UnifiedVersionFile> = version.files
            .into_iter()
            .map(|file| {
                let mut hashes_map = HashMap::new();
                if let Some(sha1) = &file.hashes.sha1 {
                    hashes_map.insert("sha1".to_string(), sha1.clone());
                }
                if let Some(sha512) = &file.hashes.sha512 {
                    hashes_map.insert("sha512".to_string(), sha512.clone());
                }

                UnifiedVersionFile {
                    filename: file.filename,
                    url: file.url,
                    size: file.size,
                    hashes: hashes_map,
                    primary: file.primary,
                    fingerprint: None, // Not available from Modrinth API
                }
            })
            .collect();

        let project_id_clone = version.project_id.clone();
        let id_clone = version.id.clone();

        // Convert Modrinth dependencies to unified dependencies
        let unified_dependencies: Vec<UnifiedDependency> = version.dependencies
            .into_iter()
            .map(|dep| UnifiedDependency {
                project_id: dep.project_id,
                version_id: dep.version_id,
                file_name: dep.file_name,
                dependency_type: match dep.dependency_type {
                    modrinth::ModrinthDependencyType::Required => UnifiedDependencyType::Required,
                    modrinth::ModrinthDependencyType::Optional => UnifiedDependencyType::Optional,
                    modrinth::ModrinthDependencyType::Incompatible => UnifiedDependencyType::Incompatible,
                    modrinth::ModrinthDependencyType::Embedded => UnifiedDependencyType::Embedded,
                },
            })
            .collect();

        UnifiedVersion {
            id: version.id,
            project_id: version.project_id,
            source: ModPlatform::Modrinth,
            name: version.name,
            version_number: version.version_number,
            changelog: version.changelog,
            dependencies: unified_dependencies,
            game_versions: version.game_versions,
            loaders: version.loaders,
            files: unified_files,
            date_published: version.date_published,
            downloads: version.downloads,
            release_type: match version.version_type {
                modrinth::ModrinthVersionType::Release => UnifiedVersionType::Release,
                modrinth::ModrinthVersionType::Beta => UnifiedVersionType::Beta,
                modrinth::ModrinthVersionType::Alpha => UnifiedVersionType::Alpha,
            },
            url: format!("https://modrinth.com/mod/{}/version/{}", project_id_clone, id_clone),
        }
    }
}

impl From<UnifiedVersion> for modrinth::ModrinthVersion {
    fn from(version: UnifiedVersion) -> Self {
        // Convert unified files back to Modrinth files
        let modrinth_files: Vec<modrinth::ModrinthFile> = version.files
            .into_iter()
            .map(|file| {
                let mut hashes = modrinth::ModrinthHashes {
                    sha512: None,
                    sha1: None,
                };

                if let Some(sha1) = file.hashes.get("sha1") {
                    hashes.sha1 = Some(sha1.clone());
                }
                if let Some(sha512) = file.hashes.get("sha512") {
                    hashes.sha512 = Some(sha512.clone());
                }

                modrinth::ModrinthFile {
                    hashes,
                    url: file.url,
                    filename: file.filename,
                    primary: file.primary,
                    size: file.size,
                    file_type: None, // Not available in UnifiedVersion
                }
            })
            .collect();

        // Convert unified dependencies back to Modrinth dependencies
        let modrinth_dependencies: Vec<modrinth::ModrinthDependency> = version.dependencies
            .into_iter()
            .map(|dep| modrinth::ModrinthDependency {
                version_id: dep.version_id,
                project_id: dep.project_id,
                file_name: dep.file_name,
                dependency_type: match dep.dependency_type {
                    UnifiedDependencyType::Required => modrinth::ModrinthDependencyType::Required,
                    UnifiedDependencyType::Optional => modrinth::ModrinthDependencyType::Optional,
                    UnifiedDependencyType::Incompatible => modrinth::ModrinthDependencyType::Incompatible,
                    UnifiedDependencyType::Embedded => modrinth::ModrinthDependencyType::Embedded,
                },
            })
            .collect();

        modrinth::ModrinthVersion {
            id: version.id,
            project_id: version.project_id,
            author_id: Some(String::new()), // Not available in UnifiedVersion
            featured: false, // Not available in UnifiedVersion
            name: version.name,
            version_number: version.version_number,
            changelog: version.changelog,
            date_published: version.date_published,
            downloads: version.downloads,
            version_type: match version.release_type {
                UnifiedVersionType::Release => modrinth::ModrinthVersionType::Release,
                UnifiedVersionType::Beta => modrinth::ModrinthVersionType::Beta,
                UnifiedVersionType::Alpha => modrinth::ModrinthVersionType::Alpha,
            },
            files: modrinth_files,
            dependencies: modrinth_dependencies,
            game_versions: version.game_versions,
            loaders: version.loaders,
        }
    }
}

impl From<curseforge::CurseForgeFile> for UnifiedVersion {
    fn from(file: curseforge::CurseForgeFile) -> Self {
        let mut hashes_map = HashMap::new();
        for hash in &file.hashes {
            if let Some(algo) = curseforge::CurseForgeHashAlgo::from_u32(hash.algo) {
                hashes_map.insert(algo.to_string(), hash.value.clone());
            } else {
                hashes_map.insert("unknown".to_string(), hash.value.clone());
            }
        }

        // Create unified file for this CurseForge file
        let unified_file = UnifiedVersionFile {
            filename: file.fileName.clone(),
            url: file.downloadUrl.clone(),
            size: file.fileLength,
            hashes: hashes_map,
            primary: true, // CurseForge doesn't have primary flag, assume single file is primary
            fingerprint: Some(file.fileFingerprint),
        };

        let unified_files = vec![unified_file];

        // Convert release type from CurseForge (1=Release, 2=Beta, 3=Alpha)
        let release_type = match file.releaseType {
            1 => UnifiedVersionType::Release,
            2 => UnifiedVersionType::Beta,
            3 => UnifiedVersionType::Alpha,
            _ => UnifiedVersionType::Release,
        };

        // Extract loaders from gameVersions array (CurseForge puts loaders in gameVersions)
        let loaders: Vec<String> = extract_loaders_from_game_versions(&file.gameVersions);

        let display_name_clone = file.displayName.clone();
        let download_url_clone = file.downloadUrl.clone();

        // Convert CurseForge dependencies to unified dependencies
        // CurseForge relationType: 1=EmbeddedLibrary, 2=OptionalDependency, 3=RequiredDependency, 4=Tool, 5=Incompatible, 6=Include
        let unified_dependencies: Vec<UnifiedDependency> = file.dependencies
            .into_iter()
            .map(|dep| UnifiedDependency {
                project_id: Some(dep.modId.to_string()),
                version_id: None, // CurseForge doesn't specify version IDs in dependencies
                file_name: None, // CurseForge doesn't specify file names in dependencies
                dependency_type: match dep.relationType {
                    1 => UnifiedDependencyType::Embedded, // EmbeddedLibrary
                    2 => UnifiedDependencyType::Optional, // OptionalDependency
                    3 => UnifiedDependencyType::Required, // RequiredDependency
                    4 => UnifiedDependencyType::Optional, // Tool (treated as optional)
                    5 => UnifiedDependencyType::Incompatible, // Incompatible
                    6 => UnifiedDependencyType::Optional, // Include (treated as optional)
                    _ => UnifiedDependencyType::Optional, // Default to optional for unknown types
                },
            })
            .collect();

        UnifiedVersion {
            id: file.id.to_string(),
            project_id: file.modId.to_string(),
            source: ModPlatform::CurseForge,
            name: file.displayName,
            version_number: display_name_clone, // CurseForge uses displayName as version
            changelog: None, // CurseForge doesn't provide changelog
            dependencies: unified_dependencies,
            game_versions: extract_game_versions_from_mixed(&file.gameVersions),
            loaders, // Extracted from gameVersions array
            files: unified_files,
            date_published: file.fileDate,
            downloads: file.downloadCount,
            release_type,
            url: download_url_clone,
        }
    }
}

pub async fn search_mods_unified(
    params: UnifiedModSearchParams,
) -> Result<UnifiedModSearchResponse, crate::error::AppError> {
    let mut all_results = Vec::new();
    let mut total_count = 0u64;

    // Execute search based on source
    match params.source {
        ModPlatform::CurseForge => {
            // Convert unified sort to CurseForge sort parameters
            let (sort_field, sort_order) = if let Some(unified_sort) = params.sort {
                unified_sort.to_curseforge_sort_field_and_order()
            } else {
                // Default fallback
                (Some(curseforge::CurseForgeModSearchSortField::Popularity), Some(curseforge::CurseForgeSortOrder::Desc))
            };

            // Convert mod loaders to CurseForge types
            let curseforge_loaders = if let Some(ref loaders) = params.mod_loaders {
                convert_string_loaders_to_curseforge_types(loaders)
            } else {
                None
            };

            match curseforge::search_mods(
                432, // Minecraft game ID
                Some(params.query.clone()),
                params.project_type.to_curseforge_class_id(), // class_id based on project type
                None, // category_id
                params.game_version.clone(),
                sort_field,
                sort_order,
                curseforge_loaders, // mod_loader_types
                None, // game_version_type_id
                params.offset, // index for pagination
                params.limit, // page_size
            ).await {
                Ok(response) => {
                    log::info!("CurseForge search successful: {} mods", response.data.len());
                    let unified_results: Vec<UnifiedModSearchResult> = response.data
                        .into_iter()
                        .map(|mod_info| mod_info.into())
                        .collect();
                    all_results.extend(unified_results);
                    total_count += response.pagination.totalCount as u64;
                }
                Err(e) => {
                    log::error!("CurseForge search failed: {}", e);
                    return Err(e);
                }
            }
        }
        ModPlatform::Modrinth => {
            // Convert unified sort to Modrinth sort
            let modrinth_sort = if let Some(unified_sort) = params.sort {
                unified_sort.to_modrinth_sort_type()
            } else {
                // Default fallback
                Some(modrinth::ModrinthSortType::Relevance)
            };

            match modrinth::search_projects(
                params.query,
                params.project_type.to_modrinth_project_type(),
                params.game_version,
                params.mod_loaders.as_ref().and_then(|loaders| loaders.first()).cloned(),
                params.limit,
                params.offset,
                modrinth_sort,
                params.categories.as_ref().map(|cats| cats.into_iter().map(|c| c.to_lowercase()).collect()),
                params.client_side_filter,
                params.server_side_filter,
            ).await {
                Ok(response) => {
                    log::info!("Modrinth search successful: {} mods", response.hits.len());
                    let unified_results: Vec<UnifiedModSearchResult> = response.hits
                        .into_iter()
                        .map(|hit| hit.into())
                        .collect();
                    all_results.extend(unified_results);
                    total_count += response.total_hits as u64;
                }
                Err(e) => {
                    log::error!("Modrinth search failed: {}", e);
                    return Err(e);
                }
            }
        }
    };

    let result_count = all_results.len() as u32;

    Ok(UnifiedModSearchResponse {
        results: all_results,
        pagination: UnifiedPagination {
            index: params.offset.unwrap_or(0),
            page_size: params.limit.unwrap_or(20),
            result_count,
            total_count,
        },
    })
}

// Function to get versions/files for a specific mod from unified platforms
pub async fn get_mod_versions_unified(
    params: UnifiedModVersionsParams,
) -> Result<UnifiedVersionResponse, crate::error::AppError> {
    let mut all_versions = Vec::new();
    let mut total_count = 0u64;

    match params.source {
        ModPlatform::Modrinth => {
            // Convert string loaders to Modrinth loaders if needed
            let modrinth_loaders = params.loaders.as_ref().map(|loaders_vec| {
                loaders_vec.into_iter().map(|l| l.to_lowercase()).collect()
            });

            match modrinth::get_mod_versions(
                params.project_id.clone(),
                modrinth_loaders,
                params.game_versions.clone(),
            ).await {
                Ok(versions) => {
                    log::info!("Modrinth versions successful: {} versions", versions.len());
                    total_count += versions.len() as u64;
                    let unified_versions: Vec<UnifiedVersion> = versions
                        .into_iter()
                        .map(|version| version.into())
                        .collect();
                    all_versions.extend(unified_versions);
                }
                Err(e) => {
                    log::error!("Modrinth versions failed: {}", e);
                    return Err(e);
                }
            }
        }
        ModPlatform::CurseForge => {
            // Parse project_id as u32 for CurseForge
            let mod_id = match params.project_id.parse::<u32>() {
                Ok(id) => id,
                Err(_) => {
                    return Err(crate::error::AppError::Other(format!(
                        "Invalid CurseForge project ID: {}", params.project_id
                    )));
                }
            };

            // Convert string loaders to CurseForge loader types
            let curseforge_loader = if let Some(ref loaders_vec) = &params.loaders {
                if loaders_vec.is_empty() {
                    None
                } else {
                    // Try to match the first loader to CurseForge enum
                    match loaders_vec[0].to_lowercase().as_str() {
                        "forge" => Some(curseforge::CurseForgeModLoaderType::Forge),
                        "fabric" => Some(curseforge::CurseForgeModLoaderType::Fabric),
                        "quilt" => Some(curseforge::CurseForgeModLoaderType::Quilt),
                        "neoforge" => Some(curseforge::CurseForgeModLoaderType::NeoForge),
                        "liteloader" => Some(curseforge::CurseForgeModLoaderType::LiteLoader),
                        "cauldron" => Some(curseforge::CurseForgeModLoaderType::Cauldron),
                        _ => None, // Default to Any if no match
                    }
                }
            } else {
                None
            };

            // Use first game version if provided
            let game_version = params.game_versions
                .as_ref()
                .and_then(|versions| versions.first())
                .cloned();

            match curseforge::get_mod_files(
                mod_id,
                game_version,
                curseforge_loader,
                None, // game_version_type_id - not used in unified interface for now
                params.offset,
                params.limit,
            ).await {
                Ok(response) => {
                    log::info!("CurseForge files successful: {} files", response.data.len());
                    let unified_versions: Vec<UnifiedVersion> = response.data
                        .into_iter()
                        .map(|file| file.into())
                        .collect();
                    all_versions.extend(unified_versions);
                    total_count += response.pagination.totalCount as u64;
                }
                Err(e) => {
                    log::error!("CurseForge files failed: {}", e);
                    return Err(e);
                }
            }
        }
    }

    Ok(UnifiedVersionResponse {
        versions: all_versions,
        total_count,
    })
}

/// Get specific modpack version and all available versions
/// This is optimized for modpack management - gets the installed version plus all available versions
pub async fn get_modpack_versions_unified(
    modpack_source: &ModPackSource,
) -> Result<UnifiedModpackVersionsResponse, crate::error::AppError> {
    info!("Getting modpack versions for: {:?}", modpack_source);

    let mut installed_version = None;
    let mut all_versions = Vec::new();
    let mut latest_version = None;

    match modpack_source {
        ModPackSource::Modrinth { project_id, version_id } => {
            // Get all versions for this project first
            let versions_params = UnifiedModVersionsParams {
                source: ModPlatform::Modrinth,
                project_id: project_id.clone(),
                loaders: None,
                game_versions: None,
                limit: None,
                offset: None,
            };

            match get_mod_versions_unified(versions_params).await {
                Ok(response) => {
                    all_versions = response.versions;

                    // Find the installed version
                    installed_version = all_versions.iter()
                        .find(|v| v.id == *version_id)
                        .cloned();

                    // Find latest version (first in list is usually newest for Modrinth)
                    latest_version = all_versions.first().cloned();
                }
                Err(e) => {
                    warn!("Failed to get Modrinth project versions: {}", e);
                    // Try to get just the specific version as fallback
                    match modrinth::get_version_details(version_id.clone()).await {
                        Ok(version) => {
                            let unified_version: UnifiedVersion = version.into();
                            installed_version = Some(unified_version.clone());
                            all_versions = vec![unified_version];
                            latest_version = all_versions.first().cloned();
                        }
                        Err(e2) => {
                            error!("Failed to get specific Modrinth version: {}", e2);
                            return Err(e2);
                        }
                    }
                }
            }
        }

        ModPackSource::CurseForge { project_id, file_id } => {
            // Get all files for this project first
            let versions_params = UnifiedModVersionsParams {
                source: ModPlatform::CurseForge,
                project_id: project_id.to_string(),
                loaders: None,
                game_versions: None,
                limit: None,
                offset: None,
            };

            match get_mod_versions_unified(versions_params).await {
                Ok(response) => {
                    all_versions = response.versions;

                    // Find the installed version
                    installed_version = all_versions.iter()
                        .find(|v| v.id == file_id.to_string())
                        .cloned();

                    // Find latest version (first in list is usually newest for CurseForge)
                    latest_version = all_versions.first().cloned();
                }
                Err(e) => {
                    warn!("Failed to get CurseForge project files: {}", e);
                    // Try to get just the specific file as fallback
                    match curseforge::get_file_details(*project_id, *file_id).await {
                        Ok(file) => {
                            let unified_version: UnifiedVersion = file.into();
                            installed_version = Some(unified_version.clone());
                            all_versions = vec![unified_version];
                            latest_version = all_versions.first().cloned();
                        }
                        Err(e2) => {
                            error!("Failed to get specific CurseForge file: {}", e2);
                            return Err(e2);
                        }
                    }
                }
            }
        }
    }

    // Determine if updates are available
    let updates_available = if let (Some(installed), Some(latest)) = (&installed_version, &latest_version) {
        // Simple comparison based on date (newer date = newer version)
        latest.date_published > installed.date_published
    } else {
        false
    };

    info!(
        "Found {} total versions, installed version: {}, updates available: {}",
        all_versions.len(),
        installed_version.as_ref().map_or("None".to_string(), |v| v.name.clone()),
        updates_available
    );

    Ok(UnifiedModpackVersionsResponse {
        installed_version,
        all_versions,
        updates_available,
        latest_version,
    })
}

/// Extract loader names from CurseForge gameVersions array
pub fn extract_loaders_from_game_versions(game_versions: &[String]) -> Vec<String> {
    game_versions
        .iter()
        .filter_map(|version| {
            let version_lower = version.to_lowercase();
            if version_lower.contains("forge") && !version_lower.contains("neoforge") {
                Some("forge".to_string())
            } else if version_lower.contains("fabric") {
                Some("fabric".to_string())
            } else if version_lower.contains("quilt") {
                Some("quilt".to_string())
            } else if version_lower.contains("neoforge") {
                Some("neoforge".to_string())
            } else if version_lower.contains("liteloader") {
                Some("liteloader".to_string())
            } else if version_lower.contains("cauldron") {
                Some("cauldron".to_string())
            } else {
                None // Not a loader, probably a game version like "1.21"
            }
        })
        .collect()
}

/// Extract actual game versions from mixed game versions array (excluding loaders)
pub fn extract_game_versions_from_mixed(game_versions: &[String]) -> Vec<String> {
    game_versions
        .iter()
        .filter_map(|version| {
            let version_lower = version.to_lowercase();
            // Filter out loaders, keep only actual game versions like "1.21", "1.20.1", etc.
            if version_lower.contains("forge") ||
               version_lower.contains("fabric") ||
               version_lower.contains("quilt") ||
               version_lower.contains("neoforge") ||
               version_lower.contains("liteloader") ||
               version_lower.contains("cauldron") {
                None // This is a loader, exclude it
            } else {
                Some(version.clone()) // This is likely a game version
            }
        })
        .collect()
}

/// Convert string loader names to CurseForge loader types
pub fn convert_string_loaders_to_curseforge_types(
    loaders: &[String],
) -> Option<Vec<curseforge::CurseForgeModLoaderType>> {
    if loaders.is_empty() {
        return None;
    }

    let mut curseforge_loaders = Vec::new();

    for loader in loaders {
        let loader_lower = loader.to_lowercase();
        let curseforge_loader = match loader_lower.as_str() {
            "any" => curseforge::CurseForgeModLoaderType::Any,
            "forge" => curseforge::CurseForgeModLoaderType::Forge,
            "cauldron" => curseforge::CurseForgeModLoaderType::Cauldron,
            "liteloader" => curseforge::CurseForgeModLoaderType::LiteLoader,
            "fabric" => curseforge::CurseForgeModLoaderType::Fabric,
            "quilt" => curseforge::CurseForgeModLoaderType::Quilt,
            "neoforge" => curseforge::CurseForgeModLoaderType::NeoForge,
            _ => {
                log::warn!("Unknown mod loader type: {}", loader);
                continue; // Skip unknown loaders
            }
        };
        curseforge_loaders.push(curseforge_loader);
    }

    if curseforge_loaders.is_empty() {
        None
    } else {
        Some(curseforge_loaders)
    }
}

/// Request structure for checking mod updates
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnifiedUpdateCheckRequest {
    pub hashes: Vec<String>,
    pub algorithm: String,
    pub loaders: Vec<String>,
    pub game_versions: Vec<String>,
    /// Optional: Map of hash to platform (if not provided, defaults to Modrinth)
    pub hash_platforms: Option<std::collections::HashMap<String, ModPlatform>>,
    /// Optional: Map of hash to CurseForge fingerprint for faster update checking
    pub hash_fingerprints: Option<std::collections::HashMap<String, u64>>,
    /// Optional: Map of hash to installed file info for proper update comparison
    pub hash_installed_info: Option<std::collections::HashMap<String, InstalledFileInfo>>,
}

/// Information about installed file for update comparison
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct InstalledFileInfo {
    pub project_id: u32,
    pub file_id: u32,
    pub file_date: String,
}

/// Response structure for update checks
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UnifiedUpdateCheckResponse {
    pub updates: std::collections::HashMap<String, UnifiedVersion>,
}

/// Check for updates across all supported platforms
/// This is the unified entry point for update checking that supports
/// both Modrinth and CurseForge based on the items' platforms
pub async fn check_mod_updates_unified(
    request: UnifiedUpdateCheckRequest,
) -> Result<UnifiedUpdateCheckResponse, crate::error::AppError> {
    info!(
        "Checking for unified mod updates: {} hashes, algorithm: {}",
        request.hashes.len(),
        request.algorithm
    );

    // Group hashes by platform
    let (modrinth_hashes, curseforge_hashes) = group_hashes_by_platform(&request);

    info!(
        "Grouped hashes - Modrinth: {}, CurseForge: {}",
        modrinth_hashes.len(),
        curseforge_hashes.len()
    );

    // Check for updates on each platform concurrently
    let (modrinth_updates, curseforge_updates) = tokio::join!(
        check_modrinth_updates_only(&request, modrinth_hashes),
        check_curseforge_updates_only(&request, curseforge_hashes)
    );

    // Combine results
    let mut all_updates = std::collections::HashMap::new();

    // Handle Modrinth results
    match modrinth_updates {
        Ok(updates) => {
            let update_count = updates.len();
            all_updates.extend(updates);
            info!("Modrinth updates found: {}", update_count);
        }
        Err(e) => {
            error!("Failed to check Modrinth updates: {}", e);
            // Continue with CurseForge results even if Modrinth fails
        }
    }

    // Handle CurseForge results
    match curseforge_updates {
        Ok(updates) => {
            let update_count = updates.len();
            all_updates.extend(updates);
            info!("CurseForge updates found: {}", update_count);
        }
        Err(e) => {
            error!("Failed to check CurseForge updates: {}", e);
            // Continue with Modrinth results even if CurseForge fails
        }
    }

    info!("Total unified updates found: {}", all_updates.len());

    Ok(UnifiedUpdateCheckResponse {
        updates: all_updates,
    })
}

/// Group hashes by their platform based on the request
fn group_hashes_by_platform(request: &UnifiedUpdateCheckRequest) -> (Vec<String>, Vec<String>) {
    let mut modrinth_hashes = Vec::new();
    let mut curseforge_hashes = Vec::new();

    if let Some(hash_platforms) = &request.hash_platforms {
        // Use provided platform mapping
        for hash in &request.hashes {
            match hash_platforms.get(hash) {
                Some(ModPlatform::Modrinth) => modrinth_hashes.push(hash.clone()),
                Some(ModPlatform::CurseForge) => curseforge_hashes.push(hash.clone()),
                None => {
                    // Default to Modrinth if platform not specified
                    warn!("No platform specified for hash {}, defaulting to Modrinth", hash);
                    modrinth_hashes.push(hash.clone());
                }
            }
        }
    } else {
        // No platform mapping provided, assume all are Modrinth
        info!("No platform mapping provided, assuming all hashes are for Modrinth");
        modrinth_hashes = request.hashes.clone();
    }

    (modrinth_hashes, curseforge_hashes)
}

/// Check for Modrinth updates only (internal helper)
async fn check_modrinth_updates_only(
    request: &UnifiedUpdateCheckRequest,
    modrinth_hashes: Vec<String>,
) -> Result<std::collections::HashMap<String, UnifiedVersion>, crate::error::AppError> {
    if modrinth_hashes.is_empty() {
        info!("No Modrinth hashes to check");
        return Ok(std::collections::HashMap::new());
    }

    info!("Checking Modrinth updates for {} hashes", modrinth_hashes.len());

    // Call the existing Modrinth update check function
    let modrinth_request = modrinth::ModrinthBulkUpdateRequestBody {
        hashes: modrinth_hashes,
        algorithm: request.algorithm.clone(),
        loaders: request.loaders.clone(),
        game_versions: request.game_versions.clone(),
    };
    let modrinth_response = modrinth::check_bulk_updates(modrinth_request).await?;
    let total_checked = modrinth_response.len();

    // Convert Modrinth versions to unified format
    let mut unified_updates = std::collections::HashMap::new();

    for (hash, modrinth_version) in modrinth_response {
        let unified_version: UnifiedVersion = modrinth_version.into();
        unified_updates.insert(hash, unified_version);
    }

    info!(
        "Found {} Modrinth updates out of {} checked hashes",
        unified_updates.len(),
        total_checked
    );

    Ok(unified_updates)
}

/// Check for CurseForge updates only (internal helper)
/// TODO: This is a placeholder implementation - will be implemented when CurseForge update checking is ready
async fn check_curseforge_updates_only(
    request: &UnifiedUpdateCheckRequest,
    curseforge_hashes: Vec<String>,
) -> Result<std::collections::HashMap<String, UnifiedVersion>, crate::error::AppError> {
    if curseforge_hashes.is_empty() {
        info!("No CurseForge hashes to check");
        return Ok(std::collections::HashMap::new());
    }

    info!("Checking {} CurseForge hashes for updates", curseforge_hashes.len());

    // Collect fingerprints for CurseForge hashes
    let mut fingerprints = Vec::new();

    if let Some(hash_fingerprints) = &request.hash_fingerprints {
        for hash in &curseforge_hashes {
            if let Some(fingerprint) = hash_fingerprints.get(hash) {
                fingerprints.push(*fingerprint);
            } else {
                warn!("No fingerprint found for CurseForge hash: {}", hash);
            }
        }
    } else {
        warn!("No hash_fingerprints provided for {} CurseForge hashes", curseforge_hashes.len());
    }

    if fingerprints.is_empty() {
        info!("No fingerprints available for CurseForge update check, skipping");
        return Ok(std::collections::HashMap::new());
    }

    info!("Using {} fingerprints for CurseForge update check", fingerprints.len());

    // Use fingerprint-based checking with filtering and installed version comparison
    let update_results = match curseforge::check_mod_updates_bulk(
        fingerprints,
        &request.game_versions,
        &request.loaders,
    ).await {
        Ok(results) => results,
        Err(e) => {
            error!("Failed to check CurseForge updates with fingerprints: {}", e);
            return Err(e);
        }
    };

    // Convert CurseForge update results to unified format
    let mut updates = std::collections::HashMap::new();

    for update_info in update_results {
        // Use original fingerprint as key (matches what the UI expects)
        let update_key = update_info.original_fingerprint.to_string();

        // Convert to UnifiedVersion
        let unified_version = UnifiedVersion {
            id: update_info.file_id.to_string(),
            project_id: update_info.project_id.to_string(),
            name: update_info.file_name.clone(),
            version_number: update_info.file_name.clone(), // Use filename as version number
            changelog: None,
            date_published: update_info.file_date.clone(),
            downloads: 0, // Not available in fingerprint response
            files: vec![UnifiedVersionFile {
                filename: update_info.file_name.clone(),
                url: update_info.download_url.clone(),
                size: update_info.file_size,
                hashes: if let Some(sha1) = update_info.hash_sha1.clone() {
                    let mut hash_map = HashMap::new();
                    hash_map.insert("sha1".to_string(), sha1);
                    hash_map
                } else {
                    HashMap::new()
                },
                primary: true,
                fingerprint: Some(update_info.fingerprint as u64), // Include the fingerprint for update tracking
            }],
            dependencies: update_info.dependencies.into_iter().map(|dep| UnifiedDependency {
                project_id: Some(dep.modId.to_string()),
                version_id: None,
                file_name: None,
                dependency_type: convert_curseforge_dependency_type(dep.relationType),
            }).collect(),
            game_versions: extract_game_versions_from_mixed(&update_info.game_versions),
            loaders: extract_loaders_from_game_versions(&update_info.game_versions),
            source: ModPlatform::CurseForge,
            release_type: if update_info.release_type == 1 { UnifiedVersionType::Release } else { UnifiedVersionType::Beta },
            url: update_info.download_url.clone(),
        };

        updates.insert(update_key, unified_version);
    }

    info!("Found {} CurseForge updates", updates.len());
    Ok(updates)
}

/// Convert CurseForge dependency relation type to unified dependency type
fn convert_curseforge_dependency_type(relation_type: u32) -> UnifiedDependencyType {
    match relation_type {
        1 => UnifiedDependencyType::Embedded, // EmbeddedLibrary -> Embedded
        2 => UnifiedDependencyType::Optional, // OptionalDependency -> Optional
        3 => UnifiedDependencyType::Required, // RequiredDependency -> Required
        4 => UnifiedDependencyType::Optional, // Tool -> Optional (no direct mapping)
        5 => UnifiedDependencyType::Incompatible, // Incompatible -> Incompatible
        6 => UnifiedDependencyType::Required, // Include -> Required (no direct mapping, closest is Required)
        _ => UnifiedDependencyType::Optional, // Default to optional
    }
}

/// Request structure for switching modpack versions
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModpackSwitchRequest {
    /// Download URL for the modpack file
    pub download_url: String,
    /// Source information for the new modpack version
    pub modpack_source: crate::state::profile_state::ModPackSource,
    /// Profile ID to update with the new modpack information
    pub profile_id: Uuid,
}

/// Response structure for modpack version switching
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModpackSwitchResponse {
    /// The Minecraft version extracted from the modpack
    pub minecraft_version: String,
    /// The mod loader type (if any)
    pub loader: Option<crate::state::profile_state::ModLoader>,
    /// The loader version (if any)
    pub loader_version: Option<String>,
    /// List of mods extracted from the modpack
    pub mods: Vec<crate::state::profile_state::Mod>,
}

/// Extract modpack information using the common trait interface
/// Returns the extracted information or an error if required fields are missing
async fn extract_modpack_info<T: ModpackManifest>(manifest: &T, pack_name: &str) -> Result<(String, Option<crate::state::profile_state::ModLoader>, Option<String>, Vec<crate::state::profile_state::Mod>), crate::error::AppError> {
    let mc_version = manifest.get_minecraft_version()
        .ok_or_else(|| {
            error!("Modpack '{}' is missing Minecraft version", pack_name);
            crate::error::AppError::Other(format!("Modpack '{}' is missing Minecraft version", pack_name))
        })?;

    let loader = manifest.get_loader();
    let loader_version = manifest.get_loader_version();
    let mods = manifest.get_mods_structs().await.map_err(|e| {
        error!("Failed to extract mods from modpack '{}': {}", pack_name, e);
        crate::error::AppError::Other(format!("Failed to extract mods from modpack '{}': {}", pack_name, e))
    })?;

    info!("Modpack '{}' info - MC: {}, Loader: {:?}, Loader Version: {:?}, Mods: {}",
          pack_name, mc_version, loader, loader_version, mods.len());

    Ok((mc_version, loader, loader_version, mods))
}

/// Switch to a different version of a modpack
/// Downloads and installs the new version while preserving profile settings
pub async fn switch_modpack_version(request: ModpackSwitchRequest) -> Result<ModpackSwitchResponse, crate::error::AppError> {
    info!("Switching modpack version - URL: {}, ModPackSource: {:?}", request.download_url, request.modpack_source);

    // Create a temporary directory for the download
    let temp_dir = tempfile::tempdir().map_err(|e| {
        error!("Failed to create temporary directory: {}", e);
        crate::error::AppError::Other(format!("Failed to create temporary directory: {}", e))
    })?;

    let temp_file_path = temp_dir.path().join("modpack_download.zip");

    // Download the modpack file using the existing download utilities
    info!("Downloading modpack from: {}", request.download_url);

    let download_config = crate::utils::download_utils::DownloadConfig::default()
        .with_force_overwrite(true) // Always download fresh version
        .with_disk_space_check(true); // Check disk space before download

    crate::utils::download_utils::DownloadUtils::download_file(
                &request.download_url,
        &temp_file_path,
        download_config,
    ).await.map_err(|e| {
        error!("Failed to download modpack: {}", e);
        e
    })?;

    info!("Successfully downloaded modpack to: {:?}", temp_file_path);

    // Get the global state to access ProfileManager
    let state = State::get().await?;
    let profile_manager = &state.profile_manager;

    // Load the current profile
    let mut profile = profile_manager.get_profile(request.profile_id).await?;
    info!("Loaded profile '{}' for modpack switching", profile.name);

    // Extract platform from modpack_source and process accordingly
    let (minecraft_version, loader, loader_version, mods, curseforge_manifest) = match &request.modpack_source {
        crate::state::profile_state::ModPackSource::Modrinth { .. } => {
            info!("Processing as Modrinth modpack");
            let (_profile, manifest) = crate::integrations::mrpack::process_mrpack(temp_file_path.clone()).await
                .map_err(|e| {
                    error!("Failed to process Modrinth modpack: {}", e);
                    e
                })?;
            let (mc, ldr, ldr_ver, mods) = extract_modpack_info(&manifest, &manifest.name).await?;
            (mc, ldr, ldr_ver, mods, None)
        }
        crate::state::profile_state::ModPackSource::CurseForge { .. } => {
            info!("Processing as CurseForge modpack");
            let (_profile, manifest) = crate::integrations::curseforge::process_curseforge_pack_from_zip(&temp_file_path).await
                .map_err(|e| {
                    error!("Failed to process CurseForge modpack: {}", e);
                    e
                })?;
            let (mc, ldr, ldr_ver, mods) = extract_modpack_info(&manifest, &manifest.name).await?;
            (mc, ldr, ldr_ver, mods, Some(manifest))
        }
    };

    // Update the profile with the extracted information
    info!("Updating profile with extracted modpack information");
    profile.game_version = minecraft_version.clone();

    if let Some(new_loader) = loader {
        profile.loader = new_loader;
    }

    if let Some(new_loader_version) = loader_version.clone() {
        profile.loader_version = Some(new_loader_version);
    }

    // Remove existing modpack mods and add new ones, preserving user-added mods
    let mut updated_mods = Vec::new();

    // Keep mods that are NOT from a modpack (user-added mods)
    for existing_mod in &profile.mods {
        if existing_mod.modpack_origin.is_none() {
            info!("Keeping user-added mod: {}", existing_mod.display_name.as_deref().unwrap_or(&existing_mod.id.to_string()));
            updated_mods.push(existing_mod.clone());
        } else {
            info!("Removing old modpack mod: {}", existing_mod.display_name.as_deref().unwrap_or(&existing_mod.id.to_string()));
        }
    }

    // Add new modpack mods
    for new_mod in &mods {
        updated_mods.push(new_mod.clone());
    }

    profile.mods = updated_mods;
    info!("Updated profile mods list: kept {} user mods, added {} modpack mods",
          profile.mods.iter().filter(|m| m.modpack_origin.is_none()).count(),
          mods.len());

    // Update the modpack_info with the new source information
    let new_modpack_info = crate::state::profile_state::ModPackInfo {
        source: request.modpack_source.clone(),
        file_hash: None, // Could be calculated if needed
    };
    profile.modpack_info = Some(new_modpack_info);
    info!("Updated profile modpack_info with new source: {:?}", request.modpack_source);

    // Extract overrides (config files, resource packs, etc.) from the modpack
    info!("Extracting overrides from modpack to profile...");
    match &request.modpack_source {
        crate::state::profile_state::ModPackSource::Modrinth { .. } => {
            crate::integrations::mrpack::extract_mrpack_overrides(&temp_file_path, &profile, None, 0.0, 1.0).await?;
            info!("Successfully extracted Modrinth modpack overrides");
        }
        crate::state::profile_state::ModPackSource::CurseForge { .. } => {
            if let Some(manifest) = curseforge_manifest {
                crate::integrations::curseforge::extract_curseforge_overrides(&temp_file_path, &profile, &manifest, None, 0.0, 1.0).await?;
                info!("Successfully extracted CurseForge modpack overrides");
            } else {
                warn!("CurseForge manifest not available for override extraction");
            }
        }
    }

    // Save the updated profile
    profile_manager.update_profile(request.profile_id, profile).await?;
    info!("Successfully updated profile {} with new modpack version information", request.profile_id);

    // Clean up temporary directory
    drop(temp_dir);

    info!("Modpack version switch completed successfully - MC: {}, Loader: {:?}, Loader Version: {:?}, Mods: {}",
          minecraft_version, loader, loader_version, mods.len());

    Ok(ModpackSwitchResponse {
        minecraft_version,
        loader,
        loader_version,
        mods,
    })
}

