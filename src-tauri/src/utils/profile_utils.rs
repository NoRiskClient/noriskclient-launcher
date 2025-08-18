use crate::config::ProjectDirsExt;
use crate::error::{AppError, Result};
use crate::integrations::modrinth::{ModrinthProjectType, ModrinthVersion};
use crate::integrations::norisk_packs;
use crate::state::profile_state::ModSource;
use crate::state::profile_state::Profile;
use crate::state::state_manager::State;
use crate::utils::file_utils;
use crate::utils::{datapack_utils, hash_utils, resourcepack_utils, shaderpack_utils};
use async_zip::tokio::write::ZipFileWriter;
use async_zip::{Compression, ZipEntryBuilder};
use chrono;
use futures::future::{join_all, BoxFuture, FutureExt};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use serde_json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tempfile;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt as TokioAsyncWriteExt};
use tokio::task::JoinHandle;

use futures_lite::io::AsyncWriteExt;
use std::collections::HashMap;
use uuid::Uuid;

/// Represents the type of content to be installed
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ContentType {
    ResourcePack,
    ShaderPack,
    DataPack,
    Mod,
    NoRiskMod,
}

impl Default for ContentType {
    fn default() -> Self {
        ContentType::Mod
    }
}

impl From<ModrinthProjectType> for ContentType {
    fn from(project_type: ModrinthProjectType) -> Self {
        match project_type {
            ModrinthProjectType::ResourcePack => ContentType::ResourcePack,
            ModrinthProjectType::Shader => ContentType::ShaderPack,
            ModrinthProjectType::Datapack => ContentType::DataPack,
            _ => panic!("Unsupported content type conversion"),
        }
    }
}

/// Adds Modrinth content (resourcepack, shaderpack, datapack) to a profile
pub async fn add_modrinth_content_to_profile(
    profile_id: Uuid,
    project_id: String,
    version_id: String,
    file_name: String,
    download_url: String,
    file_hash_sha1: Option<String>,
    content_name: Option<String>,
    version_number: Option<String>,
    content_type: ContentType,
) -> Result<()> {
    info!(
        "Adding Modrinth content to profile {}: {} ({})",
        profile_id,
        content_name.as_deref().unwrap_or(&file_name),
        content_type_to_string(&content_type)
    );

    // Get the profile
    let state = crate::state::state_manager::State::get().await?;
    let profile = state.profile_manager.get_profile(profile_id).await?;

    // Get the target directory based on content type
    let target_dir = get_content_directory(&profile, &content_type).await?;

    // Create the directory if it doesn't exist
    if !target_dir.exists() {
        debug!("Creating directory: {}", target_dir.display());
        fs::create_dir_all(&target_dir)
            .await
            .map_err(|e| AppError::Io(e))?;
    }

    // Construct the file path
    let file_path = target_dir.join(&file_name);
    debug!("Target file path: {}", file_path.display());

    // Download the file
    download_content(&download_url, &file_path, file_hash_sha1).await?;

    info!(
        "Successfully added {} '{}' to profile {}",
        content_type_to_string(&content_type),
        content_name.as_deref().unwrap_or(&file_name),
        profile_id
    );

    Ok(())
}

/// Helper function to download content from a URL
async fn download_content(
    url: &str,
    file_path: &Path,
    expected_sha1: Option<String>,
) -> Result<()> {
    info!(
        "Downloading content from {} to {}",
        url,
        file_path.display()
    );

    // Create a reqwest client
    let client = reqwest::Client::new();

    // Download the file
    let response = client
        .get(url)
        .header(
            "User-Agent",
            format!(
                "NoRiskClient-Launcher/{} (support@norisk.gg)",
                env!("CARGO_PKG_VERSION")
            ),
        )
        .send()
        .await
        .map_err(|e| AppError::Download(format!("Failed to download content: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Download(format!(
            "Failed to download content: HTTP {}",
            response.status()
        )));
    }

    // Get the bytes
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Download(format!("Failed to read content bytes: {}", e)))?;

    // Verify SHA1 hash if expected hash was provided
    if let Some(expected) = expected_sha1 {
        let hash = hash_utils::calculate_sha1_from_bytes(&bytes);

        if hash != expected {
            return Err(AppError::Download(format!(
                "SHA1 hash mismatch. Expected: {}, Got: {}",
                expected, hash
            )));
        }
        debug!("SHA1 hash verification successful");
    }

    // Create parent directories if they don't exist
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Io(e))?;
        }
    }

    // Write the file
    let mut file = fs::File::create(file_path)
        .await
        .map_err(|e| AppError::Io(e))?;

    TokioAsyncWriteExt::write_all(&mut file, &bytes)
        .await
        .map_err(|e| AppError::Io(e))?;

    info!("Successfully downloaded content to {}", file_path.display());

    Ok(())
}

/// Helper function to get the correct directory for a specific content type
async fn get_content_directory(profile: &Profile, content_type: &ContentType) -> Result<PathBuf> {
    match content_type {
        ContentType::ResourcePack => resourcepack_utils::get_resourcepacks_dir(profile).await,
        ContentType::ShaderPack => shaderpack_utils::get_shaderpacks_dir(profile).await,
        ContentType::DataPack => datapack_utils::get_datapacks_dir(profile).await,
        ContentType::Mod => {
            // For mods, the target directory is the 'mods' folder within the profile's instance path.
            let state = State::get().await?;
            let instance_path = state
                .profile_manager
                .calculate_instance_path_for_profile(profile)?;
            Ok(instance_path.join("mods"))
        }
        ContentType::NoRiskMod => {
            // NoRiskMods don't have a physical directory but we return a path for consistency
            let state = State::get().await?;
            let instance_path = state
                .profile_manager
                .calculate_instance_path_for_profile(profile)?;
            Ok(instance_path) // Just return the instance path as base
        }
    }
}

/// Converts ContentType to a string representation
fn content_type_to_string(content_type: &ContentType) -> &'static str {
    match content_type {
        ContentType::ResourcePack => "Resource Pack",
        ContentType::ShaderPack => "Shader Pack",
        ContentType::DataPack => "Data Pack",
        ContentType::Mod => "Mod",
        ContentType::NoRiskMod => "NoRisk Mod",
    }
}

/// Helper function to install a Modrinth content pack from a ModrinthVersion
pub async fn install_modrinth_content(
    profile_id: Uuid,
    version: &ModrinthVersion,
    content_type: ContentType,
) -> Result<()> {
    // Find the primary file
    let primary_file = version.files.iter().find(|f| f.primary).ok_or_else(|| {
        AppError::ModrinthPrimaryFileNotFound {
            version_id: version.id.clone(),
        }
    })?;

    // Get SHA1 hash if available
    let sha1_hash = primary_file.hashes.sha1.clone();

    // Add the content to the profile
    add_modrinth_content_to_profile(
        profile_id,
        version.project_id.clone(),
        version.id.clone(),
        primary_file.filename.clone(),
        primary_file.url.clone(),
        sha1_hash,
        Some(version.name.clone()),
        Some(version.version_number.clone()),
        content_type,
    )
    .await?;

    Ok(())
}

// --- Struct for command parameters ---
#[derive(Deserialize, Serialize, Debug)]
pub struct CheckContentParams {
    pub profile_id: Uuid,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub file_hash_sha1: Option<String>,
    pub file_name: Option<String>,
    pub project_type: Option<String>,
    pub game_version: Option<String>,
    pub loader: Option<String>,
    pub pack_version_number: Option<String>,
}

// --- Return Type ---
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct FoundItemDetails {
    pub item_type: ContentType,       // Changed from String
    pub item_id: Option<String>,      // e.g., Mod ID (UUID) if it's a mod
    pub file_name: Option<String>,    // The actual filename on disk
    pub display_name: Option<String>, // Display name if available
}

/// Represents details about an item when it comes from a NoRisk Pack
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NoRiskPackItemDetails {
    pub is_enabled: bool,
    pub norisk_mod_identifier: Option<crate::state::profile_state::NoriskModIdentifier>,
}

#[derive(Serialize, Debug, Default, Clone, Deserialize)]
pub struct ContentInstallStatus {
    pub is_included_in_norisk_pack: bool,
    pub is_installed: bool,
    pub is_specific_version_in_pack: bool,
    pub is_enabled: Option<bool>,
    pub found_item_details: Option<FoundItemDetails>,
    pub norisk_pack_item_details: Option<NoRiskPackItemDetails>,
}

