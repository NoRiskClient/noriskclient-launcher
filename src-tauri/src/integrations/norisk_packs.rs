use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::state::profile_state::{Profile, ProfileState};
use crate::state::state_manager::State;
use async_zip::tokio::read::seek::ZipFileReader;
use chrono::Utc;
use futures::future::try_join_all;
use log::{debug, error, info, warn};
use sanitize_filename::sanitize;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::HashSet;
use std::env;
use std::path::PathBuf;
use tauri::Manager; // Required for app_handle.get_window() and window.emit()
use tokio::fs;
use tokio::fs::File;
use tokio::io::{AsyncWriteExt, BufReader};
use tokio_util::compat::FuturesAsyncReadCompatExt;
use url;
use uuid::Uuid; // Added for env! macro // Added for URL parsing

/// Represents the overall structure of the norisk_modpacks.json file.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NoriskModpacksConfig {
    /// A map where the key is the pack ID (e.g., "norisk-prod") and the value is the pack definition.
    pub packs: HashMap<String, NoriskPackDefinition>,
    /// A map defining Maven repositories used by mods with source type "maven".
    /// Key is a reference name (e.g., "noriskproduction"), value is the repository URL.
    #[serde(default)] // Allow missing repositories section if no maven mods are used
    pub repositories: HashMap<String, String>,
}

impl Default for NoriskModpacksConfig {
    fn default() -> Self {
        Self {
            packs: HashMap::new(),
            repositories: HashMap::new(),
        }
    }
}

/// Defines a single Norisk modpack variant (e.g., production, development).
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NoriskPackDefinition {
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    /// Optional: List of pack IDs this pack inherits mods from. Processed in order.
    #[serde(rename = "inheritsFrom", default)]
    pub inherits_from: Option<Vec<String>>,
    /// Optional: List of mod IDs to exclude after inheritance and local mods are combined.
    #[serde(rename = "excludeMods", default)]
    pub exclude_mods: Option<Vec<String>>,
    /// Optional: List of mods specifically defined for this pack. These override inherited mods.
    #[serde(default)]
    pub mods: Vec<NoriskModEntryDefinition>,
    /// Optional: List of asset IDs to download for this pack.
    #[serde(rename = "assets", default)]
    pub assets: Vec<String>,
    /// Optional: Whether this pack is experimental.
    #[serde(rename = "isExperimental", default)]
    pub is_experimental: bool,
    /// Optional: Policy controlling loader version per MC version/loader.
    #[serde(rename = "loaderPolicy", default)]
    pub loader_policy: Option<LoaderPolicy>,
}

/// Defines a single mod entry within a Norisk pack definition.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NoriskModEntryDefinition {
    /// Unique internal identifier for the mod (e.g., "sodium"). Should be consistent across packs.
    pub id: String,
    /// Optional display name for the UI.
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    /// Defines the general source type and information needed to locate the mod.
    pub source: NoriskModSourceDefinition,
    /// Defines which specific version of the mod to use based on Minecraft version and loader.
    /// The value format depends on the `source.type`.
    pub compatibility: CompatibilityMap,
}

/// Defines the general source of a Norisk mod.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum NoriskModSourceDefinition {
    Modrinth {
        /// The stable, unique, often alphanumeric Modrinth project ID (e.g., "AANobbMI"). Used for API calls and matching.
        #[serde(rename = "projectId")]
        project_id: String,
        /// The user-friendly slug used in URLs and Maven artifact IDs (e.g., "sodium").
        #[serde(rename = "projectSlug")]
        project_slug: String,
    },
    Maven {
        /// Key referencing the URL in the top-level `repositories` map.
        #[serde(rename = "repositoryRef")]
        repository_ref: String,
        /// Optional: Can be specified if consistent across versions.
        #[serde(rename = "groupId")]
        group_id: String,
        /// Optional: Can be specified if consistent across versions.
        #[serde(rename = "artifactId")]
        artifact_id: String,
    },
    Url, // No additional data needed, URL comes from compatibility map.
}

/// Struct to hold compatibility target details
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CompatibilityTarget {
    /// The identifier used to locate the specific version (e.g., URL, Maven version, Modrinth version ID).
    pub identifier: String,
    /// The desired filename for the mod in the cache and mods folder (optional).
    pub filename: Option<String>,
}

