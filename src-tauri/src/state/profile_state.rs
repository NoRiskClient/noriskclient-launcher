use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::AppError;
use crate::error::Result;
use crate::integrations::modrinth::{self, ModrinthDependencyType, ModrinthVersion};
use crate::state::post_init::PostInitializationHandler;
use crate::utils::backup_utils::{self, BackupConfig};
use crate::utils::hash_utils;
use crate::utils::mc_utils;
use crate::utils::path_utils;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use futures::future::BoxFuture;
use log::{error, info, trace, warn};
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
    CurseForge {
        project_id: String,             // CurseForge Project ID (e.g., "238222")
        file_id: String,                // CurseForge File ID (e.g., "6829086")
        file_name: String, // The actual filename (e.g., "jei-1.21.1-neoforge-19.22.1.316.jar")
        download_url: String, // The direct download URL used when adding
        file_hash_sha1: Option<String>, // Optional SHA1 hash for verification
        file_fingerprint: Option<u64>, // CurseForge fingerprint for update checking
    }, // New variant for CurseForge mods
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
    /// Origin modpack identifier in format: "platform:project_id[:version_id]"
    /// Example: "modrinth:AANobbMI:tFw0iWAk" or "curseforge:12345:67890"
    /// None for manually added mods
    pub modpack_origin: Option<String>,
    /// True if automatic updates are enabled for this mod (default: true)
    #[serde(default = "default_true")]
    pub updates_enabled: bool,
    /// Additional MC versions the user has explicitly forced this mod to load on,
    /// even if they are not listed in `game_versions`. Written at install/update time
    /// when the target profile's MC version is absent from the upstream metadata
    /// (e.g. a mod tagged only for 26.1.1 installed into a 26.1.2 profile).
    #[serde(default)]
    pub force_include_versions: Vec<String>,
    #[serde(flatten, default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub extra: serde_json::Map<String, serde_json::Value>,
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

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
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
    #[serde(default)]
    pub loader_version: Option<String>, // Modloader Version
    #[serde(default)]
    pub created: DateTime<Utc>, // Erstellungsdatum
    #[serde(default)]
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
    /// Whether this profile should use a shared Minecraft folder
    #[serde(default)]
    pub use_shared_minecraft_folder: bool,
    /// True if this is a standard profile template, false if it's a user profile.
    #[serde(default)] // Defaults to false for existing user profiles
    pub is_standard_version: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub banner: Option<ProfileBanner>, // Banner/background image for the profile
    #[serde(default)]
    pub background: Option<ProfileBanner>,
    #[serde(default)]
    pub norisk_information: Option<NoriskInformation>,
    /// Information about this profile's modpack origin (if it was created from a modpack)
    #[serde(default)]
    pub modpack_info: Option<ModPackInfo>,
    /// Optional preferred account UUID for launching this profile
    /// If set, this account will be used instead of the global active account
    #[serde(default)]
    pub preferred_account_id: Option<Uuid>,
    /// Accumulated Minecraft playtime for this profile, in seconds.
    /// Incremented on process-exit via `ProcessManager` using `start_time - exit_time`.
    #[serde(default)]
    pub playtime_seconds: u64,
    #[serde(flatten, default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Profile {
    pub async fn effective_norisk_pack_id(&self) -> Option<String> {
        let original = self.selected_norisk_pack_id.as_deref()?;
        Some(
            crate::commands::pack_rollout_commands::resolve_effective_pack_id(original).await,
        )
    }
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
    #[serde(default)]
    pub is_main_version: bool,
}

/// Information about a modpack source (Modrinth or CurseForge)
/// This allows tracking the origin and versions of modpacks for updates
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum ModPackSource {
    /// Modrinth modpack source
    Modrinth {
        /// Modrinth Project ID (e.g., "AANobbMI")
        project_id: String,
        /// Modrinth Version ID (e.g., "tFw0iWAk")
        version_id: String,
    },
    /// CurseForge modpack source
    CurseForge {
        /// CurseForge Project ID
        project_id: u32,
        /// CurseForge File ID
        file_id: u32,
    },
}

/// Information about a modpack installation
/// Stores metadata about installed modpacks for tracking and updates
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModPackInfo {
    /// The source platform and identifiers
    pub source: ModPackSource,
    /// File hash for verification (SHA1 for Modrinth, fingerprint for CurseForge)
    pub file_hash: Option<String>,
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
    #[serde(default)]
    pub use_overwrite_loader_version: bool, // Ob die überschriebene Loader-Version verwendet werden soll
    // LEGACY single-slot override. Kept for backwards-compat with existing
    // profile JSONs and with the settings modal that still writes here. The
    // handler (profile_command.rs) mirrors any non-empty value into
    // `overwrite_loader_versions` under the current loader key on save, so
    // new reads prefer the per-loader map.
    pub overwrite_loader_version: Option<String>,
    // Per-loader override map. Key = `ModLoader::as_str()` ("fabric", "forge",
    // "quilt", "neoforge"). Lets profiles hold distinct pinned versions for
    // each loader, so switching Fabric → Forge → Fabric restores the Fabric
    // pick instead of inheriting a meaningless string.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub overwrite_loader_versions: HashMap<String, String>,
    pub memory: MemorySettings,    // Speicher Einstellungen
    #[serde(default)]
    pub resolution: Option<WindowSize>, // Auflösung
    #[serde(default)]
    pub fullscreen: bool, // Vollbild
    #[serde(default)]
    pub extra_game_args: Vec<String>, // Zusätzliche Argumente für das Spiel
    #[serde(default)] // Für Abwärtskompatibilität
    pub custom_jvm_args: Option<String>, // Zusätzliche JVM-Argumente als String
    #[serde(default)]
    pub quick_play_path: Option<String>, // Quick Play Pfad für direkten Welt-/Server-Start
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

impl Profile {
    /// Returns whether this profile should actually use a shared Minecraft folder.
    /// This method takes into account both the profile setting and special group logic.
    pub fn should_use_shared_minecraft_folder(&self) -> bool {
        // For isolated groups (server, modpacks), always return false regardless of the setting
        if let Some(group) = &self.group {
            if ProfileManager::is_isolated_group(group) {
                return false;
            }
        }
        
        // Profile has no group, don't use shared folder (use original path logic)
        self.use_shared_minecraft_folder
    }
}

/// Metadata about a single `profiles.json` backup, surfaced to the restore UI.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProfileBackupInfo {
    pub path: String,
    pub backup_time: i64,
    pub file_size: u64,
    pub profile_count: usize,
}

#[cfg(test)]
#[path = "profile_state_test.rs"]
mod tests;

pub(crate) fn mod_project_key(source: &ModSource) -> Option<(&'static str, &str)> {
    match source {
        ModSource::Modrinth { project_id, .. } => Some(("modrinth", project_id.as_str())),
        ModSource::CurseForge { project_id, .. } => Some(("curseforge", project_id.as_str())),
        _ => None,
    }
}

pub(crate) fn find_mod_by_project(mods: &[Mod], source: &ModSource) -> Option<usize> {
    let key = mod_project_key(source)?;
    mods.iter()
        .position(|m| mod_project_key(&m.source) == Some(key))
}

pub(crate) fn find_mod_by_project_id(mods: &[Mod], project_id: &str) -> Option<usize> {
    mods.iter()
        .position(|m| mod_project_key(&m.source).map(|(_, id)| id) == Some(project_id))
}

pub(crate) fn replace_mod_with_payload(
    existing: &mut Mod,
    payload: &crate::commands::content_command::InstallContentPayload,
    source: ModSource,
) {
    existing.source = source;
    existing.display_name = payload.content_name.clone();
    existing.version = payload.version_number.clone();
    existing.game_versions = payload.game_versions.clone();
    existing.file_name_override = None;
    existing.associated_loader = payload
        .loaders
        .clone()
        .and_then(|l| l.first().and_then(|s| ModLoader::from_str(s).ok()));
    existing.enabled = true;
}

pub(crate) fn find_mod_for_version_switch(
    mods: &[Mod],
    current_item: &crate::utils::profile_utils::LocalContentItem,
) -> Option<usize> {
    if let Some(id) = current_item.id.as_ref() {
        return mods.iter().position(|m| m.id.to_string() == *id);
    }

    let project_id = current_item
        .modrinth_info
        .as_ref()
        .map(|info| info.project_id.as_str())
        .or_else(|| {
            current_item
                .curseforge_info
                .as_ref()
                .map(|info| info.project_id.as_str())
        })?;

    find_mod_by_project_id(mods, project_id)
}

// Profile Manager
pub struct ProfileManager {
    profiles: Arc<RwLock<HashMap<Uuid, Profile>>>,
    profiles_path: PathBuf,
    save_lock: Mutex<()>,
    backup_config: BackupConfig,
    store: crate::state::profile_store::ProfileStore,
    db: crate::state::db::DbHandle,
    transient: RwLock<HashSet<Uuid>>,
    persisted: Mutex<HashMap<Uuid, u64>>,
    loading: Mutex<()>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStoreStatus {
    pub profile_count: usize,
    pub mod_count: usize,
    pub legacy_json_available: bool,
}


/// Rewrite an installed mod in-place to a [`UnifiedVersion`] (Modrinth or CurseForge): source,
/// version, game versions, loader, and force-include the profile MC if the version omits it.
/// Shared by both unified version-switch paths. Errors if the version has no file.
fn apply_unified_version_to_mod(
    m: &mut Mod,
    v: &crate::integrations::unified_mod::UnifiedVersion,
    profile_mc_version: &str,
) -> Result<()> {
    use crate::integrations::unified_mod::ModPlatform;

    let primary_file = v
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| v.files.first())
        .ok_or_else(|| AppError::Other(format!("Unified version {} has no file", v.id)))?;

    m.source = match v.source {
        ModPlatform::Modrinth => ModSource::Modrinth {
            project_id: v.project_id.clone(),
            version_id: v.id.clone(),
            file_name: primary_file.filename.clone(),
            download_url: primary_file.url.clone(),
            file_hash_sha1: primary_file.hashes.get("sha1").cloned(),
        },
        ModPlatform::CurseForge => ModSource::CurseForge {
            project_id: v.project_id.clone(),
            file_id: v.id.clone(),
            file_name: primary_file.filename.clone(),
            download_url: primary_file.url.clone(),
            file_hash_sha1: primary_file.hashes.get("sha1").cloned(),
            file_fingerprint: primary_file.fingerprint,
        },
    };