/// Checks the installation status of a specific Modrinth content item within a profile's context.
///
/// Returns a struct indicating if the content is defined in the selected Norisk Pack
/// and if it is currently installed in the profile.
/// At least one identifier (project_id, version_id, file_hash_sha1, file_name) must be provided.
///
/// # Arguments
///
/// * `params` - A struct containing all necessary context and identifiers.
///
/// # Returns
///
/// Returns `Ok(ContentInstallStatus)` with the status, or `Err` if errors occur.
#[tauri::command]
pub async fn check_content_installed(params: CheckContentParams) -> Result<ContentInstallStatus> {
    info!(
        "Checking installation status for content in profile {} (MC: {:?}, Loader: {:?}): project_id={:?}, version_id={:?}, hash={:?}, filename={:?}, type={:?}",
        params.profile_id, params.game_version, params.loader, params.project_id, params.version_id, params.file_hash_sha1.is_some(), params.file_name, params.project_type
    );

    // Ensure at least one identifier is provided
    if params.project_id.is_none()
        && params.version_id.is_none()
        && params.file_hash_sha1.is_none()
        && params.file_name.is_none()
    {
        return Err(AppError::Other("At least one identifier (project_id, version_id, file_hash_sha1, file_name) must be provided to check installation status.".to_string()));
    }

    // Initialize the status struct
    let mut status = ContentInstallStatus::default();

    // Get the profile
    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(params.profile_id).await?;

    // Determine the target loader context
    let target_loader_str = match &params.loader {
        // Borrow from params
        Some(loader_str) => loader_str.as_str(),
        None => profile.loader.as_str(),
    };

    // Determine the target game version context
    let target_game_version_str_buf;
    let target_game_version = match &params.game_version {
        // Borrow from params
        Some(gv_str) => gv_str.as_str(),
        None => {
            target_game_version_str_buf = profile.game_version.clone();
            target_game_version_str_buf.as_str()
        }
    };

    info!(
        "Using context: MC={}, Loader={}",
        target_game_version, target_loader_str
    );

    // --- Norisk Pack Check (if applicable) ---
    if let Some(pack_id) = &profile.selected_norisk_pack_id {
        debug!(
            "Profile {} has selected Norisk Pack: {}. Checking pack definition...",
            params.profile_id, pack_id
        );
        let config = state.norisk_pack_manager.get_config().await;
        match config.get_resolved_pack_definition(pack_id) {
            Ok(resolved_pack) => {
                for norisk_mod in &resolved_pack.mods {
                    let mut is_potential_project_match = false;
                    if let (
                        Some(pid_arg),
                        norisk_packs::NoriskModSourceDefinition::Modrinth {
                            project_id: norisk_pid,
                            ..
                        },
                    ) = (&params.project_id, &norisk_mod.source)
                    {
                        if pid_arg == norisk_pid {
                            is_potential_project_match = true;
                        }
                    }
                    // TODO: Add project matching for other source types if needed

                    if is_potential_project_match {
                        if let Some(loader_map) = norisk_mod.compatibility.get(target_game_version)
                        {
                            if let Some(target) = loader_map.get(target_loader_str) {
                                status.is_included_in_norisk_pack = true;

                                // Check if the SPECIFIC version NUMBER requested matches the pack identifier
                                if let Some(v_num_arg) = &params.pack_version_number {
                                    // Use the new field
                                    // TODO: Comparison might need adjustment for non-Modrinth sources if identifier format differs
                                    if v_num_arg == &target.identifier {
                                        debug!("Specific version number {} IS the one defined in the pack (identifier: {}).", v_num_arg, target.identifier);
                                        status.is_specific_version_in_pack = true;
                                    }
                                }

                                // New addition: Add NoRiskPackItemDetails
                                let mod_identifier = norisk_mod.id.clone();

                                // Create a proper NoriskModIdentifier
                                let norisk_mod_identifier =
                                    crate::state::profile_state::NoriskModIdentifier {
                                        pack_id: pack_id.clone(),
                                        mod_id: mod_identifier.clone(),
                                        game_version: target_game_version.to_string(),
                                        loader: crate::state::profile_state::ModLoader::from_str(
                                            target_loader_str,
                                        )
                                        .unwrap_or(profile.loader.clone()),
                                    };

                                // Check if it's disabled in the profile
                                let is_pack_mod_enabled = !profile
                                    .disabled_norisk_mods_detailed
                                    .contains(&norisk_mod_identifier);

                                status.norisk_pack_item_details = Some(NoRiskPackItemDetails {
                                    is_enabled: is_pack_mod_enabled,
                                    norisk_mod_identifier: Some(norisk_mod_identifier),
                                });

                                if status.is_specific_version_in_pack {
                                    break; // Found specific version in pack
                                }
                            }
                        }
                    }
                    if status.is_specific_version_in_pack {
                        break; // Found specific version in pack
                    }
                }
                if status.is_included_in_norisk_pack {
                    debug!("Found content (some version) in Norisk Pack definition.");
                } else {
                    debug!(
                        "Content not found in the definition of Norisk Pack '{}' for MC {} / {}",
                        pack_id, target_game_version, target_loader_str
                    );
                }
            }
            Err(e) => {
                warn!("Could not resolve Norisk Pack definition for pack ID '{}': {}. Skipping pack check.", pack_id, e);
            }
        }
    }

    // --- Installed Check (Type-Dependent) ---
    let target_type = params.project_type.as_deref().unwrap_or("mod");
    debug!("Checking local installation for type: {}", target_type);

    match target_type {
        "mod" => {
            debug!(
                "Checking locally installed mods in profile {}...",
                params.profile_id
            );
            for installed_mod in &profile.mods {
                let mut mod_project_id: Option<&str> = None;
                let mut mod_version_id: Option<&str> = None;
                let mut mod_sha1_hash: Option<&str> = None;
                let mut mod_file_name_str: Option<&str> = None; // Renamed to avoid conflict

                if let ModSource::Modrinth {
                    project_id: pid,
                    version_id: vid,
                    file_hash_sha1: hash_opt,
                    file_name: fname,
                    ..
                } = &installed_mod.source
                {
                    mod_project_id = Some(pid);
                    mod_version_id = Some(vid);
                    mod_sha1_hash = hash_opt.as_deref();
                    mod_file_name_str = Some(fname);
                }
                // TODO: Add extraction logic for other source types

                let mut match_project = true;
                if let Some(pid) = &params.project_id {
                    match_project = mod_project_id == Some(pid.as_str());
                }
                let mut match_version = true;
                if let Some(vid) = &params.version_id {
                    match_version = mod_version_id == Some(vid.as_str());
                }
                let mut match_hash = true;
                if let Some(hash) = &params.file_hash_sha1 {
                    match_hash = mod_sha1_hash == Some(hash.as_str());
                }
                let mut match_name = true;
                if let Some(name) = &params.file_name {
                    match_name = mod_file_name_str == Some(name.as_str());
                }
                let mut match_game_version = true;
                if let Some(installed_versions) = &installed_mod.game_versions {
                    match_game_version =
                        installed_versions.contains(&target_game_version.to_string());
                }
                let mut match_loader = true;
                if let Some(installed_loader_enum) = &installed_mod.associated_loader {
                    match_loader = installed_loader_enum.as_str() == target_loader_str;
                }

                if match_project
                    && match_version
                    && match_hash
                    && match_name
                    && match_game_version
                    && match_loader
                {
                    info!(
                        "Found matching locally installed mod for context ({} {}): {}",
                        target_game_version,
                        target_loader_str,
                        installed_mod
                            .display_name
                            .as_deref()
                            .unwrap_or("[Unknown Name]")
                    );
                    status.is_installed = true;
                    status.is_enabled = Some(installed_mod.enabled);
                    status.found_item_details = Some(FoundItemDetails {
                        item_type: ContentType::Mod,
                        item_id: Some(installed_mod.id.to_string()),
                        file_name: mod_file_name_str.map(String::from),
                        display_name: installed_mod.display_name.clone(),
                    });
                    break;
                }
            }
            if !status.is_installed {
                info!(
                    "No matching mod found locally installed in profile {} for context ({} {})",
                    params.profile_id, target_game_version, target_loader_str
                );
            }
        }
        "resourcepack" => {
            debug!(
                "Checking locally installed resource packs in profile {}...",
                params.profile_id
            );
            match resourcepack_utils::get_resourcepacks_for_profile(&profile, true, true).await {
                Ok(packs) => {
                    for pack_info in &packs {
                        let modrinth_pid = pack_info
                            .modrinth_info
                            .as_ref()
                            .map(|m| m.project_id.as_str());
                        let modrinth_vid = pack_info
                            .modrinth_info
                            .as_ref()
                            .map(|m| m.version_id.as_str());
                        let pack_hash = pack_info.sha1_hash.as_deref();
                        let pack_filename_str = Some(pack_info.filename.as_str()); // Renamed

                        // Match against provided parameters (excluding context for RPs)
                        let mut match_project = true;
                        if let Some(pid) = &params.project_id {
                            match_project = modrinth_pid == Some(pid.as_str());
                        }
                        let mut match_version = true;
                        if let Some(vid) = &params.version_id {
                            match_version = modrinth_vid == Some(vid.as_str());
                        }
                        let mut match_hash = true;
                        if let Some(hash) = &params.file_hash_sha1 {
                            match_hash = pack_hash == Some(hash.as_str());
                        }
                        let mut match_name = true;
                        if let Some(name) = &params.file_name {
                            match_name = pack_filename_str == Some(name.as_str());
                        }

                        if match_project && match_version && match_hash && match_name {
                            info!(
                                "Found matching locally installed resource pack: {}",
                                pack_info.filename
                            );
                            status.is_installed = true;
                            status.is_enabled = Some(!pack_info.is_disabled);
                            status.found_item_details = Some(FoundItemDetails {
                                item_type: ContentType::ResourcePack,
                                item_id: None, // No specific ID for RPs in this context
                                file_name: Some(pack_info.filename.clone()),
                                display_name: Some(pack_info.filename.clone()), // Use filename as display_name
                            });
                            break;
                        }
                    }
                    if !status.is_installed {
                        info!(
                            "No matching resource pack found locally installed in profile {}",
                            params.profile_id
                        );
                    }
                }
                Err(e) => {
                    warn!(
                        "Failed to list resource packs for profile {}: {}. Assuming not installed.",
                        params.profile_id, e
                    );
                }
            }
        }
        "shaderpack" => {
            debug!(
                "Checking locally installed shader packs in profile {}...",
                params.profile_id
            );
            match shaderpack_utils::get_shaderpacks_for_profile(&profile, true, true).await {
                Ok(packs) => {
                    for pack_info in &packs {
                        let modrinth_pid = pack_info
                            .modrinth_info
                            .as_ref()
                            .map(|m| m.project_id.as_str());
                        let modrinth_vid = pack_info
                            .modrinth_info
                            .as_ref()
                            .map(|m| m.version_id.as_str());
                        let pack_hash = pack_info.sha1_hash.as_deref();
                        let pack_filename_str = Some(pack_info.filename.as_str()); // Renamed

                        // Match against provided parameters (excluding context)
                        let mut match_project = true;
                        if let Some(pid) = &params.project_id {
                            match_project = modrinth_pid == Some(pid.as_str());
                        }
                        let mut match_version = true;
                        if let Some(vid) = &params.version_id {
                            match_version = modrinth_vid == Some(vid.as_str());
                        }
                        let mut match_hash = true;
                        if let Some(hash) = &params.file_hash_sha1 {
                            match_hash = pack_hash == Some(hash.as_str());
                        }
                        let mut match_name = true;
                        if let Some(name) = &params.file_name {
                            match_name = pack_filename_str == Some(name.as_str());
                        }

                        if match_project && match_version && match_hash && match_name {
                            info!(
                                "Found matching locally installed shader pack: {}",
                                pack_info.filename
                            );
                            status.is_installed = true;
                            status.is_enabled = Some(!pack_info.is_disabled);
                            status.found_item_details = Some(FoundItemDetails {
                                item_type: ContentType::ShaderPack,
                                item_id: None,
                                file_name: Some(pack_info.filename.clone()),
                                display_name: Some(pack_info.filename.clone()), // Use filename as display_name
                            });
                            break;
                        }
                    }
                    if !status.is_installed {
                        info!(
                            "No matching shader pack found locally installed in profile {}",
                            params.profile_id
                        );
                    }
                }
                Err(e) => {
                    warn!(
                        "Failed to list shader packs for profile {}: {}. Assuming not installed.",
                        params.profile_id, e
                    );
                }
            }
        }
        "datapack" => {
            debug!(
                "Checking locally installed data packs in profile {}...",
                params.profile_id
            );
            match datapack_utils::get_datapacks_for_profile(&profile, true, true).await {
                Ok(packs) => {
                    for pack_info in &packs {
                        let modrinth_pid = pack_info
                            .modrinth_info
                            .as_ref()
                            .map(|m| m.project_id.as_str());
                        let modrinth_vid = pack_info
                            .modrinth_info
                            .as_ref()
                            .map(|m| m.version_id.as_str());
                        let pack_hash = pack_info.sha1_hash.as_deref();
                        let pack_filename_str = Some(pack_info.filename.as_str()); // Renamed

                        // Match against provided parameters (excluding context)
                        let mut match_project = true;
                        //DAS HIER NICHT EDITIEREN
                        if let Some(pid) = &params.project_id {
                            match_project = modrinth_pid == Some(pid.as_str());
                        }
                        let mut match_version = true;
                        //DAS HIER NICHT EDITIEREN
                        if let Some(vid) = &params.version_id {
                            match_version = modrinth_vid == Some(vid.as_str());
                        }
                        let mut match_hash = true;
                        //DAS HIER NICHT EDITIEREN
                        if let Some(hash) = &params.file_hash_sha1 {
                            match_hash = pack_hash == Some(hash.as_str());
                        }
                        let mut match_name = true;
                        if let Some(name) = &params.file_name {
                            match_name = pack_filename_str == Some(name.as_str());
                        }

                        if match_project && match_version && match_hash && match_name {
                            status.is_installed = true;
                            status.is_enabled = Some(!pack_info.is_disabled);
                            status.found_item_details = Some(FoundItemDetails {
                                item_type: ContentType::DataPack,
                                item_id: None,
                                file_name: Some(pack_info.filename.clone()),
                                display_name: Some(pack_info.filename.clone()), // Use filename as display_name
                            });
                            break;
                        }
                    }
                    if !status.is_installed {
                        info!(
                            "No matching data pack found locally installed in profile {}",
                            params.profile_id
                        );
                    }
                }
                Err(e) => {
                    warn!(
                        "Failed to list data packs for profile {}: {}. Assuming not installed.",
                        params.profile_id, e
                    );
                }
            }
        }
        _ => {
            warn!(
                "Checking installation for content type '{}' is not yet implemented.",
                target_type
            );
        }
    }

    if status.is_installed {
        debug!(
            "Final status: Found content installed locally. Enabled: {:?}. Details: {:?}",
            status.is_enabled, status.found_item_details
        );
    } else {
        debug!("Final status: Content not found locally.");
    }

    Ok(status)
}