/// Type alias for the compatibility map: McVersion -> Loader -> CompatibilityTarget
/// Example: {"1.8.9": {"vanilla": {"identifier": "URL", "filename": "OptiFine...jar"}}}
pub type CompatibilityMap = HashMap<String, HashMap<String, CompatibilityTarget>>;

/// Policy to control which mod loader version to use for a given Minecraft version and loader.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct LoaderPolicy {
    /// Fallback definitions applied when no byMinecraft entry matches
    #[serde(default)]
    pub default: HashMap<String, LoaderSpec>,
    /// Specific definitions per Minecraft version pattern (e.g., "1.20.1", "1.21", "1.21.*")
    #[serde(rename = "byMinecraft", default)]
    pub by_minecraft: HashMap<String, HashMap<String, LoaderSpec>>, // mcVersionPattern -> loader -> spec
}

/// How to pick a loader version given constraints.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LoaderStrategy {
    Exact,
    Latest_compatible,
    Min_compatible,
}

/// Definition of a desired/allowed loader version.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct LoaderSpec {
    /// Exact version to use (implies strategy = exact when set)
    pub version: Option<String>,
    /// Minimum version allowed/required (used by non-exact strategies)
    pub min: Option<String>,
    /// Selection strategy; defaults to latest_compatible if not provided and version is None
    #[serde(default)]
    pub strategy: Option<LoaderStrategy>,
}

/// Helper function to determine the definitive filename for a mod defined within a Norisk Pack.
/// Prioritizes the filename specified in the compatibility target, otherwise derives it for known types.
/// Returns an error if the filename cannot be determined (e.g., missing in target for URL mods).
pub fn get_norisk_pack_mod_filename(
    source: &NoriskModSourceDefinition,
    target: &CompatibilityTarget,
    mod_id_for_log: &str, // For better error messages
) -> crate::error::Result<String> {
    // Use crate::error::Result
    match target.filename {
        Some(ref fname) => Ok(fname.clone()),
        None => {
            // Derive filename if not provided
            match source {
                NoriskModSourceDefinition::Modrinth { project_slug, .. } => {
                    Ok(format!("{}-{}.jar", project_slug, target.identifier))
                }
                NoriskModSourceDefinition::Maven { artifact_id, .. } => {
                    Ok(format!("{}-{}.jar", artifact_id, target.identifier))
                }
                NoriskModSourceDefinition::Url { .. } => {
                    // Require filename for URL mods in pack definition
                    Err(crate::error::AppError::Other(format!(
                        "Filename missing in pack definition compatibility target for URL mod '{}'",
                        mod_id_for_log
                    )))
                } // Add handling for other source types if they are added later
            }
        }
    }
}

