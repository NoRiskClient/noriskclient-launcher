use crate::config::{ProjectDirsExt, HTTP_CLIENT, LAUNCHER_DIRECTORY};
use crate::error::{AppError, CommandError};
#[cfg(desktop)]
use crate::state::profile_state::{ImageSource, ProfileBanner};
use crate::state::state_manager::State;
use log::{debug, error, info, warn};
use serde::Deserialize;
use std::path::PathBuf;
use tauri::command;
use uuid::Uuid;

type Result<T> = std::result::Result<T, CommandError>;

/// Payload for the upload_profile_icon command.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UploadProfileImagesPayload {
    pub path: Option<String>,     // Source path of the image file
    pub profile_id: Uuid,         // UUID of the profile
    pub icon_url: Option<String>, // Optional URL to download the icon from
    pub image_type: String,       // Type of image (e.g., "icon", "background")
}

/// Returns the root launcher directory path
#[command]
pub async fn get_launcher_directory() -> Result<String> {
    let path = LAUNCHER_DIRECTORY.root_dir();
    debug!("Returning launcher directory: {:?}", path);
    Ok(path.to_string_lossy().to_string())
}

#[cfg(desktop)]
/// Resolves an image path from various source types to an absolute file:// URL
/// This handles different ImageSource types and returns a format suitable for web display
#[command]
pub async fn resolve_image_path(
    image_source: ImageSource,
    profile_id: Option<String>,
) -> Result<String> {
    debug!(
        "Resolving image path: {:?} for profile: {:?}",
        image_source, profile_id
    );

    match image_source {
        // URL: Already in web-compatible format, just return
        ImageSource::Url { url } => {
            debug!("Using direct URL: {}", url);
            Ok(url)
        }

        // Base64: Format as a data URI
        ImageSource::Base64 { data, mime_type } => {
            let mime = mime_type.unwrap_or_else(|| "image/png".to_string());
            debug!("Using Base64 data with MIME type: {}", mime);

            // Ensure data is properly formatted (no line breaks, etc.)
            let clean_data = data.replace("\n", "").replace("\r", "").replace(" ", "");

            // Return as a properly formatted data URI
            Ok(format!("data:{};base64,{}", mime, clean_data))
        }

        // RelativePath: Relative to launcher directory
        ImageSource::RelativePath { path } => {
            let launcher_dir = LAUNCHER_DIRECTORY.root_dir();
            let full_path = launcher_dir.join(path);

            debug!("Resolved relative path to: {:?}", full_path);
            if !full_path.exists() {
                error!("Image file does not exist: {:?}", full_path);
                // Return an error instead of a fallback image
                return Err(
                    AppError::Other(format!("Image file does not exist: {:?}", full_path)).into(),
                );
            }

            Ok(full_path.to_string_lossy().to_string())
        }

        // RelativeProfile: Relative to profile directory
        ImageSource::RelativeProfile { path } => {
            // We need a profile ID for this type
            if profile_id.is_none() {
                error!("Profile ID is required for relativeProfile image source");
                return Err(AppError::Other(
                    "Profile ID is required for relativeProfile image source".to_string(),
                )
                .into());
            }

            let state = State::get().await?;
            let profile_manager = &state.profile_manager;

            // Parse UUID
            let profile_uuid = match uuid::Uuid::parse_str(&profile_id.unwrap()) {
                Ok(uuid) => uuid,
                Err(e) => {
                    error!("Failed to parse profile UUID: {}", e);
                    return Err(
                        AppError::Other(format!("Failed to parse profile UUID: {}", e)).into(),
                    );
                }
            };

            // Get profile path
            let profile_path = profile_manager
                .get_profile_instance_path(profile_uuid)
                .await?;
            let full_path = profile_path.join(path);

            debug!("Resolved profile-relative path to: {:?}", full_path);
            if !full_path.exists() {
                error!("Image file does not exist: {:?}", full_path);
                return Err(
                    AppError::Other(format!("Image file does not exist: {:?}", full_path)).into(),
                );
            }

            Ok(full_path.to_string_lossy().to_string())
        }

        // AbsolutePath: Already a complete path, just convert to URL
        ImageSource::AbsolutePath { path } => {
            let path_buf = PathBuf::from(path);

            debug!("Using absolute path: {:?}", path_buf);
            if !path_buf.exists() {
                error!("Image file does not exist: {:?}", path_buf);
                return Err(
                    AppError::Other(format!("Image file does not exist: {:?}", path_buf)).into(),
                );
            }

            Ok(path_buf.to_string_lossy().to_string())
        }
    }
}