/// Opens the `latest.log` file for a given profile using the system's default application.
///
/// # Arguments
///
/// * `app_handle` - The Tauri application handle to access plugins like the opener.
/// * `profile_id` - The UUID of the profile whose log file should be opened.
///
/// # Returns
///
/// Returns `Ok(())` on success, or an `AppError` if the profile instance path cannot be determined,
/// the log file doesn't exist, or the file cannot be opened.
pub async fn open_latest_log_for_profile<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    profile_id: Uuid,
) -> Result<()> {
    info!("Attempting to open latest.log for profile {}", profile_id);

    // Get the profile instance path
    let state = State::get().await?;
    let instance_path = state
        .profile_manager
        .get_profile_instance_path(profile_id)
        .await?; // This returns Result<PathBuf, AppError>

    // Construct the path to the log file
    let log_path = instance_path.join("logs").join("latest.log");
    debug!("Constructed log path: {}", log_path.display());

    // Check if the log file exists
    if !log_path.exists() {
        warn!("latest.log not found at {}", log_path.display());
        return Err(AppError::FileNotFound(log_path));
    }

    // Open the log file using the system's default viewer
    info!("Opening log file: {}", log_path.display());
    match app_handle
        .opener()
        .open_path(log_path.to_string_lossy(), None::<&str>)
    {
        Ok(_) => {
            info!(
                "Successfully requested opening of log file: {}",
                log_path.display()
            );
            Ok(())
        }
        Err(e) => {
            error!("Failed to open log file {}: {}", log_path.display(), e);
            Err(AppError::Other(format!("Failed to open log file: {}", e)))
        }
    }
}

/// Gets the content of the `latest.log` file for a given profile.
///
/// # Arguments
///
/// * `profile_id` - The UUID of the profile whose log content is needed.
///
/// # Returns
///
/// Returns `Ok(String)` containing the log content on success.
/// Returns an empty string in `Ok` if the log file is not found.
/// Returns an `AppError` if the profile instance path cannot be determined or reading fails.
pub async fn get_latest_log_content(profile_id: Uuid) -> Result<String> {
    info!(
        "Attempting to get latest.log content for profile {}",
        profile_id
    );

    // Get the profile instance path
    let state = State::get().await?;
    let instance_path = state
        .profile_manager
        .get_profile_instance_path(profile_id)
        .await?;

    // Construct the path to the log file
    let log_path = instance_path.join("logs").join("latest.log");

    // Use the new utility function to read the log file content
    file_utils::read_log_file_content(&log_path).await
}

/// Lists all log files (`.log` and `.log.gz`) for a given profile.
///
/// # Arguments
///
/// * `profile_id` - The UUID of the profile whose log files should be listed.
///
/// # Returns
///
/// Returns `Ok(Vec<PathBuf>)` containing the paths to the log files on success.
/// Returns an empty vector in `Ok` if the logs directory does not exist.
/// Returns an `AppError` if the profile instance path cannot be determined or reading the directory fails.
pub async fn list_log_files(profile_id: Uuid) -> Result<Vec<PathBuf>> {
    info!("Listing log files for profile {}", profile_id);

    // Get the profile instance path
    let state = State::get().await?;
    let instance_path = state
        .profile_manager
        .get_profile_instance_path(profile_id)
        .await?;

    // Construct the path to the logs directory
    let logs_dir = instance_path.join("logs");
    debug!("Logs directory path: {}", logs_dir.display());

    // Check if the logs directory exists
    if !logs_dir.exists() {
        warn!(
            "Logs directory not found at {}. Returning empty list.",
            logs_dir.display()
        );
        return Ok(Vec::new());
    }

    let mut log_files = Vec::new();
    let mut entries = match fs::read_dir(&logs_dir).await {
        Ok(entries) => entries,
        Err(e) => {
            error!(
                "Failed to read logs directory {}: {}",
                logs_dir.display(),
                e
            );
            return Err(AppError::Io(e));
        }
    };

    while let Some(entry_result) = entries.next_entry().await.map_err(|e| {
        error!(
            "Failed to read entry in logs directory {}: {}",
            logs_dir.display(),
            e
        );
        AppError::Io(e)
    })? {
        let path = entry_result.path();
        if path.is_file() {
            if let Some(filename_str) = path.file_name().and_then(|n| n.to_str()) {
                if filename_str.ends_with(".log") || filename_str.ends_with(".log.gz") {
                    log_files.push(path);
                }
            }
        }
    }

    info!(
        "Found {} log file(s) for profile {}",
        log_files.len(),
        profile_id
    );
    Ok(log_files)
}

/// Exports a profile to a `.noriskpack` file
///
/// This creates a zip archive with the .noriskpack extension that contains:
/// - The profile data as JSON (sanitized to remove user-specific data)  
/// - An "overrides" folder containing any files specified in `include_files`
///
/// @param profile_id: UUID of the profile to export
/// @param output_path: Optional path where the .noriskpack file should be saved
/// @param include_files: Optional list of files/directories to include in the overrides folder
/// @return: Result containing the path to the created .noriskpack file
pub async fn export_profile_to_noriskpack(
    profile_id: Uuid,
    output_path: Option<PathBuf>,
    include_files: Option<Vec<PathBuf>>,
) -> Result<PathBuf> {
    info!("Exporting profile {} to .noriskpack", profile_id);

    // Get the profile and acquire semaphore for I/O limiting
    let state = crate::state::state_manager::State::get().await?;
    let _permit = state.io_semaphore.acquire().await;
    let profile = state.profile_manager.get_profile(profile_id).await?;

    // Single traversal strategy like Modrinth
    let mut all_files = Vec::new();
    let profile_instance_path = state
        .profile_manager
        .get_profile_instance_path(profile_id)
        .await?;

    // 1. Collect ALL files in profile once (like Modrinth)
    collect_all_files_recursive(&profile_instance_path, &mut all_files).await?;

    // 2. Filter with string matching (like Modrinth's included_candidates_set check)
    if let Some(ref include_paths) = include_files {
        let include_paths_str: Vec<String> = include_paths
            .iter()
            .filter_map(|p| p.strip_prefix(&profile_instance_path).ok())
            .map(|rel_path| rel_path.to_string_lossy().replace('\\', "/"))
            .collect();

        all_files.retain(|file_path| {
            if let Ok(rel_path) = file_path.strip_prefix(&profile_instance_path) {
                let rel_path_str = rel_path.to_string_lossy().replace('\\', "/");
                include_paths_str
                    .iter()
                    .any(|include_str| rel_path_str.starts_with(include_str))
            } else {
                false
            }
        });
    } else {
        all_files.clear(); // No include_files = no files to export
    }

    // Create a sanitized copy of the profile for export
    let export_profile = sanitize_profile_for_export(&profile);

    // Determine the output file path
    let output_file = match output_path {
        Some(path) => path,
        None => {
            // Generate a default output path
            let safe_name = profile.name.replace(" ", "_").to_lowercase();
            let default_name = format!(
                "{}_v{}_{}.noriskpack",
                safe_name,
                profile.game_version,
                profile.loader.as_str()
            );

            // Use the current directory by default
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(default_name)
        }
    };

    // Ensure parent directory exists
    if let Some(parent) = output_file.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::Io(e))?;
        }
    }

    info!("Creating .noriskpack archive at: {}", output_file.display());

    // Create zip file and writer - write directly to target file
    let mut file = fs::File::create(&output_file)
        .await
        .map_err(|e| AppError::Io(e))?;
    let mut writer = ZipFileWriter::with_tokio(&mut file);

    // Write the profile data to JSON directly into zip
    let profile_json = serde_json::to_vec_pretty(&export_profile)?;
    let profile_builder = ZipEntryBuilder::new("profile.json".into(), Compression::Deflate);
    writer
        .write_entry_whole(profile_builder, &profile_json)
        .await
        .map_err(|e| AppError::Other(format!("Failed to write profile.json to zip: {}", e)))?;

    // Add files to overrides with STREAMING (zero-copy like the example)
    for file_path in all_files {
        if let Ok(rel_path) = file_path.strip_prefix(&profile_instance_path) {
            let rel_path_str = rel_path.to_string_lossy().replace('\\', "/");
            let zip_path = format!("overrides/{}", rel_path_str);

            info!("Processing file: {}", file_path.display());

            // STREAMING approach - no memory buffering
            let mut source_file = fs::File::open(&file_path)
                .await
                .map_err(|e| AppError::Io(e))?;

            let file_builder = ZipEntryBuilder::new(zip_path.into(), Compression::Deflate);
            let mut entry_writer = writer.write_entry_stream(file_builder).await.map_err(|e| {
                AppError::Other(format!("Failed to create zip entry stream: {}", e))
            })?;

            // Stream file content in chunks (using EntryStreamWriter's native API)
            let mut buffer = [0u8; 8192];
            loop {
                let n = source_file
                    .read(&mut buffer)
                    .await
                    .map_err(|e| AppError::Io(e))?;
                if n == 0 {
                    break;
                }
                entry_writer
                    .write_all(&buffer[..n])
                    .await
                    .map_err(|e| AppError::Other(format!("Failed to write chunk: {}", e)))?;
            }

            entry_writer
                .close()
                .await
                .map_err(|e| AppError::Other(format!("Failed to close zip entry: {}", e)))?;
        }
    }

    // Close the zip writer
    writer
        .close()
        .await
        .map_err(|e| AppError::Other(format!("Failed to finalize zip file: {}", e)))?;

    info!(
        "Successfully exported profile to: {}",
        output_file.display()
    );
    Ok(output_file)
}

