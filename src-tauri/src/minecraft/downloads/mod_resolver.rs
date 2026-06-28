use crate::error::Result;
use crate::integrations::norisk_packs::{self, NoriskModSourceDefinition, NoriskModpacksConfig};
use crate::state::profile_state::{
    self, CustomModInfo, ModLoader, ModSource, NoriskModIdentifier, Profile,
};
use log::{debug, info, warn};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::command;
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

// --- Unified helper function to add a mod to final_mods with all necessary checks ---
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
) -> bool {
    // 1. Check Modrinth Project ID if applicable
    if let Some(pid) = project_id {
        if is_modrinth_project_id_blocked_by_config(pid, enable_flagsmith_blocking).await {
            info!(
                "Skipping {} mod '{}' (project ID: {}) because project ID is blocked by configuration",
                mod_type_str, mod_name, pid
            );
            return false;
        }
    }
    
    // 2. Check filename
    if is_filename_blocked_by_config(&filename, enable_flagsmith_blocking).await {
        info!(
            "Skipping {} mod '{}' because filename '{}' is blocked by configuration",
            mod_type_str, mod_name, filename
        );
        return false;
    }
    
    // 3. Check if file exists in cache
    let cache_path = mod_cache_dir.join(&filename);
    if !cache_path.exists() {
        warn!(
            "{} mod '{}' not found in cache at: {:?}. Skipping.",
            mod_type_str, filename, cache_path
        );
        return false;
    }
    
    // 4. Add to final mods
    if final_mods.contains_key(&canonical_key) {
        info!(
            "Overriding pack {} mod with key '{}' with version: {}",
            mod_type_str, canonical_key, filename
        );
    } else {
        info!(
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

    true
}

// --- Helper function to resolve the final list of mods (Focus on Modrinth) ---
// Renamed loader parameter to loader_str for clarity
pub async fn resolve_target_mods(
    profile: &Profile,
    norisk_config: Option<&NoriskModpacksConfig>,
    custom_mod_infos: Option<&[CustomModInfo]>,
    minecraft_version: &str,
    loader_str: &str,
    mod_cache_dir: &PathBuf,
) -> Result<Vec<TargetMod>> {
    let mut final_mods: HashMap<String, TargetMod> = HashMap::new(); // Key: Canonical Mod Identifier
    
    // Enable Flagsmith blocking only if a NoRisk pack is selected
    let enable_flagsmith_blocking = profile.selected_norisk_pack_id.is_some();
    
    if enable_flagsmith_blocking {
        debug!("Flagsmith mod blocking is enabled (NoRisk pack selected)");
    } else {
        debug!("Flagsmith mod blocking is disabled (no NoRisk pack selected)");
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
            // Add other types if needed
            _ => None,
        }
    }
    fn get_canonical_key_profile(source: &ModSource) -> Option<String> {
        match source {
            ModSource::Modrinth { project_id, .. } => Some(format!("modrinth:{}", project_id)),
            ModSource::CurseForge { project_id, .. } => Some(format!("curseforge:{}", project_id)),
            ModSource::Url { url, .. } => Some(format!("url:{}", url)),
            ModSource::Maven { coordinates, .. } => Some(format!("maven:{}", coordinates)),
            _ => None, // Ignore other types
        }
    }
    fn get_sha1_from_source(source: &ModSource) -> Option<String> {
        match source {
            ModSource::Modrinth { file_hash_sha1, .. } => file_hash_sha1.clone(),
            ModSource::CurseForge { file_hash_sha1, .. } => file_hash_sha1.clone(),
            _ => None,
        }
    }

    // 1. Process Pack Mods (Only Modrinth)
    let effective_pack_id = profile.effective_norisk_pack_id().await;
    if let (Some(pack_id), Some(config)) = (effective_pack_id.as_ref(), norisk_config) {
        info!("Resolving mods from selected Norisk Pack: '{}'", pack_id);
        match config.get_resolved_pack_definition(pack_id) {
            Ok(pack_definition) => {
                for mod_entry in &pack_definition.mods {
                    // --- START: Moved Disabled Check (Check *before* type/compatibility) ---
                    let mod_id_str = mod_entry.id.clone();
                    let game_version_str = minecraft_version.to_string();

                    match ModLoader::from_str(loader_str) {
                        Ok(loader_enum) => {
                            let identifier = NoriskModIdentifier {
                                pack_id: pack_id.clone(),
                                mod_id: mod_id_str.clone(),
                                game_version: game_version_str,
                                loader: loader_enum,
                            };

                            if profile.disabled_norisk_mods_detailed.contains(&identifier) {
                                info!(
                                    "Skipping pack mod '{}' (ID: {}) because it is disabled for profile '{}' context (MC: {}, Loader: {:?})",
                                    mod_entry.display_name.as_deref().unwrap_or("?"), mod_id_str, profile.name, minecraft_version, loader_enum
                                );
                                continue; // Skip this mod entirely if disabled
                            }
                            // Mod is not disabled for this context
                        }
                        Err(_) => {
                            warn!("Invalid loader string '{}' during disabled check for pack mod '{}'. Cannot check disabled status.", loader_str, mod_id_str);
                            // Proceeding even if loader check failed for disabled status?
                        }
                    }
                    // --- END: Moved Disabled Check ---

                    // --- Process the mod based on type (if not disabled) ---

                    // Current focus: Modrinth
                    if let NoriskModSourceDefinition::Modrinth { project_id, .. } = &mod_entry.source {
                        if let Some(target) = mod_entry
                            .compatibility
                            .get(minecraft_version)
                            .and_then(|l| l.get(loader_str))
                        {
                            // Disabled check is handled above
                            // Use source override from target if available, otherwise use the original source
                            let effective_source = target.source.as_ref().unwrap_or(&mod_entry.source);

                            if let Some(canonical_key) =
                                get_canonical_key(effective_source, &mod_entry.id)
                            {
                                match norisk_packs::get_norisk_pack_mod_filename(
                                    effective_source,
                                    target,
                                    &mod_entry.id,
                                ) {
                                    Ok(filename) => {
                                        let mod_name = mod_entry.display_name.as_deref().unwrap_or(&mod_entry.id);
                                        try_add_mod_to_final_list(
                                            canonical_key,
                                            filename,
                                            mod_cache_dir,
                                            &mut final_mods,
                                            "pack Modrinth",
                                            mod_name,
                                            Some(project_id),
                                            enable_flagsmith_blocking,
                                            None, // Pack mods don't store SHA1
                                        ).await;
                                    }
                                    Err(e) => {
                                        warn!(
                                         "Could not determine filename for pack Modrinth mod '{}' (ID: {}): {}. Skipping.",
                                         mod_entry.display_name.as_deref().unwrap_or(&mod_entry.id), mod_entry.id, e
                                    );
                                    }
                                } // End get_filename match
                            } // End get_canonical_key match
                        } // End compatibility check

                    // Handle URL Mods
                    } else if let NoriskModSourceDefinition::Url { .. } = &mod_entry.source {
                        if let Some(target) = mod_entry
                            .compatibility
                            .get(minecraft_version)
                            .and_then(|l| l.get(loader_str))
                        {
                            // Disabled check is handled above
                            if let Some(canonical_key) =
                                get_canonical_key(&mod_entry.source, &mod_entry.id)
                            {
                                match norisk_packs::get_norisk_pack_mod_filename(
                                    &mod_entry.source,
                                    target,
                                    &mod_entry.id,
                                ) {
                                    Ok(filename) => {
                                        let mod_name = mod_entry.display_name.as_deref().unwrap_or(&mod_entry.id);
                                        try_add_mod_to_final_list(
                                            canonical_key,
                                            filename,
                                            mod_cache_dir,
                                            &mut final_mods,
                                            "pack URL",
                                            mod_name,
                                            None,
                                            enable_flagsmith_blocking,
                                            None,
                                        ).await;
                                    }
                                    Err(e) => {
                                        // Should only happen if filename is missing in pack def
                                        warn!(
                                        "Could not get filename for pack URL mod '{}' (ID: {}): {}. Skipping.",
                                        mod_entry.display_name.as_deref().unwrap_or(&mod_entry.id), mod_entry.id, e
                                    );
                                    }
                                } // End get_filename match
                            } // End get_canonical_key match
                        } // End compatibility check

                    // Handle Maven Mods
                    } else if let NoriskModSourceDefinition::Maven {
                        repository_ref,
                        group_id,
                        artifact_id,
                    } = &mod_entry.source
                    {
                        if let Some(target) = mod_entry
                            .compatibility
                            .get(minecraft_version)
                            .and_then(|l| l.get(loader_str))
                        {
                            // Disabled check is handled above
                            // Use source override from target if available, otherwise use the original source
                            let effective_source = target.source.as_ref().unwrap_or(&mod_entry.source);

                            if let Some(canonical_key) =
                                get_canonical_key(effective_source, &mod_entry.id)
                            {
                                // Filename can be derived for Maven, or explicitly provided
                                match norisk_packs::get_norisk_pack_mod_filename(
                                    effective_source,
                                    target,
                                    &mod_entry.id,
                                ) {
                                    Ok(filename) => {
                                        let mod_name = mod_entry.display_name.as_deref().unwrap_or(&mod_entry.id);
                                        try_add_mod_to_final_list(
                                            canonical_key,
                                            filename,
                                            mod_cache_dir,
                                            &mut final_mods,
                                            "pack Maven",
                                            mod_name,
                                            None,
                                            enable_flagsmith_blocking,
                                            None,
                                        ).await;
                                    }
                                    Err(e) => {
                                        // Error during filename derivation/retrieval
                                        warn!(
                                        "Could not get/derive filename for pack Maven mod '{}' (ID: {}): {}. Skipping.",
                                        mod_entry.display_name.as_deref().unwrap_or(&mod_entry.id), mod_entry.id, e
                                    );
                                    }
                                } // End get_filename match
                            } // End get_canonical_key match
                        } // End compatibility check
                    } // End Modrinth/URL/Maven checks
                } // End for mod_entry
            }
            Err(e) => {
                warn!(
                    "Could not resolve Norisk Pack definition for pack ID '{}': {}. Skipping pack mods.",
                    pack_id, e
                );
            }
        }
    }

    // 2. Process Profile Mods (Only Modrinth for Overrides)
    info!(
        "Resolving manually added/overridden mods for profile: '{}'",
        profile.name
    );
    for mod_info in &profile.mods {
        if !mod_info.enabled {
            debug!(
                "Skipping disabled profile mod: {}",
                mod_info
                    .display_name
                    .as_deref()
                    .unwrap_or(&mod_info.id.to_string())
            );
            continue;
        }

        // --- Moved Compatibility Checks (Applied to *all* enabled profile mods) ---

        // 1. Game Version Check
        if let Some(mod_gv_list) = &mod_info.game_versions {
            let mc_ver = minecraft_version.to_string();
            if !mod_gv_list.is_empty()
                && !mod_gv_list.contains(&mc_ver)
                && !mod_info.force_include_versions.contains(&mc_ver)
            {
                debug!(
                    "Skipping profile mod '{}' (intended for MC {:?}, force={:?}) because target version is {}",
                    mod_info
                        .display_name
                        .as_deref()
                        .unwrap_or(&mod_info.id.to_string()),
                    mod_gv_list,
                    mod_info.force_include_versions,
                    minecraft_version
                );
                continue; // Skip if target game version is not in either list
            }
        }

        // 2. Loader Check
        let profile_loader = profile.loader;
        match mod_info.associated_loader {
            Some(mod_loader) => {
                if mod_loader != profile_loader {
                    debug!(
                        "Skipping profile mod '{}' (intended for loader {:?}) because profile loader is {:?}",
                        mod_info.display_name.as_deref().unwrap_or(&mod_info.id.to_string()),
                        mod_loader,
                        profile_loader
                    );
                    continue; // Skip if loader doesn't match
                }
            }
            None => {
                debug!(
                    "Skipping profile mod '{}' because it lacks an associated loader.",
                    mod_info
                        .display_name
                        .as_deref()
                        .unwrap_or(&mod_info.id.to_string())
                );
                continue; // Skip if no loader is associated in profile mod
            }
        }
        // --- End Moved Compatibility Checks ---

        // Compatibility checks passed, now process based on source type
        match &mod_info.source {
            ModSource::Modrinth { project_id, .. } => {
                // Common logic for sources that can override pack mods
                if let Some(canonical_key) = get_canonical_key_profile(&mod_info.source) {
                    match profile_state::get_profile_mod_filename(&mod_info.source) {
                        Ok(filename) => {
                            let mod_id_string = mod_info.id.to_string();
                            let mod_name = mod_info.display_name.as_deref().unwrap_or(&mod_id_string);
                            try_add_mod_to_final_list(
                                canonical_key,
                                filename,
                                mod_cache_dir,
                                &mut final_mods,
                                "profile Modrinth",
                                mod_name,
                                Some(project_id),
                                enable_flagsmith_blocking,
                                get_sha1_from_source(&mod_info.source),
                            ).await;
                        }
                        Err(e) => {
                            // Error getting filename from profile mod source
                            warn!(
                                "Could not determine filename for profile mod '{}': {}. Skipping.",
                                mod_info
                                    .display_name
                                    .as_deref()
                                    .unwrap_or(&mod_info.id.to_string()),
                                e
                            );
                        }
                    }
                } else {
                    // Log if canonical key fails for expected types
                    warn!(
                        "Could not get canonical key for profile mod: {:?}",
                        mod_info.source
                    );
                }
            }
            ModSource::CurseForge { project_id, .. } => {
                // Common logic for sources that can override pack mods
                if let Some(canonical_key) = get_canonical_key_profile(&mod_info.source) {
                    match profile_state::get_profile_mod_filename(&mod_info.source) {
                        Ok(filename) => {
                            let mod_id_string = mod_info.id.to_string();
                            let mod_name = mod_info.display_name.as_deref().unwrap_or(&mod_id_string);
                            try_add_mod_to_final_list(
                                canonical_key,
                                filename,
                                mod_cache_dir,
                                &mut final_mods,
                                "profile CurseForge",
                                mod_name,
                                Some(project_id),
                                enable_flagsmith_blocking,
                                get_sha1_from_source(&mod_info.source),
                            ).await;
                        }
                        Err(e) => {
                            // Error getting filename from profile mod source
                            warn!(
                                "Could not determine filename for profile mod '{}': {}. Skipping.",
                                mod_info
                                    .display_name
                                    .as_deref()
                                    .unwrap_or(&mod_info.id.to_string()),
                                e
                            );
                        }
                    }
                } else {
                    // Log if canonical key fails for expected types
                    warn!(
                        "Could not get canonical key for profile mod: {:?}",
                        mod_info.source
                    );
                }
            }
            ModSource::Url { .. } | ModSource::Maven { .. } => {
                // Common logic for sources that can override pack mods
                if let Some(canonical_key) = get_canonical_key_profile(&mod_info.source) {
                    match profile_state::get_profile_mod_filename(&mod_info.source) {
                        Ok(filename) => {
                            let mod_type_str = match &mod_info.source {
                                ModSource::Url { .. } => "profile URL",
                                ModSource::Maven { .. } => "profile Maven",
                                _ => "profile Unknown", // Should not happen here
                            };
                            let mod_id_string = mod_info.id.to_string();
                            let mod_name = mod_info.display_name.as_deref().unwrap_or(&mod_id_string);
                            try_add_mod_to_final_list(
                                canonical_key,
                                filename,
                                mod_cache_dir,
                                &mut final_mods,
                                mod_type_str,
                                mod_name,
                                None,
                                enable_flagsmith_blocking,
                                None, // URL/Maven mods don't have SHA1
                            ).await;
                        }
                        Err(e) => {
                            // Error getting filename from profile mod source
                            warn!(
                                "Could not determine filename for profile mod '{}': {}. Skipping.",
                                mod_info
                                    .display_name
                                    .as_deref()
                                    .unwrap_or(&mod_info.id.to_string()),
                                e
                            );
                        }
                    }
                } else {
                    // Log if canonical key fails for expected types
                    warn!(
                        "Could not get canonical key for profile mod: {:?}",
                        mod_info.source
                    );
                }
            }
            ModSource::Local { .. } | ModSource::Embedded { .. } => {
                // Ignore Local/Embedded mods in the profile.mods list for resolution purposes.
                // These should be handled via custom_mods.
                debug!(
                    "Ignoring profile mod of type {:?} during resolution.",
                    mod_info.source.clone()
                );
            }
        }
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

    let final_target_list: Vec<TargetMod> = final_mods.into_values().collect();
    info!(
        "Resolved {} total target mods for sync (incl. custom & overrides).",
        final_target_list.len()
    );
    debug!("Final target mods for sync: {:?}", final_target_list);
    Ok(final_target_list)
}

/// Creates a Fabric addMods meta file that lists one absolute path per line for the provided target mods.
/// Returns the absolute path to the created meta file.
pub async fn create_fabric_add_mods_meta(
    profile_id: Uuid,
    minecraft_version: &str,
    target_mods: &[TargetMod],
) -> crate::error::Result<PathBuf> {
    let runtime_dir = LAUNCHER_DIRECTORY.meta_dir().join("runtime");
    fs::create_dir_all(&runtime_dir).await?;

    let meta_file_path = runtime_dir.join(format!(
        "nrc_fabric_mods_{}_{}.txt",
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

/// Creates the meta file and returns the formatted JVM argument string for Fabric addMods
pub async fn build_fabric_add_mods_arg(
    profile_id: Uuid,
    minecraft_version: &str,
    target_mods: &[TargetMod],
) -> crate::error::Result<String> {
    let meta = create_fabric_add_mods_meta(profile_id, minecraft_version, target_mods).await?;
    Ok(format!(
        "-Dfabric.addMods=@{}",
        meta.to_string_lossy().replace("\\", "/")
    ))
}

const NEOFORGE_EARLY_SERVICE_CLASSES: &[&str] = &[
    "net.neoforged.neoforgespi.earlywindow.GraphicsBootstrapper",
    "net.neoforged.neoforgespi.earlywindow.ImmediateWindowProvider",
    "net.neoforged.neoforgespi.locating.IModFileCandidateLocator",
    "net.neoforged.neoforgespi.locating.IModFileReader",
    "net.neoforged.neoforgespi.locating.IDependencyLocator",
];

pub async fn has_neoforge_early_service(jar_path: &std::path::Path) -> bool {
    use async_zip::tokio::read::seek::ZipFileReader;
    use tokio::io::BufReader;

    let file = match tokio::fs::File::open(jar_path).await {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut buf_reader = BufReader::new(file);
    let zip = match ZipFileReader::with_tokio(&mut buf_reader).await {
        Ok(z) => z,
        Err(_) => return false,
    };
    let targets: Vec<String> = NEOFORGE_EARLY_SERVICE_CLASSES
        .iter()
        .map(|c| format!("META-INF/services/{}", c))
        .collect();
    for entry in zip.file().entries() {
        if let Ok(name) = entry.filename().as_str() {
            if targets.iter().any(|t| t == name) {
                return true;
            }
        }
    }
    false
}

pub async fn split_neoforge_early_service_mods(
    mods: &[TargetMod],
) -> (Vec<TargetMod>, Vec<TargetMod>) {
    use futures::stream::{FuturesUnordered, StreamExt};

    let mut tasks: FuturesUnordered<_> = mods
        .iter()
        .cloned()
        .map(|tm| async move {
            let early = has_neoforge_early_service(&tm.cache_path).await;
            (tm, early)
        })
        .collect();

    let mut early = Vec::new();
    let mut normal = Vec::new();
    while let Some((tm, is_early)) = tasks.next().await {
        if is_early {
            info!("NeoForge early-service jar detected (→ classpath): {}", tm.filename);
            early.push(tm);
        } else {
            normal.push(tm);
        }
    }
    (early, normal)
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