/// Imports a profile from a .noriskpack file.
/// This function reads profile.json, creates a new profile, and extracts overrides concurrently.
pub async fn import_noriskpack_as_profile(pack_path: PathBuf) -> Result<Uuid> {
    info!("Starting import process for noriskpack: {:?}", pack_path);

    // 1. Open the file and create a reader for profile.json initially
    let profile_json_file = File::open(&pack_path).await.map_err(|e| {
        error!(
            "Failed to open noriskpack file for profile.json {:?}: {}",
            pack_path, e
        );
        AppError::Io(e)
    })?;
    let mut profile_json_buf_reader = BufReader::new(profile_json_file);

    // 2. Create zip reader for profile.json
    let mut zip_for_profile_json = ZipFileReader::with_tokio(&mut profile_json_buf_reader)
        .await
        .map_err(|e| {
            error!("Failed to read noriskpack as ZIP for profile.json: {}", e);
            AppError::Other(format!(
                "Failed to read noriskpack zip for profile.json: {}",
                e
            ))
        })?;

    // 3. Find and read profile.json
    let entries_for_profile = zip_for_profile_json.file().entries();
    let profile_entry_index = entries_for_profile
        .iter()
        .position(|e| {
            e.filename()
                .as_str()
                .map_or(false, |name| name == "profile.json")
        })
        .ok_or_else(|| {
            error!("profile.json not found in archive: {:?}", pack_path);
            AppError::Other("profile.json not found in archive".into())
        })?;

    let profile_content = {
        let mut entry_reader = zip_for_profile_json
            .reader_with_entry(profile_entry_index)
            .await
            .map_err(|e| {
                error!("Failed to get entry reader for profile.json: {}", e);
                AppError::Other(format!("Failed to read profile.json entry: {}", e))
            })?;

        let mut buffer = Vec::new();
        entry_reader
            .read_to_end_checked(&mut buffer)
            .await
            .map_err(|e| {
                error!("Failed to read profile.json content: {}", e);
                AppError::Other(format!("Zip entry read error: {}", e))
            })?;

        String::from_utf8(buffer).map_err(|e| {
            error!("Failed to convert profile.json to string: {}", e);
            AppError::Other(format!("profile.json content is not valid UTF-8: {}", e))
        })?
    };
    // Drop the first zip reader and file handle for profile.json as we are done with it.
    drop(zip_for_profile_json);
    drop(profile_json_buf_reader);

    // 4. Parse the profile.json
    let mut exported_profile: Profile = serde_json::from_str(&profile_content).map_err(|e| {
        error!("Failed to parse profile.json: {}", e);
        AppError::Json(e)
    })?;

    // 5. Use the filename as the profile name if available
    if let Some(file_name) = pack_path.file_stem().and_then(|s| s.to_str()) {
        info!("Using noriskpack filename as profile name: {}", file_name);
        exported_profile.name = file_name.to_string();
    }

    info!(
        "Parsed profile data: Name='{}', Game Version={}, Loader={:?}",
        exported_profile.name, exported_profile.game_version, exported_profile.loader
    );

    // 6. Create a new profile with a unique path
    let base_profiles_dir = crate::state::profile_state::default_profile_path();
    let sanitized_base_name = sanitize(&exported_profile.name);
    let final_profile_name = if sanitized_base_name.is_empty() {
        let default_name = format!("imported-noriskpack-{}", Utc::now().timestamp_millis());
        warn!(
            "Profile name '{}' became empty after sanitization. Using default: {}",
            exported_profile.name, default_name
        );
        default_name
    } else {
        sanitized_base_name.to_string()
    };
    exported_profile.name = final_profile_name.clone(); // Ensure profile name is also sanitized or defaulted

    let unique_segment = crate::utils::path_utils::find_unique_profile_segment(
        &base_profiles_dir,
        &final_profile_name, // Use the potentially defaulted and sanitized name
    )
    .await?;

    exported_profile.path = unique_segment;
    exported_profile.id = Uuid::new_v4();
    exported_profile.created = Utc::now();
    exported_profile.last_played = None;
    exported_profile.state = ProfileState::NotInstalled;

    info!("Prepared new profile with path: {}", exported_profile.path);

    // 7. Ensure the target profile directory exists (can be done once before spawning tasks)
    let target_dir = base_profiles_dir.join(&exported_profile.path);
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).await.map_err(|e| {
            error!(
                "Failed to create target profile directory {:?}: {}",
                target_dir, e
            );
            AppError::Io(e)
        })?;
    }

    // 8. Extract the overrides directory concurrently using streaming
    info!(
        "Extracting overrides to profile directory: {:?} using concurrent streaming...",
        target_dir
    );

    let state = State::get().await?;
    let io_semaphore = state.io_semaphore.clone();

    // Open the zip file again for listing entries for override extraction
    let overrides_file_for_listing = File::open(&pack_path).await.map_err(|e| {
        error!(
            "Failed to open noriskpack file for overrides listing {:?}: {}",
            pack_path, e
        );
        AppError::Io(e)
    })?;
    let mut overrides_buf_reader = BufReader::new(overrides_file_for_listing);
    let mut zip_lister_for_overrides = ZipFileReader::with_tokio(&mut overrides_buf_reader)
        .await
        .map_err(|e| {
        error!(
            "Failed to read noriskpack as ZIP for overrides listing: {}",
            e
        );
        AppError::Other(format!(
            "Failed to read noriskpack zip for overrides: {}",
            e
        ))
    })?;

    let num_entries = zip_lister_for_overrides.file().entries().len();
    info!(
        "Found {} entries in noriskpack. Preparing concurrent streaming for overrides...",
        num_entries
    );

    let mut extraction_tasks = Vec::new();

    for index in 0..num_entries {
        let entry_filename_str;
        let is_entry_dir;
        let entry_uncompressed_size;
        {
            let entry = match zip_lister_for_overrides.file().entries().get(index) {
                Some(e) => e,
                None => {
                    error!(
                        "Failed to get zip entry metadata for index {} during overrides listing",
                        index
                    );
                    continue;
                }
            };
            entry_filename_str = match entry.filename().as_str() {
                Ok(s) => s.to_string(),
                Err(_) => {
                    error!(
                        "Non UTF-8 filename at index {} during overrides listing",
                        index
                    );
                    continue;
                }
            };
            is_entry_dir = entry.dir().unwrap_or_else(|_err| {
                warn!("Overrides: Failed to determine if '{}' is a directory, falling back to path check.", entry_filename_str);
                entry_filename_str.ends_with('/')
            });
            entry_uncompressed_size = entry.uncompressed_size();
        }

        // Only process the "overrides/" directory for .noriskpack files
        if entry_filename_str.starts_with("overrides/") {
            let path_after_strip_str = match entry_filename_str.strip_prefix("overrides/") {
                Some(p_str) if !p_str.is_empty() => p_str,
                _ => continue, // Skip if path after prefix is empty (e.g. just "overrides/")
            };

            // Sanitize each component of the path to prevent directory traversal and invalid names
            let sanitized_relative_path_buf = PathBuf::from(path_after_strip_str)
                .components()
                .filter_map(|comp| match comp {
                    std::path::Component::Normal(os_str) => {
                        let sanitized_comp = sanitize_filename::sanitize(os_str.to_string_lossy().as_ref());
                        if sanitized_comp.is_empty() {
                            None
                        } else {
                            Some(sanitized_comp)
                        }
                    }
                    std::path::Component::ParentDir => {
                        warn!("Parent directory component '..' found and removed in noriskpack override path: {}", path_after_strip_str);
                        None 
                    }
                    std::path::Component::CurDir => None,
                    std::path::Component::RootDir => None,
                    std::path::Component::Prefix(_) => None,
                })
                .collect::<PathBuf>();

            // If sanitization results in an empty path (e.g., path was only ".." or similar), skip it.
            if sanitized_relative_path_buf.as_os_str().is_empty() {
                warn!(
                    "Skipping empty sanitized relative path for noriskpack override entry: {} (original relative: {})",
                    entry_filename_str, path_after_strip_str
                );
                continue;
            }

            let final_dest_path = target_dir.join(sanitized_relative_path_buf);

            let task_pack_path = pack_path.clone(); // PathBuf is cheap to clone
            let task_io_semaphore = io_semaphore.clone();
            let task_final_dest_path = final_dest_path.clone();
            let original_entry_index = index;

            if is_entry_dir {
                extraction_tasks.push(tokio::spawn(async move {
                    let _permit = task_io_semaphore.acquire().await.map_err(|e| {
                        error!(
                            "Overrides Task: Failed to acquire semaphore for dir {}: {}",
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
                            "Overrides Task: Creating directory: {:?}",
                            task_final_dest_path
                        );
                        fs::create_dir_all(&task_final_dest_path)
                            .await
                            .map_err(|e| {
                                error!(
                                    "Overrides Task: Failed to create directory {:?}: {}",
                                    task_final_dest_path, e
                                );
                                AppError::Io(e)
                            })?;
                    }
                    Ok::<(), AppError>(())
                }));
            } else {
                info!(
                    "Overrides Task: Queueing concurrent streaming for '{}' -> {:?} (Size: {} bytes)",
                    entry_filename_str, task_final_dest_path, entry_uncompressed_size
                );
                extraction_tasks.push(tokio::spawn(async move {
                    let _permit = task_io_semaphore.acquire().await.map_err(|e| {
                        error!(
                            "Overrides Task: Failed to acquire semaphore for '{}': {}",
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
                                    "Overrides Task: Failed to create parent for '{}': {}",
                                    task_final_dest_path.display(),
                                    e
                                );
                                AppError::Io(e)
                            })?;
                        }
                    }

                    let task_file = File::open(&task_pack_path).await.map_err(|e| {
                        error!(
                            "Overrides Task: Failed to open pack file {:?}: {}",
                            task_pack_path, e
                        );
                        AppError::Io(e)
                    })?;
                    let mut task_buf_reader = BufReader::new(task_file);
                    let mut task_zip_reader = ZipFileReader::with_tokio(&mut task_buf_reader)
                        .await
                        .map_err(|e| {
                            error!(
                                "Overrides Task: Failed to read pack as ZIP for '{}': {}",
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
                            "Overrides Task: Failed to get entry reader for '{}' (index {}): {}",
                            task_final_dest_path.display(), original_entry_index, e
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
                                "Overrides Task: Failed to create dest file {:?}: {}",
                                task_final_dest_path, e
                            );
                            AppError::Io(e)
                        })?;

                    let bytes_copied = tokio::io::copy(&mut entry_reader_tokio, &mut file_writer)
                        .await
                        .map_err(|e| {
                            error!(
                                "Overrides Task: Failed to stream for '{}' to {:?}: {}",
                                task_final_dest_path.display(),
                                task_final_dest_path,
                                e
                            );
                            AppError::Io(e)
                        })?;

                    debug!(
                        "Overrides Task: Streamed {} bytes for: {}",
                        bytes_copied,
                        task_final_dest_path.display()
                    );
                    Ok::<(), AppError>(())
                }));
            }
        }
    }
    // Drop the zip lister and its file handle as we are done with it before awaiting tasks.
    drop(zip_lister_for_overrides);
    drop(overrides_buf_reader);

    // Wait for all extraction tasks to complete
    if !extraction_tasks.is_empty() {
        info!(
            "Waiting for {} override extraction tasks to complete...",
            extraction_tasks.len()
        );
        let results = try_join_all(extraction_tasks).await.map_err(|e| {
            error!(
                "Error joining override extraction tasks for noriskpack: {}",
                e
            );
            AppError::Other(format!(
                "Noriskpack override extraction tasks panicked: {}",
                e
            ))
        })?;

        for result in results {
            result?;
        }
        info!("Successfully extracted all queued overrides for noriskpack.");
    } else {
        info!("No override files found or queued for extraction in noriskpack.");
    }

    // 9. Save the profile using ProfileManager
    // let state_for_save = State::get().await?; // Already have state from above
    let profile_id = state
        .profile_manager
        .create_profile(exported_profile)
        .await?;
    info!(
        "Successfully created and saved profile with ID: {}",
        profile_id
    );

    Ok(profile_id)
}

