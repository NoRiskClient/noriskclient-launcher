use crate::error::Result;
use crate::integrations::norisk_packs::{self, NoriskModSourceDefinition, NoriskModpacksConfig};
use crate::state::profile_state::{
    self, CustomModInfo, Mod, ModLoader, ModSource, NoriskModIdentifier, Profile,
};
use log::{debug, info, trace, warn};
use std::collections::HashMap;
use std::path::PathBuf;
use uuid::Uuid;
use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use tokio::fs;

// --- Struct for resolved mods ---
#[derive(Debug, Clone)]
pub struct TargetMod {
    // Make fields public so mod_downloader can access them
    pub mod_id: String, // Canonical Key (e.g., "modrinth:AANobbMI")
    pub filename: String,
    pub cache_path: PathBuf,
    pub sha1: Option<String>, // Known SHA1 from Modrinth/CurseForge (None for Maven/URL/local)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ModResolutionStatus {
    #[default]
    Unknown,
    Included,
    Overridden,
    UserDisabled,
    NoCompatibleVersion,
    GameVersionMismatch,
    LoaderMismatch,
    NoAssociatedLoader,
    UnsupportedSource,
    FilenameUnresolved,
    BlockedByProjectId,
    BlockedByFilename,
    MissingFromCache,
    ManagedElsewhere,
    NotDelivered,
    PackResolveFailed,
}

