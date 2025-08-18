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

/// Represents a shaderpack found in the profile directory
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShaderPackInfo {
    /// Filename of the shaderpack (e.g. "awesome_shader.zip")
    pub filename: String,
    /// Full path to the shaderpack file
    pub path: String,
    /// SHA1 hash of the file
    pub sha1_hash: Option<String>,
    /// File size in bytes
    pub file_size: u64,
    /// True if the shaderpack is disabled (.disabled extension)
    pub is_disabled: bool,
    /// Optional Modrinth information if the pack was found on Modrinth
    pub modrinth_info: Option<ShaderPackModrinthInfo>,
}

/// Modrinth information for a shaderpack
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShaderPackModrinthInfo {
    /// Modrinth project ID
    pub project_id: String,
    /// Modrinth version ID
    pub version_id: String,
    /// Name of the shaderpack on Modrinth
    pub name: String,
    /// Version string
    pub version_number: String,
    /// Download URL
    pub download_url: String,
}

/// Get all shaderpacks for a profile
pub async fn get_shaderpacks_for_profile(
    profile: &Profile,
    calculate_hashes: bool,
    fetch_modrinth_data: bool,
) -> Result<Vec<ShaderPackInfo>> {
    debug!(
        "Getting shaderpacks for profile: {} ({}) via LocalContentLoader. Calculate_hashes: {}, fetch_modrinth_data: {}",
        profile.name,
        profile.id,
        calculate_hashes,
        fetch_modrinth_data
    );

    use crate::utils::profile_utils::{LocalContentLoader, LoadItemsParams, ContentType, GenericModrinthInfo};

    // Create LoadItemsParams directly, including profile.id
    let loader_params = LoadItemsParams {
        profile_id: profile.id,
        content_type: ContentType::ShaderPack,
        calculate_hashes,
        fetch_modrinth_data,
    };

    // Call load_items directly
    match LocalContentLoader::load_items(loader_params).await {
        Ok(local_items) => {
            let shader_pack_infos: Vec<ShaderPackInfo> = local_items
                .into_iter()
                .map(|item| ShaderPackInfo {
                    filename: item.filename,
                    path: item.path_str,
                    sha1_hash: item.sha1_hash,
                    file_size: item.file_size,
                    is_disabled: item.is_disabled,
                    modrinth_info: item.modrinth_info.map(|generic_info: GenericModrinthInfo| {
                        ShaderPackModrinthInfo {
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
                "Successfully converted {} LocalContentItems to ShaderPackInfo for profile {}",
                shader_pack_infos.len(),
                profile.id
            );
            Ok(shader_pack_infos)
        }
        Err(e) => {
            log::error!(
                "Failed to load shaderpacks using LocalContentLoader for profile {}: {}",
                profile.id,
                e
            );
            Err(e)
        }
    }
}

/// Get the path to the shaderpacks directory for a profile
pub async fn get_shaderpacks_dir(profile: &Profile) -> Result<PathBuf> {
    let state = State::get().await?;
    let base_profiles_dir = state
        .profile_manager
        .calculate_instance_path_for_profile(profile)?;
    let shaderpacks_dir = base_profiles_dir.join("shaderpacks");
    debug!(
        "Shaderpacks directory for profile {}: {}",
        profile.id,
        shaderpacks_dir.display()
    );
    Ok(shaderpacks_dir)
}

/// Check if a path is a shaderpack file/directory
async fn is_shaderpack_file(path: &Path) -> Result<bool> {
    let metadata = fs::metadata(path)
        .await
        .map_err(|e| AppError::Other(format!("Failed to get metadata: {}", e)))?;

    // Shader packs can be directories or zip files
    if metadata.is_dir() {
        debug!("Checking if directory is a shader pack: {}", path.display());
        // Check if it contains files that make it a shader pack
        // (typically shaders/composite.fsh or similar)
        let result = is_shader_directory(path).await?;
        if result {
            debug!("Directory confirmed as shader pack: {}", path.display());
        } else {
            debug!("Directory is not a shader pack: {}", path.display());
        }
        return Ok(result);
    }

    if metadata.is_file() {
        let file_name = match path.file_name().and_then(|s| s.to_str()) {
            Some(name) => name,
            None => return Ok(false),
        };

        // Check for .zip or .zip.disabled extension for shader zip files
        let is_zip = file_name.ends_with(".zip") || file_name.ends_with(".zip.disabled");
        if is_zip {
            debug!("File confirmed as shader pack (zip): {}", path.display());
        } else {
            debug!("File is not a shader pack (not a zip): {}", path.display());
        }
        return Ok(is_zip);
    }

    debug!("Path is neither file nor directory: {}", path.display());
    Ok(false)
}

/// Check if a directory contains shader files
async fn is_shader_directory(path: &Path) -> Result<bool> {
    // Look for common shader files in the right places
    let shader_dir = path.join("shaders");
    debug!("Checking for shader directory at: {}", shader_dir.display());

    if !shader_dir.exists() {
        debug!("No 'shaders' subdirectory found in: {}", path.display());
        return Ok(false);
    }

    // Check for common shader files
    for common_file in &["composite.fsh", "final.fsh", "gbuffers_basic.fsh"] {
        let common_file_path = shader_dir.join(common_file);
        if common_file_path.exists() {
            debug!("Found common shader file: {}", common_file_path.display());
            return Ok(true);
        }
    }

    debug!("No common shader files found, checking for any .fsh or .vsh files...");

    // If we can't find specific files, check if there are any .fsh or .vsh files
    let mut entries = fs::read_dir(&shader_dir)
        .await
        .map_err(|e| AppError::Other(format!("Failed to read shader directory: {}", e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| AppError::Other(format!("Failed to read shader entry: {}", e)))?
    {
        let path = entry.path();
        if path.is_file() {
            if let Some(extension) = path.extension().and_then(|e| e.to_str()) {
                if extension == "fsh" || extension == "vsh" {
                    debug!(
                        "Found shader file with .fsh or .vsh extension: {}",
                        path.display()
                    );
                    return Ok(true);
                }
            }
        }
    }

    debug!(
        "No shader files found in directory: {}",
        shader_dir.display()
    );
    Ok(false)
}

/// Update a shader pack from Modrinth to a new version
pub async fn update_shaderpack_from_modrinth(
    profile: &Profile,
    shaderpack: &ShaderPackInfo,
    new_version: &crate::integrations::modrinth::ModrinthVersion,
) -> Result<()> {
    info!(
        "Updating shader pack '{}' to version {} in profile {}",
        shaderpack.filename, new_version.version_number, profile.id
    );

    // Get the shaderpacks directory
    let shaderpacks_dir = get_shaderpacks_dir(profile).await?;

    // Check if the directory exists, create if not
    if !shaderpacks_dir.exists() {
        debug!("Creating shaderpacks directory for profile: {}", profile.id);
        fs::create_dir_all(&shaderpacks_dir).await.map_err(|e| {
            AppError::Other(format!("Failed to create shaderpacks directory: {}", e))
        })?;
    }

    // Find and delete the old file/directory (including .disabled variant)
    let old_path = shaderpacks_dir.join(&shaderpack.filename);
    let old_path_disabled = shaderpacks_dir.join(format!("{}.disabled", shaderpack.filename));

    let was_disabled = shaderpack.is_disabled;

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

    // Check and delete the old file/directory
    if old_path.exists() {
        debug!("Removing old shader pack: {}", old_path.display());
        if old_path.is_dir() {
            fs::remove_dir_all(&old_path).await.map_err(|e| {
                AppError::Other(format!("Failed to remove old shader pack directory: {}", e))
            })?;
        } else {
            fs::remove_file(&old_path).await.map_err(|e| {
                AppError::Other(format!("Failed to remove old shader pack file: {}", e))
            })?;
        }
    } else if old_path_disabled.exists() {
        debug!(
            "Removing old disabled shader pack: {}",
            old_path_disabled.display()
        );
        if old_path_disabled.is_dir() {
            fs::remove_dir_all(&old_path_disabled).await.map_err(|e| {
                AppError::Other(format!(
                    "Failed to remove old disabled shader pack directory: {}",
                    e
                ))
            })?;
        } else {
            fs::remove_file(&old_path_disabled).await.map_err(|e| {
                AppError::Other(format!(
                    "Failed to remove old disabled shader pack file: {}",
                    e
                ))
            })?;
        }
    } else {
        warn!("Old shader pack not found: {}", shaderpack.filename);
    }

    // Use the utility function to download the new content
    use crate::utils::profile_utils::{add_modrinth_content_to_profile, ContentType};

    // Download the new shader pack
    add_modrinth_content_to_profile(
        profile.id,
        new_version.project_id.clone(),
        new_version.id.clone(),
        primary_file.filename.clone(),
        primary_file.url.clone(),
        primary_file.hashes.sha1.clone(),
        Some(new_version.name.clone()),
        Some(new_version.version_number.clone()),
        ContentType::ShaderPack,
    )
    .await?;

    // If the old pack was disabled, disable the new one too
    if was_disabled {
        let new_path = shaderpacks_dir.join(&primary_file.filename);
        let new_path_disabled = shaderpacks_dir.join(format!("{}.disabled", primary_file.filename));

        debug!("Old pack was disabled, disabling new pack as well");

        // Handle both file and directory cases
        if new_path.is_dir() {
            // For directories, we need to rename them
            debug!(
                "Renaming directory to disabled: {} -> {}",
                new_path.display(),
                new_path_disabled.display()
            );
            fs::rename(&new_path, &new_path_disabled)
                .await
                .map_err(|e| {
                    AppError::Other(format!(
                        "Failed to disable new shader pack directory: {}",
                        e
                    ))
                })?;
        } else {
            debug!(
                "Renaming file to disabled: {} -> {}",
                new_path.display(),
                new_path_disabled.display()
            );
            fs::rename(&new_path, &new_path_disabled)
                .await
                .map_err(|e| {
                    AppError::Other(format!("Failed to disable new shader pack file: {}", e))
                })?;
        }
    }

    info!(
        "Successfully updated shader pack from '{}' to '{}'",
        shaderpack.filename, primary_file.filename
    );

    Ok(())
}
