use crate::error::{AppError, Result};
use crate::integrations::modrinth;
use crate::state::profile_state::Profile;
use crate::state::state_manager::State;
use crate::utils::hash_utils;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::fs;

/// Represents a datapack found in the profile directory
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DataPackInfo {
    /// Filename of the datapack (e.g. "awesome_datapack.zip")
    pub filename: String,
    /// Full path to the datapack file
    pub path: String,
    /// SHA1 hash of the file
    pub sha1_hash: Option<String>,
    /// File size in bytes
    pub file_size: u64,
    /// True if the datapack is disabled (.disabled extension)
    pub is_disabled: bool,
    /// Optional Modrinth information if the pack was found on Modrinth
    pub modrinth_info: Option<DataPackModrinthInfo>,
}

/// Modrinth information for a datapack
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DataPackModrinthInfo {
    /// Modrinth project ID
    pub project_id: String,
    /// Modrinth version ID
    pub version_id: String,
    /// Name of the datapack on Modrinth
    pub name: String,
    /// Version string
    pub version_number: String,
    /// Download URL
    pub download_url: String,
}

/// Get all datapacks for a profile
pub async fn get_datapacks_for_profile(
    profile: &Profile,
    calculate_hashes: bool,
    fetch_modrinth_data: bool,
) -> Result<Vec<DataPackInfo>> {
    debug!(
        "Getting datapacks for profile: {} ({}) via LocalContentLoader. Calculate_hashes: {}, fetch_modrinth_data: {}",
        profile.name,
        profile.id,
        calculate_hashes,
        fetch_modrinth_data
    );

    use crate::utils::profile_utils::{LocalContentLoader, LoadItemsParams, ContentType, GenericModrinthInfo};

    // Create LoadItemsParams directly, including profile.id
    let loader_params = LoadItemsParams {
        profile_id: profile.id,
        content_type: ContentType::DataPack,
        calculate_hashes,
        fetch_modrinth_data,
    };

    // Call load_items directly
    match LocalContentLoader::load_items(loader_params).await {
        Ok(local_items) => {
            let data_pack_infos: Vec<DataPackInfo> = local_items
                .into_iter()
                .map(|item| DataPackInfo {
                    filename: item.filename,
                    path: item.path_str,
                    sha1_hash: item.sha1_hash,
                    file_size: item.file_size,
                    is_disabled: item.is_disabled,
                    modrinth_info: item.modrinth_info.map(|generic_info: GenericModrinthInfo| {
                        DataPackModrinthInfo {
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
                "Successfully converted {} LocalContentItems to DataPackInfo for profile {}",
                data_pack_infos.len(),
                profile.id
            );
            Ok(data_pack_infos)
        }
        Err(e) => {
            log::error!(
                "Failed to load datapacks using LocalContentLoader for profile {}: {}",
                profile.id,
                e
            );
            Err(e)
        }
    }
}

/// Get the path to the datapacks directory for a profile
pub async fn get_datapacks_dir(profile: &Profile) -> Result<PathBuf> {
    let state = State::get().await?;
    let base_profiles_dir = state
        .profile_manager
        .calculate_instance_path_for_profile(profile)?;
    let datapacks_dir = base_profiles_dir.join("datapacks");
    debug!(
        "Datapacks directory for profile {}: {}",
        profile.id,
        datapacks_dir.display()
    );
    Ok(datapacks_dir)
}

/// Check if a path is a datapack file
fn is_datapack_file(path: &Path) -> bool {
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
        debug!("File confirmed as data pack (zip): {}", path.display());
    } else {
        debug!("File is not a data pack (not a zip): {}", path.display());
    }
    return is_zip;
}

/// Update a data pack from Modrinth to a new version
pub async fn update_datapack_from_modrinth(
    profile: &Profile,
    datapack: &DataPackInfo,
    new_version: &crate::integrations::modrinth::ModrinthVersion,
) -> Result<()> {
    info!(
        "Updating data pack '{}' to version {} in profile {}",
        datapack.filename, new_version.version_number, profile.id
    );

    // Get the datapacks directory
    let datapacks_dir = get_datapacks_dir(profile).await?;

    // Check if the directory exists, create if not
    if !datapacks_dir.exists() {
        debug!("Creating datapacks directory for profile: {}", profile.id);
        fs::create_dir_all(&datapacks_dir)
            .await
            .map_err(|e| AppError::Other(format!("Failed to create datapacks directory: {}", e)))?;
    }

    // Find and delete the old file (including .disabled variant)
    let old_path = datapacks_dir.join(&datapack.filename);
    let old_path_disabled = datapacks_dir.join(format!("{}.disabled", datapack.filename));

    let was_disabled = datapack.is_disabled;

    // Find the primary file in the new version
    log::debug!(
        "Files in new_version for datapack update: {:?}",
        new_version.files
    );
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
        debug!("Removing old data pack file: {}", old_path.display());
        fs::remove_file(&old_path)
            .await
            .map_err(|e| AppError::Other(format!("Failed to remove old data pack file: {}", e)))?;
    } else if old_path_disabled.exists() {
        debug!(
            "Removing old disabled data pack file: {}",
            old_path_disabled.display()
        );
        fs::remove_file(&old_path_disabled).await.map_err(|e| {
            AppError::Other(format!(
                "Failed to remove old disabled data pack file: {}",
                e
            ))
        })?;
    } else {
        warn!("Old data pack file not found: {}", datapack.filename);
    }

    // Use the utility function to download the new content
    use crate::utils::profile_utils::{add_modrinth_content_to_profile, ContentType};

    // Download the new data pack
    add_modrinth_content_to_profile(
        profile.id,
        new_version.project_id.clone(),
        new_version.id.clone(),
        primary_file.filename.clone(),
        primary_file.url.clone(),
        primary_file.hashes.sha1.clone(),
        Some(new_version.name.clone()),
        Some(new_version.version_number.clone()),
        ContentType::DataPack,
    )
    .await?;

    // If the old pack was disabled, disable the new one too
    if was_disabled {
        let new_path = datapacks_dir.join(&primary_file.filename);
        let new_path_disabled = datapacks_dir.join(format!("{}.disabled", primary_file.filename));

        debug!("Old pack was disabled, disabling new pack as well");
        fs::rename(&new_path, &new_path_disabled)
            .await
            .map_err(|e| AppError::Other(format!("Failed to disable new data pack: {}", e)))?;
    }

    info!(
        "Successfully updated data pack from '{}' to '{}'",
        datapack.filename, primary_file.filename
    );

    Ok(())
}