impl ModResolutionStatus {
    pub fn as_wire(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Included => "included",
            Self::Overridden => "overridden",
            Self::UserDisabled => "user_disabled",
            Self::NoCompatibleVersion => "no_compatible_version",
            Self::GameVersionMismatch => "game_version_mismatch",
            Self::LoaderMismatch => "loader_mismatch",
            Self::NoAssociatedLoader => "no_associated_loader",
            Self::UnsupportedSource => "unsupported_source",
            Self::FilenameUnresolved => "filename_unresolved",
            Self::BlockedByProjectId => "blocked_by_project_id",
            Self::BlockedByFilename => "blocked_by_filename",
            Self::MissingFromCache => "missing_from_cache",
            Self::ManagedElsewhere => "managed_elsewhere",
            Self::NotDelivered => "not_delivered",
            Self::PackResolveFailed => "pack_resolve_failed",
        }
    }

    pub fn in_launch_set(self) -> Option<bool> {
        match self {
            Self::Unknown | Self::ManagedElsewhere => None,
            Self::Included | Self::Overridden => Some(true),
            _ => Some(false),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ModOutcome {
    pub status: ModResolutionStatus,
    pub canonical_key: Option<String>,
    pub filename: Option<String>,
    pub version: Option<String>,
    pub overridden_by: Option<String>,
}

impl ModOutcome {
    pub fn skipped(status: ModResolutionStatus) -> Self {
        Self {
            status,
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ModResolutionReport {
    minecraft_version: String,
    loader: String,
    pack_resolve_failed: bool,
    pack: HashMap<String, ModOutcome>,
    profile: HashMap<Uuid, ModOutcome>,
}

impl ModResolutionReport {
    fn new(minecraft_version: &str, loader: &str) -> Self {
        Self {
            minecraft_version: minecraft_version.to_string(),
            loader: loader.to_string(),
            ..Default::default()
        }
    }

    pub fn matches(&self, minecraft_version: &str, loader: &str) -> bool {
        self.minecraft_version == minecraft_version && self.loader == loader
    }

    pub fn pack_resolve_failed(&self) -> bool {
        self.pack_resolve_failed
    }

    pub fn pack_mod(&self, id: &str) -> Option<&ModOutcome> {
        self.pack.get(id)
    }

    pub fn profile_mod(&self, id: &Uuid) -> Option<&ModOutcome> {
        self.profile.get(id)
    }

    fn outcomes_mut(&mut self) -> impl Iterator<Item = &mut ModOutcome> {
        self.pack.values_mut().chain(self.profile.values_mut())
    }

    fn resolve_overrides(&mut self, final_mods: &HashMap<String, TargetMod>) {
        for outcome in self.outcomes_mut() {
            if outcome.status != ModResolutionStatus::Included {
                continue;
            }
            let winner = outcome
                .canonical_key
                .as_ref()
                .and_then(|key| final_mods.get(key))
                .filter(|winner| Some(&winner.filename) != outcome.filename.as_ref());
            if let Some(winner) = winner {
                outcome.status = ModResolutionStatus::Overridden;
                outcome.overridden_by = Some(winner.filename.clone());
                outcome.version = None;
            }
        }
    }

    pub fn mark_all_undelivered(&mut self) {
        for outcome in self.outcomes_mut() {
            if outcome.status.in_launch_set() == Some(true) {
                outcome.status = ModResolutionStatus::NotDelivered;
            }
        }
    }
}

// --- Helper function to check if a filename is blocked by Flagsmith config ---
async fn is_filename_blocked_by_config(filename: &str, enable_flagsmith_blocking: bool) -> bool {
    if !enable_flagsmith_blocking {
        return false; // Skip blocking if no NoRisk pack is selected
    }
    
    match crate::commands::flagsmith_commands::is_filename_blocked(filename.to_string()).await {
        Ok(is_blocked) => {
            if is_blocked {
                info!("Filename '{}' is blocked by Flagsmith configuration", filename);
            }
            is_blocked
        }
        Err(e) => {
            warn!("Failed to check if filename '{}' is blocked: {:?}. Allowing by default.", filename, e);
            false // Default to allowing if check fails
        }
    }
}

// --- Helper function to check if a Modrinth project ID is blocked by Flagsmith config ---
async fn is_modrinth_project_id_blocked_by_config(project_id: &str, enable_flagsmith_blocking: bool) -> bool {
    if !enable_flagsmith_blocking {
        return false; // Skip blocking if no NoRisk pack is selected
    }
    
    match crate::commands::flagsmith_commands::is_modrinth_project_id_blocked(project_id.to_string()).await {
        Ok(is_blocked) => {
            if is_blocked {
                info!("Modrinth project ID '{}' is blocked by Flagsmith configuration", project_id);
            }
            is_blocked
        }
        Err(e) => {
            warn!("Failed to check if Modrinth project ID '{}' is blocked: {:?}. Allowing by default.", project_id, e);
            false // Default to allowing if check fails
        }
    }
}

// --- Helper: Get Canonical Key ---
fn get_canonical_key(source: &NoriskModSourceDefinition, mod_id: &str) -> Option<String> {
    match source {
        NoriskModSourceDefinition::Modrinth { project_id, .. } => {
            Some(format!("modrinth:{}", project_id))
        }
        NoriskModSourceDefinition::Url { .. } => Some(format!("url:{}", mod_id)),
        NoriskModSourceDefinition::Maven {
            group_id,
            artifact_id,
            ..
        } => Some(format!("maven:{}:{}", group_id, artifact_id)),
    }
}

fn get_canonical_key_profile(source: &ModSource) -> Option<String> {
    match source {
        ModSource::Modrinth { project_id, .. } => Some(format!("modrinth:{}", project_id)),
        ModSource::CurseForge { project_id, .. } => Some(format!("curseforge:{}", project_id)),
        ModSource::Url { url, .. } => Some(format!("url:{}", url)),
        ModSource::Maven { coordinates, .. } => Some(format!("maven:{}", coordinates)),
        _ => None,
    }
}

fn get_sha1_from_source(source: &ModSource) -> Option<String> {
    match source {
        ModSource::Modrinth { file_hash_sha1, .. } => file_hash_sha1.clone(),
        ModSource::CurseForge { file_hash_sha1, .. } => file_hash_sha1.clone(),
        _ => None,
    }
}

// --- Unified helper function to add a mod to final_mods with all necessary checks ---
#[must_use]
async fn try_add_mod_to_final_list(
    canonical_key: String,
    filename: String,
    mod_cache_dir: &PathBuf,
    final_mods: &mut HashMap<String, TargetMod>,
    mod_type_str: &str,
    mod_name: &str,
    project_id: Option<&str>, // Only for Modrinth mods
    enable_flagsmith_blocking: bool, // Flag to enable/disable Flagsmith blocking
    sha1: Option<String>, // Known SHA1 hash (Modrinth/CurseForge)
) -> ModResolutionStatus {
    // 1. Check Modrinth Project ID if applicable
    if let Some(pid) = project_id {
        if is_modrinth_project_id_blocked_by_config(pid, enable_flagsmith_blocking).await {
            info!(
                "Skipping {} mod '{}' (project ID: {}) because project ID is blocked by configuration",
                mod_type_str, mod_name, pid
            );
            return ModResolutionStatus::BlockedByProjectId;
        }
    }

    // 2. Check filename
    if is_filename_blocked_by_config(&filename, enable_flagsmith_blocking).await {
        info!(
            "Skipping {} mod '{}' because filename '{}' is blocked by configuration",
            mod_type_str, mod_name, filename
        );
        return ModResolutionStatus::BlockedByFilename;
    }

    // 3. Check if file exists in cache
    let cache_path = mod_cache_dir.join(&filename);
    if !cache_path.exists() {
        warn!(
            "{} mod '{}' not found in cache at: {:?}. Skipping.",
            mod_type_str, filename, cache_path
        );
        return ModResolutionStatus::MissingFromCache;
    }

    // 4. Add to final mods
    if final_mods.contains_key(&canonical_key) {
        info!(
            "Overriding pack {} mod with key '{}' with version: {}",
            mod_type_str, canonical_key, filename
        );
    } else {
        trace!(
            "Adding {} mod to list: {}",
            mod_type_str, filename
        );
    }
    
    final_mods.insert(
        canonical_key.clone(),
        TargetMod {
            mod_id: canonical_key,
            filename,
            cache_path,
            sha1,
        },
    );

    ModResolutionStatus::Included
}

async fn resolve_pack_entry(
    mod_entry: &norisk_packs::NoriskModEntryDefinition,
    pack_id: &str,
    profile: &Profile,
    minecraft_version: &str,
    loader_str: &str,
    mod_cache_dir: &PathBuf,
    final_mods: &mut HashMap<String, TargetMod>,
    enable_flagsmith_blocking: bool,
) -> ModOutcome {
    let mod_name = mod_entry.display_name.as_deref().unwrap_or(&mod_entry.id);

    match ModLoader::from_str(loader_str) {
        Ok(loader_enum) => {
            let identifier = NoriskModIdentifier {
                pack_id: pack_id.to_string(),
                mod_id: mod_entry.id.clone(),
                game_version: minecraft_version.to_string(),
                loader: loader_enum,
            };

            if profile.disabled_norisk_mods_detailed.contains(&identifier) {
                info!(
                    "Skipping pack mod '{}' (ID: {}) because it is disabled for profile '{}' context (MC: {}, Loader: {:?})",
                    mod_name, mod_entry.id, profile.name, minecraft_version, loader_enum
                );
                return ModOutcome::skipped(ModResolutionStatus::UserDisabled);
            }
        }
        Err(_) => {
            warn!("Invalid loader string '{}' during disabled check for pack mod '{}'. Cannot check disabled status.", loader_str, mod_entry.id);
        }
    }

    let target = match mod_entry
        .compatibility
        .get(minecraft_version)
        .and_then(|l| l.get(loader_str))
    {
        Some(target) => target,
        None => {
            warn!(
                "Pack mod '{}' (ID: {}) has no compatibility entry for {} / {}. Not launched.",
                mod_name, mod_entry.id, minecraft_version, loader_str
            );
            return ModOutcome::skipped(ModResolutionStatus::NoCompatibleVersion);
        }
    };

    let (mod_type_str, project_id, effective_source) = match &mod_entry.source {
        NoriskModSourceDefinition::Modrinth { project_id, .. } => (
            "pack Modrinth",
            Some(project_id.as_str()),
            target.source.as_ref().unwrap_or(&mod_entry.source),
        ),
        NoriskModSourceDefinition::Url { .. } => ("pack URL", None, &mod_entry.source),
        NoriskModSourceDefinition::Maven { .. } => (
            "pack Maven",
            None,
            target.source.as_ref().unwrap_or(&mod_entry.source),
        ),
    };

    let mut outcome = ModOutcome {
        version: match effective_source {
            NoriskModSourceDefinition::Maven { .. } => Some(target.identifier.clone()),
            _ => None,
        },
        ..Default::default()
    };

    let canonical_key = match get_canonical_key(effective_source, &mod_entry.id) {
        Some(key) => key,
        None => {
            warn!(
                "Could not build canonical key for pack mod '{}' (ID: {}). Skipping.",
                mod_name, mod_entry.id
            );
            outcome.status = ModResolutionStatus::UnsupportedSource;
            return outcome;
        }
    };
    outcome.canonical_key = Some(canonical_key.clone());

    let filename =
        match norisk_packs::get_norisk_pack_mod_filename(effective_source, target, &mod_entry.id) {
            Ok(filename) => filename,
            Err(e) => {
                warn!(
                    "Could not determine filename for {} mod '{}' (ID: {}): {}. Skipping.",
                    mod_type_str, mod_name, mod_entry.id, e
                );
                outcome.status = ModResolutionStatus::FilenameUnresolved;
                return outcome;
            }
        };
    outcome.filename = Some(filename.clone());

    outcome.status = try_add_mod_to_final_list(
        canonical_key,
        filename,
        mod_cache_dir,
        final_mods,
        mod_type_str,
        mod_name,
        project_id,
        enable_flagsmith_blocking,
        None,
    )
    .await;

    outcome
}

async fn resolve_profile_mod(
    mod_info: &Mod,
    profile: &Profile,
    minecraft_version: &str,
    mod_cache_dir: &PathBuf,
    final_mods: &mut HashMap<String, TargetMod>,
    enable_flagsmith_blocking: bool,
) -> ModOutcome {
    let mod_id_string = mod_info.id.to_string();
    let mod_name = mod_info.display_name.as_deref().unwrap_or(&mod_id_string);

    if !mod_info.enabled {
        debug!("Skipping disabled profile mod: {}", mod_name);
        return ModOutcome::skipped(ModResolutionStatus::UserDisabled);
    }

    if let Some(mod_gv_list) = &mod_info.game_versions {
        let mc_ver = minecraft_version.to_string();
        if !mod_gv_list.is_empty()
            && !mod_gv_list.contains(&mc_ver)
            && !mod_info.force_include_versions.contains(&mc_ver)
        {
            debug!(
                "Skipping profile mod '{}' (intended for MC {:?}, force={:?}) because target version is {}",
                mod_name, mod_gv_list, mod_info.force_include_versions, minecraft_version
            );
            return ModOutcome::skipped(ModResolutionStatus::GameVersionMismatch);
        }
    }

    let profile_loader = profile.loader;
    match mod_info.associated_loader {
        Some(mod_loader) => {
            if mod_loader != profile_loader {
                debug!(
                    "Skipping profile mod '{}' (intended for loader {:?}) because profile loader is {:?}",
                    mod_name, mod_loader, profile_loader
                );
                return ModOutcome::skipped(ModResolutionStatus::LoaderMismatch);
            }
        }
        None => {
            debug!(
                "Skipping profile mod '{}' because it lacks an associated loader.",
                mod_name
            );
            return ModOutcome::skipped(ModResolutionStatus::NoAssociatedLoader);
        }
    }

    let (mod_type_str, project_id) = match &mod_info.source {
        ModSource::Modrinth { project_id, .. } => ("profile Modrinth", Some(project_id.as_str())),
        ModSource::CurseForge { project_id, .. } => {
            ("profile CurseForge", Some(project_id.as_str()))
        }
        ModSource::Url { .. } => ("profile URL", None),
        ModSource::Maven { .. } => ("profile Maven", None),
        ModSource::Local { .. } | ModSource::Embedded { .. } => {
            debug!(
                "Ignoring profile mod of type {:?} during resolution.",
                mod_info.source.clone()
            );
            return ModOutcome::skipped(ModResolutionStatus::ManagedElsewhere);
        }
    };

    let mut outcome = ModOutcome::default();

    let canonical_key = match get_canonical_key_profile(&mod_info.source) {
        Some(key) => key,
        None => {
            warn!(
                "Could not get canonical key for profile mod: {:?}",
                mod_info.source
            );
            outcome.status = ModResolutionStatus::UnsupportedSource;
            return outcome;
        }
    };
    outcome.canonical_key = Some(canonical_key.clone());

    let filename = match profile_state::get_profile_mod_filename(&mod_info.source) {
        Ok(filename) => filename,
        Err(e) => {
            warn!(
                "Could not determine filename for profile mod '{}': {}. Skipping.",
                mod_name, e
            );
            outcome.status = ModResolutionStatus::FilenameUnresolved;
            return outcome;
        }
    };
    outcome.filename = Some(filename.clone());

    outcome.status = try_add_mod_to_final_list(
        canonical_key,
        filename,
        mod_cache_dir,
        final_mods,
        mod_type_str,
        mod_name,
        project_id,
        enable_flagsmith_blocking,
        get_sha1_from_source(&mod_info.source),
    )
    .await;

    outcome
}

// --- Helper function to resolve the final list of mods (Focus on Modrinth) ---
// Renamed loader parameter to loader_str for clarity
pub async fn resolve_target_mods(
    profile: &Profile,
    norisk_config: Option<&NoriskModpacksConfig>,
    custom_mod_infos: Option<&[CustomModInfo]>,
    extra_mods: &[Mod],
    minecraft_version: &str,
    loader_str: &str,
    mod_cache_dir: &PathBuf,
) -> Result<(Vec<TargetMod>, ModResolutionReport)> {
    let mut final_mods: HashMap<String, TargetMod> = HashMap::new(); // Key: Canonical Mod Identifier
    let mut report = ModResolutionReport::new(minecraft_version, loader_str);

    // Enable Flagsmith blocking only if a NoRisk pack is selected
    let enable_flagsmith_blocking = profile.selected_norisk_pack_id.is_some();

    if enable_flagsmith_blocking {
        debug!("Flagsmith mod blocking is enabled (NoRisk pack selected)");
    } else {
        debug!("Flagsmith mod blocking is disabled (no NoRisk pack selected)");
    }

    // 1. Process Pack Mods (Only Modrinth)
    let effective_pack_id = profile.effective_norisk_pack_id().await;
    if let (Some(pack_id), Some(config)) = (effective_pack_id.as_ref(), norisk_config) {
        info!("Resolving mods from selected Norisk Pack: '{}'", pack_id);
        match config.get_resolved_pack_definition(pack_id) {
            Ok(pack_definition) => {
                for mod_entry in &pack_definition.mods {
                    let outcome = resolve_pack_entry(
                        mod_entry,
                        pack_id,
                        profile,
                        minecraft_version,
                        loader_str,
                        mod_cache_dir,
                        &mut final_mods,
                        enable_flagsmith_blocking,
                    )
                    .await;
                    report.pack.insert(mod_entry.id.clone(), outcome);
                }
            }
            Err(e) => {
                warn!(
                    "Could not resolve Norisk Pack definition for pack ID '{}': {}. Skipping pack mods.",
                    pack_id, e
                );
                report.pack_resolve_failed = true;
            }
        }
    }

    // 2. Process Profile Mods (Only Modrinth for Overrides)
    info!(
        "Resolving manually added/overridden mods for profile: '{}'",
        profile.name
    );
    for mod_info in extra_mods.iter().chain(profile.mods.iter()) {
        let outcome = resolve_profile_mod(
            mod_info,
            profile,
            minecraft_version,
            mod_cache_dir,
            &mut final_mods,
            enable_flagsmith_blocking,
        )
        .await;
        report.profile.insert(mod_info.id, outcome);
    }

    // 3. Process Custom Mods (Add if enabled)
    info!(
        "Resolving custom (local) mods for profile: '{}'",
        profile.name
    );
    if let Some(custom_mods) = custom_mod_infos {
        let mut custom_mods_added = 0;
        for info in custom_mods {
            if info.is_enabled {
                // Check if filename is blocked by Flagsmith config first (no project ID check for custom mods)
                if is_filename_blocked_by_config(&info.filename, enable_flagsmith_blocking).await {
                    info!(
                        "Skipping custom mod '{}' because filename is blocked by configuration",
                        info.filename
                    );
                    continue;
                }
                
                // Create a unique key for the HashMap
                let canonical_key = format!("local:{}", info.filename);

                // Custom mods use direct path, not cache path - no exists() check needed
                let target = TargetMod {
                    mod_id: canonical_key.clone(),
                    filename: info.filename.clone(),
                    cache_path: info.path.clone(),
                    sha1: None, // Local custom mods don't have known SHA1
                };

                // Use the unique canonical key
                if final_mods.insert(canonical_key.clone(), target).is_none() {
                    debug!(
                        "Adding enabled custom mod to target list: {}",
                        info.filename
                    );
                    custom_mods_added += 1;
                } else {
                    // This should not happen if canonical keys are unique, but log just in case
                    warn!("Custom mod canonical key collision: {}", canonical_key);
                }
            } else {
                debug!("Skipping disabled custom mod: {}", info.filename);
            }
        }
        info!(
            "Added {} enabled custom mods to the target list.",
            custom_mods_added
        );
    } else {
        info!("No custom mod information provided for resolving.");
    }

    report.resolve_overrides(&final_mods);

    let final_target_list: Vec<TargetMod> = final_mods.into_values().collect();
    info!(
        "Resolved {} total target mods for sync (incl. custom & overrides).",
        final_target_list.len()
    );
    debug!("Final target mods for sync: {:?}", final_target_list);
    Ok((final_target_list, report))
}

/// Collects loose jars sitting directly in `<instance>/mods`.
///
/// Fabric normally treats that directory as *the* mods folder, but we point
/// `fabric.modsFolder` at the launcher-managed per-profile subdirectory, and
/// `FabricLoaderImpl.getModsDirectory0()` picks one or the other — it does not merge:
///
/// ```text
/// return directory != null ? Paths.get(directory) : gameDir.resolve("mods");
/// ```
///
/// So anything dropped into `mods/` — a jar the user dragged in, or the `overrides/mods`
/// of an installed .mrpack — silently never loads. Forge/NeoForge do not have that problem:
/// FML scans `<instance>/mods` itself, and our own loader merges `nrc.modsFolder` with
/// `nrc.addMods`. Feeding these jars through addMods gives Fabric the same behaviour.
///
/// Only the top level is scanned, so the managed `nrc-<mc>-<loader>[-<uuid>]` subdirectory
/// (and any other subfolder) is left alone.
pub async fn collect_instance_root_mods(instance_path: &std::path::Path) -> Vec<PathBuf> {
    let mods_dir = instance_path.join("mods");
    let mut out = Vec::new();

    let mut entries = match fs::read_dir(&mods_dir).await {
        Ok(e) => e,
        Err(_) => return out, // No mods dir yet — nothing to add.
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // Anything not ending in .jar is skipped, which also covers the `.disabled`
        // convention launchers use to park a mod without deleting it.
        if path
            .extension()
            .and_then(|e| e.to_str())
            .map_or(true, |e| !e.eq_ignore_ascii_case("jar"))
        {
            continue;
        }
        out.push(path);
    }
    out.sort();
    out
}

/// Creates a Fabric addMods meta file that lists one absolute path per line for the provided
/// target mods, followed by any loose jars from `<instance>/mods` (see
/// [`collect_instance_root_mods`]). Returns the absolute path to the created meta file.
pub async fn create_fabric_add_mods_meta(
    profile_id: Uuid,
    minecraft_version: &str,
    target_mods: &[TargetMod],
    extra_jars: &[PathBuf],
) -> crate::error::Result<PathBuf> {
    let runtime_dir = LAUNCHER_DIRECTORY.meta_dir().join("runtime");
    fs::create_dir_all(&runtime_dir).await?;

    let meta_file_path = runtime_dir.join(format!(
        "nrc_fabric_mods_{}_{}.txt",
        profile_id, minecraft_version
    ));

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut meta_contents = String::new();
    for p in target_mods
        .iter()
        .map(|tm| tm.cache_path.to_string_lossy().replace("\\", "/"))
        .chain(
            extra_jars
                .iter()
                .map(|p| p.to_string_lossy().replace("\\", "/")),
        )
    {
        // A managed mod could also sit in mods/ — list it only once.
        if !seen.insert(p.clone()) {
            continue;
        }
        meta_contents.push_str(&p);
        meta_contents.push('\n');
    }
    fs::write(&meta_file_path, meta_contents).await?;
    Ok(meta_file_path)
}

/// Creates the meta file and returns the formatted JVM argument string for Fabric addMods
pub async fn build_fabric_add_mods_arg(
    profile_id: Uuid,
    minecraft_version: &str,
    target_mods: &[TargetMod],
    extra_jars: &[PathBuf],
) -> crate::error::Result<String> {
    let meta =
        create_fabric_add_mods_meta(profile_id, minecraft_version, target_mods, extra_jars).await?;
    Ok(format!(
        "-Dfabric.addMods=@{}",
        meta.to_string_lossy().replace("\\", "/")
    ))
}

/// Creates a Forge addMods meta file listing ALL mod JARs (absolute paths, one per line).
/// ForgeModLoader reads this via `-Dnrc.addMods=@<meta>` and registers each JAR with ModListHelper.
pub async fn build_forge_add_mods_meta(
    profile_id: Uuid,
    minecraft_version: &str,
    target_mods: &[TargetMod],
) -> crate::error::Result<PathBuf> {
    let runtime_dir = LAUNCHER_DIRECTORY.meta_dir().join("runtime");
    fs::create_dir_all(&runtime_dir).await?;

    let meta_file_path = runtime_dir.join(format!(
        "nrc_forge_mods_{}_{}.txt",
        profile_id, minecraft_version
    ));

    let mut meta_contents = String::new();
    for tm in target_mods {
        let p = tm.cache_path.to_string_lossy().replace("\\", "/");
        meta_contents.push_str(&p);
        meta_contents.push('\n');
    }

    fs::write(&meta_file_path, meta_contents).await?;
    Ok(meta_file_path)
}