/// Creates a sanitized copy of a profile for export
fn sanitize_profile_for_export(profile: &Profile) -> Profile {
    let mut export_profile = profile.clone();

    // Reset timestamps and other personal data
    export_profile.created = chrono::Utc::now();
    export_profile.last_played = None;

    // Reset any absolute paths to relative ones
    //export_profile.path = format!("minecraft-{}-{}",  export_profile.game_version, export_profile.loader.as_str());

    // Reset profile ID to ensure it's unique when imported
    export_profile.id = Uuid::new_v4();

    // Exported profiles should always be user profiles, not standard templates
    export_profile.is_standard_version = false;

    // Change NORISK CLIENT group to CUSTOM for exports
    if let Some(group) = &export_profile.group {
        if group.eq_ignore_ascii_case("NORISK CLIENT") {
            export_profile.group = Some("CUSTOM".to_string());
        }
    }

    // Keep other essential data
    export_profile
}

/// Collect all files recursively (like Modrinth's add_all_recursive_folder_paths)
fn collect_all_files_recursive<'a>(
    dir_path: &'a Path,
    file_list: &'a mut Vec<PathBuf>,
) -> BoxFuture<'a, Result<()>> {
    Box::pin(async move {
        let mut entries = fs::read_dir(dir_path).await.map_err(|e| AppError::Io(e))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| AppError::Io(e))? {
            let path = entry.path();

            if path.is_dir() {
                // Recurse into directories
                collect_all_files_recursive(&path, file_list).await?;
            } else {
                // Add files to the list
                file_list.push(path);
            }
        }

        Ok(())
    })
}

// Added: ScreenshotInfo struct
#[derive(Serialize, Clone, Debug)]
pub struct ScreenshotInfo {
    pub filename: String,
    pub path: PathBuf,
    pub modified: Option<chrono::DateTime<chrono::Utc>>, // Use chrono for timestamps
}

/// Recursively finds screenshot files in a directory and its subdirectories.
pub fn find_screenshots_recursive<'a>(
    dir_path: &'a Path,
    screenshots: &'a mut Vec<ScreenshotInfo>,
) -> BoxFuture<'a, Result<()>> {
    async move {
        if !dir_path.exists() || !dir_path.is_dir() {
            return Ok(()); // Nothing to do if the path doesn't exist or isn't a directory
        }

        let mut dir_entries = match fs::read_dir(dir_path).await {
            Ok(entries) => entries,
            Err(e) => {
                error!("Failed to read directory {:?}: {}", dir_path, e);
                return Err(AppError::Io(e));
            }
        };

        while let Some(entry_result) = dir_entries.next_entry().await.map_err(|e| {
            error!("Failed to read entry in directory {:?}: {}", dir_path, e);
            AppError::Io(e)
        })? {
            let path = entry_result.path();
            if path.is_dir() {
                // If it's a directory, recurse into it
                find_screenshots_recursive(&path, screenshots).await?;
            } else if path.is_file() {
                // If it's a file, check if it's a PNG
                if let Some(filename_str) = path.file_name().and_then(|n| n.to_str()) {
                    if filename_str.to_lowercase().ends_with(".png") {
                        let modified_time = match fs::metadata(&path).await {
                            Ok(metadata) => match metadata.modified() {
                                Ok(sys_time) => {
                                    Some(chrono::DateTime::<chrono::Utc>::from(sys_time))
                                }
                                Err(e) => {
                                    warn!("Could not get modified time for {:?}: {}", path, e);
                                    None
                                }
                            },
                            Err(e) => {
                                warn!("Could not get metadata for {:?}: {}", path, e);
                                None
                            }
                        };

                        screenshots.push(ScreenshotInfo {
                            filename: filename_str.to_string(),
                            path: path.clone(),
                            modified: modified_time,
                        });
                    }
                }
            }
            // Ignore other entry types (symlinks, etc.)
        }
        Ok(())
    }
    .boxed() // Use .boxed() from FutureExt trait
}

/// Lists screenshot files found in the profile's `screenshots` directory and its subdirectories.
/// Only includes files ending in `.png`.
pub async fn get_screenshots_for_profile(profile_id: Uuid) -> Result<Vec<ScreenshotInfo>> {
    let state = State::get().await?;
    let instance_path = state
        .profile_manager
        .get_profile_instance_path(profile_id)
        .await?;
    let screenshots_path = instance_path.join("screenshots");
    let mut screenshots = Vec::new();

    // Call the recursive helper function starting from the main screenshots directory
    find_screenshots_recursive(&screenshots_path, &mut screenshots).await?;

    // Sort the collected screenshots by modified time (newest first)
    screenshots.sort_by(|a, b| b.modified.cmp(&a.modified));

    info!(
        "Found {} screenshot(s) in total within {:?} and its subdirectories",
        screenshots.len(),
        screenshots_path
    );
    Ok(screenshots)
}

// --- Batch Content Check Types ---
#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct BatchCheckContentParams {
    pub profile_id: Uuid,
    pub requests: Vec<ContentCheckRequest>,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct ContentCheckRequest {
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub file_hash_sha1: Option<String>,
    pub file_name: Option<String>,
    pub project_type: Option<String>,
    pub game_version: Option<String>,
    pub loader: Option<String>,
    pub pack_version_number: Option<String>,
    pub request_id: Option<String>, // Optional client-provided ID to match requests with responses
}

#[derive(Serialize, Debug, Clone, Deserialize)]
pub struct BatchContentInstallStatus {
    pub results: Vec<ContentCheckResult>,
}

#[derive(Serialize, Debug, Clone, Deserialize)]
pub struct ContentCheckResult {
    pub request_id: Option<String>, // Same ID that was provided in the request
    pub status: ContentInstallStatus,
    pub project_id: Option<String>, // Echo back key identifiers for easier matching
    pub version_id: Option<String>,
    pub file_name: Option<String>,
    pub project_type: Option<String>,
}

