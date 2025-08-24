use crate::error::{AppError, CommandError};
use crate::integrations::norisk_packs::NoriskModEntryDefinition;
use crate::utils::file_utils;
use crate::utils::path_utils;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::ImageEncoder;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use tauri_plugin_opener::OpenerExt;
use tokio::fs;

// Imports for image processing
use fast_image_resize::images::Image as FirImage;
use fast_image_resize::{
    CpuExtensions, FilterType, ImageView as FirImageViewTrait, IntoImageView,
    PixelType as FirPixelType, ResizeAlg, Resizer,
};
use image::{
    codecs::{jpeg::JpegEncoder, png::PngEncoder},
    ColorType,
    DynamicImage,
    GenericImageView, // For getting dimensions from DynamicImage
    ImageFormat,
};
use std::io::Cursor; // For writing encoded image to a byte vector

/// Sets a file as enabled or disabled by adding or removing the .disabled extension
#[tauri::command]
pub async fn set_file_enabled(file_path: String, enabled: bool) -> Result<(), CommandError> {
    let input_path = PathBuf::from(&file_path);

    let input_filename_cow = input_path.file_name().unwrap_or_default().to_string_lossy();
    let input_filename = input_filename_cow.as_ref();
    let parent_dir = input_path.parent().unwrap_or_else(|| Path::new("")); // Handles case where input_path might be just a filename

    // Determine the true base name by stripping .disabled if it exists on the input filename
    let true_base_name = if input_filename.ends_with(".disabled") {
        input_filename
            .strip_suffix(".disabled")
            .unwrap_or(input_filename)
            .to_string()
    } else {
        input_filename.to_string()
    };

    info!(
        "Attempting to set file (true base name '{}' from input '{}') to enabled={}",
        true_base_name,
        input_path.display(),
        enabled
    );

    let path_if_enabled = parent_dir.join(&true_base_name); // e.g., /path/to/foo.zip
    let path_if_disabled = parent_dir.join(format!("{}.disabled", true_base_name)); // e.g., /path/to/foo.zip.disabled

    let current_path: PathBuf;
    let is_file_actually_disabled: bool;

    if path_if_enabled.exists() {
        current_path = path_if_enabled.clone();
        is_file_actually_disabled = false;
        debug!("Found file in its enabled form: {}", current_path.display());
    } else if path_if_disabled.exists() {
        current_path = path_if_disabled.clone();
        is_file_actually_disabled = true;
        debug!(
            "Found file in its disabled form: {}",
            current_path.display()
        );
    } else {
        let error_message = format!(
            "File not found: Neither '{}' nor '{}' exists.",
            path_if_enabled.display(),
            path_if_disabled.display()
        );
        log::error!("{}", error_message);
        return Err(CommandError::from(AppError::Other(error_message)));
    }

    // Check if the file is already in the desired state.
    // `enabled` is the target state (true for enabled, false for disabled).
    // `is_file_actually_disabled` is the current state (true if it ends with .disabled).
    // If target is enabled (enabled=true) AND file is NOT disabled (is_file_actually_disabled=false), it's already enabled.
    //   Condition: enabled == !is_file_actually_disabled  =>  true == !false  =>  true == true  => true.
    // If target is disabled (enabled=false) AND file IS disabled (is_file_actually_disabled=true), it's already disabled.
    //   Condition: enabled == !is_file_actually_disabled  =>  false == !true  =>  false == false => true.
    if enabled == !is_file_actually_disabled {
        debug!(
            "File '{}' is already in the desired state (current_is_disabled: {}, target_enabled: {}). No action needed.",
            current_path.display(),
            is_file_actually_disabled,
            enabled
        );
        return Ok(());
    }

    // Determine the new path based on the target 'enabled' state and the true_base_name.
    let new_path = if enabled {
        path_if_enabled // Target state is enabled, so use the path_if_enabled form
    } else {
        path_if_disabled // Target state is disabled, so use the path_if_disabled form
    };

    // This check is mostly a safeguard; the logic above should prevent current_path == new_path.
    if current_path == new_path {
        warn!(
            "Source path '{}' and target path '{}' are identical. This should have been caught by the 'already in desired state' check. No action needed.",
            current_path.display(),
            new_path.display()
        );
        return Ok(());
    }

    debug!(
        "Renaming file from '{}' to '{}'",
        current_path.display(),
        new_path.display()
    );

    // Rename the file
    fs::rename(&current_path, &new_path).await.map_err(|e| {
        log::error!(
            "Failed to rename file from '{}' to '{}': {}",
            current_path.display(),
            new_path.display(),
            e
        );
        CommandError::from(AppError::Io(e))
    })?;

    info!(
        "Successfully set file based on input '{}' (now at '{}') to enabled={}",
        input_path.display(), // Log original input for clarity
        new_path.display(),   // Log the new actual path
        enabled
    );
    Ok(())
}