    m.version = Some(v.version_number.clone());
    m.game_versions = Some(v.game_versions.clone());
    if !v.game_versions.iter().any(|g| g == profile_mc_version)
        && !m.force_include_versions.iter().any(|g| g == profile_mc_version)
    {
        m.force_include_versions.push(profile_mc_version.to_string());
    }
    if let Some(loader) = v.loaders.first().and_then(|s| ModLoader::from_str(s).ok()) {
        m.associated_loader = Some(loader);
    }
    if m.display_name.is_none() {
        m.display_name = Some(v.name.clone());
    }
    Ok(())
}

impl ProfileManager {
    pub fn new(profiles_path: PathBuf, db: crate::state::db::DbHandle) -> Result<Self> {
        trace!(
            "ProfileManager: Initializing with path: {:?} (profiles loading deferred)",
            profiles_path
        );

        // Configure backup settings - more aggressive for profiles due to critical nature
        let backup_config = BackupConfig {
            max_backups_per_file: 10, // Keep more backups for profiles
            max_backup_age_seconds: 90 * 24 * 60 * 60, // 90 days for profiles
            min_backup_interval_seconds: 60, // TEMP: Increased to 5 minutes to prevent spam during testing
            gfs: Some(backup_utils::GfsPolicy {
                keep_recent: 10,
                daily_days: 14,
                weekly_weeks: 8,
                monthly_months: 12,
            }),
        };

        Ok(Self {
            profiles: Arc::new(RwLock::new(HashMap::new())), // Start with empty profiles
            profiles_path,
            save_lock: Mutex::new(()),
            backup_config,
            store: crate::state::profile_store::ProfileStore::new(db.clone()),
            db,
            transient: RwLock::new(HashSet::new()),
            persisted: Mutex::new(HashMap::new()),
            loading: Mutex::new(()),
        })
    }

    // Renamed from load_profiles to avoid conflict, made internal
    pub async fn list_profile_backups(&self) -> Result<Vec<ProfileBackupInfo>> {
        let backups = backup_utils::list_backups(&self.profiles_path, Some("profiles")).await?;
        let mut out = Vec::with_capacity(backups.len());
        for (path, mtime) in backups {
            let file_size = fs::metadata(&path).await.map(|m| m.len()).unwrap_or(0);
            let profile_count = match fs::read_to_string(&path).await {
                Ok(data) => serde_json::from_str::<Vec<serde_json::Value>>(&data)
                    .map(|v| v.len())
                    .unwrap_or(0),
                Err(_) => 0,
            };
            out.push(ProfileBackupInfo {
                path: path.to_string_lossy().to_string(),
                backup_time: mtime.timestamp(),
                file_size,
                profile_count,
            });
        }
        Ok(out)
    }

    /// Restores a user-chosen backup over `profiles.json` and reloads the
    /// in-memory map so the change is live without a restart.
    pub async fn restore_profile_backup(&self, backup_path: PathBuf) -> Result<()> {
        let _guard = self.save_lock.lock().await;

        let raw = fs::read_to_string(&backup_path).await?;
        self.snapshot_database("pre-restore").await;
        let outcome = self.store.import_from_json(&raw).await?;
        let reloaded = self.store.load_all().await?;
        self.adopt_profiles(reloaded).await;
        info!(
            "ProfileManager: restored {} profiles and {} mods from {:?} ({} quarantined)",
            outcome.imported, outcome.mods, backup_path, outcome.unparsed
        );
        Ok(())
    }

    async fn adopt_profiles(&self, profiles: HashMap<Uuid, Profile>) {
        let count = profiles.len();
        *self.profiles.write().await = profiles;
        self.persisted.lock().await.clear();
        info!("ProfileManager: Reloaded {} profiles after restore", count);
    }

    async fn snapshot_database_for_version(&self) {
        const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
        const VERSION_KEY: &str = "app_version";

        match self.store.get_meta(VERSION_KEY).await {
            Ok(Some(recorded)) if recorded == APP_VERSION => return,
            Ok(_) => {}
            Err(e) => {
                warn!("Could not read the recorded app version: {}", e);
                return;
            }
        }

        self.snapshot_database(&format!("v{}", APP_VERSION)).await;
        self.prune_database_snapshots().await;

        if let Err(e) = self.store.set_meta(VERSION_KEY, APP_VERSION).await {
            warn!("Could not record the app version: {}", e);
        }
    }

