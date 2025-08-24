use crate::config::LAUNCHER_DIRECTORY;
use crate::error::AppError;
use crate::error::Result;
use crate::integrations::modrinth::{self, ModrinthDependencyType, ModrinthVersion};
use crate::state::post_init::PostInitializationHandler;
use crate::utils::hash_utils;
use crate::utils::path_utils;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use futures::future::BoxFuture;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tauri_plugin_dialog::FilePath;
use tokio::fs;
use tokio::sync::Mutex;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum ModSource {
    Local {
        file_name: String,
    },
    Url {
        url: String,
        file_name: Option<String>,
    },
    Maven {
        coordinates: String,
        repository_url: Option<String>,
    }, // e.g., "net.fabricmc:fabric-api:0.91.0+1.20.1"
    Embedded {
        name: String,
    }, // e.g., "Fabric API" provided by the loader itself
    Modrinth {
        project_id: String,             // Modrinth Project ID (e.g., "AANobbMI")
        version_id: String,             // Modrinth Version ID (e.g., "tFw0iWAk")
        file_name: String, // The actual filename (e.g., "sodium-fabric-mc1.20.1-0.5.3.jar")
        download_url: String, // The direct download URL used when adding
        file_hash_sha1: Option<String>, // Optional SHA1 hash for verification
    }, // New variant for Modrinth mods
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Mod {
    #[serde(default = "Uuid::new_v4")] // Assign a new UUID if missing
    pub id: Uuid,
    pub source: ModSource,
    pub enabled: bool,
    pub display_name: Option<String>, // Optional: Could be inferred from mod metadata later
    pub version: Option<String>,      // Optional: Could be inferred
    pub game_versions: Option<Vec<String>>, // Changed: List of supported Minecraft versions
    pub file_name_override: Option<String>, // Optional: To store the actual filename on disk if needed
    pub associated_loader: Option<ModLoader>, // Optional: Tracks the loader this mod was originally intended for
}

// New struct to uniquely identify a Norisk Pack mod within a specific context
#[derive(Serialize, Deserialize, Clone, Debug, Eq, PartialEq, Hash)]
pub struct NoriskModIdentifier {
    pub pack_id: String,
    pub mod_id: String,
    pub game_version: String,
    pub loader: ModLoader,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ImageSource {
    Url {
        url: String,
    },
    RelativePath {
        path: String,
    }, // Relative to launcher_directory
    RelativeProfile {
        path: String,
    }, // Relative to profile directory
    AbsolutePath {
        path: String,
    },
    Base64 {
        data: String,
        mime_type: Option<String>, // Optional MIME type, e.g., "image/png"
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProfileBanner {
    pub source: ImageSource,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Profile {
    #[serde(default = "Uuid::new_v4")] // Use new_v4 for a default ID
    pub id: Uuid, // Eindeutige ID
    pub name: String,                   // Anzeigename
    pub path: String,                   // Dateipfad
    pub game_version: String,           // Minecraft Version
    pub loader: ModLoader,              // Modloader Typ
    pub loader_version: Option<String>, // Modloader Version
    #[serde(default)]
    pub created: DateTime<Utc>, // Erstellungsdatum
    pub last_played: Option<DateTime<Utc>>, // Letzter Start
    #[serde(default)]
    pub settings: ProfileSettings, // Profil Einstellungen
    #[serde(default)]
    pub state: ProfileState, // Aktueller Status
    #[serde(default)] // Add default for backward compatibility when loading old profiles
    pub mods: Vec<Mod>, // List of mods for this profile
    #[serde(default)] // Add default for backward compatibility
    pub selected_norisk_pack_id: Option<String>, // ID of the selected Norisk Pack (e.g., "norisk-prod")
    #[serde(default)] // Keep track of disabled mods per pack/version/loader context
    pub disabled_norisk_mods_detailed: HashSet<NoriskModIdentifier>, // Changed field
    /// Optional: If this profile was created from a standard profile, store its original ID
    #[serde(default)]
    pub source_standard_profile_id: Option<Uuid>,
    /// Optional group name for UI organization and filtering
    #[serde(default)]
    pub group: Option<String>,
    /// True if this is a standard profile template, false if it's a user profile.
    #[serde(default)] // Defaults to false for existing user profiles
    pub is_standard_version: bool,
    pub description: Option<String>,
    #[serde(default)]
    pub banner: Option<ProfileBanner>, // Banner/background image for the profile
    #[serde(default)]
    pub background: Option<ProfileBanner>,
    pub norisk_information: Option<NoriskInformation>,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NoriskInformation {
    #[serde(default)]
    pub keep_local_assets: bool,
    #[serde(default)]
    pub is_experimental: bool,
    #[serde(default = "default_true")]
    pub copy_initial_mc_data: bool,
}

#[derive(Debug, Eq, PartialEq, Clone, Copy, Deserialize, Serialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ModLoader {
    Vanilla,
    Forge,
    Fabric,
    Quilt,
    NeoForge,
}

impl ModLoader {
    pub fn as_str(&self) -> &'static str {
        match *self {
            Self::Vanilla => "vanilla",
            Self::Forge => "forge",
            Self::Fabric => "fabric",
            Self::Quilt => "quilt",
            Self::NeoForge => "neoforge",
        }
    }

    pub fn from_str(s: &str) -> Result<Self> {
        match s.to_lowercase().as_str() {
            "vanilla" => Ok(ModLoader::Vanilla),
            "forge" => Ok(ModLoader::Forge),
            "fabric" => Ok(ModLoader::Fabric),
            "quilt" => Ok(ModLoader::Quilt),
            "neoforge" => Ok(ModLoader::NeoForge),
            _ => Err(AppError::Other(format!("Invalid mod loader: {}", s))),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProfileSettings {
    pub java_path: Option<String>, // Java Pfad
    #[serde(default)]
    pub use_custom_java_path: bool, // Ob der benutzerdefinierte Java-Pfad verwendet werden soll
    pub memory: MemorySettings,    // Speicher Einstellungen
    #[serde(default)]
    pub resolution: Option<WindowSize>, // Auflösung
    #[serde(default)]
    pub fullscreen: bool, // Vollbild
    #[serde(default)]
    pub extra_game_args: Vec<String>, // Zusätzliche Argumente für das Spiel
    #[serde(default)] // Für Abwärtskompatibilität
    pub custom_jvm_args: Option<String>, // Zusätzliche JVM-Argumente als String
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MemorySettings {
    pub min: u32, // in MB
    pub max: u32, // in MB
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProfileState {
    NotInstalled, // Profil existiert nur in der DB
    Installing,   // Wird installiert
    Installed,    // Installiert und bereit
    Running,      // Läuft gerade
    Error,        // Fehler aufgetreten
}

impl Default for ProfileState {
    fn default() -> Self {
        ProfileState::NotInstalled
    }
}

// --- Custom Mod Structs & Enums ---

#[derive(Serialize, Clone, Debug)]
pub struct CustomModInfo {
    pub filename: String, // Base filename (e.g., OptiFine.jar)
    pub is_enabled: bool, // True if the file doesn't end with .disabled
    pub path: PathBuf,    // Full path to the file in custom_mods directory
}

// Profile Manager
pub struct ProfileManager {
    profiles: Arc<RwLock<HashMap<Uuid, Profile>>>,
    profiles_path: PathBuf,
    save_lock: Mutex<()>,
}

impl ProfileManager {
    pub fn new(profiles_path: PathBuf) -> Result<Self> {
        info!(
            "ProfileManager: Initializing with path: {:?} (profiles loading deferred)",
            profiles_path
        );
        Ok(Self {
            profiles: Arc::new(RwLock::new(HashMap::new())), // Start with empty profiles
            profiles_path,
            save_lock: Mutex::new(()),
        })
    }

    // Renamed from load_profiles to avoid conflict, made internal
    async fn load_profiles_internal(&self, path: &PathBuf) -> Result<HashMap<Uuid, Profile>> {
        if !path.exists() {
            return Ok(HashMap::new());
        }
        let data = fs::read_to_string(path).await?;
        let profiles: Vec<Profile> = serde_json::from_str(&data)?;
        Ok(profiles.into_iter().map(|p| (p.id, p)).collect())
    }

    async fn save_profiles(&self) -> Result<()> {
        let _guard = self.save_lock.lock().await;

        let profiles_data = {
            let profiles_guard = self.profiles.read().await;
            let profiles_vec: Vec<&Profile> = profiles_guard.values().collect();
            serde_json::to_string_pretty(&profiles_vec)?
        };

        if let Some(parent_dir) = self.profiles_path.parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir).await?;
            }
        }

        fs::write(&self.profiles_path, profiles_data).await?;
        Ok(())
    }

    // CRUD Operationen
    pub async fn create_profile(&self, profile: Profile) -> Result<Uuid> {
        // The 'profile.path' field is expected to be a relative path/name for the profile directory
        // e.g., "My Profile Name" or "some_group/My Profile Name"
        info!(
            "Attempting to create profile named '{}' with relative path identifier: {:?}",
            profile.name, profile.path
        );

        // Calculate the absolute path for the new profile's instance directory
        let new_profile_instance_path = self.calculate_instance_path_for_profile(&profile)?;

        info!(
            "Calculated absolute profile instance directory: {:?}",
            new_profile_instance_path
        );

        // Create the specific instance directory for this new profile.
        // This will also create any necessary parent directories, including the one
        // where profiles.json (self.profiles_path) will be stored, due to the nature of create_dir_all.
        info!(
            "Creating profile instance directory at: {:?}",
            new_profile_instance_path
        );
        fs::create_dir_all(&new_profile_instance_path).await?; // Use the calculated full path

        let id = profile.id;
        {
            let mut profiles = self.profiles.write().await;
            // The 'profile' object with its relative 'path' is stored.
            // Other functions will use calculate_instance_path_for_profile to resolve it.
            profiles.insert(id, profile);
        }
        info!("Saving profiles metadata to: {:?}", self.profiles_path);
        self.save_profiles().await?;
        Ok(id)
    }

    pub async fn get_profile(&self, id: Uuid) -> Result<Profile> {
        let profiles = self.profiles.read().await;
        if let Some(profile) = profiles.get(&id).cloned() {
            Ok(profile)
        } else {
            // Profile not found in local manager, try standard versions
            //info!( "Profile with ID {} not found in ProfileManager, checking standard versions via global State.", id);
            // Access global state to get NoriskVersionManager
            // This assumes State::get() is available and NoriskVersionManager has get_profile_by_id
            match crate::state::state_manager::State::get().await {
                Ok(state) => {
                    if let Some(standard_profile) =
                        state.norisk_version_manager.get_profile_by_id(id).await
                    {
                        //info!("Found standard profile '{}' for ID {}", standard_profile.name, id);
                        Ok(standard_profile)
                    } else {
                        info!("Profile ID {} not found in standard versions either.", id);
                        Err(crate::error::AppError::ProfileNotFound(id))
                    }
                }
                Err(e) => {
                    error!("Failed to get global state while trying to fetch standard profile for ID {}: {}", id, e);
                    // Return the original ProfileNotFound error, or a more specific one for state access failure
                    Err(crate::error::AppError::ProfileNotFound(id))
                }
            }
        }
    }

    pub async fn update_profile(&self, id: Uuid, profile: Profile) -> Result<()> {
        // Check if the profile being updated is a standard version
        if profile.is_standard_version {
            warn!(
                "Attempted to update a standard version profile (ID: {}). Updates to standard versions are not allowed.",
                id
            );
            return Ok(()); // Do not proceed with update for standard versions
        }

        {
            let mut profiles = self.profiles.write().await;
            profiles.insert(id, profile);
        }
        self.save_profiles().await?;
        Ok(())
    }

    pub async fn delete_profile(&self, id: Uuid) -> Result<()> {
        let profile_to_delete: Option<Profile>;
        let profile_dir_path: Option<PathBuf>;

        // Scope to release the read lock quickly
        {
            let profiles = self.profiles.read().await;
            profile_to_delete = profiles.get(&id).cloned(); // Clone the profile data if it exists
        }

        // If the profile exists, determine its path using the helper function
        if let Some(profile) = &profile_to_delete {
            match self.calculate_instance_path_for_profile(&profile) {
                Ok(path) => {
                    profile_dir_path = Some(path.clone());
                    info!(
                        "Profile '{}' marked for deletion. Directory path: {:?}",
                        profile.name, path
                    );
                }
                Err(e) => {
                    // Should not happen if profile object is valid, but handle defensively
                    error!("Failed to calculate instance path for profile '{}': {}. Aborting directory deletion.", profile.name, e);
                    profile_dir_path = None;
                    // Return an error, as we can't be sure about the path
                    return Err(AppError::Other(format!(
                        "Could not calculate profile path: {}",
                        e
                    )));
                }
            }
        } else {
            // Profile not found in map, nothing to delete on filesystem
            profile_dir_path = None;
            info!("Profile with ID {} not found for deletion.", id);
            return Err(AppError::ProfileNotFound(id)); // Return error if profile doesn't exist
        }

        // Attempt to delete the directory (outside the profile map lock)
        if let Some(path) = profile_dir_path {
            if path.exists() {
                info!("Moving profile directory to trash: {:?}", path);
                match crate::utils::trash_utils::move_path_to_trash(&path, Some("profiles")).await {
                    Ok(wrapper) => info!("Profile directory moved to trash wrapper: {:?}", wrapper),
                    Err(e) => {
                        error!("Failed to move profile directory {:?} to trash: {}", path, e);
                        return Err(e);
                    }
                }
            } else {
                info!(
                    "Profile directory {:?} does not exist. Skipping directory deletion.",
                    path
                );
            }
        }

        // Remove the profile from the in-memory map
        {
            let mut profiles = self.profiles.write().await;
            if profiles.remove(&id).is_none() {
                // This case should ideally not happen if we found it earlier, but log just in case
                warn!(
                    "Profile {} was not found in the map during final removal step.",
                    id
                );
            }
        }

        // Save the updated profiles list
        self.save_profiles().await?;
        info!(
            "Successfully removed profile entry {} from configuration.",
            id
        );

        Ok(())
    }

    // Add a new mod to a specific profile
    pub async fn add_mod(&self, profile_id: Uuid, mod_info: Mod) -> Result<()> {
        info!(
            "Adding mod '{}' (Source: {:?}) to profile {}",
            mod_info
                .display_name
                .as_deref()
                .unwrap_or(&mod_info.id.to_string()),
            mod_info.source,
            profile_id
        );

        let mut profiles = self.profiles.write().await;

        if let Some(profile) = profiles.get_mut(&profile_id) {
            if !profile
                .mods
                .iter()
                .any(|existing_mod| existing_mod.source == mod_info.source)
            {
                profile.mods.push(mod_info);
                drop(profiles);
                self.save_profiles().await?;
                info!("Successfully added mod to profile {}", profile_id);
                Ok(())
            } else {
                info!(
                    "Mod with the same source already exists in profile {}",
                    profile_id
                );
                Err(AppError::Other(format!(
                    "Mod already exists in profile {}",
                    profile_id
                )))
            }
        } else {
            Err(AppError::ProfileNotFound(profile_id))
        }
    }

    // Add a mod specifically sourced from Modrinth - Internal function with dependency logic
    // Use BoxFuture for recursion
    fn add_modrinth_mod_internal<'a>(
        &'a self,
        profile_id: Uuid,
        project_id: String,
        version_id: String,
        file_name: String,
        download_url: String,
        file_hash_sha1: Option<String>,
        // Optional details for better Mod struct population
        mod_name: Option<String>,
        version_number: Option<String>,
        // Loaders and game versions associated with *this specific version* being added
        loaders: Option<Vec<String>>,
        game_versions: Option<Vec<String>>,
        // Flag to control dependency fetching
        add_dependencies: bool,
        // Internal parameter to prevent infinite loops
        visited_mods: HashSet<(String, String)>,
    ) -> BoxFuture<'a, Result<()>> {
        // Return type is BoxFuture
        Box::pin(async move {
            let display_name_log = mod_name.as_deref().unwrap_or(&project_id);
            let version_log = version_number.as_deref().unwrap_or(&version_id);
            info!(
                "Processing Modrinth mod {} (Version {}) for profile {}. Add dependencies: {}",
                display_name_log, version_log, profile_id, add_dependencies
            );

            let mod_key = (project_id.clone(), version_id.clone());
            if visited_mods.contains(&mod_key) {
                info!(
                    "Skipping already processed mod/dependency: {} ({})",
                    display_name_log, version_log
                );
                return Ok(());
            }
            let mut visited_mods_clone = visited_mods.clone();
            visited_mods_clone.insert(mod_key);

            let source = ModSource::Modrinth {
                project_id: project_id.clone(),
                version_id: version_id.clone(),
                file_name: file_name.clone(),
                download_url: download_url.clone(),
                file_hash_sha1: file_hash_sha1.clone(),
            };

            let mut needs_save = false;
            {
                let mut profiles = self.profiles.write().await;
                if let Some(profile) = profiles.get_mut(&profile_id) {
                    if !profile.mods.iter().any(|m| m.source == source) {
                        info!(
                            "Adding mod {} ({}) to profile {}",
                            display_name_log, version_log, profile_id
                        );

                        let new_mod = Mod {
                            id: Uuid::new_v4(),
                            source: source.clone(),
                            enabled: true,
                            display_name: mod_name.clone().or_else(|| Some(file_name.clone())),
                            version: version_number.clone(),
                            game_versions: game_versions.clone(),
                            file_name_override: None,
                            associated_loader: loaders
                                .clone()
                                .and_then(|l| l.first().and_then(|s| ModLoader::from_str(s).ok())),
                        };
                        profile.mods.push(new_mod);
                        needs_save = true;
                    } else {
                        info!(
                            "Mod {} ({}) already exists in profile {}. Skipping addition.",
                            display_name_log, version_log, profile_id
                        );
                    }
                } else {
                    return Err(AppError::ProfileNotFound(profile_id));
                }
            }

            if needs_save {
                self.save_profiles().await?;
                info!(
                    "Profile saved after adding mod {} ({})",
                    display_name_log, version_log
                );
            }

            if add_dependencies {
                info!(
                    "Fetching dependencies for {} ({})",
                    display_name_log, version_log
                );

                let profile_details = self.get_profile(profile_id).await?;
                let profile_loader_str = profile_details.loader.as_str().to_string();
                let profile_game_version = profile_details.game_version.clone();

                match modrinth::get_mod_versions(project_id.clone(), None, None).await {
                    Ok(versions) => {
                        if let Some(version_info) =
                            versions.into_iter().find(|v| v.id == version_id)
                        {
                            info!(
                                "Found {} dependencies for {} ({})",
                                version_info.dependencies.len(),
                                display_name_log,
                                version_log
                            );

                            for dependency in version_info.dependencies {
                                if dependency.dependency_type == ModrinthDependencyType::Required {
                                    info!("Processing required dependency: Project={:?}, Version={:?}", dependency.project_id, dependency.version_id);

                                    if let Some(dep_project_id) = dependency.project_id {
                                        info!("Attempting to find compatible version for dependency project '{}'", dep_project_id);

                                        let target_version_id = dependency.version_id;

                                        // Fetch dependency versions compatible with the profile's loader, but *without* filtering by game version yet.
                                        // Game version filtering will happen below based on the *parent mod's* requirements.
                                        match modrinth::get_mod_versions(
                                            dep_project_id.clone(), 
                                            Some(vec![profile_loader_str.clone()]), 
                                            None // <-- Removed game_version filter here
                                        ).await {
                                            Ok(dep_versions) => {
                                                let mut best_dep_version: Option<&ModrinthVersion> = None;

                                                // If a specific dependency version was requested, try to find that first.
                                                if let Some(tv_id) = &target_version_id { // Borrow tv_id
                                                    best_dep_version = dep_versions.iter().find(|v| &v.id == tv_id);
                                                    if best_dep_version.is_none() {
                                                        warn!("Requested dependency version '{}' not found or not compatible with profile's loader for project '{}'. Trying to find best alternative.", tv_id, dep_project_id);
                                                    }
                                                }
                                                
                                                // If no specific version requested or found, find the best compatible version.
                                                if best_dep_version.is_none() {
                                                    
                                                    // Determine the target game versions for filtering: use the PARENT mod's versions (from version_info) if available (non-empty), else fallback to profile's.
                                                    let target_game_versions_for_dep: Vec<String> = if !version_info.game_versions.is_empty() {
                                                        // Use the parent mod's game versions if the list is not empty
                                                        version_info.game_versions.clone()
                                                    } else {
                                                         // Otherwise, fallback to the profile's game version
                                                         warn!("Parent mod {} ({}) did not provide specific game versions in its fetched data (version_info) or list was empty. Falling back to profile game version '{}' for dependency '{}' lookup.", display_name_log, version_log, profile_game_version, dep_project_id);
                                                        vec![profile_game_version.clone()]
                                                    };
                                                    
                                                     // Attempt 1: Find the latest version supporting any of the *target* game versions.
                                                     best_dep_version = dep_versions.iter()
                                                         .filter(|dep_v| {
                                                            // Check if the dependency version supports AT LEAST ONE of the target game versions
                                                            target_game_versions_for_dep.iter().any(|target_gv| dep_v.game_versions.contains(target_gv))
                                                         })
                                                         .max_by_key(|v| &v.date_published);

                                                     // Attempt 2: If no match for target game versions, fall back to the overall latest compatible version (loader match only).
                                                     if best_dep_version.is_none() {
                                                         warn!("Could not find dependency version matching target game versions {:?} for project '{}'. Falling back to latest version compatible with loader '{}'.", target_game_versions_for_dep, dep_project_id, profile_loader_str);
                                                         best_dep_version = dep_versions.iter()
                                                             .max_by_key(|v| &v.date_published);
                                                     }
                                                 }

                                                 if let Some(selected_dep_version) = best_dep_version {
                                                     info!("Selected version '{}' ({}) for dependency '{}'", selected_dep_version.name, selected_dep_version.id, dep_project_id);
                                                     
                                                     if let Some(primary_file) = selected_dep_version.files.iter().find(|f| f.primary) {
                                                         match self.add_modrinth_mod_internal(
                                                             profile_id,
                                                             selected_dep_version.project_id.clone(),
                                                             selected_dep_version.id.clone(),
                                                             primary_file.filename.clone(),
                                                             primary_file.url.clone(),
                                                             primary_file.hashes.sha1.clone(),
                                                             Some(selected_dep_version.name.clone()),
                                                             Some(selected_dep_version.version_number.clone()),
                                                             Some(selected_dep_version.loaders.clone()),
                                                             Some(selected_dep_version.game_versions.clone()),
                                                             true,
                                                             visited_mods_clone.clone(),
                                                         ).await {
                                                             Ok(_) => info!("Successfully processed dependency '{}'", dep_project_id),
                                                             Err(e) => error!("Failed processing dependency '{}': {}", dep_project_id, e),
                                                         }
                                                     } else {
                                                          error!("Could not find primary file for dependency version {} ({})", selected_dep_version.name, selected_dep_version.id);
                                                     }
                                                 } else {
                                                     warn!("Could not find a compatible version for dependency project '{}' matching loader '{}' and game version '{}'. Dependency may be missing.", dep_project_id, profile_loader_str, profile_game_version);
                                                 }
                                             },
                                             Err(e) => error!("Failed to fetch versions for dependency project '{}': {}", dep_project_id, e),
                                         }
                                    } else {
                                        if let Some(dep_version_id_only) = dependency.version_id {
                                            warn!("Dependency has only version_id ('{}'). Attempting to fetch details directly.", dep_version_id_only);
                                            match modrinth::get_version_details(
                                                dep_version_id_only.clone(),
                                            )
                                            .await
                                            {
                                                Ok(dep_version_details) => {
                                                    info!("Successfully fetched details for version '{}': Project='{}'", dep_version_id_only, dep_version_details.project_id);
                                                    if let Some(primary_file) = dep_version_details
                                                        .files
                                                        .iter()
                                                        .find(|f| f.primary)
                                                    {
                                                        match self.add_modrinth_mod_internal(
                                                             profile_id,
                                                             dep_version_details.project_id.clone(),
                                                             dep_version_details.id.clone(),
                                                             primary_file.filename.clone(),
                                                             primary_file.url.clone(),
                                                             primary_file.hashes.sha1.clone(),
                                                             Some(dep_version_details.name.clone()),
                                                             Some(dep_version_details.version_number.clone()),
                                                             Some(dep_version_details.loaders.clone()),
                                                             Some(dep_version_details.game_versions.clone()),
                                                             true,
                                                             visited_mods_clone.clone(),
                                                         ).await {
                                                             Ok(_) => info!("Successfully processed dependency by version_id '{}'", dep_version_id_only),
                                                             Err(e) => error!("Failed processing dependency by version_id '{}': {}", dep_version_id_only, e),
                                                         }
                                                    } else {
                                                        error!("Could not find primary file for dependency version fetched by ID '{}'", dep_version_id_only);
                                                    }
                                                }
                                                Err(e) => {
                                                    error!("Failed to fetch details for dependency version_id '{}': {}. Cannot add dependency.", dep_version_id_only, e);
                                                }
                                            }
                                        } else {
                                            error!("Required dependency is missing project_id and version_id. Cannot resolve. File: {:?}", dependency.file_name);
                                        }
                                    }
                                } else {
                                    // Optional/Incompatible/Embedded dependencies are ignored for now
                                    // info!("Ignoring non-required dependency type: {:?}", dependency.dependency_type);
                                }
                            }
                        } else {
                            warn!("Could not find details for version ID '{}' of project '{}' on Modrinth after fetching versions.", version_id, project_id);
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to fetch versions for project '{}' to resolve dependencies: {}",
                            project_id, e
                        );
                    }
                }
            } else {
                info!(
                    "Skipping dependency check for {} ({}) as requested.",
                    display_name_log, version_log
                );
            }

            Ok(())
        })
    }

    // Public wrapper function to add a Modrinth mod and its dependencies
    pub async fn add_modrinth_mod(
        &self,
        profile_id: Uuid,
        project_id: String,
        version_id: String,
        file_name: String,
        download_url: String,
        file_hash_sha1: Option<String>,
        // Optional details for better Mod struct population
        mod_name: Option<String>,
        version_number: Option<String>,
        loaders: Option<Vec<String>>,
        game_versions: Option<Vec<String>>,
        add_dependencies: bool, // Allow caller to decide
    ) -> Result<()> {
           // If profile is a standard version, download directly into its mods folder
           let profile = self.get_profile(profile_id).await?;
           if profile.is_standard_version {
               let mods_dir = self.get_profile_mods_path(&profile)?;
               tokio::fs::create_dir_all(&mods_dir).await?;
   
               let target_path = mods_dir.join(&file_name);
               let tmp_path = target_path.with_extension("jar.nrc_tmp");
   
               let mut config = crate::utils::download_utils::DownloadConfig::new().with_streaming(true);
               if let Some(sha1) = &file_hash_sha1 { config = config.with_sha1(sha1); }
               crate::utils::download_utils::DownloadUtils::download_file(
                   &download_url,
                   &tmp_path,
                   config,
               ).await?;
               // Atomic move
               tokio::fs::rename(&tmp_path, &target_path).await?;
   
               // Optionally install required dependencies if requested
               if add_dependencies {
                   // Fetch version details to read dependencies
                   if let Ok(ver_details) = modrinth::get_version_details(version_id.clone()).await {
                       for dep in ver_details.dependencies.iter().filter(|d| d.dependency_type == ModrinthDependencyType::Required) {
                           if let Some(dep_project_id) = &dep.project_id {
                               // Find a compatible version by loader/profile game version
                               if let Ok(dep_versions) = modrinth::get_mod_versions(dep_project_id.clone(), Some(vec![profile.loader.as_str().to_string()]), Some(vec![profile.game_version.clone()])).await {
                                   if let Some(best) = dep_versions.iter().max_by_key(|v| &v.date_published) {
                                       if let Some(primary) = best.files.iter().find(|f| f.primary) {
                                           let dep_tmp = mods_dir.join(&primary.filename).with_extension("jar.nrc_tmp");
                                           let dep_target = mods_dir.join(&primary.filename);
                                           let mut cfg = crate::utils::download_utils::DownloadConfig::new().with_streaming(true);
                                           if let Some(s) = &primary.hashes.sha1 { cfg = cfg.with_sha1(s); }
                                           let _ = crate::utils::download_utils::DownloadUtils::download_file(&primary.url, &dep_tmp, cfg).await;
                                           let _ = tokio::fs::rename(&dep_tmp, &dep_target).await;
                                       }
                                   }
                               }
                           }
                       }
                   }
               }
               Ok(())
           } else {
               // Non-standard: keep existing behavior (add to profile mods + optional deps)
               self.add_modrinth_mod_internal(
                   profile_id,
                   project_id,
                   version_id,
                   file_name,
                   download_url,
                   file_hash_sha1,
                   mod_name,
                   version_number,
                   loaders,
                   game_versions,
                   add_dependencies,
                   HashSet::new(),
               )
               .await
           }
    }

    // Set the enabled status of a specific mod within a profile
    pub async fn set_mod_enabled(
        &self,
        profile_id: Uuid,
        mod_id: Uuid,
        enabled: bool,
    ) -> Result<()> {
        info!(
            "Setting mod {} enabled status to {} for profile {}",
            mod_id, enabled, profile_id
        );

        let mut profiles = self.profiles.write().await;

        if let Some(profile) = profiles.get_mut(&profile_id) {
            if let Some(mod_to_update) = profile.mods.iter_mut().find(|m| m.id == mod_id) {
                if mod_to_update.enabled != enabled {
                    mod_to_update.enabled = enabled;
                    drop(profiles);
                    self.save_profiles().await?;
                    info!(
                        "Successfully updated mod {} enabled status in profile {}",
                        mod_id, profile_id
                    );
                } else {
                    info!(
                        "Mod {} enabled status already {}. No change needed.",
                        mod_id, enabled
                    );
                }
                Ok(())
            } else {
                Err(AppError::Other(format!(
                    "Mod with ID {} not found in profile {}",
                    mod_id, profile_id
                )))
            }
        } else {
            Err(AppError::ProfileNotFound(profile_id))
        }
    }

    // Remove a specific mod from a profile
    pub async fn delete_mod(&self, profile_id: Uuid, mod_id: Uuid) -> Result<()> {
        info!("Deleting mod {} from profile {}", mod_id, profile_id);

        let mut profiles = self.profiles.write().await;

        if let Some(profile) = profiles.get_mut(&profile_id) {
            let initial_len = profile.mods.len();
            profile.mods.retain(|m| m.id != mod_id);
            let final_len = profile.mods.len();

            if final_len < initial_len {
                drop(profiles);
                self.save_profiles().await?;
                info!(
                    "Successfully deleted mod {} from profile {}",
                    mod_id, profile_id
                );
                Ok(())
            } else {
                Err(AppError::Other(format!(
                    "Mod with ID {} not found in profile {}",
                    mod_id, profile_id
                )))
            }
        } else {
            Err(AppError::ProfileNotFound(profile_id))
        }
    }

    // Set the enabled/disabled status of a specific mod within a Norisk Pack for a profile's specific context
    pub async fn set_norisk_mod_status(
        &self,
        profile_id: Uuid,
        pack_id: String,
        mod_id: String,
        game_version: String,
        loader: ModLoader,
        disabled: bool,
    ) -> Result<()> {
        info!(
            "Setting disabled state for pack mod '{}' (Pack: '{}', MC: {}, Loader: {:?}) for profile {} to {}",
            mod_id, pack_id, game_version, loader, profile_id, disabled
        );

        let mut profiles = self.profiles.write().await;

        if let Some(profile) = profiles.get_mut(&profile_id) {
            let identifier = NoriskModIdentifier {
                pack_id,
                mod_id: mod_id.clone(),
                game_version,
                loader,
            };

            let changed;
            if disabled {
                changed = profile.disabled_norisk_mods_detailed.insert(identifier);
            } else {
                changed = profile.disabled_norisk_mods_detailed.remove(&identifier);
            }

            if changed {
                info!(
                    "Successfully {} pack mod '{}' for profile {}",
                    if disabled { "disabled" } else { "enabled" },
                    mod_id,
                    profile_id
                );
                drop(profiles);
                self.save_profiles().await?;
            } else {
                info!(
                    "Pack mod '{}' for profile {} was already {}",
                    mod_id,
                    profile_id,
                    if disabled { "disabled" } else { "enabled" }
                );
            }
            Ok(())
        } else {
            Err(AppError::ProfileNotFound(profile_id))
        }
    }

    // Utility Funktionen
    pub async fn list_profiles(&self) -> Result<Vec<Profile>> {
        let profiles = self.profiles.read().await;
        Ok(profiles.values().cloned().collect())
    }

    pub async fn search_profiles(&self, query: &str) -> Result<Vec<Profile>> {
        let query = query.to_lowercase();
        let profiles = self.profiles.read().await;
        Ok(profiles
            .values()
            .filter(|p| p.name.to_lowercase().contains(&query))
            .cloned()
            .collect())
    }

    /// Updates the version of a specific Modrinth mod instance within a profile,
    /// after checking for the presence of required dependencies (by project ID).
    /// Automatically adds missing dependencies.
    pub async fn update_profile_modrinth_mod_version(
        &self,
        profile_id: Uuid,
        mod_id: Uuid,
        new_version_details: &ModrinthVersion,
    ) -> Result<()> {
        info!(
            "Attempting to update Modrinth mod instance {} in profile {} to version '{}' ({})",
            mod_id, profile_id, new_version_details.name, new_version_details.id
        );

        let mut profiles = self.profiles.write().await;

        let profile = profiles.get_mut(&profile_id).ok_or_else(|| {
            error!(
                "Profile {} not found during mod update attempt.",
                profile_id
            );
            AppError::ProfileNotFound(profile_id)
        })?;

        info!(
            "Checking required dependencies for new version {}...",
            new_version_details.id
        );
        let existing_project_ids: HashSet<String> = profile
            .mods
            .iter()
            .filter_map(|m| match &m.source {
                ModSource::Modrinth { project_id, .. } => Some(project_id.clone()),
                _ => None,
            })
            .collect();

        // Track missing dependencies to install them later
        let mut missing_deps = Vec::new();

        for dependency in &new_version_details.dependencies {
            if dependency.dependency_type == ModrinthDependencyType::Required {
                if let Some(dep_project_id) = &dependency.project_id {
                    if !existing_project_ids.contains(dep_project_id) {
                        info!(
                            "Required dependency project '{}' is missing in profile {}. Will install it automatically.",
                            dep_project_id, profile_id
                        );
                        missing_deps.push((dep_project_id.clone(), dependency.version_id.clone()));
                    } else {
                        info!(
                            "Required dependency project '{}' found in profile.",
                            dep_project_id
                        );
                    }
                } else {
                    warn!(
                        "Required dependency found without a project_id in version {}: {:?}",
                        new_version_details.id, dependency
                    );
                }
            }
        }

        // Now update the mod
        let mod_to_update_index = profile.mods.iter().position(|m| m.id == mod_id);

        if let Some(index) = mod_to_update_index {
            let mod_to_update = &mut profile.mods[index];

            if let ModSource::Modrinth {
                project_id: old_project_id,
                ..
            } = &mod_to_update.source
            {
                if old_project_id != &new_version_details.project_id {
                    error!(
                        "Project ID mismatch when updating mod {}! Expected '{}', got '{}'. Aborting update.",
                         mod_id, old_project_id, new_version_details.project_id
                    );
                    return Err(AppError::Other(format!(
                        "Project ID mismatch for mod {}",
                        mod_id
                    )));
                }

                match new_version_details.files.iter().find(|f| f.primary) {
                    Some(primary_file) => {
                        info!(
                            "Updating mod instance {} from version {} to {} using file '{}'",
                            mod_id,
                            mod_to_update.version.as_deref().unwrap_or("?"),
                            new_version_details.version_number,
                            primary_file.filename
                        );

                        mod_to_update.source = ModSource::Modrinth {
                            project_id: new_version_details.project_id.clone(),
                            version_id: new_version_details.id.clone(),
                            file_name: primary_file.filename.clone(),
                            download_url: primary_file.url.clone(),
                            file_hash_sha1: primary_file.hashes.sha1.clone(),
                        };

                        mod_to_update.version = Some(new_version_details.version_number.clone());
                        mod_to_update.game_versions =
                            Some(new_version_details.game_versions.clone());
                        mod_to_update.associated_loader = new_version_details
                            .loaders
                            .first()
                            .and_then(|s| ModLoader::from_str(s).ok());

                        info!("Mod instance {} updated successfully in memory.", mod_id);
                    }
                    None => {
                        error!(
                            "No primary file found for Modrinth version {} (ID: {})",
                            new_version_details.name, new_version_details.id
                        );
                        return Err(AppError::ModrinthPrimaryFileNotFound {
                            version_id: new_version_details.id.clone(),
                        });
                    }
                }
            } else {
                error!(
                    "Mod instance {} in profile {} is not a Modrinth mod.",
                    mod_id, profile_id
                );
                return Err(AppError::Other(format!(
                    "Mod {} is not a Modrinth mod",
                    mod_id
                )));
            }
        } else {
            error!(
                "Mod instance with ID {} not found in profile {} during update.",
                mod_id, profile_id
            );
            return Err(AppError::ModNotFoundInProfile { profile_id, mod_id });
        }

        // Save changes to the profile first
        drop(profiles);
        self.save_profiles().await?;
        info!(
            "Profile {} saved after updating mod {}.",
            profile_id, mod_id
        );

        // Now install any missing dependencies
        let mut installed_deps = 0;
        let mut failed_deps = 0;

        for (dep_project_id, dep_version_id_opt) in missing_deps {
            info!("Installing missing dependency: {}", dep_project_id);

            // Get the profile's game version and loader for compatibility check
            let profile = self.get_profile(profile_id).await?;
            let profile_loader = profile.loader.as_str().to_string();

            // First, try to find the specific version if one was specified
            if let Some(version_id) = dep_version_id_opt {
                match modrinth::get_version_details(version_id.clone()).await {
                    Ok(dep_version) => {
                        if let Some(primary_file) = dep_version.files.iter().find(|f| f.primary) {
                            match self
                                .add_modrinth_mod(
                                    profile_id,
                                    dep_version.project_id.clone(),
                                    dep_version.id.clone(),
                                    primary_file.filename.clone(),
                                    primary_file.url.clone(),
                                    primary_file.hashes.sha1.clone(),
                                    Some(dep_version.name.clone()),
                                    Some(dep_version.version_number.clone()),
                                    Some(dep_version.loaders.clone()),
                                    Some(dep_version.game_versions.clone()),
                                    false, // don't recursively add dependencies here
                                )
                                .await
                            {
                                Ok(_) => {
                                    info!("Successfully added dependency: {}", dep_project_id);
                                    installed_deps += 1;
                                }
                                Err(e) => {
                                    error!("Failed to add dependency {}: {}", dep_project_id, e);
                                    failed_deps += 1;
                                }
                            }
                            continue;
                        }
                    }
                    Err(e) => {
                        warn!("Failed to fetch version details for dependency {} ({}): {}. Trying to find compatible version.", 
                            dep_project_id, version_id, e);
                    }
                }
            }

            // If specific version not found or no version specified, find compatible version
            match modrinth::get_mod_versions(
                dep_project_id.clone(),
                Some(vec![profile_loader.clone()]),
                Some(vec![profile.game_version.clone()]),
            )
            .await
            {
                Ok(versions) => {
                    if let Some(best_version) = versions.iter().max_by_key(|v| &v.date_published) {
                        if let Some(primary_file) = best_version.files.iter().find(|f| f.primary) {
                            match self
                                .add_modrinth_mod(
                                    profile_id,
                                    best_version.project_id.clone(),
                                    best_version.id.clone(),
                                    primary_file.filename.clone(),
                                    primary_file.url.clone(),
                                    primary_file.hashes.sha1.clone(),
                                    Some(best_version.name.clone()),
                                    Some(best_version.version_number.clone()),
                                    Some(best_version.loaders.clone()),
                                    Some(best_version.game_versions.clone()),
                                    false, // don't recursively add dependencies here
                                )
                                .await
                            {
                                Ok(_) => {
                                    info!("Successfully added dependency: {}", dep_project_id);
                                    installed_deps += 1;
                                }
                                Err(e) => {
                                    error!("Failed to add dependency {}: {}", dep_project_id, e);
                                    failed_deps += 1;
                                }
                            }
                        } else {
                            error!("No primary file found for dependency version");
                            failed_deps += 1;
                        }
                    } else {
                        error!(
                            "No compatible version found for dependency {}",
                            dep_project_id
                        );
                        failed_deps += 1;
                    }
                }
                Err(e) => {
                    error!(
                        "Failed to fetch versions for dependency {}: {}",
                        dep_project_id, e
                    );
                    failed_deps += 1;
                }
            }
        }

        info!(
            "Dependency installation complete: {} installed, {} failed",
            installed_deps, failed_deps
        );

        Ok(())
    }

    /// Returns the instance path for a given profile ID by looking it up.
    pub async fn get_profile_instance_path(&self, profile_id: Uuid) -> Result<PathBuf> {
        //log::debug!("Attempting to get instance path for profile {}", profile_id);
        let profiles_map = self.profiles.read().await;
        match profiles_map.get(&profile_id) {
            Some(profile) => {
                log::trace!(
                    "Found instance path {:?} for profile {}",
                    &profile.path,
                    profile_id
                );
                // Reuse the logic by calling the new method
                self.calculate_instance_path_for_profile(profile)
            }
            None => {
                //log::info!("Profile {} not found, checking standard versions",profile_id);
                // Get state to access norisk_version_manager
                let state = crate::state::state_manager::State::get().await?;

                // Check if it's a standard version ID
                if let Some(standard_profile) = state
                    .norisk_version_manager
                    .get_profile_by_id(profile_id)
                    .await
                {
                    //log::info!("Found standard profile '{}', converting to temporary profile",standard_profile.name);
                    // Convert to a temporary profile
                    return self.calculate_instance_path_for_profile(&standard_profile);
                }

                log::warn!("Profile {} not found when getting instance path (not in regular profiles or standard versions).", profile_id);
                Err(AppError::ProfileNotFound(profile_id))
            }
        }
    }

    /// Calculates the instance path for a given Profile object based on its properties.
    /// This method does NOT check if the profile exists in the manager.
    pub fn calculate_instance_path_for_profile(&self, profile: &Profile) -> Result<PathBuf> {
        log::trace!(
            "Calculating instance path for profile '{}' (Raw profile.path: '{}', Version: {})",
            profile.name,
            profile.path, // Log the raw profile.path string
            profile.game_version
        );

        let base_path = default_profile_path();
        let mut final_path = base_path;

        // Explicitly split profile.path by '/' and push each segment
        // This ensures that segments like "noriskclient" and "new" from "noriskclient/new"
        // are appended individually. PathBuf::push is OS-aware.
        for segment in profile.path.split('/') {
            if !segment.is_empty() {
                // Avoid creating empty segments if path has "//" or leading/trailing "/"
                final_path.push(segment);
            }
        }

        log::trace!(
            "Constructed final path for profile '{}': {:?}",
            profile.name,
            final_path
        );
        Ok(final_path)
    }

    /// Returns the path to the mods directory for a given profile.
    /// The mods directory is located inside the instance path.
    /// For Fabric, it's specifically within a versioned fabric subfolder.
    pub fn get_profile_mods_path(&self, profile: &Profile) -> Result<PathBuf> {
        let instance_path = self.calculate_instance_path_for_profile(profile)?;
        log::debug!(
            "Calculating mods path for profile '{}' (Loader: {:?}, Game Version: {}) starting from instance path: {:?}",
            profile.name,
            profile.loader,
            profile.game_version,
            instance_path
        );

        let mods_path = match profile.loader {
            ModLoader::Fabric => {
                let fabric_version_folder = format!("{}-{}-{}", "nrc", profile.game_version, "fabric");
                instance_path.join("mods").join(fabric_version_folder)
            }
            _ => instance_path.join("mods"),
        };
        log::info!(
            "Calculated mods path for profile '{}': {:?}",
            profile.name,
            mods_path
        );
        Ok(mods_path)
    }

    /// Returns the path to the custom_mods directory for a given profile ID.
    /// The directory is located next to the .minecraft directory within the instance folder.
    pub async fn get_profile_custom_mods_path(&self, profile_id: Uuid) -> Result<PathBuf> {
        log::debug!(
            "Attempting to get custom_mods path for profile {}",
            profile_id
        );
        let minecraft_dir_path = self.get_profile_instance_path(profile_id).await?;

        let custom_mods_dir = minecraft_dir_path.join("custom_mods");
        log::trace!(
            "Determined custom_mods path {:?} for profile {}",
            custom_mods_dir,
            profile_id
        );
        Ok(custom_mods_dir)
    }

    /// Lists relevant custom mods found in the profile's `custom_mods` directory.
    /// Only includes files ending in `.jar` or `.jar.disabled`.
    pub async fn list_custom_mods(&self, profile: &Profile) -> Result<Vec<CustomModInfo>> {
        let custom_mods_path = self.get_profile_custom_mods_path(profile.id).await?;
        let mut custom_mods = Vec::new();

        if !custom_mods_path.exists() {
            log::debug!(
                "Custom mods directory {:?} does not exist for profile {}. Returning empty list.",
                custom_mods_path,
                profile.id
            );
            // Attempt to create it for next time?
            if let Err(e) = tokio::fs::create_dir_all(&custom_mods_path).await {
                log::warn!(
                    "Failed to create custom_mods directory {:?}: {}",
                    custom_mods_path,
                    e
                );
            }
            return Ok(custom_mods); // Return empty list if dir doesn't exist initially
        }

        let mut dir_entries = tokio::fs::read_dir(&custom_mods_path).await.map_err(|e| {
            log::error!(
                "Failed to read custom_mods directory {:?}: {}",
                custom_mods_path,
                e
            );
            AppError::Io(e)
        })?;

        while let Some(entry_result) = dir_entries.next_entry().await.map_err(|e| {
            log::error!(
                "Failed to read entry in custom_mods directory {:?}: {}",
                custom_mods_path,
                e
            );
            AppError::Io(e)
        })? {
            let path = entry_result.path();
            if path.is_file() {
                if let Some(filename_str) = path.file_name().and_then(|n| n.to_str()) {
                    // Skip hidden files
                    if filename_str.starts_with(".") {
                        log::trace!("Skipping hidden file in custom_mods: {:?}", path);
                        continue;
                    }

                    let is_enabled = !filename_str.ends_with(".disabled");
                    let base_filename_opt = if is_enabled {
                        if filename_str.ends_with(".jar") {
                            Some(filename_str.to_string())
                        } else {
                            None // Skip if enabled but not a .jar
                        }
                    } else {
                        // If disabled, check if the base name ends with .jar
                        if let Some(base) = filename_str.strip_suffix(".disabled") {
                            if base.ends_with(".jar") {
                                Some(base.to_string())
                            } else {
                                None // Skip if disabled but base is not .jar
                            }
                        } else {
                            None // Should not happen if ends_with(".disabled") is true
                        }
                    };

                    if let Some(base_filename) = base_filename_opt {
                        custom_mods.push(CustomModInfo {
                            filename: base_filename,
                            is_enabled,
                            path: path.clone(),
                        });
                    } else {
                        log::trace!(
                            "Skipping file in custom_mods (not .jar or .jar.disabled): {:?}",
                            path
                        );
                    }
                }
            }
        }

        log::info!(
            "Found {} relevant custom mod file(s) in {:?}",
            custom_mods.len(),
            custom_mods_path
        );
        Ok(custom_mods)
    }

    /// Sets the enabled/disabled state of a custom mod by renaming it.
    /// Accepts the base filename (e.g., "OptiFine.jar") and the desired enabled state.
    /// Returns Ok(()) if the state is successfully set or already correct.
    pub async fn set_custom_mod_enabled(
        &self,
        profile_id: Uuid,
        filename: String,
        set_enabled: bool,
    ) -> Result<()> {
        // Changed return type to Result<()>
        let custom_mods_path = self.get_profile_custom_mods_path(profile_id).await?;

        // Ensure the filename itself doesn't end with .disabled - we expect the base name.
        if filename.ends_with(".disabled") {
            log::warn!("set_custom_mod_enabled called with filename ending in .disabled: '{}'. Please provide the base filename.", filename);
            return Err(AppError::Other(format!(
                "Invalid filename provided to set_custom_mod_enabled: {}",
                filename
            )));
        }

        let enabled_path = custom_mods_path.join(&filename);
        let disabled_filename = format!("{}.disabled", filename);
        let disabled_path = custom_mods_path.join(&disabled_filename);

        let current_enabled = enabled_path.exists();
        let currently_exists_as_disabled = disabled_path.exists();

        if !current_enabled && !currently_exists_as_disabled {
            // Neither file exists
            log::error!(
                "Could not find custom mod file '{}' or '{}' in {:?}",
                filename,
                disabled_filename,
                custom_mods_path
            );
            return Err(AppError::Other(format!(
                "Custom mod file not found: {} in {:?}",
                filename, custom_mods_path
            )));
        }

        // Check if the state is already the desired one
        if current_enabled == set_enabled {
            log::info!(
                "Custom mod '{}' is already {}. No action needed.",
                filename,
                if set_enabled { "enabled" } else { "disabled" }
            );
            return Ok(());
        }

        // Perform the rename if the state needs changing
        if set_enabled {
            // --> Enable it: Rename file.disabled to file
            log::info!(
                "Enabling custom mod: Renaming {:?} to {:?}",
                disabled_path,
                enabled_path
            );
            tokio::fs::rename(&disabled_path, &enabled_path)
                .await
                .map_err(|e| {
                    log::error!(
                        "Failed to rename custom mod {:?} to {:?}: {}",
                        disabled_path,
                        enabled_path,
                        e
                    );
                    AppError::Io(e)
                })?;
        } else {
            // --> Disable it: Rename file to file.disabled
            log::info!(
                "Disabling custom mod: Renaming {:?} to {:?}",
                enabled_path,
                disabled_path
            );
            tokio::fs::rename(&enabled_path, &disabled_path)
                .await
                .map_err(|e| {
                    log::error!(
                        "Failed to rename custom mod {:?} to {:?}: {}",
                        enabled_path,
                        disabled_path,
                        e
                    );
                    AppError::Io(e)
                })?;
        }

        log::info!(
            "Successfully set custom mod '{}' state to: {}",
            filename,
            if set_enabled { "enabled" } else { "disabled" }
        );
        Ok(())
    }

    /// Imports local .jar files selected by the user into the specified profile.
    /// It tries to identify mods via Modrinth hash lookup and adds them as Modrinth mods.
    /// If a mod is not found on Modrinth or an error occurs during lookup,
    /// it falls back to copying the file into the profile's custom_mods directory.
    pub async fn import_local_mods_to_profile(
        &self,
        profile_id: Uuid,
        paths_enums: Vec<FilePath>,
    ) -> Result<()> {
        info!(
            "Processing {} selected files for import into profile {}",
            paths_enums.len(),
            profile_id
        );

        // --- Collect Hashes and Paths ---
        let mut hashes_to_check: Vec<String> = Vec::new();
        let mut path_map: HashMap<String, PathBuf> = HashMap::new(); // Map: sha1 -> PathBuf
        let mut path_conversion_errors = 0;

        for file_path_enum in paths_enums {
            let src_path_buf = match file_path_enum.into_path() {
                Ok(path) => path,
                Err(e) => {
                    error!("Failed to convert selected file path: {}", e);
                    path_conversion_errors += 1;
                    continue;
                }
            };

            // Calculate hash using the async util function
            match hash_utils::calculate_sha1(&src_path_buf).await {
                Ok(hash) => {
                    // Avoid checking the same hash multiple times if user selects same file twice
                    if !path_map.contains_key(&hash) {
                        hashes_to_check.push(hash.clone());
                        path_map.insert(hash, src_path_buf);
                    } else {
                        warn!(
                            "Skipping duplicate file selection: {:?}",
                            src_path_buf.file_name().unwrap_or_default()
                        );
                    }
                }
                Err(e) => {
                    error!("Failed to calculate SHA1 for {:?}: {}", src_path_buf, e);
                    path_conversion_errors += 1;
                }
            }
        }

        if hashes_to_check.is_empty() {
            info!(
                "No valid files found to process after hashing/path conversion for profile {}.",
                profile_id
            );
            // Still return Ok, as no critical error occurred, just nothing to import
            return Ok(());
        }

        info!(
            "Attempting to look up {} unique hashes on Modrinth for profile {}...",
            hashes_to_check.len(),
            profile_id
        );

        // --- Modrinth Bulk Lookup ---
        // Use qualified path if modrinth module is imported directly
        let versions_map_result =
            crate::integrations::modrinth::get_versions_by_hashes(hashes_to_check, "sha1").await;

        // --- Process Results ---
        // Use normal mods directory for direct file placement
        let profile = self.get_profile(profile_id).await?;
        let mods_dir = if profile.loader == ModLoader::Fabric {
            self.get_profile_mods_path(&profile)?
        } else {
            self.get_profile_custom_mods_path(profile_id).await?
        };
        // Ensure mods_dir exists ONCE
        fs::create_dir_all(&mods_dir)
            .await
            .map_err(AppError::Io)?;

        let mut modrinth_added_count: u64 = 0;
        let mut custom_added_count: u64 = 0;
        let mut skipped_count: u64 = 0; // For already existing custom mods
        let mut error_count: u64 = path_conversion_errors;

        match versions_map_result {
            Ok(versions_map) => {
                info!(
                    "Successfully received results for {} hashes from Modrinth for profile {}.",
                    versions_map.len(),
                    profile_id
                );
                for (hash, src_path_buf) in path_map {
                    // Iterate through the originally collected paths/hashes
                    if let Some(modrinth_version) = versions_map.get(&hash) {
                        // Found on Modrinth
                        log::debug!(
                            "Processing Modrinth match for hash {} for profile {}: {:?}",
                            hash,
                            profile_id,
                            src_path_buf.file_name().unwrap_or_default()
                        );
                        if let Some(primary_file) =
                            modrinth_version.files.iter().find(|f| f.primary)
                        {
                            match self
                                .add_modrinth_mod(
                                    // Use self
                                    profile_id,
                                    modrinth_version.project_id.clone(),
                                    modrinth_version.id.clone(),
                                    primary_file.filename.clone(),
                                    primary_file.url.clone(),
                                    primary_file.hashes.sha1.clone(),
                                    Some(modrinth_version.name.clone()),
                                    Some(modrinth_version.version_number.clone()),
                                    Some(modrinth_version.loaders.clone()),
                                    Some(modrinth_version.game_versions.clone()),
                                    false, // add_dependencies = true
                                )
                                .await
                            {
                                Ok(_) => {
                                    info!(
                                        "Successfully added '{}' as Modrinth mod to profile {}.",
                                        primary_file.filename, profile_id
                                    );
                                    modrinth_added_count += 1;
                                }
                                Err(e) => {
                                    // Log error, count it, but continue processing other files
                                    error!("Failed to add identified Modrinth mod '{}' to profile {}: {}", primary_file.filename, profile_id, e);
                                    error_count += 1;
                                }
                            }
                        } else {
                            // Log error, count it, and fallback
                            error!("Modrinth version {} found for hash {}, but no primary file found. Falling back to custom mod import for profile {} - {:?}.", modrinth_version.id, hash, profile_id, src_path_buf.file_name().unwrap_or_default());
                            error_count += 1; // Count as error because Modrinth add failed essentially
                            path_utils::copy_as_custom_mod(
                                &src_path_buf,
                                &mods_dir,
                                profile_id,
                                &mut custom_added_count,
                                &mut skipped_count,
                            )
                            .await;
                        }
                    } else {
                        // Not found in Modrinth results -> Treat as custom mod
                        log::info!("Mod {:?} (hash: {}) not found on Modrinth for profile {}. Importing as custom mod.", src_path_buf.file_name().unwrap_or_default(), hash, profile_id);
                        path_utils::copy_as_custom_mod(
                            &src_path_buf,
                            &mods_dir,
                            profile_id,
                            &mut custom_added_count,
                            &mut skipped_count,
                        )
                        .await;
                    }
                }
            }
            Err(e) => {
                log::error!("Failed to perform bulk hash lookup on Modrinth for profile {}: {}. Falling back to importing all as custom mods.", profile_id, e);
                error_count += path_map.len() as u64; // Count all as errors for Modrinth lookup
                                                      // Fallback: Try adding all as custom mods
                for (_hash, src_path_buf) in path_map {
                    path_utils::copy_as_custom_mod(
                        &src_path_buf,
                        &mods_dir,
                        profile_id,
                        &mut custom_added_count,
                        &mut skipped_count,
                    )
                    .await;
                }
            }
        }

        log::info!(
            "Import process finished for profile {}. Added as Modrinth: {}, Added as Custom: {}, Skipped (exists/other): {}, Hashing/Path/Lookup Errors: {}",
            profile_id, modrinth_added_count, custom_added_count, skipped_count, error_count
        );

        // No critical error occurred during the process itself, return Ok.
        // Individual file errors are logged and counted.
        Ok(())
    }

    /// Deletes a custom mod file (either .jar or .jar.disabled) from the profile's custom_mods directory.
    pub async fn delete_custom_mod_file(&self, profile_id: Uuid, filename: &str) -> Result<()> {
        info!(
            "Attempting to delete custom mod file '{}' for profile {}",
            filename, profile_id
        );

        // Note: Validation that filename doesn't end with .disabled should happen in the caller (command)

        let custom_mods_dir = self.get_profile_custom_mods_path(profile_id).await?;

        let enabled_path = custom_mods_dir.join(filename); // filename is the base name
        let disabled_filename = format!("{}.disabled", filename);
        let disabled_path = custom_mods_dir.join(&disabled_filename);

        let file_to_delete = if enabled_path.exists() {
            Some(enabled_path)
        } else if disabled_path.exists() {
            Some(disabled_path)
        } else {
            None
        };

        if let Some(path_to_delete) = file_to_delete {
            log::debug!("Deleting custom mod file at path: {:?}", path_to_delete);
            fs::remove_file(&path_to_delete).await.map_err(|e| {
                log::error!(
                    "Failed to delete custom mod file {:?}: {}",
                    path_to_delete,
                    e
                );
                AppError::Io(e)
            })?; // Propagate IO error
            info!(
                "Successfully deleted custom mod file corresponding to '{}' for profile {}.",
                filename, profile_id
            );
            Ok(())
        } else {
            log::warn!(
                "Custom mod file '{}' not found (neither enabled nor disabled) in profile {}.",
                filename,
                profile_id
            );
            // Return specific error indicating file not found
            Err(AppError::Profile(format!(
                "Custom mod {} in profile {}",
                filename, profile_id
            )))
        }
    }
}

#[async_trait]
impl PostInitializationHandler for ProfileManager {
    async fn on_state_ready(&self, _app_handle: Arc<tauri::AppHandle>) -> Result<()> {
        info!("ProfileManager: on_state_ready called. Loading profiles...");
        let mut loaded_profiles = self
            .load_profiles_internal(&self.profiles_path.clone())
            .await?;
        
        // Perform profile migrations
        let migration_count = crate::utils::migration_utils::migrate_profiles(&mut loaded_profiles);
        
        // Set profiles in memory
        let mut profiles_guard = self.profiles.write().await;
        *profiles_guard = loaded_profiles;
        drop(profiles_guard);
        
        // Save profiles to disk if migrations were performed
        if migration_count > 0 {
            info!("ProfileManager: Saving migrated profiles to disk...");
            self.save_profiles().await?;
            info!("ProfileManager: Successfully saved migrated profiles.");
        }
        
        info!("ProfileManager: Successfully loaded profiles in on_state_ready.");

        // Fire-and-forget: purge trashed items after init (test: 2 minutes)
        tauri::async_runtime::spawn(async move {
            let seconds_30_days = 30 * 24 * 60 * 60;
            let seconds_2_minutes = 2 * 60;
            if let Err(e) = crate::utils::trash_utils::purge_expired(seconds_30_days).await {
                log::warn!("Trash purge after init failed: {}", e);
            }
        });

        Ok(())
    }
}

/// Helper function to determine the definitive filename for a mod defined within a Profile.
pub fn get_profile_mod_filename(source: &ModSource) -> crate::error::Result<String> {
    match source {
        ModSource::Modrinth { file_name, .. } => Ok(file_name.clone()),
        ModSource::Local { file_name } => Ok(file_name.clone()),
        ModSource::Url { file_name, url } => file_name.clone().ok_or_else(|| {
            crate::error::AppError::Other(format!("Filename missing for URL mod source: {}", url))
        }),
        ModSource::Maven { coordinates, .. } => Err(crate::error::AppError::Other(format!(
            "Cannot determine filename for profile Maven mod source: {}",
            coordinates
        ))),
        ModSource::Embedded { name } => Err(crate::error::AppError::Other(format!(
            "Cannot get filename for embedded mod source: {}",
            name
        ))),
    }
}

pub fn default_profile_path() -> PathBuf {
    // Check cache first (same system as meta_dir)
    if let Ok(guard) = crate::config::CUSTOM_GAME_DIR_CACHE.read() {
        if let Some(cached_value) = guard.as_ref() {
            if let Some(custom_dir) = cached_value {
                return custom_dir.join("profiles");
            }
        }
    }
    
    // Fallback to standard logic
    LAUNCHER_DIRECTORY.data_dir().join("profiles")
}

impl Default for ProfileSettings {
    fn default() -> Self {
        Self {
            java_path: None,
            use_custom_java_path: false,
            memory: MemorySettings::default(),
            resolution: None,
            fullscreen: false,
            extra_game_args: Vec::new(),
            custom_jvm_args: None, // Standardmäßig keine benutzerdefinierten JVM-Args
        }
    }
}

impl Default for MemorySettings {
    fn default() -> Self {
        Self {
            min: 1024, // 1GB
            max: 2048, // 2GB
        }
    }
}

impl Default for WindowSize {
    fn default() -> Self {
        Self {
            width: 854,
            height: 480,
        }
    }
}