/// Deletes a file from the filesystem. Handles cases where the input path might or might not
/// already have a .disabled extension, and will attempt to delete the corresponding file.
#[tauri::command]
pub async fn delete_file(file_path: String) -> Result<(), CommandError> {
    let input_path = PathBuf::from(&file_path);

    // Determine the parent directory and the effective base file name (without .disabled potentially)
    let parent_dir = input_path.parent().unwrap_or_else(|| Path::new("."));
    let input_file_name_cow = input_path.file_name().unwrap_or_default().to_string_lossy();
    let input_file_name = input_file_name_cow.as_ref();

    let effective_base_file_name = if input_file_name.ends_with(".disabled") {
        input_file_name
            .strip_suffix(".disabled")
            .unwrap_or(input_file_name)
    } else {
        input_file_name
    };

    info!(
        "Attempting to delete file based on effective base name: '{}' (from input '{}')",
        effective_base_file_name,
        input_path.display()
    );

    let path_enabled_version = parent_dir.join(effective_base_file_name);
    let path_disabled_version = parent_dir.join(format!("{}.disabled", effective_base_file_name));

    let actual_path_to_delete: PathBuf;

    if path_enabled_version.exists() {
        actual_path_to_delete = path_enabled_version;
        debug!(
            "Found file to delete (enabled form): {}",
            actual_path_to_delete.display()
        );
    } else if path_disabled_version.exists() {
        actual_path_to_delete = path_disabled_version;
        debug!(
            "Found file to delete (disabled form): {}",
            actual_path_to_delete.display()
        );
    } else {
        let error_message = format!(
            "File not found for deletion: Neither '{}' nor '{}' exists.",
            parent_dir.join(effective_base_file_name).display(),
            parent_dir
                .join(format!("{}.disabled", effective_base_file_name))
                .display()
        );
        log::error!("{}", error_message);
        return Err(CommandError::from(AppError::Other(error_message)));
    }

    // Check if it's a file or directory
    let metadata = fs::metadata(&actual_path_to_delete).await.map_err(|e| {
        log::error!(
            "Failed to get metadata for {}: {}",
            actual_path_to_delete.display(),
            e
        );
        CommandError::from(AppError::Io(e))
    })?;

    // Move to trash instead of hard delete
    let category = if metadata.is_dir() { Some("directories") } else { Some("files") };
    crate::utils::trash_utils::move_path_to_trash(&actual_path_to_delete, category)
        .await
        .map_err(CommandError::from)?;

    info!("Moved to trash: {}", actual_path_to_delete.display());
    Ok(())
}

/// Opens the directory containing a file
#[tauri::command]
pub async fn open_file_directory(
    app_handle: tauri::AppHandle,
    file_path: String,
) -> Result<(), CommandError> {
    let path = PathBuf::from(&file_path);
    info!("Opening directory for file: {}", path.display());

    if !path.exists() {
        return Err(CommandError::from(AppError::Other(format!(
            "File not found: {}",
            path.display()
        ))));
    }

    // Get the parent directory
    let parent_dir = match path.parent() {
        Some(parent) => parent,
        None => {
            return Err(CommandError::from(AppError::Other(
                "Could not determine parent directory".to_string(),
            )))
        }
    };

    debug!("Opening directory: {}", parent_dir.display());

    // Open the directory with the system file browser
    match app_handle
        .opener()
        .open_path(parent_dir.to_string_lossy(), None::<&str>)
    {
        Ok(_) => {
            info!("Successfully opened directory: {}", parent_dir.display());
            Ok(())
        }
        Err(e) => {
            info!("Failed to open directory {}: {}", parent_dir.display(), e);
            Err(CommandError::from(AppError::Other(format!(
                "Failed to open directory: {}",
                e
            ))))
        }
    }
}