/// Checks the installation status of multiple Modrinth content items in batch.
///
/// This function is optimized to minimize repeated operations when checking multiple items
/// of the same content type. For example, when checking multiple resource packs, it will
/// load the list of installed resource packs only once.
///
/// # Arguments
///
/// * `params` - A struct containing the profile ID and a list of content check requests.
///
/// # Returns
///
/// Returns `Ok(BatchContentInstallStatus)` with the status for each request, or `Err` if errors occur.
pub async fn check_content_installed_batch(
    params: BatchCheckContentParams,
) -> Result<BatchContentInstallStatus> {
    info!(
        "Batch checking installation status for {} items in profile {}",
        params.requests.len(),
        params.profile_id
    );

    // If empty request list, return empty result
    if params.requests.is_empty() {
        return Ok(BatchContentInstallStatus {
            results: Vec::new(),
        });
    }

    // Get the profile once for all requests
    let state = State::get().await?;
    let profile = state.profile_manager.get_profile(params.profile_id).await?;

    // Group requests by content type to avoid repeated operations
    let mut mod_requests: Vec<(&ContentCheckRequest, usize)> = Vec::new();
    let mut resourcepack_requests: Vec<(&ContentCheckRequest, usize)> = Vec::new();
    let mut shaderpack_requests: Vec<(&ContentCheckRequest, usize)> = Vec::new();
    let mut datapack_requests: Vec<(&ContentCheckRequest, usize)> = Vec::new();
    let mut other_requests: Vec<(&ContentCheckRequest, usize)> = Vec::new();

    // Categorize requests while preserving original indices
    for (idx, request) in params.requests.iter().enumerate() {
        let target_type = request.project_type.as_deref().unwrap_or("mod");
        match target_type {
            "mod" => mod_requests.push((request, idx)),
            "resourcepack" => resourcepack_requests.push((request, idx)),
            "shader" => shaderpack_requests.push((request, idx)),
            "datapack" => datapack_requests.push((request, idx)),
            _ => other_requests.push((request, idx)),
        }
    }

    // Create results array with the capacity but don't pre-fill it
    let mut results = Vec::<Option<ContentCheckResult>>::with_capacity(params.requests.len());
    // Make sure all slots are initialized to None
    for _ in 0..params.requests.len() {
        results.push(None);
    }

    // Process mods
    if !mod_requests.is_empty() {
        debug!("Processing {} mod requests", mod_requests.len());
        process_mod_requests(&profile, &mod_requests, &mut results).await?;
    }

    // Process resource packs
    if !resourcepack_requests.is_empty() {
        debug!(
            "Processing {} resource pack requests",
            resourcepack_requests.len()
        );
        process_resourcepack_requests(&profile, &resourcepack_requests, &mut results).await?;
    }

    // Process shader packs
    if !shaderpack_requests.is_empty() {
        debug!(
            "Processing {} shader pack requests",
            shaderpack_requests.len()
        );
        process_shaderpack_requests(&profile, &shaderpack_requests, &mut results).await?;
    }

    // Process data packs
    if !datapack_requests.is_empty() {
        debug!("Processing {} data pack requests", datapack_requests.len());
        process_datapack_requests(&profile, &datapack_requests, &mut results).await?;
    }

    // Process other content types individually
    for (request, idx) in other_requests {
        debug!(
            "Processing individual request for content type: {:?}",
            request.project_type
        );

        // Convert to the old params format
        let old_params = CheckContentParams {
            profile_id: params.profile_id,
            project_id: request.project_id.clone(),
            version_id: request.version_id.clone(),
            file_hash_sha1: request.file_hash_sha1.clone(),
            file_name: request.file_name.clone(),
            project_type: request.project_type.clone(),
            game_version: request.game_version.clone(),
            loader: request.loader.clone(),
            pack_version_number: request.pack_version_number.clone(),
        };

        // Call the original function
        let status = check_content_installed(old_params).await?;

        // Store the result
        results[idx] = Some(ContentCheckResult {
            request_id: request.request_id.clone(),
            status,
            project_id: request.project_id.clone(),
            version_id: request.version_id.clone(),
            file_name: request.file_name.clone(),
            project_type: request.project_type.clone(),
        });
    }

    // Unwrap results and handle any None values (shouldn't happen if implementation is correct)
    let final_results = results
        .into_iter()
        .enumerate()
        .map(|(idx, result)| {
            result.unwrap_or_else(|| {
                warn!("No result was generated for request index {}", idx);
                // Create a default result
                ContentCheckResult {
                    request_id: params.requests[idx].request_id.clone(),
                    status: ContentInstallStatus::default(),
                    project_id: params.requests[idx].project_id.clone(),
                    version_id: params.requests[idx].version_id.clone(),
                    file_name: params.requests[idx].file_name.clone(),
                    project_type: params.requests[idx].project_type.clone(),
                }
            })
        })
        .collect();

    Ok(BatchContentInstallStatus {
        results: final_results,
    })
}

/// Process all mod requests efficiently
async fn process_mod_requests(
    profile: &Profile,
    requests: &[(&ContentCheckRequest, usize)],
    results: &mut Vec<Option<ContentCheckResult>>,
) -> Result<()> {
    // Load all local mods once
    let local_mods = match LocalContentLoader::load_items(LoadItemsParams {
        profile_id: profile.id,
        content_type: ContentType::Mod,
        calculate_hashes: true,
        fetch_modrinth_data: true,
    }).await {
        Ok(mods) => mods,
        Err(e) => {
            warn!(
                "Failed to list local mods: {}. Assuming none installed.",
                e
            );
            Vec::new()
        }
    };

    // For each request, we need to check both in NoRisk Pack and local installation
    for (request, idx) in requests {
        // Convert to the old params format for reusing norisk pack check logic
        let old_params = CheckContentParams {
            profile_id: profile.id,
            project_id: request.project_id.clone(),
            version_id: request.version_id.clone(),
            file_hash_sha1: request.file_hash_sha1.clone(),
            file_name: request.file_name.clone(),
            project_type: request.project_type.clone(),
            game_version: request.game_version.clone(),
            loader: request.loader.clone(),
            pack_version_number: request.pack_version_number.clone(),
        };

        // Initialize the status struct
        let mut status = ContentInstallStatus::default();

        // Determine target contexts
        let target_loader_str = match &request.loader {
            Some(loader_str) => loader_str.as_str(),
            None => profile.loader.as_str(),
        };

        let target_game_version_str_buf;
        let target_game_version = match &request.game_version {
            Some(gv_str) => gv_str.as_str(),
            None => {
                target_game_version_str_buf = profile.game_version.clone();
                target_game_version_str_buf.as_str()
            }
        };

        // Check if included in NoRisk Pack
        if let Some(pack_id) = &profile.selected_norisk_pack_id {
            let state = State::get().await?;
            let config = state.norisk_pack_manager.get_config().await;

            if let Ok(resolved_pack) = config.get_resolved_pack_definition(pack_id) {
                for norisk_mod in &resolved_pack.mods {
                    let mut is_potential_project_match = false;
                    if let (
                        Some(pid_arg),
                        norisk_packs::NoriskModSourceDefinition::Modrinth {
                            project_id: norisk_pid,
                            ..
                        },
                    ) = (&request.project_id, &norisk_mod.source)
                    {
                        if pid_arg == norisk_pid {
                            is_potential_project_match = true;
                        }
                    }

                    if is_potential_project_match {
                        if let Some(loader_map) = norisk_mod.compatibility.get(target_game_version)
                        {
                            if let Some(target) = loader_map.get(target_loader_str) {
                                status.is_included_in_norisk_pack = true;

                                // Check specific version match
                                if let Some(v_num_arg) = &request.pack_version_number {
                                    if v_num_arg == &target.identifier {
                                        status.is_specific_version_in_pack = true;
                                    }
                                }

                                // Add NoRiskPackItemDetails
                                let mod_identifier = norisk_mod.id.clone();

                                let norisk_mod_identifier =
                                    crate::state::profile_state::NoriskModIdentifier {
                                        pack_id: pack_id.clone(),
                                        mod_id: mod_identifier.clone(),
                                        game_version: target_game_version.to_string(),
                                        loader: crate::state::profile_state::ModLoader::from_str(
                                            target_loader_str,
                                        )
                                        .unwrap_or(profile.loader.clone()),
                                    };

                                let is_pack_mod_enabled = !profile
                                    .disabled_norisk_mods_detailed
                                    .contains(&norisk_mod_identifier);

                                status.norisk_pack_item_details = Some(NoRiskPackItemDetails {
                                    is_enabled: is_pack_mod_enabled,
                                    norisk_mod_identifier: Some(norisk_mod_identifier),
                                });

                                if status.is_specific_version_in_pack {
                                    break; // Found specific version
                                }
                            }
                        }
                    }
                    if status.is_specific_version_in_pack {
                        break; // Found specific version
                    }
                }
            }
        }

        // Check if locally installed - first check profile.mods
        for installed_mod in &profile.mods {
            let mut mod_project_id: Option<&str> = None;
            let mut mod_version_id: Option<&str> = None;
            let mut mod_sha1_hash: Option<&str> = None;
            let mut mod_file_name_str: Option<&str> = None;

            if let ModSource::Modrinth {
                project_id: pid,
                version_id: vid,
                file_hash_sha1: hash_opt,
                file_name: fname,
                ..
            } = &installed_mod.source
            {
                mod_project_id = Some(pid);
                mod_version_id = Some(vid);
                mod_sha1_hash = hash_opt.as_deref();
                mod_file_name_str = Some(fname);
            }

            let mut match_project = true;
            if let Some(pid) = &request.project_id {
                match_project = mod_project_id == Some(pid.as_str());
            }
            let mut match_version = true;
            if let Some(vid) = &request.version_id {
                match_version = mod_version_id == Some(vid.as_str());
            }
            let mut match_hash = true;
            if let Some(hash) = &request.file_hash_sha1 {
                match_hash = mod_sha1_hash == Some(hash.as_str());
            }
            let mut match_name = true;
            if let Some(name) = &request.file_name {
                match_name = mod_file_name_str == Some(name.as_str());
            }
            let mut match_game_version = true;
            if let Some(installed_versions) = &installed_mod.game_versions {
                match_game_version = installed_versions.contains(&target_game_version.to_string());
            }
            let mut match_loader = true;
            if let Some(installed_loader_enum) = &installed_mod.associated_loader {
                match_loader = installed_loader_enum.as_str() == target_loader_str;
            }

            if match_project
                && match_version
                && match_hash
                && match_name
                && match_game_version
                && match_loader
            {
                status.is_installed = true;
                status.is_enabled = Some(installed_mod.enabled);
                status.found_item_details = Some(FoundItemDetails {
                    item_type: ContentType::Mod,
                    item_id: Some(installed_mod.id.to_string()),
                    file_name: mod_file_name_str.map(String::from),
                    display_name: installed_mod.display_name.clone(),
                });
                break;
            }
        }

        // If not found in profile.mods, check local files
        if !status.is_installed {
            for mod_item in &local_mods {
                let modrinth_pid = mod_item.modrinth_info.as_ref().map(|m| m.project_id.as_str());
                let modrinth_vid = mod_item.modrinth_info.as_ref().map(|m| m.version_id.as_str());
                let mod_hash = mod_item.sha1_hash.as_deref();
                let mod_filename_str = Some(mod_item.filename.as_str());

                // Match against provided parameters
                let mut match_project = true;
                if let Some(pid) = &request.project_id {
                    match_project = modrinth_pid == Some(pid.as_str());
                }
                let mut match_version = true;
                if let Some(vid) = &request.version_id {
                    match_version = modrinth_vid == Some(vid.as_str());
                }
                let mut match_hash = true;
                if let Some(hash) = &request.file_hash_sha1 {
                    match_hash = mod_hash == Some(hash.as_str());
                }
                let mut match_name = true;
                if let Some(name) = &request.file_name {
                    match_name = mod_filename_str == Some(name.as_str());
                }

                if match_project && match_version && match_hash && match_name {
                    status.is_installed = true;
                    status.is_enabled = Some(!mod_item.is_disabled); // Local files: enabled = !disabled
                    status.found_item_details = Some(FoundItemDetails {
                        item_type: ContentType::Mod,
                        item_id: mod_item.id.clone(),
                        file_name: Some(mod_item.filename.clone()),
                        display_name: mod_item.modrinth_info.as_ref().map(|m| m.name.clone()),
                    });
                    break;
                }
            }
        }

        // Store the result
        results[*idx] = Some(ContentCheckResult {
            request_id: request.request_id.clone(),
            status,
            project_id: request.project_id.clone(),
            version_id: request.version_id.clone(),
            file_name: request.file_name.clone(),
            project_type: request.project_type.clone(),
        });
    }

    Ok(())
}