/// Handles the opening of a .noriskpack file, either on app startup or second instance.
/// It will call the `import_profile` command if a valid file path is found in the arguments.
pub async fn handle_noriskpack_file_paths<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    args: Vec<String>, // Changed from Vec<PathBuf>
) {
    let mut noriskpack_to_import: Option<PathBuf> = None;

    // Iterate over string arguments. Skip the first one if these are direct command line args.
    // For single-instance plugin, all args might be relevant, but filtering by extension handles it.
    let args_to_check = if args.len() > 1 && PathBuf::from(&args[0]).is_file() {
        args.iter().skip(1) // Likely std::env::args(), skip executable path
    } else {
        args.iter().skip(0) // Potentially from single-instance, check all
    };

    for arg_str in args_to_check {
        // Attempt to parse as URL first for file:// scheme, then as direct path
        let path_candidate = if let Ok(url) = url::Url::parse(arg_str) {
            if url.scheme() == "file" {
                url.to_file_path().ok()
            } else {
                info!("Skipping non-file URL argument: {}", arg_str);
                None // Skip other URL schemes
            }
        } else {
            // If not a valid URL, treat as a potential file path
            Some(PathBuf::from(arg_str))
        };

        if let Some(path) = path_candidate {
            if path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("noriskpack")
            {
                info!("Found .noriskpack file to process: {}", path.display());
                noriskpack_to_import = Some(path);
                break; // Handle the first .noriskpack file found
            }
        }
    }

    if let Some(file_path_to_import) = noriskpack_to_import {
        if let Some(file_path_str) = file_path_to_import.to_str() {
            info!("Attempting to import profile from path: {}", file_path_str);
            let import_app_handle = app_handle.clone();
            let path_string_for_task = file_path_str.to_string();

            // Spawn an async task to handle the import
            tauri::async_runtime::spawn(async move {
                match crate::commands::profile_command::import_profile(path_string_for_task).await {
                    Ok(profile_id) => {
                        info!("Profile {} imported successfully.", profile_id);
                        // Attempt to bring the main window to the front and focus it.
                        if let Some(window) = import_app_handle.get_webview_window("main") {
                            if let Err(e) = window.unminimize() {
                                warn!("Failed to unminimize window: {:?}", e);
                            }
                            if let Err(e) = window.set_focus() {
                                warn!("Failed to focus window: {:?}", e);
                            }
                            // The import_profile command should already emit an event for UI update.
                        } else {
                            warn!("Could not get main window handle to unminimize/focus.");
                        }
                    }
                    Err(e) => {
                        error!(
                            "Error importing profile from path ({}): {:?}",
                            file_path_to_import.display(),
                            e // Use {:?} for CommandError
                        );
                        // Optionally, send an event to the frontend to show an error toast/dialog
                        if let Some(window) = import_app_handle.get_webview_window("main") {
                            let error_message = format!(
                                "Failed to import noriskpack ({}): {:?}",
                                file_path_to_import.display(),
                                e
                            );
                            /*if let Err(emit_err) = window.emit("show-error-toast", error_message) {
                                warn!("Failed to emit show-error-toast event: {:?}", emit_err);
                            }*/
                        } else {
                            warn!(
                                "Could not get main window to emit error toast for import failure."
                            );
                        }
                    }
                }
            });
        } else {
            error!(
                "Failed to convert .noriskpack path to string: {}",
                file_path_to_import.display()
            );
        }
    } else {
        info!("No .noriskpack file found in the provided paths.");
    }
}

