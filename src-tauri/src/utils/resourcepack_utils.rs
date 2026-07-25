use crate::error::{AppError, Result};
use crate::integrations::modrinth;
use crate::state::profile_state::Profile;
use crate::state::state_manager::State;
use crate::utils::hash_utils;
use crate::utils::profile_utils::{
    ContentType, GenericModrinthInfo, LoadItemsParams, LocalContentLoader,
};
use futures::future::join_all;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::Semaphore;

/// Represents a resourcepack found in the profile directory
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ResourcePackInfo {
    /// Filename of the resourcepack (e.g. "awesome_pack.zip")
    pub filename: String,
    /// Full path to the resourcepack file
    pub path: String,
    /// SHA1 hash of the file
    pub sha1_hash: Option<String>,
    /// File size in bytes
    pub file_size: u64,
    /// True if the resourcepack is disabled (.disabled extension)
    pub is_disabled: bool,
    /// Optional Modrinth information if the pack was found on Modrinth
    pub modrinth_info: Option<ResourcePackModrinthInfo>,
}

/// Modrinth information for a resourcepack
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ResourcePackModrinthInfo {
    /// Modrinth project ID
    pub project_id: String,
    /// Modrinth version ID
    pub version_id: String,
    /// Name of the resourcepack on Modrinth
    pub name: String,
    /// Version string
    pub version_number: String,
    /// Download URL
    pub download_url: String,
}

/// Get all resourcepacks for a profile
pub async fn get_resourcepacks_for_profile(
    profile: &Profile,
    calculate_hashes: bool,
    fetch_modrinth_data: bool,
) -> Result<Vec<ResourcePackInfo>> {
    debug!(
        "Getting resourcepacks for profile: {} ({}) via LocalContentLoader. Calculate_hashes: {}, fetch_modrinth_data: {}",
        profile.name,
        profile.id,
        calculate_hashes,
        fetch_modrinth_data
    );

    // Create LoadItemsParams directly, including profile.id
    let loader_params = LoadItemsParams {
        profile_id: profile.id, // Pass profile.id here
        content_type: ContentType::ResourcePack,
        calculate_hashes,
        fetch_modrinth_data,
        cache_behaviour: Default::default(),
    };

    // Call load_items directly
    match LocalContentLoader::load_items(loader_params).await {
        Ok(local_items) => {
            let resource_pack_infos: Vec<ResourcePackInfo> = local_items
                .into_iter()
                .map(|item| ResourcePackInfo {
                    filename: item.filename,
                    path: item.path_str,
                    sha1_hash: item.sha1_hash,
                    file_size: item.file_size,
                    is_disabled: item.is_disabled,
                    modrinth_info: item.modrinth_info.map(|generic_info: GenericModrinthInfo| {
                        ResourcePackModrinthInfo {
                            project_id: generic_info.project_id,
                            version_id: generic_info.version_id,
                            name: generic_info.name,
                            version_number: generic_info.version_number,
                            download_url: generic_info.download_url.unwrap_or_default(),
                        }
                    }),
                })
                .collect();

            info!(
                "Successfully converted {} LocalContentItems to ResourcePackInfo for profile {}",
                resource_pack_infos.len(),
                profile.id
            );
            Ok(resource_pack_infos)
        }
        Err(e) => {
            log::error!(
                "Failed to load resourcepacks using LocalContentLoader for profile {}: {}",
                profile.id,
                e
            );
            Err(e)
        }
    }
}

/// Get the path to the resourcepacks directory for a profile
pub async fn get_resourcepacks_dir(profile: &Profile) -> Result<PathBuf> {
    let state = State::get().await?;
    let base_profiles_dir = state
        .profile_manager
        .calculate_instance_path_for_profile(profile)?;
    let resourcepacks_dir = base_profiles_dir.join("resourcepacks");
    debug!(
        "Resourcepacks directory for profile {}: {}",
        profile.id,
        resourcepacks_dir.display()
    );
    Ok(resourcepacks_dir)
}