/// Fetches the first PNG icon found within a list of archive files (.zip, .jar) as Base64 strings.
///
/// # Arguments
///
/// * `archive_paths` - A vector of strings representing the paths to the archive files.
///
/// # Returns
///
/// A `Result` containing a `HashMap` where keys are the original file paths
/// and values are `Option<String>`. The value is `Some(base64_string)` if a PNG
/// was found, and `None` otherwise (or if an error occurred for that specific file).
#[tauri::command]
pub async fn get_icons_for_archives(
    archive_paths: Vec<String>,
) -> Result<HashMap<String, Option<String>>, CommandError> {
    info!("Fetching icons for {} archives...", archive_paths.len());
    let mut results_map: HashMap<String, Option<String>> = HashMap::new();

    for path_str in archive_paths {
        let archive_path = Path::new(&path_str);
        let result = file_utils::find_first_png_in_archive_as_base64(archive_path).await;

        match result {
            Ok(base64_icon) => {
                debug!("Icon found for: {}", path_str);
                results_map.insert(path_str, Some(base64_icon));
            }
            Err(AppError::PngNotFoundInArchive(_)) => {
                debug!("No PNG icon found in archive: {}", path_str);
                results_map.insert(path_str, None);
            }
            Err(AppError::FileNotFound(_)) => {
                warn!("Archive file not found: {}", path_str);
                results_map.insert(path_str, None); // File not found is not an error, just no icon
            }
            Err(AppError::ArchiveReadError(msg)) => {
                error!("Error reading archive {}: {}", path_str, msg);
                results_map.insert(path_str, None); // Insert None on error for this specific file
            }
            Err(e) => {
                error!("Unexpected error processing archive {}: {}", path_str, e);
                results_map.insert(path_str, None); // Insert None on unexpected error
            }
        }
    }

    info!(
        "Finished fetching icons. Returning {} results.",
        results_map.len()
    );
    Ok(results_map)
}

/// Fetches the first PNG icon found within Norisk Pack mods as Base64 strings.
///
/// # Arguments
///
/// * `mods` - A vector of NoriskModEntryDefinition structs
/// * `minecraft_version` - The Minecraft version to use for compatibility check
/// * `loader` - The mod loader (fabric/forge) to use for compatibility check
///
/// # Returns
///
/// A `Result` containing a `HashMap` where keys are the mod IDs
/// and values are `Option<String>`. The value is `Some(base64_string)` if a PNG
/// was found, and `None` otherwise (or if an error occurred for that specific mod).
#[tauri::command]
pub async fn get_icons_for_norisk_mods(
    mods: Vec<NoriskModEntryDefinition>,
    minecraft_version: String,
    loader: String,
) -> Result<HashMap<String, Option<String>>, CommandError> {
    info!("Fetching icons for {} Norisk Pack mods...", mods.len());
    let mut results_map: HashMap<String, Option<String>> = HashMap::new();

    // Sammle alle Mod-Cache-Pfade
    let mut mod_paths: Vec<(String, String)> = Vec::new(); // (mod_id, file_path)

    for mod_entry in &mods {
        match path_utils::get_norisk_mod_cache_path(mod_entry, &minecraft_version, &loader) {
            Ok(path) => {
                mod_paths.push((mod_entry.id.clone(), path.to_string_lossy().to_string()));
            }
            Err(e) => {
                warn!("Could not get cache path for mod {}: {}", mod_entry.id, e);
                results_map.insert(mod_entry.id.clone(), None); // Mod nicht gefunden, kein Icon
            }
        }
    }

    // Extrahiere Icons für jeden Mod aus dem Cache
    for (mod_id, path_str) in mod_paths {
        let archive_path = Path::new(&path_str);
        let result = file_utils::find_first_png_in_archive_as_base64(archive_path).await;

        match result {
            Ok(base64_icon) => {
                debug!("Icon found for mod {}", mod_id);
                results_map.insert(mod_id, Some(base64_icon));
            }
            Err(AppError::PngNotFoundInArchive(_)) => {
                debug!("No PNG icon found in archive for mod {}", mod_id);
                results_map.insert(mod_id, None);
            }
            Err(AppError::FileNotFound(_)) => {
                warn!("Archive file not found for mod {}: {}", mod_id, path_str);
                results_map.insert(mod_id, None);
            }
            Err(e) => {
                error!("Error processing archive for mod {}: {}", mod_id, e);
                results_map.insert(mod_id, None);
            }
        }
    }

    info!(
        "Finished fetching Norisk mod icons. Returning {} results.",
        results_map.len()
    );
    Ok(results_map)
}