impl NoriskModpacksConfig {
    pub fn resolve_pack_mods(
        &self,
        pack_id: &str,
        visited: &mut HashSet<String>, // To detect circular inheritance
    ) -> Result<Vec<NoriskModEntryDefinition>> {
        // --- 1. Circular Dependency Check ---
        if !visited.insert(pack_id.to_string()) {
            error!(
                "Circular inheritance detected involving pack ID: {}",
                pack_id
            );
            return Err(AppError::Other(format!(
                "Circular inheritance detected involving pack ID: {}",
                pack_id
            )));
        }

        // --- 2. Get Base Definition ---
        let base_definition = self.packs.get(pack_id).ok_or_else(|| {
            error!("Pack ID '{}' not found in configuration.", pack_id);
            AppError::Other(format!("Pack ID '{}' not found", pack_id))
        })?;

        // --- 3. Initialize Mod Map ---
        // Use HashMap to handle overrides easily (Mod ID -> Mod Definition)
        let mut resolved_mods: HashMap<String, NoriskModEntryDefinition> = HashMap::new();

        // --- 4. Handle Inheritance ---
        if let Some(parent_ids) = &base_definition.inherits_from {
            for parent_id in parent_ids {
                debug!("Pack '{}': Inheriting from parent '{}'", pack_id, parent_id);
                // Recursively resolve parent mods
                let parent_mods = self.resolve_pack_mods(parent_id, visited)?;
                // Merge parent mods into the map. Later parents override earlier ones.
                for mod_entry in parent_mods {
                    resolved_mods.insert(mod_entry.id.clone(), mod_entry);
                }
            }
        }

        // --- 5. Handle Local Mods ---
        // Local mods defined directly in the pack override any inherited mods.
        if let local_mods = &base_definition.mods {
            debug!(
                "Pack '{}': Processing {} local mods",
                pack_id,
                local_mods.len()
            );
            for mod_entry in local_mods {
                resolved_mods.insert(mod_entry.id.clone(), mod_entry.clone());
            }
        }

        // --- 6. Handle Exclusions ---
        // Exclusions are applied *after* inheritance and local overrides.
        if let Some(excluded_mod_ids) = &base_definition.exclude_mods {
            debug!(
                "Pack '{}': Applying {} exclusions",
                pack_id,
                excluded_mod_ids.len()
            );
            for mod_id_to_exclude in excluded_mod_ids {
                if resolved_mods.remove(mod_id_to_exclude).is_some() {
                    debug!("Pack '{}': Excluded mod '{}'", pack_id, mod_id_to_exclude);
                } else {
                    warn!("Pack '{}': Exclusion requested for mod '{}', but it was not found in the resolved list.", pack_id, mod_id_to_exclude);
                }
            }
        }

        // --- 7. Finalize ---
        // Remove the current pack from the visited set for the current resolution path
        visited.remove(pack_id);

        // Convert the HashMap values back to a Vec
        let final_mod_list: Vec<NoriskModEntryDefinition> = resolved_mods.into_values().collect();

        debug!(
            "Pack '{}': Resolved to {} final mods.",
            pack_id,
            final_mod_list.len()
        );
        Ok(final_mod_list)
    }