#[cfg(desktop)]
/// Uploads an image as a profile icon, copying it to a standard location within the profile's directory.
/// Returns the relative path to the icon within the profile directory.
#[command]
pub async fn upload_profile_images(payload: UploadProfileImagesPayload) -> Result<String> {
    debug!("Uploading profile image with payload: {:?}", payload);

    let state = State::get().await?;

    let profile_uuid = payload.profile_id;
    let image_type = &payload.image_type; // Get the image type

    let profile_manager = &state.profile_manager;
    let profile_instance_path = profile_manager
        .get_profile_instance_path(profile_uuid)
        .await?;

    let target_sub_dir_name = "NoRiskClientLauncher";
    // Dynamically determine filename based on image_type and extension
    // Default extension if not found
    let mut extension = ".png".to_string();

    // Attempt to get extension from path or URL
    if let Some(local_path_str) = &payload.path {
        if let Some(ext) = PathBuf::from(local_path_str)
            .extension()
            .and_then(|os_str| os_str.to_str())
        {
            extension = format!(".{}", ext);
        }
    } else if let Some(url_str) = &payload.icon_url {
        if let Ok(url_path) = url::Url::parse(url_str).map(|u| PathBuf::from(u.path())) {
            if let Some(ext) = url_path.extension().and_then(|os_str| os_str.to_str()) {
                extension = format!(".{}", ext);
            }
        }
    }

    let target_image_filename = format!("{}{}", image_type, extension);

    let target_dir = profile_instance_path.join(target_sub_dir_name);
    let target_file_path = target_dir.join(&target_image_filename); // Use new filename

    if !target_dir.exists() {
        info!(
            "Target directory {:?} does not exist, creating.",
            target_dir
        );
        tokio::fs::create_dir_all(&target_dir)
            .await
            .map_err(|e| AppError::Io(e))?;
    }

    // Determine the source path: either from local path, downloaded URL, or None
    let mut temp_file_to_delete: Option<PathBuf> = None;
    let effective_src_path: Option<PathBuf> = if let Some(local_path_str) = payload.path {
        Some(PathBuf::from(local_path_str))
    } else if let Some(url_str) = payload.icon_url {
        info!("Downloading image from URL: {}", url_str);
        let response = HTTP_CLIENT.get(&url_str).send().await.map_err(|e| {
            error!("Failed to download image from URL {}: {}", url_str, e);
            AppError::RequestError(e.to_string())
        })?;

        if !response.status().is_success() {
            error!(
                "Failed to download image: URL {} returned status {}",
                url_str,
                response.status()
            );
            return Err(
                AppError::Other(format!("Download failed: HTTP {}", response.status())).into(),
            );
        }

        let temp_dir = LAUNCHER_DIRECTORY.cache_dir();
        if !temp_dir.exists() {
            tokio::fs::create_dir_all(&temp_dir)
                .await
                .map_err(|e| AppError::Io(e))?;
        }
        // Create a unique temporary filename
        let temp_filename = format!("{}.tmp_image", Uuid::new_v4()); // Generic term "image"
        let temp_path = temp_dir.join(temp_filename);

        let file_bytes = response.bytes().await.map_err(|e| {
            error!(
                "Failed to read bytes from downloaded image {}: {}",
                url_str, e
            );
            AppError::RequestError(e.to_string())
        })?;

        tokio::fs::write(&temp_path, file_bytes)
            .await
            .map_err(|e| {
                error!(
                    "Failed to write downloaded image to temporary file {:?}: {}",
                    temp_path, e
                );
                AppError::Io(e)
            })?;

        info!(
            "Successfully downloaded image to temporary file: {:?}",
            temp_path
        );
        temp_file_to_delete = Some(temp_path.clone()); // Mark for deletion
        Some(temp_path)
    } else {
        None // Neither local path nor URL provided
    };

    if let Some(src_path) = effective_src_path {
        if !src_path.exists() {
            error!("Source image path does not exist: {:?}", src_path);
            return Err(AppError::FileNotFound(src_path).into());
        }
        if !src_path.is_file() {
            error!("Source path is not a file: {:?}", src_path);
            return Err(AppError::InvalidInput(format!(
                "Source path is not a file: {:?}",
                src_path
            ))
            .into());
        }

        info!(
            "Copying profile image from {:?} to {:?}",
            src_path, target_file_path
        );
        let copy_result = tokio::fs::copy(&src_path, &target_file_path).await;

        // Always attempt to clean up the temporary file if one was created,
        // regardless of copy success or failure.
        if let Some(temp_path_to_clean) = &temp_file_to_delete {
            // Use & to borrow
            if let Err(e) = tokio::fs::remove_file(temp_path_to_clean).await {
                // Borrow here again
                warn!(
                    "Failed to delete temporary image file {:?}: {}",
                    temp_path_to_clean, e
                );
            } else {
                info!(
                    "Successfully deleted temporary image file {:?}",
                    temp_path_to_clean
                );
            }
        }

        // Now handle the copy result
        copy_result.map_err(|e| {
            error!(
                "Failed to copy profile image from {:?} to {:?}: {}",
                src_path, target_file_path, e
            );
            AppError::Io(e)
        })?;

        info!(
            "Successfully copied profile image to {:?}",
            target_file_path
        );
    } else {
        info!("No source path or URL provided for profile image upload for profile {}. Ensuring directory exists and profile will point to standard image path.", payload.profile_id);
    }

    let relative_image_path_str = PathBuf::from(target_sub_dir_name)
        .join(&target_image_filename) // Use new filename
        .to_string_lossy()
        .to_string();

    // Update the profile to use this new image path
    let mut profile = profile_manager.get_profile(profile_uuid).await?;

    let new_image_source = ImageSource::RelativeProfile {
        path: relative_image_path_str.clone(),
    };
    let new_banner_source = ProfileBanner {
        source: new_image_source,
    };

    if image_type == "icon" {
        profile.banner = Some(new_banner_source);
        info!(
            "Successfully updated profile {} to use icon at relative path: {}",
            profile_uuid, relative_image_path_str
        );
    } else if image_type == "background" {
        profile.background = Some(new_banner_source);
        info!(
            "Successfully updated profile {} to use background at relative path: {}",
            profile_uuid, relative_image_path_str
        );
    } else {
        // Handle other types or default behavior if necessary
        warn!("Unknown image type '{}' for profile {}. Image saved but not linked in standard fields.", image_type, profile_uuid);
    }

    profile_manager
        .update_profile(profile_uuid, profile)
        .await?;

    Ok(relative_image_path_str)
}
