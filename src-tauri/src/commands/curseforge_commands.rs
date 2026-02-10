use crate::error::{AppError, CommandError};
use crate::integrations::curseforge::{
    get_mods_by_ids, GetModsByIdsRequestBody, CurseForgeModsResponse, CurseForgeMod,
    import_curseforge_pack_as_profile, download_and_install_curseforge_modpack, get_file_changelog,
    get_mod_description
};
use crate::state::profile_state::default_profile_path;
use crate::utils::disk_space_utils::DiskSpaceUtils;
use serde::Serialize;
use std::path::PathBuf;

#[tauri::command]
pub async fn get_curseforge_mods_by_ids(
    mod_ids: Vec<u32>,
    filter_pc_only: Option<bool>,
) -> Result<CurseForgeModsResponse, CommandError> {
    log::debug!(
        "Received get_curseforge_mods_by_ids command for {} mod IDs",
        mod_ids.len()
    );

    let result = get_mods_by_ids(mod_ids, filter_pc_only)
        .await
        .map_err(CommandError::from)?;

    log::info!(
        "Successfully retrieved {} CurseForge mods",
        result.data.len()
    );

    Ok(result)
}


/// Import a CurseForge modpack as a new profile
#[tauri::command]
pub async fn import_curseforge_pack(pack_path: String) -> Result<String, CommandError> {
    log::debug!("Received import_curseforge_pack command for path: {}", pack_path);

    let path_buf = PathBuf::from(&pack_path);

    // Check if file exists
    if !path_buf.exists() {
        return Err(CommandError::from(AppError::Other(format!("Pack file does not exist: {}", pack_path))));
    }

    // Check if it's a file
    if !path_buf.is_file() {
        return Err(CommandError::from(AppError::Other(format!("Path is not a file: {}", pack_path))));
    }

    // Import the pack (without project_id/file_id for manually imported packs)
    let profile_id = import_curseforge_pack_as_profile(path_buf, None, None, None, 0.0, 1.0)
        .await
        .map_err(CommandError::from)?;

    log::info!("Successfully imported CurseForge pack as profile with ID: {}", profile_id);

    Ok(profile_id.to_string())
}

/// Download and install a CurseForge modpack from its URL
#[tauri::command]
pub async fn download_and_install_curseforge_modpack_command(
    project_id: u32,
    file_id: u32,
    file_name: String,
    download_url: String,
    icon_url: Option<String>,
    file_size: Option<u64>,
    event_id: Option<String>,
) -> Result<String, CommandError> {
    log::info!(
        "Executing download_and_install_curseforge_modpack for project {}, file {}, icon_url: {:?}, file_size: {:?}",
        project_id, file_id, icon_url, file_size
    );

    // Check disk space before downloading if file_size is known
    if let Some(size) = file_size {
        let estimated_required = size * 3; // 3x for download + extraction + mod downloads overhead
        let profiles_dir = default_profile_path();
        log::info!(
            "Checking disk space: file size = {} bytes, estimated required = {} bytes",
            size,
            estimated_required
        );
        DiskSpaceUtils::ensure_space_for_download(&profiles_dir, estimated_required, 0.1).await?;
    }

    // Parse event_id if provided
    let event_id_uuid = event_id.and_then(|id| uuid::Uuid::parse_str(&id).ok());

    let profile_id_uuid = download_and_install_curseforge_modpack(
        project_id,
        file_id,
        file_name,
        download_url,
        icon_url,
        event_id_uuid,
    )
    .await
    .map_err(|e| {
        log::error!("Failed to download and install CurseForge modpack: {}", e);
        CommandError::from(e)
    })?;

    log::info!(
        "Successfully downloaded and installed CurseForge modpack as profile with ID: {}",
        profile_id_uuid
    );

    Ok(profile_id_uuid.to_string())
}

/// Get changelog for a specific CurseForge file
/// Returns HTML formatted changelog
#[tauri::command]
pub async fn get_curseforge_file_changelog_command(
    mod_id: u32,
    file_id: u32,
) -> Result<String, CommandError> {
    log::debug!(
        "Received get_curseforge_file_changelog command: mod_id={}, file_id={}",
        mod_id, file_id
    );

    let changelog = get_file_changelog(mod_id, file_id)
        .await
        .map_err(CommandError::from)?;

    log::info!(
        "Successfully retrieved CurseForge changelog for mod {}/file {} (length: {} chars)",
        mod_id, file_id, changelog.len()
    );

    Ok(changelog)
}

/// Get full description for a CurseForge mod
/// Returns HTML formatted description
#[tauri::command]
pub async fn get_curseforge_mod_description_command(
    mod_id: u32,
) -> Result<String, CommandError> {
    log::debug!(
        "Received get_curseforge_mod_description command: mod_id={}",
        mod_id
    );

    let description = get_mod_description(mod_id)
        .await
        .map_err(CommandError::from)?;

    log::info!(
        "Successfully retrieved CurseForge description for mod {} (length: {} chars)",
        mod_id, description.len()
    );

    Ok(description)
}