    async fn prune_database_snapshots(&self) {
        const KEEP: usize = 10;

        let dir = LAUNCHER_DIRECTORY.meta_dir().join("backups").join("db");
        let Ok(mut entries) = std::fs::read_dir(&dir) else {
            return;
        };

        let mut snapshots: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
        let mut oldest_migration: Option<(std::time::SystemTime, PathBuf)> = None;
        while let Some(Ok(entry)) = entries.next() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let modified = entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            let is_migration = path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|name| name.ends_with(PRE_MIGRATION_SNAPSHOT));
            if is_migration {
                match &oldest_migration {
                    Some((seen, _)) if *seen <= modified => snapshots.push((modified, path)),
                    Some((_, kept)) => {
                        snapshots.push((modified, kept.clone()));
                        oldest_migration = Some((modified, path));
                    }
                    None => oldest_migration = Some((modified, path)),
                }
                continue;
            }
            snapshots.push((modified, path));
        }

        if snapshots.len() <= KEEP {
            return;
        }

        snapshots.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, path) in snapshots.into_iter().skip(KEEP) {
            match std::fs::remove_file(&path) {
                Ok(()) => info!("Pruned the old database snapshot {:?}", path),
                Err(e) => warn!("Could not prune {:?}: {}", path, e),
            }
        }
    }

    async fn snapshot_database(&self, label: &str) {
        let destination = LAUNCHER_DIRECTORY
            .meta_dir()
            .join("backups")
            .join("db")
            .join(format!("app.db.{}.{}", Utc::now().timestamp(), label));
        if let Err(e) = crate::state::db::vacuum_into(&self.db, &destination).await {
            warn!("Could not snapshot the database before {}: {}", label, e);
        }
    }

    /// Inserts a profile into the in-memory map WITHOUT persisting to
    /// `profiles.json`. Used for throwaway temp profiles (CLI `temp` subcommand)
    /// so that by-id lookups during launch — `get_profile`,
    /// `get_profile_instance_path`, `list_custom_mods`, ProcessManager
    /// playtime/crash handling — all succeed. `save_profiles()` filters these
    /// out by their `temp/` path prefix, so they never reach disk.
    pub async fn register_transient_profile(&self, profile: Profile) {
        self.transient.write().await.insert(profile.id);
        let id = profile.id;
        self.profiles.write().await.insert(id, profile);
        log::info!(
            "[ProfileManager] Registered transient (temp) profile {} (in-memory only)",
            id
        );
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
        info!("Persisting the new profile {}", id);
        self.save_profile(id).await?;
        Ok(id)
    }

    pub async fn get_profile(&self, id: Uuid) -> Result<Profile> {
        let profile = self.profiles.read().await.get(&id).cloned();
        if let Some(profile) = profile {
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
        {
            let mut profiles = self.profiles.write().await;
            profiles.insert(id, profile);
        }
        self.save_profile(id).await?;
        Ok(())
    }

    pub async fn resolve_and_migrate_pack_id(&self, profile_id: Uuid) -> Result<Option<String>> {
        let mut profile = self.get_profile(profile_id).await?;
        // Empty string is the "no pack / vanilla" sentinel — never migrate it.
        let Some(original) = profile
            .selected_norisk_pack_id
            .clone()
            .filter(|s| !s.trim().is_empty())
        else {
            return Ok(None);
        };

        let aliased =
            crate::commands::pack_rollout_commands::resolve_effective_pack_id(&original).await;

        let state = crate::state::state_manager::State::get().await?;
        let config = state.norisk_pack_manager.get_config().await;

        // Skip migration before pack config has loaded — would otherwise nuke every profile on first boot.
        if config.packs.is_empty() {
            return Ok(Some(aliased));
        }

        if config.packs.contains_key(&aliased) {
            return Ok(Some(aliased));
        }

        let fallback = crate::commands::pack_fallback_commands::get_fallback_pack_id().await;
        warn!(
            "[PackFallback] Profile '{}' references missing pack '{}' (from '{}'). Falling back to '{}'.",
            profile.name, aliased, original, fallback
        );

        if !config.packs.contains_key(&fallback) {
            error!(
                "[PackFallback] Fallback pack '{}' also missing. Clearing selection for profile '{}'.",
                fallback, profile.name
            );
            profile.selected_norisk_pack_id = None;
            self.update_profile(profile_id, profile).await?;
            return Ok(None);
        }

        profile.selected_norisk_pack_id = Some(fallback.clone());
        self.update_profile(profile_id, profile).await?;
        Ok(Some(fallback))
    }

    /// Helper function to check if any other profile uses the same path
    /// This is used before deleting a profile directory to ensure we don't delete
    /// files that are still needed by other profiles
    async fn has_other_profile_with_same_path<F>(&self, exclude_id: Uuid, target_path: &PathBuf, path_calculator: F) -> bool
    where
        F: Fn(&Profile) -> PathBuf,
    {
        let profiles = self.profiles.read().await;

        for (&profile_id, profile) in profiles.iter() {
            // Skip the profile we're about to delete
            if profile_id == exclude_id {
                continue;
            }

            // Calculate the path for this profile and compare
            let other_path = path_calculator(profile);
            if other_path == *target_path {
                info!(
                    "Found another profile '{}' (ID: {}) using the same path: {:?}",
                    profile.name, profile_id, target_path
                );
                return true;
            }
        }

        false
    }

    pub async fn delete_profile(&self, id: Uuid) -> Result<()> {
        let profile_to_delete: Option<Profile>;

        // Scope to release the read lock quickly
        {
            let profiles = self.profiles.read().await;
            profile_to_delete = profiles.get(&id).cloned(); // Clone the profile data if it exists
        }

        // If the profile exists, determine its path using the helper function
        let profile_dir_path = if let Some(profile) = &profile_to_delete {
            match self.calculate_instance_path_for_profile(&profile) {
                Ok(path) => {
                    info!(
                        "Profile '{}' marked for deletion. Directory path: {:?}",
                        profile.name, path
                    );
                    Some(path)
                }
                Err(e) => {
                    // Should not happen if profile object is valid, but handle defensively
                    error!("Failed to calculate instance path for profile '{}': {}. Aborting directory deletion.", profile.name, e);
                    // Return an error, as we can't be sure about the path
                    return Err(AppError::Other(format!(
                        "Could not calculate profile path: {}",
                        e
                    )));
                }
            }
        } else {
            // Profile not found in map, nothing to delete on filesystem
            info!("Profile with ID {} not found for deletion.", id);
            return Err(AppError::ProfileNotFound(id)); // Return error if profile doesn't exist
        };

        // Check if other profiles use the same path before attempting directory deletion
        let should_delete_directory = if let Some(path) = &profile_dir_path {
            if self.has_other_profile_with_same_path(id, path, |profile| {
                self.calculate_instance_path_for_profile(profile).unwrap_or_default()
            }).await {
                info!(
                    "Another profile is using the same directory path {:?}. Skipping directory deletion.",
                    path
                );
                false
            } else {
                info!(
                    "No other profile uses the directory path {:?}. Safe to delete.",
                    path
                );
                true
            }
        } else {
            false
        };

        // Attempt to delete the directory only if no other profile uses it
        if should_delete_directory {
            if let Some(ref path) = profile_dir_path {
                if path.exists() {
                    info!("Moving profile directory to trash: {:?}", path);
                    match crate::utils::trash_utils::move_path_to_trash(path, Some("profiles")).await {
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
        }

        // Additionally, always try to delete the individual profile path (build_path_from_profile_path)
        // This covers cases where the profile might have files in both group and individual directories
        if let Some(profile) = &profile_to_delete {
            let individual_path = Self::build_path_from_profile_path(profile);

            // Only delete if it's different from the main path
            if Some(&individual_path) != profile_dir_path.as_ref() {
                // Check if other profiles use the same individual path before attempting deletion
                let should_delete_individual_directory = if self.has_other_profile_with_same_path(id, &individual_path, |profile| {
                    Self::build_path_from_profile_path(profile)
                }).await {
                    info!(
                        "Another profile is using the same individual directory path {:?}. Skipping individual directory deletion.",
                        individual_path
                    );
                    false
                } else {
                    info!(
                        "No other profile uses the individual directory path {:?}. Safe to delete.",
                        individual_path
                    );
                    true
                };

                if should_delete_individual_directory {
                    if individual_path.exists() {
                        info!("Moving individual profile directory to trash: {:?}", individual_path);
                        match crate::utils::trash_utils::move_path_to_trash(&individual_path, Some("profiles")).await {
                            Ok(wrapper) => info!("Individual profile directory moved to trash wrapper: {:?}", wrapper),
                            Err(e) => {
                                error!("Failed to move individual profile directory {:?} to trash: {}", individual_path, e);
                                // Don't return error here, as the main profile deletion was successful
                                warn!("Continuing despite individual path deletion failure.");
                            }
                        }
                    } else {
                        info!(
                            "Individual profile directory {:?} does not exist. Skipping deletion.",
                            individual_path
                        );
                    }
                }
            } else {
                info!("Individual path is the same as main path, skipping separate deletion.");
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

        self.store.delete_profile(id).await?;
        self.persisted.lock().await.remove(&id);
        info!(
            "Successfully removed profile entry {} from configuration.",
            id
        );

        Ok(())
    }

    // Add a new mod to a specific profile
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

                        let force_include_versions = match &game_versions {
                            Some(list) if !list.contains(&profile.game_version) => {
                                vec![profile.game_version.clone()]
                            }
                            _ => Vec::new(),
                        };

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
                            modpack_origin: None, // Manually added mod
                            updates_enabled: true, // Updates enabled by default
                            force_include_versions,
                            extra: Default::default(),
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
                self.save_profile(profile_id).await?;
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
                                                    
                                                     // Attempt 1: among versions supporting the target game versions, pick the one
                                                     // CONTEMPORANEOUS with the parent — the newest dep version published at-or-before
                                                     // the parent's release date. Installing the absolute newest dep for an OLD parent
                                                     // (e.g. switching Iris to its oldest version) wrongly pulls a brand-new Sodium.
                                                     let parent_date = version_info.date_published.as_str();
                                                     let compatible: Vec<&ModrinthVersion> = dep_versions.iter()
                                                         .filter(|dep_v| target_game_versions_for_dep.iter().any(|target_gv| dep_v.game_versions.contains(target_gv)))
                                                         .collect();
                                                     best_dep_version = compatible.iter().copied()
                                                         .filter(|v| v.date_published.as_str() <= parent_date)
                                                         .max_by(|a, b| a.date_published.cmp(&b.date_published))
                                                         .or_else(|| compatible.iter().copied().min_by(|a, b| a.date_published.cmp(&b.date_published)));

                                                     // Attempt 2: no game-version match -> newest contemporaneous-or-older for the loader,
                                                     // else the overall newest.
                                                     if best_dep_version.is_none() {
                                                         warn!("Could not find dependency version matching target game versions {:?} for project '{}'. Falling back to loader-compatible version near parent date '{}'.", target_game_versions_for_dep, dep_project_id, parent_date);
                                                         best_dep_version = dep_versions.iter()
                                                             .filter(|v| v.date_published.as_str() <= parent_date)
                                                             .max_by(|a, b| a.date_published.cmp(&b.date_published))
                                                             .or_else(|| dep_versions.iter().max_by(|a, b| a.date_published.cmp(&b.date_published)));
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

    // Public wrapper function to add a mod (supports both Modrinth and CurseForge)
    pub async fn add_mod_from_payload(
        &self,
        payload: &crate::commands::content_command::InstallContentPayload,
        add_dependencies: bool,
    ) -> Result<()> {
        use crate::integrations::unified_mod::ModPlatform;

        let display_name_log = payload.content_name.as_deref().unwrap_or(&payload.project_id);
        let platform_name = match payload.source {
            ModPlatform::Modrinth => "Modrinth",
            ModPlatform::CurseForge => "CurseForge",
        };

        info!(
            "Adding {} mod {} to profile {} (dependencies: {})",
            platform_name, display_name_log, payload.profile_id, add_dependencies
        );

        let source = match payload.source {
            ModPlatform::Modrinth => ModSource::Modrinth {
                project_id: payload.project_id.clone(),
                version_id: payload.version_id.clone(),
                file_name: payload.file_name.clone(),
                download_url: payload.download_url.clone(),
                file_hash_sha1: payload.file_hash_sha1.clone(),
            },
            ModPlatform::CurseForge => ModSource::CurseForge {
                project_id: payload.project_id.clone(),
                file_id: payload.version_id.clone(), // For CurseForge, version_id is actually file_id
                file_name: payload.file_name.clone(),
                download_url: payload.download_url.clone(),
                file_hash_sha1: payload.file_hash_sha1.clone(),
                file_fingerprint: payload.file_fingerprint,
            },
        };

        let mut needs_save = false;
        {
            let mut profiles = self.profiles.write().await;
            if let Some(profile) = profiles.get_mut(&payload.profile_id) {
                let existing_index = find_mod_by_project(&profile.mods, &source);

                if let Some(index) = existing_index {
                    if profile.mods[index].source == source {
                        info!(
                            "{} mod {} already exists in profile {}. Skipping addition.",
                            platform_name, display_name_log, payload.profile_id
                        );
                    } else {
                        info!(
                            "{} mod {} already present in profile {} in a different version. Replacing it instead of adding a duplicate.",
                            platform_name, display_name_log, payload.profile_id
                        );
                        replace_mod_with_payload(&mut profile.mods[index], payload, source.clone());
                        needs_save = true;
                    }
                } else {
                    info!(
                        "Adding mod {} to profile {}",
                        display_name_log, payload.profile_id
                    );

                    let force_include_versions = match &payload.game_versions {
                        Some(list) if !list.contains(&profile.game_version) => {
                            vec![profile.game_version.clone()]
                        }
                        _ => Vec::new(),
                    };

                    let new_mod = Mod {
                        id: Uuid::new_v4(),
                        source: source.clone(),
                        enabled: true,
                        display_name: payload.content_name.clone(),
                        version: payload.version_number.clone(),
                        game_versions: payload.game_versions.clone(),
                        file_name_override: None,
                        associated_loader: payload.loaders
                            .clone()
                            .and_then(|l| l.first().and_then(|s| ModLoader::from_str(s).ok())),
                        modpack_origin: None, // Manually added mod
                        updates_enabled: true, // Updates enabled by default
                        force_include_versions,
                        extra: Default::default(),
                    };
                    profile.mods.push(new_mod);
                    needs_save = true;
                }
            } else {
                return Err(AppError::ProfileNotFound(payload.profile_id));
            }
        }

        if needs_save {
            self.save_profile(payload.profile_id).await?;
            info!(
                "Successfully added {} mod {} to profile {}",
                platform_name, display_name_log, payload.profile_id
            );
        }

        // Install dependencies if requested
        if add_dependencies {
            self.install_dependencies_for_mod(payload, display_name_log, platform_name).await?;
        }

        Ok(())
    }

    // Helper method to install dependencies for a mod
    async fn install_dependencies_for_mod(
        &self,
        payload: &crate::commands::content_command::InstallContentPayload,
        display_name_log: &str,
        platform_name: &str,
    ) -> Result<()> {
        use crate::integrations::unified_mod::{ModPlatform, UnifiedVersion};

        info!(
            "Installing dependencies for {} mod {} (version: {})",
            platform_name,
            display_name_log,
            payload.version_number.as_deref().unwrap_or("unknown")
        );

        let version: UnifiedVersion = match payload.source {
            ModPlatform::Modrinth => {
                match crate::integrations::modrinth::get_version_details(payload.version_id.clone()).await {
                    Ok(full_version) => {
                        if let Ok(state) = crate::state::state_manager::State::get().await {
                            info!(
                                "[cache-warm] single install warming modrinth version {} for {}",
                                full_version.id, display_name_log
                            );
                            state.content_cache.cache_modrinth_version(&full_version).await;
                        }
                        full_version.into()
                    }
                    Err(e) => {
                        warn!(
                            "Failed to get Modrinth version {} for dependency resolution: {}",
                            payload.version_id, e
                        );
                        return Ok(());
                    }
                }
            }
            ModPlatform::CurseForge => {
                let project_id = match payload.project_id.parse::<u32>() {
                    Ok(project_id) => project_id,
                    Err(e) => {
                        warn!(
                            "Invalid CurseForge project ID '{}' for dependency resolution: {}",
                            payload.project_id, e
                        );
                        return Ok(());
                    }
                };
                let file_id = match payload.version_id.parse::<u32>() {
                    Ok(file_id) => file_id,
                    Err(e) => {
                        warn!(
                            "Invalid CurseForge file ID '{}' for dependency resolution: {}",
                            payload.version_id, e
                        );
                        return Ok(());
                    }
                };

                match crate::integrations::curseforge::get_file_details(project_id, file_id).await {
                    Ok(file) => file.into(),
                    Err(e) => {
                        warn!(
                            "Failed to get CurseForge file {} for dependency resolution: {}",
                            file_id, e
                        );
                        return Ok(());
                    }
                }
            }
        };

        info!(
            "Found {} dependencies for {} mod {}",
            version.dependencies.len(),
            platform_name,
            display_name_log
        );

        self.install_missing_dependencies(
            payload.profile_id,
            &version.dependencies,
            &payload.source,
            &version.date_published,
        )
        .await
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
           // Always use the same behavior for all profiles (add to profile mods + optional deps)
           // if profile.is_standard_version {
           //     let mods_dir = self.get_profile_mods_path(&profile)?;
           //     tokio::fs::create_dir_all(&mods_dir).await?;
           //
           //     let target_path = mods_dir.join(&file_name);
           //     let tmp_path = target_path.with_extension("jar.nrc_tmp");
           //
           //     let mut config = crate::utils::download_utils::DownloadConfig::new().with_streaming(true);
           //     if let Some(sha1) = &file_hash_sha1 { config = config.with_sha1(sha1); }
           //     crate::utils::download_utils::DownloadUtils::download_file(
           //         &download_url,
           //         &tmp_path,
           //         config,
           //     ).await?;
           //     // Atomic move
           //     tokio::fs::rename(&tmp_path, &target_path).await?;
           //
           //     // Optionally install required dependencies if requested
           //     if add_dependencies {
           //         // Fetch version details to read dependencies
           //         if let Ok(ver_details) = modrinth::get_version_details(version_id.clone()).await {
           //             for dep in ver_details.dependencies.iter().filter(|d| d.dependency_type == ModrinthDependencyType::Required) {
           //                 if let Some(dep_project_id) = &dep.project_id {
           //                     // Find a compatible version by loader/profile game version
           //                     if let Ok(dep_versions) = modrinth::get_mod_versions(dep_project_id.clone(), Some(vec![profile.loader.as_str().to_string()]), Some(vec![profile.game_version.clone()])).await {
           //                         if let Some(best) = dep_versions.iter().max_by_key(|v| &v.date_published) {
           //                             if let Some(primary) = best.files.iter().find(|f| f.primary) {
           //                                 let dep_tmp = mods_dir.join(&primary.filename).with_extension("jar.nrc_tmp");
           //                                 let dep_target = mods_dir.join(&primary.filename);
           //                                 let mut cfg = crate::utils::download_utils::DownloadConfig::new().with_streaming(true);
           //                                 if let Some(s) = &primary.hashes.sha1 { cfg = cfg.with_sha1(s); }
           //                                 let _ = crate::utils::download_utils::DownloadUtils::download_file(&primary.url, &dep_tmp, cfg).await;
           //                                 let _ = tokio::fs::rename(&dep_tmp, &dep_target).await;
           //                             }
           //                         }
           //                     }
           //                 }
           //             }
           //         }
           //     }
           //     Ok(())
           // } else {
               // Use the same behavior for all profiles (add to profile mods + optional deps)
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
           // }
    }

    // Set the enabled status of a specific mod within a profile
    async fn edit_mods<F, T>(&self, profile_id: Uuid, edit: F) -> Result<(T, bool)>
    where
        F: FnOnce(&mut Profile) -> T,
    {
        let transient = self.transient.read().await.clone();
        let mut profiles = self.profiles.write().await;
        let profile = profiles
            .get_mut(&profile_id)
            .ok_or(AppError::ProfileNotFound(profile_id))?;

        let touched = edit(profile);
        Ok((touched, should_persist(profile, &transient)))
    }

    async fn forget_persisted(&self, profile_id: Uuid) {
        self.persisted.lock().await.remove(&profile_id);
    }

    pub async fn set_mods_enabled(
        &self,
        profile_id: Uuid,
        mod_ids: &[Uuid],
        enabled: bool,
    ) -> Result<usize> {
        if mod_ids.is_empty() {
            return Ok(0);
        }

        let wanted: HashSet<Uuid> = mod_ids.iter().copied().collect();
        let (touched, persistable) = self
            .edit_mods(profile_id, |profile| {
                let mut touched = Vec::new();
                for entry in profile.mods.iter_mut() {
                    if wanted.contains(&entry.id) && entry.enabled != enabled {
                        entry.enabled = enabled;
                        touched.push(entry.id);
                    }
                }
                touched
            })
            .await?;

        if !touched.is_empty() && persistable {
            self.store
                .set_mods_enabled(profile_id, &touched, enabled)
                .await?;
            self.forget_persisted(profile_id).await;
        }

        info!(
            "Set {} of {} requested mod(s) to enabled={} in profile {}",
            touched.len(),
            mod_ids.len(),
            enabled,
            profile_id
        );
        Ok(touched.len())
    }

    pub async fn set_mods_updates_enabled(
        &self,
        profile_id: Uuid,
        mod_ids: &[Uuid],
        updates_enabled: bool,
    ) -> Result<usize> {
        if mod_ids.is_empty() {
            return Ok(0);
        }

        let wanted: HashSet<Uuid> = mod_ids.iter().copied().collect();
        let (touched, persistable) = self
            .edit_mods(profile_id, |profile| {
                let mut touched = Vec::new();
                for entry in profile.mods.iter_mut() {
                    if wanted.contains(&entry.id) && entry.updates_enabled != updates_enabled {
                        entry.updates_enabled = updates_enabled;
                        touched.push(entry.id);
                    }
                }
                touched
            })
            .await?;

        if !touched.is_empty() && persistable {
            self.store
                .set_mods_updates_enabled(profile_id, &touched, updates_enabled)
                .await?;
            self.forget_persisted(profile_id).await;
        }
        Ok(touched.len())
    }

    pub async fn delete_mods(&self, profile_id: Uuid, mod_ids: &[Uuid]) -> Result<usize> {
        if mod_ids.is_empty() {
            return Ok(0);
        }

        let wanted: HashSet<Uuid> = mod_ids.iter().copied().collect();
        let (touched, persistable) = self
            .edit_mods(profile_id, |profile| {
                let mut touched = Vec::new();
                profile.mods.retain(|entry| {
                    if wanted.contains(&entry.id) {
                        touched.push(entry.id);
                        false
                    } else {
                        true
                    }
                });
                touched
            })
            .await?;

        if !touched.is_empty() && persistable {
            self.store.delete_mods(profile_id, &touched).await?;
            self.forget_persisted(profile_id).await;
        }

        info!("Removed {} mod(s) from profile {}", touched.len(), profile_id);
        Ok(touched.len())
    }

    pub async fn set_norisk_mod_statuses(
        &self,
        profile_id: Uuid,
        entries: &[(NoriskModIdentifier, bool)],
    ) -> Result<usize> {
        if entries.is_empty() {
            return Ok(0);
        }

        let (applied, persistable) = self
            .edit_mods(profile_id, |profile| {
                let mut applied = Vec::new();
                for (identifier, enabled) in entries {
                    let touched = if *enabled {
                        profile.disabled_norisk_mods_detailed.remove(identifier)
                    } else {
                        profile
                            .disabled_norisk_mods_detailed
                            .insert(identifier.clone())
                    };
                    if touched {
                        applied.push((identifier.clone(), *enabled));
                    }
                }
                applied
            })
            .await?;

        if !applied.is_empty() && persistable {
            self.store
                .set_norisk_mod_statuses(profile_id, &applied)
                .await?;
            self.forget_persisted(profile_id).await;
        }
        Ok(applied.len())
    }

    pub async fn set_mod_enabled(
        &self,
        profile_id: Uuid,
        mod_id: Uuid,
        enabled: bool,
    ) -> Result<()> {
        self.require_mod(profile_id, mod_id).await?;
        self.set_mods_enabled(profile_id, &[mod_id], enabled).await?;
        Ok(())
    }

    pub async fn delete_mod(&self, profile_id: Uuid, mod_id: Uuid) -> Result<()> {
        self.require_mod(profile_id, mod_id).await?;
        self.delete_mods(profile_id, &[mod_id]).await?;
        Ok(())
    }

    pub async fn set_norisk_mod_status(
        &self,
        profile_id: Uuid,
        pack_id: String,
        mod_id: String,
        game_version: String,
        loader: ModLoader,
        disabled: bool,
    ) -> Result<()> {
        let identifier = NoriskModIdentifier {
            pack_id,
            mod_id,
            game_version,
            loader,
        };
        self.set_norisk_mod_statuses(profile_id, &[(identifier, !disabled)])
            .await?;
        Ok(())
    }

    async fn require_mod(&self, profile_id: Uuid, mod_id: Uuid) -> Result<()> {
        let profiles = self.profiles.read().await;
        let profile = profiles
            .get(&profile_id)
            .ok_or(AppError::ProfileNotFound(profile_id))?;
        if profile.mods.iter().any(|entry| entry.id == mod_id) {
            Ok(())
        } else {
            Err(AppError::Other(format!(
                "Mod with ID {} not found in profile {}",
                mod_id, profile_id
            )))
        }
    }

    pub async fn list_profiles(&self) -> Result<Vec<Profile>> {
        self.ensure_profiles_loaded().await?;
        let profiles = self.profiles.read().await;
        Ok(profiles.values().cloned().collect())
    }

    pub async fn expected_mod_filenames(&self) -> HashSet<String> {
        let profiles = self.profiles.read().await;
        profiles
            .values()
            .flat_map(|profile| profile.mods.iter())
            .filter_map(|entry| get_profile_mod_filename(&entry.source).ok())
            .collect()
    }

    pub async fn list_profiles_without_mods(&self) -> Result<Vec<(Profile, usize)>> {
        self.ensure_profiles_loaded().await?;
        let profiles = self.profiles.read().await;
        Ok(profiles
            .values()
            .map(|p| {
                let slim = Profile {
                    id: p.id,
                    name: p.name.clone(),
                    path: p.path.clone(),
                    game_version: p.game_version.clone(),
                    loader: p.loader.clone(),
                    loader_version: p.loader_version.clone(),
                    created: p.created,
                    last_played: p.last_played,
                    settings: p.settings.clone(),
                    state: p.state.clone(),
                    mods: Vec::new(),
                    selected_norisk_pack_id: p.selected_norisk_pack_id.clone(),
                    disabled_norisk_mods_detailed: p.disabled_norisk_mods_detailed.clone(),
                    source_standard_profile_id: p.source_standard_profile_id,
                    group: p.group.clone(),
                    use_shared_minecraft_folder: p.use_shared_minecraft_folder,
                    is_standard_version: p.is_standard_version,
                    description: p.description.clone(),
                    banner: p.banner.clone(),
                    background: p.background.clone(),
                    norisk_information: p.norisk_information.clone(),
                    modpack_info: p.modpack_info.clone(),
                    preferred_account_id: p.preferred_account_id,
                    playtime_seconds: p.playtime_seconds,
                    extra: p.extra.clone(),
                };
                (slim, p.mods.len())
            })
            .collect())
    }

    pub async fn search_profiles(&self, query: &str) -> Result<Vec<Profile>> {
        self.ensure_profiles_loaded().await?;
        let query = query.to_lowercase();
        let profiles = self.profiles.read().await;
        Ok(profiles
            .values()
            .filter(|p| p.name.to_lowercase().contains(&query))
            .cloned()
            .collect())
    }

    pub async fn update_mod_to_unified_version(
        &self,
        profile_id: Uuid,
        mod_id: Uuid,
        new_version: &crate::integrations::unified_mod::UnifiedVersion,
    ) -> Result<()> {
        let mut profiles = self.profiles.write().await;
        let profile = profiles
            .get_mut(&profile_id)
            .ok_or(AppError::ProfileNotFound(profile_id))?;
        let profile_mc_version = profile.game_version.clone();

        let index = profile
            .mods
            .iter()
            .position(|m| m.id == mod_id)
            .ok_or(AppError::ModNotFoundInProfile { profile_id, mod_id })?;
        apply_unified_version_to_mod(&mut profile.mods[index], new_version, &profile_mc_version)?;

        drop(profiles);
        self.save_profile(profile_id).await?;
        info!(
            "Switched mod {} to unified version {} ({:?}) in profile {}",
            mod_id, new_version.version_number, new_version.source, profile_id
        );
        Ok(())
    }

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

        let profile_mc_version = profile.game_version.clone();

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
                        if !new_version_details
                            .game_versions
                            .contains(&profile_mc_version)
                            && !mod_to_update
                                .force_include_versions
                                .contains(&profile_mc_version)
                        {
                            mod_to_update
                                .force_include_versions
                                .push(profile_mc_version.clone());
                        }
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
        self.save_profile(profile_id).await?;
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
                    // no pin -> newest dep published at-or-before the parent's date, not the absolute
                    // newest (else switching Iris to an old version pulls a brand-new, incompatible Sodium)
                    let parent_date = new_version_details.date_published.as_str();
                    let best_version = versions.iter()
                        .filter(|v| v.date_published.as_str() <= parent_date)
                        .max_by(|a, b| a.date_published.cmp(&b.date_published))
                        .or_else(|| versions.iter().max_by(|a, b| a.date_published.cmp(&b.date_published)));
                    if let Some(best_version) = best_version {
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

    /// Helper function to check if a group belongs to NoRisk Client
    fn is_norisk_client_group(group_name: &str) -> bool {
        let normalized = group_name.to_lowercase();
        normalized == "nrc" || normalized == "noriskclient" || normalized == "norisk client"
    }

    /// Helper function to check if a group should NOT use shared Minecraft folder
    fn is_isolated_group(group_name: &str) -> bool {
        let normalized = group_name.to_lowercase();
        normalized == "server" || normalized == "modpacks"
    }

    /// Sanitizes a group name for safe filesystem usage
    fn sanitize_group_name(group_name: &str) -> String {
        sanitize_filename::sanitize(group_name.to_lowercase())
    }

    /// Builds the default path using profile.path segments
    pub fn build_path_from_profile_path(profile: &Profile) -> PathBuf {
        let mut path = default_profile_path();
        
        // Explicitly split profile.path by '/' and push each segment
        for segment in profile.path.split('/') {
            if !segment.is_empty() {
                path.push(segment);
            }
        }
        path
    }

    /// Calculates the group directory for a profile when using shared folder logic.
    /// Returns the directory path based on the profile's group and Minecraft version.
    pub fn calculate_group_directory(&self, profile: &Profile) -> Result<PathBuf> {
        if let Some(group) = &profile.group {
            if Self::is_norisk_client_group(group) {
                // NoRisk Client groups go to "noriskclient/legacy" for MC < 1.13, "noriskclient/new" otherwise
                if mc_utils::is_legacy_minecraft_version(&profile.game_version) {
                    Ok(default_profile_path().join("noriskclient").join("legacy"))
                } else {
                    Ok(default_profile_path().join("noriskclient").join("new"))
                }
            } else {
                // Other custom groups go to "groups/{sanitized_group_name}"
                let sanitized_group = Self::sanitize_group_name(group);
                Ok(default_profile_path().join("groups").join(sanitized_group))
            }
        } else {
            // No group, use the original logic with profile.path
            Ok(Self::build_path_from_profile_path(profile))
        }
    }

    /// Calculates the instance path for a given Profile object based on its properties.
    /// This method does NOT check if the profile exists in the manager.
    pub fn calculate_instance_path_for_profile(&self, profile: &Profile) -> Result<PathBuf> {
        log::trace!(
            "Calculating instance path for profile '{}' (Raw profile.path: '{}', Version: {}, Group: {:?})",
            profile.name,
            profile.path, // Log the raw profile.path string
            profile.game_version,
            profile.group
        );

        // Determine final path based on shared folder logic and group
        let final_path = if profile.should_use_shared_minecraft_folder() {
            // Profile should use shared folder - use group directory logic
            log::trace!("Profile '{}' should use shared Minecraft folder, using group directory", profile.name);
            self.calculate_group_directory(profile)?
        } else {
            // Profile should NOT use shared folder (isolated) - use original logic with profile.path
            log::trace!("Profile '{}' should not use shared Minecraft folder, using isolated path logic", profile.name);
            Self::build_path_from_profile_path(profile)
        };

        log::trace!(
            "Constructed final path for profile '{}': {:?}",
            profile.name,
            final_path
        );
        Ok(final_path)
    }

    /// Returns the path to the mods directory for individual/isolated profiles.
    /// This always uses the standard single profile logic.
    pub fn get_profile_mods_path_single(&self, profile: &Profile) -> Result<PathBuf> {
        let instance_path = self.calculate_instance_path_for_profile(profile)?;
        let mods_path = match profile.loader {
            ModLoader::Fabric => instance_path
                .join("mods")
                .join(format!("nrc-{}-fabric", profile.game_version)),
            ModLoader::Forge => instance_path
                .join("mods")
                .join(format!("nrc-{}-forge", profile.game_version)),
            ModLoader::NeoForge => instance_path
                .join("mods")
                .join(format!("nrc-{}-neoforge", profile.game_version)),
            _ => instance_path.join("mods"),
        };
        log::debug!(
            "Calculated single mods path for profile '{}': {:?}",
            profile.name,
            mods_path
        );
        Ok(mods_path)
    }

    /// Returns the path to the mods directory for shared/grouped profiles.
    /// This uses the UUID-based shared pattern.
    pub fn get_profile_mods_path_shared(&self, profile: &Profile) -> Result<PathBuf> {
        let instance_path = self.calculate_instance_path_for_profile(profile)?;
        
        // Extract first 2 and last 2 characters from UUID
        let uuid_str = profile.id.to_string().replace("-", "");
        let uuid_short = if uuid_str.len() >= 4 {
            format!("{}{}", &uuid_str[0..2], &uuid_str[uuid_str.len()-2..])
        } else {
            uuid_str[0..4.min(uuid_str.len())].to_string()
        };
        
        let mods_path = match profile.loader {
            ModLoader::Fabric => instance_path
                .join("mods")
                .join(format!("nrc-{}-fabric-{}", profile.game_version, uuid_short)),
            ModLoader::Forge => instance_path
                .join("mods")
                .join(format!("nrc-{}-forge-{}", profile.game_version, uuid_short)),
            ModLoader::NeoForge => instance_path
                .join("mods")
                .join(format!("nrc-{}-neoforge-{}", profile.game_version, uuid_short)),
            _ => instance_path.join("mods"),
        };
        log::debug!(
            "Calculated shared mods path for profile '{}': {:?}",
            profile.name,
            mods_path
        );
        Ok(mods_path)
    }

    /// Returns the path to the mods directory for a given profile.
    /// Automatically chooses between single and shared based on profile settings.
    pub fn get_profile_mods_path(&self, profile: &Profile) -> Result<PathBuf> {
        log::debug!(
            "Calculating mods path for profile '{}' (Loader: {:?}, Game Version: {}, Standard: {}, Uses Shared: {})",
            profile.name,
            profile.loader,
            profile.game_version,
            profile.is_standard_version,
            profile.should_use_shared_minecraft_folder()
        );

        // Use standard logic for standard versions or profiles without group/shared folder
        let mods_path = if profile.is_standard_version || !profile.should_use_shared_minecraft_folder() {
            let path = self.get_profile_mods_path_single(profile)?;
            log::info!(
                "Calculated standard mods path for profile '{}': {:?}",
                profile.name,
                path
            );
            path
        } else {
            let path = self.get_profile_mods_path_shared(profile)?;
            log::info!(
                "Calculated shared mods path for profile '{}': {:?}",
                profile.name,
                path
            );
            path
        };
        
        Ok(mods_path)
    }

    pub fn mod_scan_dirs(&self, profile: &Profile) -> Result<Vec<PathBuf>> {
        let instance = self.calculate_instance_path_for_profile(profile)?;
        let mut dirs = vec![
            instance.join("mods"),
            self.get_profile_mods_path(profile)?,
            instance.join("custom_mods"),
        ];
        dirs.dedup();
        Ok(dirs)
    }

    #[deprecated(
        note = "custom_mods/ is legacy. Local and imported mods now go into the flat mods/ folder (get_content_directory / ContentType::Mod). custom_mods/ is still read at launch as a back-compat fallback for existing profiles."
    )]
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

    #[deprecated(
        note = "custom_mods/ is legacy; new local/imported mods live in the flat mods/ folder. Retained as a launch-time back-compat scan for existing profiles."
    )]
    #[allow(deprecated)]
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

    #[deprecated(
        note = "custom_mods/ is legacy; new local/imported mods live in the flat mods/ folder. Retained for back-compat toggling of existing custom_mods/ entries."
    )]
    #[allow(deprecated)]
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

        let profile = self.get_profile(profile_id).await?;
        let mods_dir = self.calculate_instance_path_for_profile(&profile)?.join("mods");
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
                            error!("Modrinth version {} found for hash {}, but no primary file found. Falling back to local mod import for profile {} - {:?}.", modrinth_version.id, hash, profile_id, src_path_buf.file_name().unwrap_or_default());
                            error_count += 1;
                            path_utils::copy_local_mod(
                                &src_path_buf,
                                &mods_dir,
                                profile_id,
                                &mut custom_added_count,
                                &mut skipped_count,
                            )
                            .await;
                        }
                    } else {
                        log::info!("Mod {:?} (hash: {}) not found on Modrinth for profile {}. Importing as local mod.", src_path_buf.file_name().unwrap_or_default(), hash, profile_id);
                        path_utils::copy_local_mod(
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
                error_count += path_map.len() as u64;
                for (_hash, src_path_buf) in path_map {
                    path_utils::copy_local_mod(
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

    pub async fn store_status(&self) -> Result<ProfileStoreStatus> {
        let (profiles, mods) = self.store.counts().await?;
        Ok(ProfileStoreStatus {
            profile_count: profiles as usize,
            mod_count: mods as usize,
            legacy_json_available: self.migrated_json_path().exists(),
        })
    }

    fn migrated_json_path(&self) -> PathBuf {
        self.profiles_path.with_extension("json.migrated")
    }

    async fn read_migration_source(&self, source: &std::path::Path) -> Result<String> {
        let mut current = source.to_path_buf();

        for attempt in 0..2 {
            let raw = fs::read_to_string(&current).await?;
            if serde_json::from_str::<Vec<serde_json::Value>>(&raw).is_ok() {
                return Ok(raw);
            }

            error!(
                "ProfileManager: {:?} is not a readable profile list, quarantining it",
                current
            );
            let quarantine = current.with_extension(format!(
                "corrupted.{}",
                Utc::now().format("%Y%m%d_%H%M%S")
            ));
            match fs::copy(&current, &quarantine).await {
                Ok(_) => info!("ProfileManager: corrupted file saved as {:?}", quarantine),
                Err(e) => error!("ProfileManager: could not quarantine the corrupted file: {}", e),
            }

            if attempt == 1 {
                break;
            }

            match backup_utils::restore_from_backup(&self.profiles_path, Some("profiles")).await {
                Ok(restored) => {
                    info!("ProfileManager: restored profiles from backup {:?}", restored);
                    current = self.profiles_path.clone();
                }
                Err(e) => {
                    error!("ProfileManager: no usable backup to restore: {}", e);
                    break;
                }
            }
        }

        warn!("ProfileManager: importing an empty profile list");
        Ok("[]".to_string())
    }

    async fn migrate_if_needed(&self) -> Result<()> {
        if self.store.is_migrated().await? {
            return Ok(());
        }

        if self.store.counts().await?.0 > 0 {
            warn!(
                "The database already holds profiles but was never marked as migrated; adopting them instead of importing over them"
            );
            self.store.mark_migrated().await?;
            return Ok(());
        }

        let source = if self.profiles_path.exists() {
            self.profiles_path.clone()
        } else if self.migrated_json_path().exists() {
            info!("The database is empty; re-importing from profiles.json.migrated");
            self.migrated_json_path()
        } else {
            info!("No profiles.json to import; starting the database empty");
            self.store.import_from_json("[]").await?;
            return Ok(());
        };

        self.snapshot_database(PRE_MIGRATION_SNAPSHOT).await;

        if source == self.profiles_path {
            if let Err(e) =
                backup_utils::create_backup(&source, Some("profiles"), &self.backup_config).await
            {
                warn!("Could not back up profiles.json before importing: {}", e);
            }
        }

        let raw = self.read_migration_source(&source).await?;
        let outcome = self.store.import_from_json(&raw).await?;

        if source == self.profiles_path {
            if let Err(e) = fs::rename(&self.profiles_path, self.migrated_json_path()).await {
                warn!("Could not rename profiles.json after importing: {}", e);
            }
        }

        info!(
            "Imported {} profiles and {} mods into the database ({} quarantined)",
            outcome.imported, outcome.mods, outcome.unparsed
        );
        Ok(())
    }

    pub async fn reimport_from_legacy_json(&self) -> Result<usize> {
        let path = self.migrated_json_path();
        if !path.exists() {
            return Err(AppError::Other(format!(
                "There is nothing to re-import: {:?} does not exist",
                path
            )));
        }

        let raw = fs::read_to_string(&path).await?;
        self.snapshot_database("pre-reimport").await;
        let outcome = self.store.import_from_json(&raw).await?;

        let loaded = self.store.load_all().await?;
        self.adopt_profiles(loaded).await;
        Ok(outcome.imported)
    }




    async fn save_profile(&self, id: Uuid) -> Result<()> {
        let _guard = self.save_lock.lock().await;

        let transient = self.transient.read().await.clone();
        let profile = {
            let profiles = self.profiles.read().await;
            match profiles.get(&id) {
                Some(profile) if should_persist(profile, &transient) => profile.clone(),
                _ => return Ok(()),
            }
        };

        let hash = content_hash(&profile)?;
        if self.persisted.lock().await.get(&id) == Some(&hash) {
            return Ok(());
        }

        self.store.upsert_many(std::slice::from_ref(&profile)).await?;
        self.persisted.lock().await.insert(id, hash);
        Ok(())
    }

    pub async fn add_playtime(&self, profile_id: Uuid, seconds: u64) -> Result<()> {
        {
            let mut profiles = self.profiles.write().await;
            if let Some(profile) = profiles.get_mut(&profile_id) {
                profile.playtime_seconds = profile.playtime_seconds.saturating_add(seconds);
            }
        }

        self.store.add_playtime(profile_id, seconds).await?;
        self.persisted.lock().await.remove(&profile_id);
        Ok(())
    }

    pub async fn sync_standard_profiles(&self) -> Result<()> {
        info!("ProfileManager: Starting standard profiles synchronization...");

        // Ensure profiles are loaded before syncing to avoid race conditions
        self.ensure_profiles_loaded().await?;

        // Get standard profiles from norisk version manager
        let state = match crate::state::state_manager::State::get().await {
            Ok(state) => state,
            Err(e) => {
                warn!("ProfileManager: Could not get global state for standard profile sync: {}", e);
                return Ok(()); // Non-critical, skip sync
            }
        };

        let standard_profiles = state.norisk_version_manager.get_config().await.profiles;
        info!("ProfileManager: Found {} standard profiles to sync", standard_profiles.len());

        if standard_profiles.is_empty() {
            info!("ProfileManager: No standard profiles found, skipping sync");
            return Ok(());
        }

        let stored = self.store.counts().await.map(|(p, _)| p).unwrap_or(0) as usize;
        let in_memory = self.profiles.read().await.len();
        if stored > in_memory {
            warn!(
                "ProfileManager: skipping standard profile sync, the database holds {} profiles but only {} are loaded",
                stored, in_memory
            );
            return Ok(());
        }

        // Get all user profiles and create lookup maps
        let user_profiles = self.list_profiles().await?;
        let mut existing_copies_by_source_id: std::collections::HashMap<Uuid, Uuid> = std::collections::HashMap::new();
        
        for profile in &user_profiles {
            if let Some(source_id) = profile.source_standard_profile_id {
                existing_copies_by_source_id.insert(source_id, profile.id);
            }
        }

        let mut copies_created = 0;
        let mut copies_updated = 0;

        for standard_profile in standard_profiles {
            if let Some(existing_copy_id) = existing_copies_by_source_id.get(&standard_profile.id) {
                // Update existing copy with forced fields
                match self.update_copy_with_forced_fields(*existing_copy_id, &standard_profile).await {
                    Ok(updated) => {
                        if updated {
                            info!("ProfileManager: Updated forced fields for copy {} of standard profile '{}'", existing_copy_id, standard_profile.name);
                            copies_updated += 1;
                        }
                    }
                    Err(e) => {
                        warn!("ProfileManager: Failed to update copy {} for standard profile '{}': {}", existing_copy_id, standard_profile.name, e);
                    }
                }
            } else {
                // Create new copy
                match self.create_editable_copy_from_standard(&standard_profile).await {
                    Ok(new_id) => {
                        info!("ProfileManager: Created editable copy {} for standard profile '{}'", new_id, standard_profile.name);
                        copies_created += 1;
                    }
                    Err(e) => {
                        warn!("ProfileManager: Failed to create copy for standard profile '{}': {}", standard_profile.name, e);
                    }
                }
            }
        }

        info!("ProfileManager: Standard profile sync complete. Created {} new copies, updated {} existing copies", copies_created, copies_updated);
        Ok(())
    }

    async fn ensure_profiles_loaded(&self) -> Result<()> {
        let _guard = self.loading.lock().await;
        self.load_profiles_once().await
    }

    async fn load_profiles_once(&self) -> Result<()> {
        {
            let profiles_guard = self.profiles.read().await;
            if profiles_guard.is_empty() {
                info!("ProfileManager: Profiles not loaded yet, loading them now...");
                drop(profiles_guard); // Release read lock before loading

                // Load profiles from disk
                let mut loaded_profiles = self.store.load_all().await?;

                // Perform profile migrations
                let migrated = crate::utils::migration_utils::migrate_profiles(&mut loaded_profiles);

                {
                    let mut profiles_write_guard = self.profiles.write().await;
                    *profiles_write_guard = loaded_profiles;
                }

                if !migrated.is_empty() {
                    info!(
                        "ProfileManager: Persisting {} migrated profile(s)...",
                        migrated.len()
                    );
                    let transient = self.transient.read().await.clone();
                    let touched: Vec<Profile> = {
                        let profiles = self.profiles.read().await;
                        migrated
                            .iter()
                            .filter_map(|id| profiles.get(id))
                            .filter(|profile| should_persist(profile, &transient))
                            .cloned()
                            .collect()
                    };
                    self.store.upsert_many(&touched).await?;
                    let mut persisted = self.persisted.lock().await;
                    for profile in &touched {
                        persisted.insert(profile.id, content_hash(profile)?);
                    }
                }

                info!("ProfileManager: Profiles loaded successfully.");
            }
        }
        Ok(())
    }

    /// Creates an editable copy of a standard profile for user customization
    async fn create_editable_copy_from_standard(&self, standard_profile: &Profile) -> Result<Uuid> {
        let mut editable_copy = standard_profile.clone();
           
        // Link back to original standard profile
        editable_copy.source_standard_profile_id = Some(standard_profile.id);
        
        // Update timestamps
        editable_copy.created = chrono::Utc::now();
        editable_copy.last_played = None;
        
        // Reset state to not installed for user copy
        editable_copy.state = ProfileState::NotInstalled;

        // Create the profile using existing create_profile method
        let new_id = self.create_profile(editable_copy).await?;
        
        Ok(new_id)
    }

    /// Updates an existing copy with forced fields from the standard profile
    /// Returns true if any changes were made, false otherwise
    async fn update_copy_with_forced_fields(&self, copy_id: Uuid, standard_profile: &Profile) -> Result<bool> {
        let mut profiles = self.profiles.write().await;
        
        if let Some(copy) = profiles.get_mut(&copy_id) {
            let mut changed = false;
            
            // Force update name if different
            if copy.name != standard_profile.name {
                info!("Updating name for copy {}: '{}' -> '{}'", copy_id, copy.name, standard_profile.name);
                copy.name = standard_profile.name.clone();
                changed = true;
            }
            
            // Force update group if different
            if copy.group != standard_profile.group {
                info!("Updating group for copy {}: {:?} -> {:?}", copy_id, copy.group, standard_profile.group);
                copy.group = standard_profile.group.clone();
                changed = true;
            }
            
            // Force update game version if different
            if copy.game_version != standard_profile.game_version {
                info!("Updating game version for copy {}: '{}' -> '{}'", copy_id, copy.game_version, standard_profile.game_version);
                copy.game_version = standard_profile.game_version.clone();
                changed = true;
            }
            
            // Force update loader if different
            if copy.loader != standard_profile.loader {
                info!("Updating loader for copy {}: {:?} -> {:?}", copy_id, copy.loader, standard_profile.loader);
                copy.loader = standard_profile.loader.clone();
                changed = true;
            }
            
            // Force update loader version if different
            if copy.loader_version != standard_profile.loader_version {
                info!("Updating loader version for copy {}: {:?} -> {:?}", copy_id, copy.loader_version, standard_profile.loader_version);
                copy.loader_version = standard_profile.loader_version.clone();
                changed = true;
            }
            
            // Force update description if different
            if copy.description != standard_profile.description {
                info!("Updating description for copy {}", copy_id);
                copy.description = standard_profile.description.clone();
                changed = true;
            }
            
            // Force update NoRisk pack selection if different
            if copy.selected_norisk_pack_id != standard_profile.selected_norisk_pack_id {
                info!("Updating NoRisk pack for copy {}: {:?} -> {:?}", copy_id, copy.selected_norisk_pack_id, standard_profile.selected_norisk_pack_id);
                copy.selected_norisk_pack_id = standard_profile.selected_norisk_pack_id.clone();
                changed = true;
            }
            
            // Force update banner if different
            if copy.banner != standard_profile.banner {
                info!("Updating banner for copy {}", copy_id);
                copy.banner = standard_profile.banner.clone();
                changed = true;
            }

              // Force update banner if different
            if copy.background != standard_profile.background {
                info!("Updating background for copy {}", copy_id);
                copy.background = standard_profile.background.clone();
                changed = true;
            }
            
            // Force update is_standard_version if different
            if copy.is_standard_version != standard_profile.is_standard_version {
                info!("Updating is_standard_version for copy {}: {} -> {}", copy_id, copy.is_standard_version, standard_profile.is_standard_version);
                copy.is_standard_version = standard_profile.is_standard_version;
                changed = true;
            }
            
            // Force update path if different
            if copy.path != standard_profile.path {
                info!("Updating path for copy {}: '{}' -> '{}'", copy_id, copy.path, standard_profile.path);
                copy.path = standard_profile.path.clone();
                changed = true;
            }
            
            if changed {
                drop(profiles);
                self.save_profile(copy_id).await?;
                info!("Saved forced field updates for copy {}", copy_id);
            }
            
            Ok(changed)
        } else {
            Err(AppError::ProfileNotFound(copy_id))
        }
    }

    /// Updates a mod in a profile using SwitchContentVersionPayload
    /// This method handles the unified version update process
    pub async fn update_mods_with_switch_payloads(
        &self,
        profile_id: Uuid,
        payloads: &[&crate::commands::content_command::SwitchContentVersionPayload],
    ) -> Result<Vec<usize>> {
        if payloads.is_empty() {
            return Ok(Vec::new());
        }

        let mut applied = Vec::new();
        {
            let mut profiles = self.profiles.write().await;
            let profile = profiles
                .get_mut(&profile_id)
                .ok_or(AppError::ProfileNotFound(profile_id))?;
            let profile_mc_version = profile.game_version.clone();

            for (slot, payload) in payloads.iter().enumerate() {
                let Some(current_item) = payload.current_item_details.as_ref() else {
                    warn!("Bulk update entry {} has no current_item_details", slot);
                    continue;
                };
                let Some(index) = find_mod_for_version_switch(&profile.mods, current_item) else {
                    warn!(
                        "Bulk update could not find '{}' in profile {}",
                        current_item.filename, profile_id
                    );
                    continue;
                };
                match apply_unified_version_to_mod(
                    &mut profile.mods[index],
                    &payload.new_version_details,
                    &profile_mc_version,
                ) {
                    Ok(()) => applied.push(slot),
                    Err(e) => error!(
                        "Bulk update failed for '{}': {}",
                        current_item.filename, e
                    ),
                }
            }
        }

        if applied.is_empty() {
            return Ok(applied);
        }

        self.save_profile(profile_id).await?;
        info!(
            "Bulk update applied {} of {} version switches in profile {}",
            applied.len(),
            payloads.len(),
            profile_id
        );

        let mut seen = std::collections::HashSet::new();
        for slot in &applied {
            let payload = payloads[*slot];
            if payload.new_version_details.dependencies.is_empty() {
                continue;
            }
            if let Err(e) = self
                .install_dependencies_with_seen(
                    profile_id,
                    &payload.new_version_details.dependencies,
                    &payload.new_version_details.source,
                    &payload.new_version_details.date_published,
                    &mut seen,
                )
                .await
            {
                error!("Bulk update could not install dependencies: {}", e);
            }
        }

        Ok(applied)
    }

    pub async fn update_mod_with_switch_content_version_payload(
        &self,
        profile_id: Uuid,
        payload: &crate::commands::content_command::SwitchContentVersionPayload,
    ) -> Result<()> {
        info!(
            "Updating mod in profile {} using unified version switch",
            profile_id
        );

        let mut profiles = self.profiles.write().await;

        let profile = profiles.get_mut(&profile_id).ok_or_else(|| {
            error!(
                "Profile {} not found during unified mod update attempt.",
                profile_id
            );
            AppError::ProfileNotFound(profile_id)
        })?;

        let profile_mc_version = profile.game_version.clone();

        let current_item = payload.current_item_details.as_ref().ok_or_else(|| {
            AppError::InvalidInput("Missing current_item_details in payload.".to_string())
        })?;

        let mod_to_update_index = find_mod_for_version_switch(&profile.mods, current_item);

        if let Some(index) = mod_to_update_index {
            apply_unified_version_to_mod(
                &mut profile.mods[index],
                &payload.new_version_details,
                &profile_mc_version,
            )?;
            info!("Successfully updated mod {} in profile {}", profile.mods[index].id, profile_id);
        } else {
            error!(
                "Mod not found in profile {} for update with unified version",
                profile_id
            );
            return Err(AppError::ModNotFoundInProfile {
                profile_id,
                mod_id: current_item.id.as_ref()
                    .and_then(|id_str| Uuid::parse_str(id_str).ok())
                    .unwrap_or(Uuid::nil()),
            });
        }

        drop(profiles);
        self.save_profile(profile_id).await?;

        info!(
            "Profile {} saved after updating mod with unified version.",
            profile_id
        );

        // Install missing dependencies if any
        if !payload.new_version_details.dependencies.is_empty() {
            info!("Processing {} dependencies for updated mod", payload.new_version_details.dependencies.len());
            if let Err(e) = self.install_missing_dependencies(
                profile_id,
                &payload.new_version_details.dependencies,
                &payload.new_version_details.source,
                &payload.new_version_details.date_published,
            ).await {
                error!("Failed to install dependencies: {}", e);
                // Don't fail the entire operation if dependency installation fails
            }
        }

        Ok(())
    }

    /// Checks if a dependency mod is already installed in the profile
    fn installed_dependency(
        &self,
        profile: &Profile,
        dependency_project_id: &str,
    ) -> Option<(Uuid, bool)> {
        find_mod_by_project_id(&profile.mods, dependency_project_id)
            .map(|idx| (profile.mods[idx].id, profile.mods[idx].enabled))
    }

    const DEPENDENCY_DEPTH: u8 = 20;

    async fn install_missing_dependencies(
        &self,
        profile_id: Uuid,
        dependencies: &[crate::integrations::unified_mod::UnifiedDependency],
        platform: &crate::integrations::unified_mod::ModPlatform,
        parent_date: &str, // release date of the mod we just switched to — pick a contemporaneous dep
    ) -> Result<()> {
        let mut seen = std::collections::HashSet::new();
        self.install_dependencies_with_seen(
            profile_id,
            dependencies,
            platform,
            parent_date,
            &mut seen,
        )
        .await
    }

    async fn install_dependencies_with_seen(
        &self,
        profile_id: Uuid,
        dependencies: &[crate::integrations::unified_mod::UnifiedDependency],
        platform: &crate::integrations::unified_mod::ModPlatform,
        parent_date: &str,
        seen: &mut std::collections::HashSet<String>,
    ) -> Result<()> {
        let mut queue: std::collections::VecDeque<(Vec<crate::integrations::unified_mod::UnifiedDependency>, String, u8)> =
            std::collections::VecDeque::new();
        queue.push_back((
            dependencies.to_vec(),
            parent_date.to_string(),
            Self::DEPENDENCY_DEPTH,
        ));

        while let Some((batch, batch_parent_date, depth)) = queue.pop_front() {
            self.install_dependency_level(
                profile_id,
                &batch,
                platform,
                &batch_parent_date,
                seen,
                depth,
                &mut queue,
            )
            .await?;
        }

        Ok(())
    }

    async fn install_dependency_level(
        &self,
        profile_id: Uuid,
        dependencies: &[crate::integrations::unified_mod::UnifiedDependency],
        platform: &crate::integrations::unified_mod::ModPlatform,
        parent_date: &str,
        seen: &mut std::collections::HashSet<String>,
        depth: u8,
        queue: &mut std::collections::VecDeque<(Vec<crate::integrations::unified_mod::UnifiedDependency>, String, u8)>,
    ) -> Result<()> {
        use crate::integrations::unified_mod::UnifiedModVersionsParams;

        if depth == 0 {
            warn!("Dependency chain too deep, stopping here");
            return Ok(());
        }

        // Get profile once and reuse it
        let profile = self.get_profile(profile_id).await?;

        for dependency in dependencies {
            // Only process required dependencies
            if dependency.dependency_type != crate::integrations::unified_mod::UnifiedDependencyType::Required {
                continue;
            }

            if let Some(dep_project_id) = &dependency.project_id {
                if !seen.insert(format!("{:?}:{}", platform, dep_project_id)) {
                    continue;
                }

                if let Some((existing_id, enabled)) = self.installed_dependency(&profile, dep_project_id) {
                    if enabled {
                        info!("Dependency {} already installed, skipping", dep_project_id);
                    } else {
                        info!(
                            "Dependency {} is installed but disabled, re-enabling instead of adding a second copy",
                            dep_project_id
                        );
                        if let Err(e) = self.set_mod_enabled(profile_id, existing_id, true).await {
                            error!("Failed to re-enable dependency '{}': {}", dep_project_id, e);
                        }
                    }
                    continue;
                }

                info!("Installing missing dependency: {}", dep_project_id);

                let versions_params = UnifiedModVersionsParams {
                    source: platform.clone(),
                    project_id: dep_project_id.clone(),
                    loaders: Some(vec![profile.loader.as_str().to_string()]),
                    game_versions: Some(vec![profile.game_version.clone()]),
                    limit: None,
                    offset: None,
                };

                match crate::integrations::unified_mod::get_mod_versions_unified(versions_params).await {
                    Ok(versions_response) => {
                        let mc = &profile.game_version;
                        let versions = &versions_response.versions;
                        // 1) exact pin from the parent's dependency metadata (e.g. Iris -> a specific Sodium)
                        // 2) else the dep CONTEMPORANEOUS with the parent (newest <= parent's date) for this MC
                        // 3) else newest for this MC  4) else newest overall
                        let chosen = dependency.version_id.as_ref()
                            .and_then(|vid| versions.iter().find(|v| &v.id == vid))
                            .or_else(|| versions.iter().filter(|v| v.game_versions.contains(mc) && v.date_published.as_str() <= parent_date).max_by(|a, b| a.date_published.cmp(&b.date_published)))
                            .or_else(|| versions.iter().filter(|v| v.game_versions.contains(mc)).max_by(|a, b| a.date_published.cmp(&b.date_published)))
                            .or_else(|| versions.iter().max_by(|a, b| a.date_published.cmp(&b.date_published)));
                        info!(
                            "[dep-resolve] {} pin={:?} parent_date={} candidates={} -> chosen={:?} ({:?})",
                            dep_project_id, dependency.version_id, parent_date, versions.len(),
                            chosen.map(|v| &v.version_number), chosen.map(|v| &v.id)
                        );
                        if let Some(dep_version) = chosen {
                            let file = dep_version
                                .files
                                .iter()
                                .find(|f| f.primary)
                                .or_else(|| dep_version.files.first());
                            // Create install payload for the dependency
                            let dep_payload = crate::commands::content_command::InstallContentPayload {
                                profile_id,
                                project_id: dep_project_id.clone(),
                                version_id: dep_version.id.clone(),
                                file_name: file
                                    .map(|f| f.filename.clone())
                                    .unwrap_or_else(|| format!("{}.jar", dep_project_id)),
                                download_url: file.map(|f| f.url.clone()).unwrap_or_default(),
                                file_hash_sha1: file.and_then(|f| f.hashes.get("sha1").cloned()),
                                file_fingerprint: file.and_then(|f| f.fingerprint),
                                content_name: Some(dep_version.name.clone()),
                                version_number: Some(dep_version.version_number.clone()),
                                content_type: crate::utils::profile_utils::ContentType::Mod,
                                loaders: Some(dep_version.loaders.clone()),
                                game_versions: Some(dep_version.game_versions.clone()),
                                source: platform.clone(),
                            };

                            match Box::pin(self.add_mod_from_payload(&dep_payload, false)).await {
                                Ok(_) => {
                                    info!("Successfully installed dependency '{}'", dep_project_id);
                                    if !dep_version.dependencies.is_empty() {
                                        queue.push_back((
                                            dep_version.dependencies.clone(),
                                            dep_version.date_published.clone(),
                                            depth - 1,
                                        ));
                                    }
                                }
                                Err(e) => error!("Failed to install dependency '{}': {}", dep_project_id, e),
                            }
                        } else {
                            warn!("No compatible version found for dependency '{}'", dep_project_id);
                        }
                    }
                    Err(e) => error!("Failed to get versions for dependency '{}': {}", dep_project_id, e),
                }
            }
        }

        Ok(())
    }

    #[deprecated(
        note = "custom_mods/ is legacy; new local/imported mods live in the flat mods/ folder. Retained for back-compat deletion of existing custom_mods/ entries."
    )]
    #[allow(deprecated)]
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
        trace!("ProfileManager: on_state_ready called. Loading profiles...");
        // PRIORITY 0: Create backup BEFORE ANYTHING else (including loading)
        trace!("ProfileManager: Creating pre-load backup of profiles.json...");
        if self.profiles_path.exists() {
            match backup_utils::create_backup(&self.profiles_path, Some("profiles"), &self.backup_config).await {
                Ok(backup_path) => {
                    trace!("ProfileManager: Pre-load backup created: {:?}", backup_path);
                }
                Err(e) => {
                    warn!("ProfileManager: Failed to create pre-load backup: {}", e);
                    // Continue anyway - don't fail the whole operation
                }
            }
        } else {
            info!("ProfileManager: profiles.json doesn't exist yet - no backup needed at this stage");
        }

        {
            let _guard = self.loading.lock().await;
            self.snapshot_database_for_version().await;
            self.migrate_if_needed().await?;
            self.load_profiles_once().await?;
        }

        let (profiles, mods) = self.store.counts().await?;
        info!(
            "ProfileManager: serving {} profiles and {} mods from the database",
            profiles, mods
        );

        // Sync standard profiles - create editable copies for each norisk_version
        if let Err(e) = self.sync_standard_profiles().await {
            warn!("ProfileManager: Failed to sync standard profiles: {}", e);
        }

        trace!("ProfileManager: Successfully loaded profiles in on_state_ready.");

        // Fire-and-forget: purge trashed items and old backups after init
        let backup_config_clone = self.backup_config.clone();
        let profiles_path_clone = self.profiles_path.clone();
        tauri::async_runtime::spawn(async move {
            let seconds_30_days = 30 * 24 * 60 * 60;

            // Clean up trash
            if let Err(e) = crate::utils::trash_utils::purge_expired(seconds_30_days).await {
                log::warn!("Trash purge after init failed: {}", e);
            }

            // Clean up old backups for profiles category (generational if configured)
            let cleanup_result = match &backup_config_clone.gfs {
                Some(policy) => crate::utils::backup_utils::cleanup_old_backups_generational(
                    &profiles_path_clone,
                    Some("profiles"),
                    policy,
                ).await,
                None => crate::utils::backup_utils::cleanup_old_backups(
                    &profiles_path_clone,
                    Some("profiles"),
                    &backup_config_clone,
                ).await,
            };
            if let Err(e) = cleanup_result {
                log::warn!("Profile backup cleanup after init failed: {}", e);
            }
        });

        Ok(())
    }
}