    // Helper: merge incoming loader policy into accumulator (child overrides parent)
    fn merge_loader_policy(acc: &mut LoaderPolicy, incoming: &LoaderPolicy) {
        // Merge default loader specs
        for (loader, spec) in &incoming.default {
            acc.default.insert(loader.clone(), spec.clone());
        }
        // Merge byMinecraft -> loader -> spec
        for (mc_pattern, loader_map) in &incoming.by_minecraft {
            let entry = acc
                .by_minecraft
                .entry(mc_pattern.clone())
                .or_insert_with(HashMap::new);
            for (loader, spec) in loader_map {
                entry.insert(loader.clone(), spec.clone());
            }
        }
    }

    // Resolve loader policy across inheritance (parents first, child overrides)
    fn resolve_loader_policy_for_pack(
        &self,
        pack_id: &str,
        visited: &mut HashSet<String>,
    ) -> Result<Option<LoaderPolicy>> {
        if !visited.insert(pack_id.to_string()) {
            return Err(AppError::Other(format!(
                "Circular inheritance detected while resolving loader policy for pack ID: {}",
                pack_id
            )));
        }

        let base_definition = self.packs.get(pack_id).ok_or_else(|| {
            AppError::Other(format!("Pack ID '{}' not found", pack_id))
        })?;

        let mut merged: Option<LoaderPolicy> = None;

        if let Some(parent_ids) = &base_definition.inherits_from {
            for parent_id in parent_ids {
                if let Some(parent_policy) =
                    self.resolve_loader_policy_for_pack(parent_id, visited)?
                {
                    if let Some(acc) = &mut merged {
                        Self::merge_loader_policy(acc, &parent_policy);
                    } else {
                        merged = Some(parent_policy.clone());
                    }
                }
            }
        }

        if let Some(own) = &base_definition.loader_policy {
            if let Some(acc) = &mut merged {
                Self::merge_loader_policy(acc, own);
            } else {
                merged = Some(own.clone());
            }
        }

        visited.remove(pack_id);
        Ok(merged)
    }