/// Check if a path is a resourcepack file
fn is_resourcepack_file(path: &Path) -> bool {
    if !path.is_file() {
        debug!("Skipping non-file path: {}", path.display());
        return false;
    }

    let file_name = match path.file_name().and_then(|s| s.to_str()) {
        Some(name) => name,
        None => {
            debug!("Path has no valid filename: {}", path.display());
            return false;
        }
    };

    // Check for .zip or .zip.disabled extension
    let is_zip = file_name.ends_with(".zip") || file_name.ends_with(".zip.disabled");
    if is_zip {
        debug!("File confirmed as resource pack (zip): {}", path.display());
    } else {
        debug!(
            "File is not a resource pack (not a zip): {}",
            path.display()
        );
    }
    return is_zip;
}

/// Update a resource pack from Modrinth to a new version
pub async fn update_resourcepack_from_modrinth(
    profile: &Profile,
    resourcepack: &ResourcePackInfo,
    new_version: &crate::integrations::modrinth::ModrinthVersion,
) -> Result<()> {
    info!(
        "Updating resource pack '{}' to version {} in profile {}",
        resourcepack.filename, new_version.version_number, profile.id
    );

    // Get the resourcepacks directory
    let resourcepacks_dir = get_resourcepacks_dir(profile).await?;

    // Check if the directory exists, create if not
    if !resourcepacks_dir.exists() {
        debug!(
            "Creating resourcepacks directory for profile: {}",
            profile.id
        );
        fs::create_dir_all(&resourcepacks_dir).await.map_err(|e| {
            AppError::Other(format!("Failed to create resourcepacks directory: {}", e))
        })?;
    }

    // Find and delete the old file (including .disabled variant)
    let old_path = resourcepacks_dir.join(&resourcepack.filename);
    let old_path_disabled = resourcepacks_dir.join(format!("{}.disabled", resourcepack.filename));

    let was_disabled = resourcepack.is_disabled;

    // Find the primary file in the new version
    let primary_file = new_version
        .files
        .iter()
        .find(|f| f.primary)
        .ok_or_else(|| {
            AppError::Other(format!(
                "No primary file found for Modrinth version {} (ID: {})",
                new_version.name, new_version.id
            ))
        })?;

    // Check and delete the old file
    if old_path.exists() {
        debug!("Removing old resource pack file: {}", old_path.display());
        fs::remove_file(&old_path).await.map_err(|e| {
            AppError::Other(format!("Failed to remove old resource pack file: {}", e))
        })?;
    } else if old_path_disabled.exists() {
        debug!(
            "Removing old disabled resource pack file: {}",
            old_path_disabled.display()
        );
        fs::remove_file(&old_path_disabled).await.map_err(|e| {
            AppError::Other(format!(
                "Failed to remove old disabled resource pack file: {}",
                e
            ))
        })?;
    } else {
        warn!(
            "Old resource pack file not found: {}",
            resourcepack.filename
        );
    }

    // Use the utility function to download the new content
    use crate::utils::profile_utils::{add_modrinth_content_to_profile, ContentType};

    // Download the new resource pack
    add_modrinth_content_to_profile(
        profile.id,
        new_version.project_id.clone(),
        new_version.id.clone(),
        primary_file.filename.clone(),
        primary_file.url.clone(),
        primary_file.hashes.sha1.clone(),
        Some(new_version.name.clone()),
        Some(new_version.version_number.clone()),
        ContentType::ResourcePack,
    )
    .await?;

    // If the old pack was disabled, disable the new one too
    if was_disabled {
        let new_path = resourcepacks_dir.join(&primary_file.filename);
        let new_path_disabled =
            resourcepacks_dir.join(format!("{}.disabled", primary_file.filename));

        debug!("Old pack was disabled, disabling new pack as well");
        fs::rename(&new_path, &new_path_disabled)
            .await
            .map_err(|e| AppError::Other(format!("Failed to disable new resource pack: {}", e)))?;
    }

    info!(
        "Successfully updated resource pack from '{}' to '{}'",
        resourcepack.filename, primary_file.filename
    );

    Ok(())
}