/// Opens a specified file using the system's default application.
/// Requires appropriate scope permissions in capabilities.
#[tauri::command]
pub async fn open_file(
    app_handle: tauri::AppHandle,
    file_path: String,
) -> Result<(), CommandError> {
    let path = PathBuf::from(&file_path);
    info!("Attempting to open file: {}", path.display());

    // Check if the path exists and is a file
    if !path.exists() {
        error!("File not found: {}", path.display());
        return Err(CommandError::from(AppError::FileNotFound(path)));
    }
    if !path.is_file() {
        error!("Path is not a file: {}", path.display());
        return Err(CommandError::from(AppError::Other(format!(
            "Path is not a file: {}",
            path.display()
        ))));
    }

    // Open the file using the opener plugin
    match app_handle
        .opener()
        .open_path(path.to_string_lossy(), None::<&str>)
    {
        Ok(_) => {
            info!("Successfully requested opening file: {}", path.display());
            Ok(())
        }
        Err(e) => {
            // Log the specific error from the opener plugin
            error!("Failed to open file {} using opener: {}", path.display(), e);
            // Check for permission denied error specifically if possible (depends on plugin error type)
            // For now, return a generic error
            Err(CommandError::from(AppError::Other(format!(
                "Failed to open file: {}. Check permissions.",
                e // Include the original error message
            ))))
        }
    }
}