    // Helper function to get a fully resolved pack definition (including mods)
    // This combines the base definition with the resolved mods.
    pub fn get_resolved_pack_definition(&self, pack_id: &str) -> Result<NoriskPackDefinition> {
        let base_definition = self.packs.get(pack_id).ok_or_else(|| {
            error!("Pack ID '{}' not found in configuration.", pack_id);
            AppError::Other(format!("Pack ID '{}' not found", pack_id))
        })?;

        let mut visited = HashSet::new();
        let resolved_mods_vec = self.resolve_pack_mods(pack_id, &mut visited)?;

        let mut visited_lp = HashSet::new();
        let resolved_loader_policy =
            self.resolve_loader_policy_for_pack(pack_id, &mut visited_lp)?;

        Ok(NoriskPackDefinition {
            display_name: base_definition.display_name.clone(),
            description: base_definition.description.clone(),
            inherits_from: base_definition.inherits_from.clone(), // Keep original inheritance info
            exclude_mods: base_definition.exclude_mods.clone(),   // Keep original exclusion info
            mods: resolved_mods_vec, // Use the fully resolved list here
            assets: base_definition.assets.clone(), // Added missing field
            is_experimental: base_definition.is_experimental, // Added missing field
            loader_policy: resolved_loader_policy, // RESOLVED loader policy
        })
    }