/// Process all resource pack requests efficiently
async fn process_resourcepack_requests(
    profile: &Profile,
    requests: &[(&ContentCheckRequest, usize)],
    results: &mut Vec<Option<ContentCheckResult>>,
) -> Result<()> {
    // Load all resource packs once
    let packs = match resourcepack_utils::get_resourcepacks_for_profile(profile, true, true).await
    {
        Ok(packs) => packs,
        Err(e) => {
            warn!(
                "Failed to list resource packs: {}. Assuming none installed.",
                e
            );
            Vec::new()
        }
    };

    for (request, idx) in requests {
        // Initialize the status struct
        let mut status = ContentInstallStatus::default();

        // Check NoRisk Pack - reuse old function for now
        let old_params = CheckContentParams {
            profile_id: profile.id,
            project_id: request.project_id.clone(),
            version_id: request.version_id.clone(),
            file_hash_sha1: request.file_hash_sha1.clone(),
            file_name: request.file_name.clone(),
            project_type: request.project_type.clone(),
            game_version: request.game_version.clone(),
            loader: request.loader.clone(),
            pack_version_number: request.pack_version_number.clone(),
        };

        // Check if in NoRisk Pack
        if let Some(pack_id) = &profile.selected_norisk_pack_id {
            let state = State::get().await?;
            let config = state.norisk_pack_manager.get_config().await;

            if let Ok(resolved_pack) = config.get_resolved_pack_definition(pack_id) {
                // Check if the pack includes this resource pack
                // (Note: This would need to be expanded if NoRisk Packs can contain resource packs)
                // For now, this is a placeholder as the original function doesn't handle this case specifically
            }
        }

        // Check local installation against the preloaded packs
        for pack_info in &packs {
            let modrinth_pid = pack_info
                .modrinth_info
                .as_ref()
                .map(|m| m.project_id.as_str());
            let modrinth_vid = pack_info
                .modrinth_info
                .as_ref()
                .map(|m| m.version_id.as_str());
            let pack_hash = pack_info.sha1_hash.as_deref();
            let pack_filename_str = Some(pack_info.filename.as_str());

            // Match against provided parameters
            let mut match_project = true;
            if let Some(pid) = &request.project_id {
                match_project = modrinth_pid == Some(pid.as_str());
            }
            let mut match_version = true;
            if let Some(vid) = &request.version_id {
                match_version = modrinth_vid == Some(vid.as_str());
            }
            let mut match_hash = true;
            if let Some(hash) = &request.file_hash_sha1 {
                match_hash = pack_hash == Some(hash.as_str());
            }
            let mut match_name = true;
            if let Some(name) = &request.file_name {
                match_name = pack_filename_str == Some(name.as_str());
            }

            if match_project && match_version && match_hash && match_name {
                status.is_installed = true;
                status.is_enabled = Some(!pack_info.is_disabled);
                status.found_item_details = Some(FoundItemDetails {
                    item_type: ContentType::ResourcePack,
                    item_id: None,
                    file_name: Some(pack_info.filename.clone()),
                    display_name: Some(pack_info.filename.clone()),
                });
                break;
            }
        }

        // Store the result
        results[*idx] = Some(ContentCheckResult {
            request_id: request.request_id.clone(),
            status,
            project_id: request.project_id.clone(),
            version_id: request.version_id.clone(),
            file_name: request.file_name.clone(),
            project_type: request.project_type.clone(),
        });
    }

    Ok(())
}

/// Process all shader pack requests efficiently
async fn process_shaderpack_requests(
    profile: &Profile,
    requests: &[(&ContentCheckRequest, usize)],
    results: &mut Vec<Option<ContentCheckResult>>,
) -> Result<()> {
    // Load all shader packs once
    let packs = match shaderpack_utils::get_shaderpacks_for_profile(profile, true, true).await {
        Ok(packs) => packs,
        Err(e) => {
            warn!(
                "Failed to list shader packs: {}. Assuming none installed.",
                e
            );
            Vec::new()
        }
    };

    for (request, idx) in requests {
        // Initialize the status struct
        let mut status = ContentInstallStatus::default();

        // Check if in NoRisk Pack - placeholder for future NoRisk Pack shader support
        if let Some(pack_id) = &profile.selected_norisk_pack_id {
            // Placeholder for future implementation
        }

        // Check local installation against the preloaded packs
        for pack_info in &packs {
            let modrinth_pid = pack_info
                .modrinth_info
                .as_ref()
                .map(|m| m.project_id.as_str());
            let modrinth_vid = pack_info
                .modrinth_info
                .as_ref()
                .map(|m| m.version_id.as_str());
            let pack_hash = pack_info.sha1_hash.as_deref();
            let pack_filename_str = Some(pack_info.filename.as_str());

            // Match against provided parameters
            let mut match_project = true;
            if let Some(pid) = &request.project_id {
                match_project = modrinth_pid == Some(pid.as_str());
            }
            let mut match_version = true;
            if let Some(vid) = &request.version_id {
                match_version = modrinth_vid == Some(vid.as_str());
            }
            let mut match_hash = true;
            if let Some(hash) = &request.file_hash_sha1 {
                match_hash = pack_hash == Some(hash.as_str());
            }
            let mut match_name = true;
            if let Some(name) = &request.file_name {
                match_name = pack_filename_str == Some(name.as_str());
            }

            if match_project && match_version && match_hash && match_name {
                status.is_installed = true;
                status.is_enabled = Some(!pack_info.is_disabled);
                status.found_item_details = Some(FoundItemDetails {
                    item_type: ContentType::ShaderPack,
                    item_id: None,
                    file_name: Some(pack_info.filename.clone()),
                    display_name: Some(pack_info.filename.clone()), // Use filename as display_name
                });
                break;
            }
        }

        // Store the result
        results[*idx] = Some(ContentCheckResult {
            request_id: request.request_id.clone(),
            status,
            project_id: request.project_id.clone(),
            version_id: request.version_id.clone(),
            file_name: request.file_name.clone(),
            project_type: request.project_type.clone(),
        });
    }

    Ok(())
}