const PRE_MIGRATION_SNAPSHOT: &str = "pre-profiles";

fn should_persist(profile: &Profile, transient: &HashSet<Uuid>) -> bool {
    if transient.contains(&profile.id) || profile.path.starts_with("noriskclient/temp/") {
        return false;
    }
    !(profile.is_standard_version && profile.source_standard_profile_id.is_none())
}

fn content_hash(profile: &Profile) -> Result<u64> {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    crate::state::profile_store::canonical_value(profile)?
        .to_string()
        .hash(&mut hasher);
    Ok(hasher.finish())
}

/// Helper function to determine the definitive filename for a mod defined within a Profile.
pub fn get_profile_mod_filename(source: &ModSource) -> crate::error::Result<String> {
    match source {
        ModSource::Modrinth { file_name, .. } => {
            crate::utils::import_safety::safe_file_component(file_name)
        }
        ModSource::CurseForge { file_name, .. } => {
            crate::utils::import_safety::safe_file_component(file_name)
        }
        ModSource::Local { file_name } => {
            crate::utils::import_safety::safe_file_component(file_name)
        }
        ModSource::Url { file_name, url } => file_name
            .as_deref()
            .ok_or_else(|| {
                crate::error::AppError::Other(format!(
                    "Filename missing for URL mod source: {}",
                    url
                ))
            })
            .and_then(crate::utils::import_safety::safe_file_component),
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
            use_overwrite_loader_version: false,
            overwrite_loader_version: None,
            overwrite_loader_versions: HashMap::new(),
            memory: MemorySettings::default(),
            resolution: None,
            fullscreen: false,
            extra_game_args: Vec::new(),
            custom_jvm_args: None, // Standardmäßig keine benutzerdefinierten JVM-Args
            quick_play_path: None,
        }
    }
}

pub const LEGACY_DEFAULT_MEMORY_MIN_MB: u32 = 1024;
pub const LEGACY_DEFAULT_MEMORY_MAX_MB: u32 = 2048;

pub fn default_memory_max_mb() -> u32 {
    static TIER: std::sync::OnceLock<u32> = std::sync::OnceLock::new();

    *TIER.get_or_init(|| {
        let system_gib = crate::utils::system_info::total_ram_mb() / 1024;

        if system_gib < 8 {
            2048
        } else if system_gib >= 24 {
            6144
        } else {
            4096
        }
    })
}

impl Default for MemorySettings {
    fn default() -> Self {
        Self {
            min: LEGACY_DEFAULT_MEMORY_MIN_MB,
            max: default_memory_max_mb(),
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