    /// Prints the resolved mod list for each pack defined in the configuration.
    /// Useful for debugging the inheritance and exclusion logic.
    pub fn print_resolved_packs(&self) -> Result<()> {
        info!("Printing resolved packs...");
        // Collect pack IDs to avoid borrowing issues while iterating and resolving
        let pack_ids: Vec<String> = self.packs.keys().cloned().collect();

        for pack_id in pack_ids {
            match self.get_resolved_pack_definition(&pack_id) {
                Ok(resolved_pack) => {
                    // Use debug logging for potentially large output
                    debug!("--- Resolved Pack: '{}' ---", resolved_pack.display_name);
                    debug!("  Description: {}", resolved_pack.description);
                    if let Some(inherits) = &resolved_pack.inherits_from {
                        debug!("  Inherits From: {:?}", inherits);
                    }
                    if let Some(excludes) = &resolved_pack.exclude_mods {
                        debug!("  Excludes Mods: {:?}", excludes);
                    }

                    let mod_ids: Vec<&str> =
                        resolved_pack.mods.iter().map(|m| m.id.as_str()).collect();
                    debug!("  Final Mods ({}): {:?}", mod_ids.len(), mod_ids);

                    // Example of printing more details (optional)
                    // for mod_def in resolved_pack.mods {
                    //     debug!("    - Mod ID: {}, Source Type: {:?}, Compatibility Keys: {:?}",
                    //            mod_def.id,
                    //            mod_def.source, // This might be verbose
                    //            mod_def.compatibility.keys().collect::<Vec<_>>()
                    //     );
                    // }
                    println!(
                        "Resolved Pack: '{}' - Final Mod IDs: {:?}",
                        resolved_pack.display_name, mod_ids
                    );
                }
                Err(e) => {
                    error!("Failed to resolve pack '{}': {}", pack_id, e);
                    // Decide if you want to continue or return the error
                    // For a print function, continuing might be acceptable.
                    // return Err(e);
                }
            }
        }
        info!("Finished printing resolved packs.");
        Ok(())
    }
}

/// Copies a dummy/test `test_norisk_modpacks.json` from the project's source directory
/// (assuming a development environment structure) to the launcher's root directory
/// as `norisk_modpacks.json` if it doesn't already exist.
///
/// Note: This path resolution using CARGO_MANIFEST_DIR might not work correctly
/// in a packaged production build. Consider using Tauri's resource resolver for that.
pub async fn load_dummy_modpacks() -> Result<()> {
    let target_dir = LAUNCHER_DIRECTORY.root_dir();
    let target_file = target_dir.join("norisk_modpacks.json");

    // Only copy if the target file doesn't exist
    if target_file.exists() {
        //info!("Target modpacks file {:?} already exists. Skipping dummy loading.", target_file);
        //return Ok(());
    }

    // --- Path resolution based on CARGO_MANIFEST_DIR ---
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // Assuming the project root is one level above the crate's manifest (src-tauri)
    let project_root = manifest_dir.parent().ok_or_else(|| {
        AppError::Other("Failed to get parent directory of CARGO_MANIFEST_DIR".to_string())
    })?;

    // Use the test file as the source
    let source_path = project_root.join("minecraft-data/nrc/norisk_modpacks.json");
    // --- End path resolution ---

    if source_path.exists() {
        info!("Found dummy modpacks source at: {:?}", source_path);
        // Ensure the target directory exists
        fs::create_dir_all(&target_dir).await.map_err(|e| {
            error!("Failed to create target directory {:?}: {}", target_dir, e);
            AppError::Io(e)
        })?;

        // Copy the file
        fs::copy(&source_path, &target_file).await.map_err(|e| {
            error!(
                "Failed to copy dummy modpacks from {:?} to {:?}: {}",
                source_path, target_file, e
            );
            AppError::Io(e)
        })?;
        info!("Successfully copied dummy modpacks to {:?}", target_file);
    } else {
        error!(
            "Dummy modpacks source file not found at expected path: {:?}",
            source_path
        );
        // Use a more general error as it's not a Tauri resource issue anymore
        return Err(AppError::Other(format!(
            "Source file not found for dummy modpacks: {}",
            source_path.display()
        )));
    }

    Ok(())
}