/// Process all data pack requests efficiently
async fn process_datapack_requests(
    profile: &Profile,
    requests: &[(&ContentCheckRequest, usize)],
    results: &mut Vec<Option<ContentCheckResult>>,
) -> Result<()> {
    // Load all data packs once
    let packs = match datapack_utils::get_datapacks_for_profile(profile, true, true).await {
        Ok(packs) => packs,
        Err(e) => {
            warn!("Failed to list data packs: {}. Assuming none installed.", e);
            Vec::new()
        }
    };

    for (request, idx) in requests {
        // Initialize the status struct
        let mut status = ContentInstallStatus::default();

        // Check if in NoRisk Pack - placeholder for future NoRisk Pack datapack support
        if let Some(pack_id) = &profile.selected_norisk_pack_id {
            // Placeholder for future implementation
        }

        // Check local installation against the preloaded packs
        for pack_info in &packs {
            let modrinth_pid = pack_info
                .modrinth_info
                .as_ref()
                .map(|m| m.project_id.as_str());
            let modrinth_vid = pack_info
                .modrinth_info
                .as_ref()
                .map(|m| m.version_id.as_str());
            let pack_hash = pack_info.sha1_hash.as_deref();
            let pack_filename_str = Some(pack_info.filename.as_str());

            // Match against provided parameters
            let mut match_project = true;
            if let Some(pid) = &request.project_id {
                match_project = modrinth_pid == Some(pid.as_str());
            }
            let mut match_version = true;
            if let Some(vid) = &request.version_id {
                match_version = modrinth_vid == Some(vid.as_str());
            }
            let mut match_hash = true;
            if let Some(hash) = &request.file_hash_sha1 {
                match_hash = pack_hash == Some(hash.as_str());
            }
            let mut match_name = true;
            if let Some(name) = &request.file_name {
                match_name = pack_filename_str == Some(name.as_str());
            }

            if match_project && match_version && match_hash && match_name {
                status.is_installed = true;
                status.is_enabled = Some(!pack_info.is_disabled);
                status.found_item_details = Some(FoundItemDetails {
                    item_type: ContentType::DataPack,
                    item_id: None,
                    file_name: Some(pack_info.filename.clone()),
                    display_name: Some(pack_info.filename.clone()), // Use filename as display_name
                });
                break;
            }
        }

        // Store the result
        results[*idx] = Some(ContentCheckResult {
            request_id: request.request_id.clone(),
            status,
            project_id: request.project_id.clone(),
            version_id: request.version_id.clone(),
            file_name: request.file_name.clone(),
            project_type: request.project_type.clone(),
        });
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GenericModrinthInfo {
    pub project_id: String,
    pub version_id: String,
    pub name: String, // Name des Modrinth-Projekts oder der Version
    pub version_number: String,
    pub download_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LocalContentItem {
    pub filename: String,
    pub path_str: String, // Pfad als String
    pub sha1_hash: Option<String>,
    pub file_size: u64,
    pub is_disabled: bool,
    pub is_directory: bool,        // Wichtig für Shader
    pub content_type: ContentType, // Um den Typ mitzuführen
    pub modrinth_info: Option<GenericModrinthInfo>,
    pub source_type: Option<String>, // Zur Kennzeichnung von Custom Mods
    pub norisk_info: Option<crate::state::profile_state::NoriskModIdentifier>, // Identifier für NoRiskMods
    pub fallback_version: Option<String>, // Fallback Version aus dem compatibility target
    pub id: Option<String>,               // Added optional ID field
    pub associated_loader: Option<crate::state::profile_state::ModLoader>, // Added associated_loader
}

#[derive(Debug, Clone, Serialize, Deserialize)] // Ensure Serialize and Deserialize are here
pub struct LoadItemsParams {
    pub profile_id: Uuid,
    pub content_type: ContentType,
    pub calculate_hashes: bool,
    pub fetch_modrinth_data: bool,
}

pub struct LocalContentLoader; // No longer holds profile_id, becomes a namespace/utility struct

impl LocalContentLoader {
    // new() constructor is removed as loader is now stateless regarding profile_id

    pub async fn load_items(
        // Made static conceptually, no longer uses &self
        params: LoadItemsParams,
    ) -> Result<Vec<LocalContentItem>> {
        let state = State::get().await?;
        // Fetch profile using profile_id from params
        let profile = state.profile_manager.get_profile(params.profile_id).await?;
        let profile_mods_path = state.profile_manager.get_profile_mods_path(&profile)?;

        debug!(
            "Loading items for profile: {} ({}), content_type: {:?}, calculate_hashes: {}, fetch_modrinth_data: {}",
            profile.name, params.profile_id, params.content_type, params.calculate_hashes, params.fetch_modrinth_data
        );

        let content_dirs = match params.content_type {
            ContentType::ResourcePack => {
                vec![resourcepack_utils::get_resourcepacks_dir(&profile).await?]
            }
            ContentType::ShaderPack => vec![shaderpack_utils::get_shaderpacks_dir(&profile).await?],
            ContentType::DataPack => vec![datapack_utils::get_datapacks_dir(&profile).await?],
            ContentType::Mod => {
                // Prefer standard mods directory first, then custom_mods
                let instance_path = state
                    .profile_manager
                    .calculate_instance_path_for_profile(&profile)?;
                vec![
                    profile_mods_path.clone(),
                    instance_path.join("custom_mods"),
                ]
            }
            ContentType::NoRiskMod => {
                // For NoRisk mods, handled differently (no physical directory scan)
                Vec::new()
            }
        };

        let mut preliminary_items: Vec<LocalContentItem> = Vec::new();

        if params.content_type == ContentType::NoRiskMod {
            // Special handling for NoRisk mods - fetch them from the NoRisk pack system
            if let Some(pack_id) = &profile.selected_norisk_pack_id {
                // Get the NoRisk pack manager from the state
                let state = State::get().await?;
                let config = state.norisk_pack_manager.get_config().await;

                // Get the resolved pack definition
                match config.get_resolved_pack_definition(pack_id) {
                    Ok(pack_def) => {
                        for norisk_mod in &pack_def.mods {
                            // Extract fallback version from compatibility target at the beginning
                            let fallback_version = norisk_mod
                                .compatibility
                                .get(&profile.game_version)
                                .and_then(|game_version_map| {
                                    game_version_map.get(profile.loader.as_str())
                                })
                                .map(|loader_target| loader_target.identifier.clone());

                            // Skip this mod if no fallback version is available
                            if fallback_version.is_none() {
                                continue;
                            }

                            // Create a proper NoriskModIdentifier first so we can reuse it
                            let norisk_mod_identifier =
                                crate::state::profile_state::NoriskModIdentifier {
                                    pack_id: pack_id.clone(),
                                    mod_id: norisk_mod.id.clone(),
                                    game_version: profile.game_version.clone(),
                                    loader: profile.loader.clone(),
                                };

                            // Determine if the mod is enabled/disabled using the identifier
                            let is_disabled = profile
                                .disabled_norisk_mods_detailed
                                .iter()
                                .any(|disabled_mod| *disabled_mod == norisk_mod_identifier);

                            // Determine source type string
                            let source_type_str = match &norisk_mod.source {
                                crate::integrations::norisk_packs::NoriskModSourceDefinition::Modrinth { .. } => None,
                                crate::integrations::norisk_packs::NoriskModSourceDefinition::Maven { .. } => Some("maven"),
                                crate::integrations::norisk_packs::NoriskModSourceDefinition::Url { .. } => Some("url"),
                                _ => Some("norisk"),
                            };

                            // Extract Modrinth info if available
                            let modrinth_info = if let crate::integrations::norisk_packs::NoriskModSourceDefinition::Modrinth { project_id, .. } = &norisk_mod.source {
                                // For version info we need to look at compatibility
                                let version_id = norisk_mod.compatibility
                                    .get(&profile.game_version)
                                    .and_then(|game_version_map| game_version_map.get(profile.loader.as_str()))
                                    .map(|loader_target| loader_target.identifier.clone())
                                    .unwrap_or_else(|| "unknown".to_string());

                                Some(GenericModrinthInfo {
                                    project_id: project_id.clone(),
                                    version_id,
                                    name: norisk_mod.display_name.clone().unwrap_or_else(|| norisk_mod.id.clone()),
                                    version_number: "".to_string(), // Not directly available
                                    download_url: None,
                                })
                            } else {
                                None
                            };

                            // Use the path_utils function to get the mod cache path
                            let path_str = match crate::utils::path_utils::get_norisk_mod_cache_path(
                                norisk_mod,
                                &profile.game_version,
                                &profile.loader.as_str(),
                            ) {
                                Ok(path) => path.to_string_lossy().to_string(),
                                Err(e) => {
                                    warn!(
                                        "Could not get cache path for NoRisk mod {}: {}",
                                        norisk_mod.id, e
                                    );
                                    String::new() // Fallback if path can't be determined
                                }
                            };

                            // Create LocalContentItem (using the identifier we created earlier)
                            preliminary_items.push(LocalContentItem {
                                filename: norisk_mod.id.clone(),
                                path_str,
                                sha1_hash: None,
                                file_size: 0,
                                is_disabled,
                                is_directory: false,
                                content_type: ContentType::NoRiskMod,
                                modrinth_info,
                                source_type: source_type_str.map(|s| s.to_string()),
                                norisk_info: Some(norisk_mod_identifier),
                                fallback_version: fallback_version,
                                id: None,
                                associated_loader: None,
                            });
                        }
                    }
                    Err(e) => {
                        warn!("Failed to get NoRisk pack definition: {}", e);
                    }
                }
            }
        } else if params.content_type == ContentType::Mod {
            // First process profile.mods entries (for tracking enabled status)
            for mod_item in &profile.mods {
                let mut filename = mod_item.file_name_override.clone();
                if filename.is_none() {
                    match mod_item.source {
                        crate::state::profile_state::ModSource::Modrinth {
                            ref file_name, ..
                        } => filename = Some(file_name.clone()),
                        crate::state::profile_state::ModSource::Local { ref file_name, .. } => {
                            filename = Some(file_name.clone())
                        }
                        crate::state::profile_state::ModSource::Url { ref file_name, .. } => {
                            filename = file_name.clone()
                        }
                        _ => {
                            warn!("Mod {} has no derivable filename. Skipping.", mod_item.id);
                            continue;
                        }
                    }
                }

                let actual_filename = match filename {
                    Some(name) => name,
                    None => {
                        warn!(
                            "Mod {} could not determine a filename even after checks. Skipping.",
                            mod_item.id
                        );
                        continue;
                    }
                };

                // Try to find the mod in any of the content directories
                let mut found_path = None;
                for dir in &content_dirs {
                    let path_buf = dir.join(&actual_filename);
                    if path_buf.exists() {
                        found_path = Some(path_buf);
                        break;
                    }
                }

                // Use the first directory as fallback if file not found
                let path_buf = if let Some(found) = found_path { found } else {
                    // Smarter fallback: if this profile mod comes from Modrinth/Url/Maven, point to mod_cache
                    match &mod_item.source {
                        crate::state::profile_state::ModSource::Modrinth { .. }
                        | crate::state::profile_state::ModSource::Url { .. }
                        | crate::state::profile_state::ModSource::Maven { .. } => {
                            crate::config::ProjectDirsExt::meta_dir(&*crate::config::LAUNCHER_DIRECTORY)
                                .join("mod_cache")
                                .join(&actual_filename)
                        }
                        _ => content_dirs[0].join(&actual_filename),
                    }
                };
                let path_str = path_buf.to_string_lossy().into_owned();

                let file_size = 0; // Placeholder due to cache logic - will revisit

                let sha1_hash = match mod_item.source {
                    crate::state::profile_state::ModSource::Modrinth {
                        ref file_hash_sha1, ..
                    } => file_hash_sha1.clone(),
                    _ => None,
                };

                let modrinth_info = match mod_item.source {
                    crate::state::profile_state::ModSource::Modrinth {
                        ref project_id,
                        ref version_id,
                        ..
                    } => Some(GenericModrinthInfo {
                        project_id: project_id.clone(),
                        version_id: version_id.clone(),
                        name: mod_item
                            .display_name
                            .clone()
                            .unwrap_or_else(|| project_id.clone()),
                        version_number: mod_item
                            .version
                            .clone()
                            .unwrap_or_else(|| version_id.clone()),
                        download_url: None,
                    }),
                    _ => None,
                };

                preliminary_items.push(LocalContentItem {
                    filename: actual_filename,
                    path_str,
                    sha1_hash,
                    file_size,
                    is_disabled: !mod_item.enabled,
                    is_directory: false,
                    content_type: ContentType::Mod,
                    modrinth_info,
                    source_type: None,
                    norisk_info: None,
                    fallback_version: mod_item.version.clone(),
                    id: Some(mod_item.id.to_string()), // Set the ID from ModProfileEntry
                    associated_loader: mod_item.associated_loader.clone(), // Populate associated_loader
                });
            }
        }

        // Process files directly from content directories for all content types
        for content_dir in &content_dirs {
            if !content_dir.exists() {
                debug!(
                    "Content directory {} does not exist. Skipping.",
                    content_dir.display()
                );
                continue;
            }

            let mut entries = match fs::read_dir(&content_dir).await {
                Ok(entries) => entries,
                Err(e) => {
                    warn!(
                        "Failed to read directory {}: {}. Skipping.",
                        content_dir.display(),
                        e
                    );
                    continue;
                }
            };

            let mut items_to_process_with_paths: Vec<(PathBuf, bool)> = Vec::new();

            while let Some(entry_result) =
                entries.next_entry().await.map_err(|e| AppError::Io(e))?
            {
                let path = entry_result.path();
                let file_name_os = path.file_name().unwrap_or_default();
                let file_name_str = file_name_os.to_string_lossy();
                let is_directory = path.is_dir();

                let is_valid_item = match params.content_type {
                    ContentType::ResourcePack => {
                        (file_name_str.ends_with(".zip")
                            || file_name_str.ends_with(".zip.disabled"))
                            && !is_directory
                    }
                    ContentType::ShaderPack => {
                        (file_name_str.ends_with(".zip")
                            || file_name_str.ends_with(".zip.disabled"))
                            || is_directory
                    }
                    ContentType::DataPack => {
                        (file_name_str.ends_with(".zip")
                            || file_name_str.ends_with(".zip.disabled"))
                            && !is_directory
                    }
                    ContentType::Mod => {
                        (file_name_str.ends_with(".jar")
                            || file_name_str.ends_with(".jar.disabled"))
                            && !is_directory
                    }
                    ContentType::NoRiskMod => false, // We handle NoRisk mods differently, not by scanning directories
                };

                if is_valid_item {
                    items_to_process_with_paths.push((path.clone(), is_directory));
                } else {
                    debug!(
                        "Skipping invalid item for {:?}: {}",
                        params.content_type,
                        path.display()
                    );
                }
            }

            for (path, is_dir_flag) in items_to_process_with_paths {
                let file_name_os = path.file_name().unwrap_or_default();
                let file_name_str = file_name_os.to_string_lossy().to_string();
                let metadata = fs::metadata(&path).await.map_err(|e| AppError::Io(e))?;
                let file_size = metadata.len();
                let is_disabled = file_name_str.ends_with(".disabled");
                let base_filename = if is_disabled {
                    file_name_str
                        .strip_suffix(".disabled")
                        .unwrap_or(&file_name_str)
                        .to_string()
                } else {
                    file_name_str
                };

                // Determine source_type based on location (only mark custom if under custom_mods)
                let source_type = if params.content_type == ContentType::Mod {
                    if path.starts_with(&profile_mods_path) {
                        Some("custom".to_string())
                    } else if path
                        .parent()
                        .and_then(|p| p.file_name())
                        .map(|name| name.to_string_lossy().to_string() == "custom_mods")
                        .unwrap_or(false)
                    {
                        Some("custom".to_string())
                    } else {
                        None
                    }
                } else {
                    None
                };

                preliminary_items.push(LocalContentItem {
                    filename: base_filename,
                    path_str: path.to_string_lossy().into_owned(),
                    sha1_hash: None,
                    file_size,
                    is_disabled,
                    is_directory: is_dir_flag,
                    content_type: params.content_type.clone(),
                    modrinth_info: None,
                    source_type,
                    norisk_info: None,
                    fallback_version: None,
                    id: None,
                    associated_loader: None,
                });
            }
        }

        let mut final_items = preliminary_items;

        // If the content type is NoRiskMod, sort the items by filename for consistent ordering
        if params.content_type == ContentType::NoRiskMod {
            final_items.sort_by(|a, b| a.filename.cmp(&b.filename));
        }

        if params.calculate_hashes {
            let mut hash_tasks: Vec<JoinHandle<(usize, std::result::Result<String, AppError>)>> =
                Vec::new();
            // Collect indices of items that need hashing (files only, or non-Modrinth mods if hash not present)
            let items_to_hash_indices: Vec<usize> = final_items
                .iter()
                .enumerate()
                .filter(|(_, item)| {
                    if item.is_directory {
                        return false;
                    }
                    if item.content_type == ContentType::Mod {
                        // For mods, only hash if sha1_hash is currently None (e.g. local mod, or Modrinth mod missing it)
                        return item.sha1_hash.is_none();
                    }
                    // For other types, always hash if calculate_hashes is true (as sha1_hash starts as None)
                    true
                })
                .map(|(index, _)| index)
                .collect();

            let mut hash_tasks = Vec::new();

            // Create a vector of (index, path, filename) to avoid borrowing final_items in the async tasks
            let hash_items_info: Vec<(usize, String, String)> = items_to_hash_indices
                .iter()
                .map(|&idx| {
                    (
                        idx,
                        final_items[idx].path_str.clone(),
                        final_items[idx].filename.clone(),
                    )
                })
                .collect();

            for (index_in_final_items, path_str, filename) in hash_items_info {
                let path_buf = PathBuf::from(&path_str);
                let semaphore_clone = Arc::clone(&state.io_semaphore);

                hash_tasks.push(tokio::spawn(async move {
                    let permit_result = semaphore_clone.acquire_owned().await;
                    if permit_result.is_err() {
                        error!("Failed to acquire semaphore permit for hashing.");
                        return (
                            index_in_final_items,
                            Err(AppError::Other("Semaphore acquisition failed".to_string())),
                        );
                    }

                    // Permit is acquired, proceed with hashing
                    if !path_buf.exists() {
                        // If file doesn't exist, return "0" as hash instead of error
                        warn!(
                            "Path doesn't exist for {}: {}",
                            filename,
                            path_buf.display()
                        );
                        return (index_in_final_items, Ok("0".to_string()));
                    }

                    let hash_result = hash_utils::calculate_sha1(&path_buf)
                        .await
                        .map_err(AppError::Io);
                    // Permit is automatically dropped when it goes out of scope
                    (index_in_final_items, hash_result)
                }));
            }

            let hash_calculation_results = join_all(hash_tasks).await;
            for task_result in hash_calculation_results {
                match task_result {
                    Ok((item_idx, Ok(sha1))) => {
                        if let Some(item_to_update) = final_items.get_mut(item_idx) {
                            item_to_update.sha1_hash = Some(sha1);
                        }
                    }
                    Ok((item_idx, Err(e))) => {
                        if let Some(item) = final_items.get(item_idx) {
                            warn!("Failed to calculate SHA1 for {}: {}", item.filename, e);
                        } else {
                            warn!(
                                "Failed to calculate SHA1 for item at index {}: {}",
                                item_idx, e
                            );
                        }
                    }
                    Err(e) => {
                        // JoinError
                        error!("Hash calculation task panicked: {}", e);
                    }
                }
            }
        }

        if params.fetch_modrinth_data {
            // Use params.fetch_modrinth_data
            let mut hashes_for_modrinth_lookup: HashMap<String, Vec<usize>> = HashMap::new(); // sha1 -> Vec of indices in final_items
            for (index, item) in final_items.iter().enumerate() {
                if let Some(hash) = &item.sha1_hash {
                    if !item.is_directory {
                        // Only fetch for files with hashes
                        hashes_for_modrinth_lookup
                            .entry(hash.clone())
                            .or_default()
                            .push(index);
                    }
                }
            }

            if !hashes_for_modrinth_lookup.is_empty() {
                let hashes_vec: Vec<String> = hashes_for_modrinth_lookup.keys().cloned().collect();
                debug!(
                    "Fetching Modrinth info for {} unique hashes (affecting {} items)",
                    hashes_vec.len(),
                    hashes_for_modrinth_lookup
                        .values()
                        .map(|v| v.len())
                        .sum::<usize>()
                );

                match crate::integrations::modrinth::get_versions_by_hashes(hashes_vec, "sha1")
                    .await
                {
                    Ok(version_map) => {
                        for (hash, modrinth_version) in version_map {
                            if let Some(item_indices) = hashes_for_modrinth_lookup.get(&hash) {
                                for &item_idx in item_indices {
                                    if let Some(item_to_update) = final_items.get_mut(item_idx) {
                                        // Additional check: ensure content type matches Modrinth project type if possible/needed.
                                        // For now, directly assign if a primary file exists.
                                        let primary_file =
                                            modrinth_version.files.iter().find(|f| f.primary);

                                        // TODO: Re-evaluate project type compatibility check.
                                        // The ModrinthVersion struct from get_versions_by_hashes might not include project_type directly.
                                        // This check needs to be re-implemented if project_type is available or fetched separately.
                                        /*
                                        let project_type_compatible = match params.content_type { // Use params.content_type
                                            ContentType::ResourcePack => modrinth_version.project_type == Some(crate::integrations::modrinth::ModrinthProjectType::ResourcePack),
                                            ContentType::ShaderPack => modrinth_version.project_type == Some(crate::integrations::modrinth::ModrinthProjectType::Shader),
                                            ContentType::DataPack => modrinth_version.project_type == Some(crate::integrations::modrinth::ModrinthProjectType::Datapack),
                                            ContentType::Mod => false, // Should not happen here
                                        };

                                        if !project_type_compatible && modrinth_version.project_type.is_some() {
                                            debug!(
                                                "Skipping Modrinth info for '{}' (hash {}): Mismatched project type. Expected {:?}, got {:?}",
                                                item_to_update.filename, hash, params.content_type, modrinth_version.project_type // Use params.content_type
                                            );
                                            continue;
                                        }
                                        */

                                        if let Some(file_info) = primary_file {
                                            item_to_update.modrinth_info =
                                                Some(GenericModrinthInfo {
                                                    project_id: modrinth_version.project_id.clone(),
                                                    version_id: modrinth_version.id.clone(),
                                                    name: modrinth_version.name.clone(),
                                                    version_number: modrinth_version
                                                        .version_number
                                                        .clone(),
                                                    download_url: Some(file_info.url.clone()),
                                                });
                                        } else if !modrinth_version.files.is_empty() {
                                            // Fallback to first file if no primary, but log this
                                            warn!("No primary file for Modrinth version {} (project {}). Using first available file for Modrinth info.", modrinth_version.id, modrinth_version.project_id);
                                            let first_file = &modrinth_version.files[0];
                                            item_to_update.modrinth_info =
                                                Some(GenericModrinthInfo {
                                                    project_id: modrinth_version.project_id.clone(),
                                                    version_id: modrinth_version.id.clone(),
                                                    name: modrinth_version.name.clone(),
                                                    version_number: modrinth_version
                                                        .version_number
                                                        .clone(),
                                                    download_url: Some(first_file.url.clone()),
                                                });
                                        } else {
                                            debug!("No files found for Modrinth version {} (project {}) to determine download URL.", modrinth_version.id, modrinth_version.project_id);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to fetch Modrinth versions by hashes: {}", e);
                    }
                }
            }
        }

        for (idx, item) in final_items.iter().enumerate() {
            info!(
                "Final item [{}]: filename='{}', path_str='{}', sha1_hash={:?}, file_size={}, is_disabled={}, is_directory={}, content_type={:?}, source_type={:?}, norisk_info={:?}, id={:?}, associated_loader={:?}, fallback_version={:?}, modrinth_info={:?}",
                idx,
                item.filename,
                item.path_str,
                item.sha1_hash,
                item.file_size,
                item.is_disabled,
                item.is_directory,
                item.content_type,
                item.source_type,
                item.norisk_info,
                item.id,
                item.associated_loader,
                item.fallback_version,
                item.modrinth_info
            );
        }
        info!(
            "Successfully loaded {} items of type {:?} for profile {}",
            final_items.len(),
            params.content_type,
            params.profile_id
        );
        Ok(final_items)
    }
}
