use crate::error::{AppError, CommandError};
use crate::integrations::norisk_packs::NoriskModEntryDefinition;
use crate::utils::file_utils;
use crate::utils::path_utils;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri_plugin_opener::OpenerExt;
use tokio::fs;


/// File information for log/crash report listings
#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: i64, // Unix timestamp
}

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

#[tauri::command]
pub async fn get_image_thumbnail(path: String, size: u32) -> Result<String, CommandError> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err(CommandError::from(AppError::FileNotFound(source)));
    }
    let size = size.clamp(32, 1024);
    let target = crate::utils::preview_cache::thumbnail_path(&source, size)
        .await
        .ok_or_else(|| CommandError::from(AppError::Other(format!("Could not read {}", path))))?;
    if target.is_file() {
        return Ok(target.to_string_lossy().into_owned());
    }
    let output = target.clone();
    tokio::task::spawn_blocking(move || crate::utils::preview_cache::create_thumbnail(&source, &output, size))
        .await
        .map_err(|e| CommandError::from(AppError::Other(format!("Thumbnail task failed: {e}"))))?
        .map_err(|e| CommandError::from(AppError::Other(format!("Could not create a thumbnail for {}: {}", path, e))))?;
    Ok(target.to_string_lossy().into_owned())
}

/// Lists all launcher log files from the logs directory
#[tauri::command]
pub async fn list_launcher_logs() -> Result<Vec<FileInfo>, CommandError> {
    use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};

    let logs_dir = LAUNCHER_DIRECTORY.root_dir().join("logs");
    info!("Listing launcher logs from: {:?}", logs_dir);

    if !logs_dir.exists() {
        debug!("Logs directory does not exist");
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    let mut entries = fs::read_dir(&logs_dir)
        .await
        .map_err(|e| CommandError::from(AppError::Io(e)))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| CommandError::from(AppError::Io(e)))?
    {
        let path = entry.path();
        if path.is_file() {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            // Include .log files and .log.X backup files (rotated logs)
            if name.ends_with(".log") || name.contains(".log.") {
                if let Ok(metadata) = entry.metadata().await {
                    let modified = metadata
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);

                    files.push(FileInfo {
                        path: path.to_string_lossy().to_string(),
                        name,
                        size: metadata.len(),
                        modified,
                    });
                }
            }
        }
    }

    // Sort by modified time (newest first)
    files.sort_by(|a, b| b.modified.cmp(&a.modified));

    info!("Found {} launcher log files", files.len());
    Ok(files)
}

/// Lists crash report files from all profiles, returns the 20 most recent
#[tauri::command]
pub async fn list_crash_reports() -> Result<Vec<FileInfo>, CommandError> {
    use crate::state::state_manager::State;

    info!("Listing crash reports from all profiles");

    let state = State::get().await?;
    let profiles = state.profile_manager.list_profiles().await?;

    let mut all_files = Vec::new();

    for profile in profiles {
        if let Ok(instance_path) = state
            .profile_manager
            .get_profile_instance_path(profile.id)
            .await
        {
            let crash_reports_dir = instance_path.join("crash-reports");

            if !crash_reports_dir.exists() {
                continue;
            }

            if let Ok(mut entries) = fs::read_dir(&crash_reports_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    if path.is_file() {
                        let name = path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();
                        // Only include crash-*.txt files
                        if name.starts_with("crash-") && name.ends_with(".txt") {
                            if let Ok(metadata) = entry.metadata().await {
                                let modified = metadata
                                    .modified()
                                    .ok()
                                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_secs() as i64)
                                    .unwrap_or(0);

                                all_files.push(FileInfo {
                                    path: path.to_string_lossy().to_string(),
                                    name,
                                    size: metadata.len(),
                                    modified,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort by modified time (newest first) and take top 20
    all_files.sort_by(|a, b| b.modified.cmp(&a.modified));
    all_files.truncate(20);

    info!("Found {} crash report files across all profiles", all_files.len());
    Ok(all_files)
}

/// Lists MC log files from all profiles, returns the 20 most recent
#[tauri::command]
pub async fn list_all_mc_logs() -> Result<Vec<FileInfo>, CommandError> {
    use crate::state::state_manager::State;

    info!("Listing MC logs from all profiles");

    let state = State::get().await?;
    let profiles = state.profile_manager.list_profiles().await?;

    let mut all_files = Vec::new();

    for profile in profiles {
        if let Ok(instance_path) = state
            .profile_manager
            .get_profile_instance_path(profile.id)
            .await
        {
            let logs_dir = instance_path.join("logs");

            if !logs_dir.exists() {
                continue;
            }

            if let Ok(mut entries) = fs::read_dir(&logs_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    if path.is_file() {
                        let name = path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();
                        // Include .log files and .log.gz files
                        if name.ends_with(".log") || name.ends_with(".log.gz") {
                            if let Ok(metadata) = entry.metadata().await {
                                let modified = metadata
                                    .modified()
                                    .ok()
                                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_secs() as i64)
                                    .unwrap_or(0);

                                all_files.push(FileInfo {
                                    path: path.to_string_lossy().to_string(),
                                    name,
                                    size: metadata.len(),
                                    modified,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort by modified time (newest first) and take top 20
    all_files.sort_by(|a, b| b.modified.cmp(&a.modified));
    all_files.truncate(20);

    info!("Found {} MC log files across all profiles", all_files.len());
    Ok(all_files)
}

/// Lists archived game-session process logs from {launcher_root}/logs/game/
#[tauri::command]
pub async fn list_process_logs() -> Result<Vec<FileInfo>, CommandError> {
    let archive_dir = crate::utils::log_archive::archive_root();
    info!("Listing archived process logs from: {:?}", archive_dir);

    if !archive_dir.exists() {
        return Ok(Vec::new());
    }

    let mut all_files = Vec::new();
    let mut sessions = fs::read_dir(&archive_dir)
        .await
        .map_err(|e| CommandError::from(AppError::Io(e)))?;

    while let Ok(Some(session)) = sessions.next_entry().await {
        let session_path = session.path();
        if !session_path.is_dir() {
            continue;
        }
        let session_name = session.file_name().to_string_lossy().to_string();
        let process_log = session_path.join("nrc-process.log");
        if !process_log.is_file() {
            continue;
        }
        if let Ok(metadata) = fs::metadata(&process_log).await {
            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            all_files.push(FileInfo {
                path: process_log.to_string_lossy().to_string(),
                name: session_name,
                size: metadata.len(),
                modified,
            });
        }
    }

    all_files.sort_by(|a, b| b.modified.cmp(&a.modified));

    info!("Found {} archived process logs", all_files.len());
    Ok(all_files)
}