/// Reads the content of a file as raw bytes.
#[tauri::command]
pub async fn read_file_bytes(file_path: String) -> Result<Vec<u8>, CommandError> {
    let path = PathBuf::from(&file_path);
    debug!("Reading bytes from file: {}", path.display());

    if !path.exists() {
        error!("File not found for reading bytes: {}", path.display());
        return Err(CommandError::from(AppError::FileNotFound(path)));
    }
    if !path.is_file() {
        error!("Path is not a file for reading bytes: {}", path.display());
        return Err(CommandError::from(AppError::Other(format!(
            "Path is not a file: {}",
            path.display()
        ))));
    }

    // Read the file content into a vector of bytes
    fs::read(&path).await.map_err(|e| {
        error!("Failed to read file bytes {}: {}", path.display(), e);
        CommandError::from(AppError::Io(e))
    })
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ImagePreviewPayload {
    path: String,
    width: Option<u32>,  // Target width for the preview
    height: Option<u32>, // Target height for the preview
    quality: Option<u8>, // Target quality (e.g., 1-100 for JPEG)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImagePreviewResponse {
    base64_image: String,
    original_width: u32,
    original_height: u32,
    preview_width: u32,
    preview_height: u32,
}

#[tauri::command]
pub async fn get_image_preview(
    payload: ImagePreviewPayload,
) -> Result<ImagePreviewResponse, CommandError> {
    info!(
        "Received request to generate image preview for path: '{}', target_width: {:?}, target_height: {:?}, target_quality: {:?}",
        payload.path, payload.width, payload.height, payload.quality
    );

    let image_path = PathBuf::from(&payload.path);

    if !image_path.exists() {
        let error_msg = format!("Image file not found: {}", image_path.display());
        error!("{}", error_msg);
        return Err(CommandError::from(AppError::FileNotFound(image_path)));
    }
    if !image_path.is_file() {
        let error_msg = format!("Path is not a file: {}", image_path.display());
        error!("{}", error_msg);
        return Err(CommandError::from(AppError::Other(error_msg)));
    }

    // Read the original image bytes
    let image_bytes = match fs::read(&image_path).await {
        Ok(bytes) => bytes,
        Err(e) => {
            let error_msg = format!("Failed to read image file {}: {}", image_path.display(), e);
            error!("{}", error_msg);
            return Err(CommandError::from(AppError::Io(e)));
        }
    };

    // Load image using the 'image' crate for broad format support and metadata
    let img: DynamicImage = match image::load_from_memory(&image_bytes) {
        Ok(img) => img,
        Err(e) => {
            let error_msg = format!(
                "Failed to decode image from memory (path: '{}'): {}",
                payload.path, e
            );
            error!("{}", error_msg);
            return Err(CommandError::from(AppError::Other(error_msg)));
        }
    };

    let original_width = img.width();
    let original_height = img.height();

    // Manually construct FirImageView from DynamicImage parts
    let (image_buffer_vec, fir_pixel_type, original_width_nz, original_height_nz) = match &img {
        // Match on reference to DynamicImage
        DynamicImage::ImageRgba8(rgba_img_buf) => (
            rgba_img_buf.to_vec(), // Get owned Vec<u8>
            FirPixelType::U8x4,
            NonZeroU32::new(rgba_img_buf.width()).ok_or_else(|| {
                CommandError::from(AppError::Other(
                    "Width cannot be zero for RGBA8".to_string(),
                ))
            })?,
            NonZeroU32::new(rgba_img_buf.height()).ok_or_else(|| {
                CommandError::from(AppError::Other(
                    "Height cannot be zero for RGBA8".to_string(),
                ))
            })?,
        ),
        DynamicImage::ImageRgb8(rgb_img_buf) => (
            rgb_img_buf.to_vec(),
            FirPixelType::U8x3,
            NonZeroU32::new(rgb_img_buf.width()).ok_or_else(|| {
                CommandError::from(AppError::Other("Width cannot be zero for RGB8".to_string()))
            })?,
            NonZeroU32::new(rgb_img_buf.height()).ok_or_else(|| {
                CommandError::from(AppError::Other(
                    "Height cannot be zero for RGB8".to_string(),
                ))
            })?,
        ),
        DynamicImage::ImageLuma8(luma_img_buf) => (
            luma_img_buf.to_vec(),
            FirPixelType::U8,
            NonZeroU32::new(luma_img_buf.width()).ok_or_else(|| {
                CommandError::from(AppError::Other(
                    "Width cannot be zero for Luma8".to_string(),
                ))
            })?,
            NonZeroU32::new(luma_img_buf.height()).ok_or_else(|| {
                CommandError::from(AppError::Other(
                    "Height cannot be zero for Luma8".to_string(),
                ))
            })?,
        ),
        DynamicImage::ImageLumaA8(luma_alpha_img_buf) => (
            luma_alpha_img_buf.to_vec(),
            FirPixelType::U8x2,
            NonZeroU32::new(luma_alpha_img_buf.width()).ok_or_else(|| {
                CommandError::from(AppError::Other(
                    "Width cannot be zero for LumaA8".to_string(),
                ))
            })?,
            NonZeroU32::new(luma_alpha_img_buf.height()).ok_or_else(|| {
                CommandError::from(AppError::Other(
                    "Height cannot be zero for LumaA8".to_string(),
                ))
            })?,
        ),
        _ => {
            // Fallback for other formats: convert to RGBA8
            let rgba_img_buf = img.to_rgba8(); // This creates an owned ImageBuffer
            let w = NonZeroU32::new(rgba_img_buf.width()).ok_or_else(|| {
                CommandError::from(AppError::Other(
                    "Width cannot be zero for fallback RGBA8".to_string(),
                ))
            })?;
            let h = NonZeroU32::new(rgba_img_buf.height()).ok_or_else(|| {
                CommandError::from(AppError::Other(
                    "Height cannot be zero for fallback RGBA8".to_string(),
                ))
            })?;
            (rgba_img_buf.into_raw(), FirPixelType::U8x4, w, h)
        }
    };

    let src_fir_view = fast_image_resize::images::Image::from_vec_u8(
        original_width_nz.get(),
        original_height_nz.get(),
        image_buffer_vec, // Pass a slice of the owned Vec
        fir_pixel_type,
    )
    .map_err(|e| {
        CommandError::from(AppError::Other(format!(
            "Failed to create source ImageView: {}",
            e
        )))
    })?;

    // Determine target dimensions for preview
    let target_w = payload.width.unwrap_or(200); // Default preview width
    let target_h = payload.height.unwrap_or(200); // Default preview height

    // Create destination image for fast_image_resize
    let mut dst_fir_image = FirImage::new(target_w, target_h, src_fir_view.pixel_type());

    // Create a resizer
    let mut resizer = Resizer::new();
    // Optional: Configure CPU extensions if needed, though default should be fine.
    // resizer.set_cpu_extensions(CpuExtensions::Sse4_1);

    // Select resize algorithm - Lanczos3 offers good quality
    // For higher performance with slightly less quality, one could use Bilinear or even Box.
    // E.g., ResizeAlg::Bilinear or ResizeAlg::Convolution(FilterType::Box)
    let algorithm = ResizeAlg::Convolution(FilterType::Lanczos3);

    let resize_options = fast_image_resize::ResizeOptions::default(); // Create an owned instance
    match resizer.resize(&src_fir_view, &mut dst_fir_image, Some(&resize_options)) {
        // Pass a reference to it
        Ok(_) => {}
        Err(e) => {
            let error_msg = format!(
                "Failed to resize image from '{}' using fast_image_resize: {}",
                payload.path, e
            );
            error!("{}", error_msg);
            return Err(CommandError::from(AppError::Other(error_msg)));
        }
    }

    let preview_width = dst_fir_image.width();
    let preview_height = dst_fir_image.height();

    // Encode the resized image (dst_fir_image.buffer()) into PNG or JPEG format
    let mut encoded_image_bytes = Vec::new();
    let cursor = Cursor::new(&mut encoded_image_bytes);

    // Use original image's color type for encoding the resized buffer.
    // Note: fast_image_resize might change pixel type (e.g. to U8x4 for RGBA).
    // We should use the dst_fir_image.pixel_type() and map it to image::ColorType.
    let output_color_type = match dst_fir_image.pixel_type() {
        FirPixelType::U8 => ColorType::L8,
        FirPixelType::U8x2 => ColorType::La8,
        FirPixelType::U8x3 => ColorType::Rgb8,
        FirPixelType::U8x4 => ColorType::Rgba8,
        FirPixelType::U16 => ColorType::L16,
        FirPixelType::U16x2 => ColorType::La16,
        FirPixelType::U16x3 => ColorType::Rgb16,
        FirPixelType::U16x4 => ColorType::Rgba16,
        // Add other mappings as necessary if you support more pixel types
        _ => {
            let error_msg = format!(
                "Unsupported pixel type after resize: {:?}",
                dst_fir_image.pixel_type()
            );
            error!("{}", error_msg);
            return Err(CommandError::from(AppError::Other(error_msg)));
        }
    };

    // Guess original format for choosing encoder, or default to PNG
    let original_format = image::guess_format(&image_bytes).unwrap_or(ImageFormat::Png);

    match original_format {
        ImageFormat::Jpeg => {
            let quality = payload.quality.unwrap_or(75).clamp(1, 100); // Default quality 75 for JPEG
            let encoder = JpegEncoder::new_with_quality(cursor, quality);
            if let Err(e) = encoder.write_image(
                dst_fir_image.buffer(),
                preview_width,
                preview_height,
                output_color_type.into(),
            ) {
                let error_msg = format!(
                    "Failed to encode JPEG preview for '{}': {}",
                    payload.path, e
                );
                error!("{}", error_msg);
                return Err(CommandError::from(AppError::Other(error_msg)));
            }
        }
        ImageFormat::Png | _ => {
            // Default to PNG for other formats or if guessing failed
            let encoder = PngEncoder::new(cursor);
            if let Err(e) = encoder.write_image(
                dst_fir_image.buffer(),
                preview_width,
                preview_height,
                output_color_type.into(),
            ) {
                let error_msg =
                    format!("Failed to encode PNG preview for '{}': {}", payload.path, e);
                error!("{}", error_msg);
                return Err(CommandError::from(AppError::Other(error_msg)));
            }
        }
    }

    let base64_image = STANDARD.encode(&encoded_image_bytes);

    info!(
        "Successfully generated preview for: '{}' (original: {}x{}, preview: {}x{})",
        payload.path, original_width, original_height, preview_width, preview_height
    );

    Ok(ImagePreviewResponse {
        base64_image,
        original_width,
        original_height,
        preview_width,
        preview_height,
    })
}
