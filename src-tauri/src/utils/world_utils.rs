use crate::error::{AppError, Result};
use crate::state::State;
use fastnbt::{from_bytes, to_bytes, Value};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use fs4::tokio::AsyncFileExt;
use fs_extra::dir::{copy as copy_dir, CopyOptions};
use log::{error, info, warn};
use sanitize_filename;
use std::path::Path;
use tokio::fs;
use uuid::Uuid;

/// Generates a unique, sanitized folder name for a world within a given saves directory.
///
/// Takes a desired display name, sanitizes it for use as a folder name, and appends
/// a counter (e.g., " (1)") if a folder with that name already exists, until a unique
/// name is found.
///
/// # Arguments
/// * `target_saves_path` - The absolute path to the 'saves' directory where the world folder should reside.
/// * `desired_name` - The desired display name for the world.
///
/// # Returns
/// A `Result` containing the unique, sanitized folder name string, or an `AppError`.
pub async fn find_unique_world_folder_name(
    target_saves_path: &Path,
    desired_name: &str,
) -> Result<String> {
    info!(
        "Finding unique world folder name for '{}' in directory '{}'",
        desired_name,
        target_saves_path.display()
    );

    // Sanitize the desired name to create a base folder name
    let base_folder_name = sanitize_filename::sanitize(desired_name.trim());

    if base_folder_name.is_empty() {
        error!("Desired world name resulted in an empty sanitized folder name.");
        // Fallback to a default name if sanitization leads to empty string
        // This could happen with names consisting only of invalid characters.
        // Consider generating a UUID-based name or similar as a robust fallback.
        // For now, let's try a simple default.
        let default_base = "New_World".to_string();
        warn!("Falling back to default base folder name: {}", default_base);
        // We still need to ensure uniqueness for the default name
        // Box the recursive call to give it a known size
        return Box::pin(find_unique_world_folder_name(
            target_saves_path,
            &default_base,
        ))
        .await;
    }

    let initial_path = target_saves_path.join(&base_folder_name);

    // Check the base name first
    match fs::try_exists(&initial_path).await {
        Ok(false) => {
            info!("Sanitized folder name '{}' is unique.", base_folder_name);
            return Ok(base_folder_name);
        }
        Ok(true) => {
            info!(
                "Path '{}' already exists, starting counter.",
                initial_path.display()
            );
        }
        Err(e) => {
            error!(
                "Error checking path existence for '{}': {}",
                initial_path.display(),
                e
            );
            return Err(AppError::Io(e));
        }
    }

    // If base name exists, append counter
    let mut counter = 1u32;
    loop {
        // Create suffixed name like "Base Name (1)"
        let suffixed_folder_name = format!("{} ({})", base_folder_name, counter);
        let candidate_path = target_saves_path.join(&suffixed_folder_name);
        // info!("Checking candidate path: {}", candidate_path.display()); // Reduce log verbosity

        match fs::try_exists(&candidate_path).await {
            Ok(false) => {
                info!("Found unique folder name: '{}'", suffixed_folder_name);
                return Ok(suffixed_folder_name);
            }
            Ok(true) => {
                counter = counter.checked_add(1).ok_or_else(|| {
                    error!(
                        "Counter overflow finding unique folder name for '{}'",
                        base_folder_name
                    );
                    AppError::Other(format!(
                        "Counter overflow for base name '{}'",
                        base_folder_name
                    ))
                })?;

                // Safety limit
                if counter > 1000 {
                    error!(
                        "Could not find unique folder name for '{}' after {} attempts.",
                        base_folder_name, counter
                    );
                    return Err(AppError::Other(format!(
                        "Too many folders with similar names starting '{}'",
                        base_folder_name
                    )));
                }
            }
            Err(e) => {
                error!(
                    "Error checking candidate path '{}': {}",
                    candidate_path.display(),
                    e
                );
                return Err(AppError::Io(e));
            }
        }
    }
}

/// Copies a singleplayer world directory from a source profile to a target profile.
///
/// # Arguments
///
/// * `source_profile_id` - UUID of the profile containing the source world.
/// * `source_world_folder` - The name of the world folder within the source profile's 'saves' directory.
/// * `target_profile_id` - UUID of the profile where the world should be copied to.
/// * `target_world_name` - The desired display name for the world in the target profile. A unique folder name will be generated.
///
/// # Returns
///
/// Returns `Ok(String)` with the generated target folder name on success, or an `AppError` variant on failure.
pub async fn copy_world_directory(
    source_profile_id: Uuid,
    source_world_folder: &str,
    target_profile_id: Uuid,
    target_world_name: &str,
) -> Result<String> {
    info!(
        "Attempting to copy world '{}' from profile {} to profile {} with desired name '{}'",
        source_world_folder, source_profile_id, target_profile_id, target_world_name
    );

    // Sanitize folder names (basic check)
    if source_world_folder.is_empty()
        || target_world_name.is_empty()
        || source_world_folder.contains('/')
        || source_world_folder.contains('\\')
    {
        error!("Invalid source world folder name or empty target name provided.");
        return Err(AppError::InvalidInput(
            "Source folder name invalid or target name empty.".to_string(),
        ));
    }

    let state = State::get().await?;
    let profile_manager = &state.profile_manager;

    // --- Calculate Paths & Generate Target Folder Name ---
    let source_instance_path = profile_manager
        .get_profile_instance_path(source_profile_id)
        .await?;
    let source_saves_path = source_instance_path.join("saves");
    let source_world_path = source_saves_path.join(source_world_folder);

    let target_instance_path = profile_manager
        .get_profile_instance_path(target_profile_id)
        .await?;
    let target_saves_path = target_instance_path.join("saves");

    // Ensure target saves directory exists *before* finding unique name
    info!(
        "Ensuring target saves directory exists: {}",
        target_saves_path.display()
    );
    fs::create_dir_all(&target_saves_path).await.map_err(|e| {
        error!("Failed to create target saves directory: {}", e);
        AppError::Io(e)
    })?;

    // Find a unique folder name in the target saves directory
    let final_target_folder_name =
        find_unique_world_folder_name(&target_saves_path, target_world_name).await?;
    let target_world_path = target_saves_path.join(&final_target_folder_name);

    info!("Source world path: {}", source_world_path.display());
    info!(
        "Target world path (generated folder): {}",
        target_world_path.display()
    );

    // --- Validate Source (Target is implicitly validated by find_unique_world_folder_name) ---
    if !source_world_path.is_dir() {
        error!(
            "Source world directory not found: {}",
            source_world_path.display()
        );
        return Err(AppError::WorldNotFound {
            profile_id: source_profile_id,
            world_folder: source_world_folder.to_string(),
        });
    }
    if !source_world_path.join("level.dat").is_file() {
        error!(
            "Source world level.dat not found: {}",
            source_world_path.display()
        );
        return Err(AppError::WorldNotFound {
            profile_id: source_profile_id,
            world_folder: source_world_folder.to_string(),
        });
    }

    // --- Check Session Lock ---
    if let Err(e) = check_world_session_lock(&source_world_path).await {
        // If it's the specific WorldLocked error, enhance it with correct IDs
        if let AppError::WorldLocked { .. } = e {
            error!(
                "Source world '{}' in profile {} is currently locked.",
                source_world_folder, source_profile_id
            );
            return Err(AppError::WorldLocked {
                profile_id: source_profile_id,
                world_folder: source_world_folder.to_string(),
            });
        } else {
            // Propagate other errors (e.g., IO errors during lock check)
            error!(
                "Error checking session lock for source world '{}': {}",
                source_world_folder, e
            );
            return Err(e);
        }
    }
    info!(
        "Source world '{}' is not locked, proceeding with copy.",
        source_world_folder
    );

    // --- Copy Directory ---
    info!(
        "Starting directory copy for target folder '{}'...",
        final_target_folder_name
    );
    let options = CopyOptions {
        overwrite: false,
        skip_exist: false, // We explicitly want an error if the target exists, checked by find_unique
        content_only: true, // Copy the *content* of source_world_path into target_world_path
        ..Default::default()
    };

    // Create the empty target directory before copying content into it
    fs::create_dir(&target_world_path).await.map_err(|e| {
        error!(
            "Failed to create target world directory '{}': {}",
            target_world_path.display(),
            e
        );
        if target_world_path.exists() {
            AppError::WorldAlreadyExists {
                profile_id: target_profile_id,
                world_folder: final_target_folder_name.clone(),
            }
        } else {
            AppError::Io(e)
        }
    })?;

    match copy_dir(&source_world_path, &target_world_path, &options) {
        Ok(bytes_copied) => {
            info!(
                "Successfully copied world directory content ({} bytes) from {} to {}",
                bytes_copied,
                source_world_path.display(),
                target_world_path.display()
            );
        }
        Err(e) => {
            error!(
                "Failed to copy world directory from {} to {}: {}",
                source_world_path.display(),
                target_world_path.display(),
                e
            );
            let _ = fs::remove_dir_all(&target_world_path).await; // Cleanup
            return Err(AppError::FsExtra(e));
        }
    }

    // --- Modify level.dat in Target Directory ---
    info!(
        "Modifying level.dat in target directory: {}",
        target_world_path.display()
    );
    let target_level_dat_path = target_world_path.join("level.dat");

    if let Err(e) = modify_level_dat_name(&target_level_dat_path, target_world_name).await {
        error!(
            "Failed to modify level.dat name in target world '{}': {}. Cleaning up.",
            final_target_folder_name, e
        );
        // Cleanup the copied directory if modifying level.dat fails
        let _ = fs::remove_dir_all(&target_world_path).await;
        return Err(e);
    }

    info!(
        "World copy process completed successfully for target folder: {}",
        final_target_folder_name
    );
    Ok(final_target_folder_name) // Return the generated folder name
}

/// Reads, modifies the LevelName tag, and writes back a level.dat file.
async fn modify_level_dat_name(level_dat_path: &Path, new_level_name: &str) -> Result<()> {
    // 1. Read the file
    let compressed_bytes = fs::read(level_dat_path).await.map_err(|e| {
        error!(
            "Failed to read target level.dat at '{}': {}",
            level_dat_path.display(),
            e
        );
        AppError::Io(e)
    })?;

    // 2. Decompress
    let mut decoder = GzDecoder::new(&compressed_bytes[..]);
    let mut decompressed_bytes = Vec::new();
    if let Err(e) = std::io::Read::read_to_end(&mut decoder, &mut decompressed_bytes) {
        error!(
            "Failed to decompress level.dat from '{}': {}",
            level_dat_path.display(),
            e
        );
        return Err(AppError::Io(e)); // Treat as IO error for now
    }

    // 3. Parse NBT
    let mut nbt_value: Value = from_bytes(&decompressed_bytes).map_err(|e| {
        error!(
            "Failed to parse NBT from decompressed level.dat '{}': {}",
            level_dat_path.display(),
            e
        );
        AppError::Nbt(e)
    })?;

    // 4. Modify LevelName
    let mut modified = false;
    if let Value::Compound(root) = &mut nbt_value {
        if let Some(Value::Compound(data)) = root.get_mut("Data") {
            if let Some(level_name_tag) = data.get_mut("LevelName") {
                *level_name_tag = Value::String(new_level_name.to_string());
                modified = true;
                info!(
                    "Set LevelName to '{}' in {}",
                    new_level_name,
                    level_dat_path.display()
                );
            } else {
                warn!(
                    "'LevelName' tag not found within 'Data' compound in {}",
                    level_dat_path.display()
                );
            }
        } else {
            warn!("'Data' compound not found in {}", level_dat_path.display());
        }
    } else {
        warn!(
            "Root tag in level.dat is not a Compound: {}",
            level_dat_path.display()
        );
    }

    if !modified {
        // If we couldn't modify it, maybe it's okay, but log a warning.
        // Alternatively, could return an error.
        warn!(
            "Could not modify LevelName in {}. Proceeding without change.",
            level_dat_path.display()
        );
        // Decide if this should be an error: return Err(AppError::Other(...));
    }

    // 5. Serialize NBT back to bytes
    let new_decompressed_bytes = to_bytes(&nbt_value).map_err(|e| {
        error!(
            "Failed to serialize modified NBT for '{}': {}",
            level_dat_path.display(),
            e
        );
        AppError::Other(format!("NBT serialization error: {}", e)) // Use generic error for ser error
    })?;

    // 6. Compress
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    if let Err(e) = std::io::Write::write_all(&mut encoder, &new_decompressed_bytes) {
        error!(
            "Failed to compress modified level.dat bytes for '{}': {}",
            level_dat_path.display(),
            e
        );
        return Err(AppError::Io(e));
    }
    let new_compressed_bytes = encoder.finish().map_err(|e| {
        error!(
            "Failed finish compression for level.dat '{}': {}",
            level_dat_path.display(),
            e
        );
        AppError::Io(e)
    })?;

    // 7. Write back to file
    fs::write(level_dat_path, &new_compressed_bytes)
        .await
        .map_err(|e| {
            error!(
                "Failed to write modified level.dat back to '{}': {}",
                level_dat_path.display(),
                e
            );
            AppError::Io(e)
        })?;

    info!(
        "Successfully modified and saved level.dat: {}",
        level_dat_path.display()
    );
    Ok(())
}

/// Checks if the world directory's session.lock file can be exclusively locked.
/// This indicates whether the world is likely currently in use by Minecraft.
///
/// # Arguments
/// * `world_path` - Path to the specific world directory (e.g., .../saves/MyWorld).
///
/// # Returns
/// * `Ok(())` if the lock can be acquired (world likely not in use).
/// * `Err(AppError::WorldLocked)` if the lock cannot be acquired immediately.
/// * `Err(AppError::Io)` for other file system errors.
pub async fn check_world_session_lock(world_path: &Path) -> Result<()> {
    let lock_file_path = world_path.join("session.lock");
    info!(
        "Checking session lock for world at: {}",
        lock_file_path.display()
    );

    // Try to open or create the lock file for writing
    // Use tokio::fs::OpenOptions for async operation
    let file = match fs::OpenOptions::new()
        .write(true)
        .create(true) // Create if it doesn't exist
        .open(&lock_file_path)
        .await
    {
        Ok(f) => f,
        Err(e) => {
            error!(
                "Failed to open session.lock file at '{}': {}",
                lock_file_path.display(),
                e
            );
            // Don't necessarily error out if we can't OPEN it,
            // maybe Minecraft hasn't created it yet, but the folder exists.
            // However, if we can't lock it later, that's the real issue.
            // Let's try to proceed, try_lock_exclusive handles non-existence implicitly I think?
            // Re-evaluate: Opening it is necessary for fs4::try_lock_exclusive
            return Err(AppError::Io(e));
        }
    };

    // Try to acquire an exclusive, non-blocking lock
    match file.try_lock_exclusive() {
        Ok(_) => {
            // Lock acquired successfully! This means the file was not locked by another process.
            info!(
                "Session lock acquired for '{}'. World is likely not in use.",
                lock_file_path.display()
            );
            // The lock is automatically released when `file` goes out of scope here.
            Ok(())
        }
        Err(e) => {
            // Check if the error is specifically because it's already locked
            if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut
                || e.kind() == std::io::ErrorKind::PermissionDenied
                || e.kind() == std::io::ErrorKind::ResourceBusy
            {
                error!(
                    "Failed to acquire session lock for '{}' (likely in use): {}",
                    lock_file_path.display(),
                    e
                );
                // Cannot acquire lock, world is likely in use
                Err(AppError::WorldLocked {
                    // We don't have profile_id/world_folder here easily, adjust error or pass them in?
                    // For now, use path, but ideally the caller (copy_world_directory) constructs the specific error.
                    // Let's change the return type to signal locked state.
                    // Returning Ok(false) might be cleaner than a specific error here.
                    // Let's stick with the specific error for now.
                    profile_id: Uuid::nil(), // Placeholder - To be filled by caller
                    world_folder: world_path
                        .file_name()
                        .map_or_else(|| "?".to_string(), |n| n.to_string_lossy().to_string()), // Get folder name from path
                })
            } else {
                error!(
                    "Unexpected error trying to lock session.lock file '{}': {}",
                    lock_file_path.display(),
                    e
                );
                // Another I/O error occurred
                Err(AppError::Io(e))
            }
        }
    }
}

/// Deletes a singleplayer world directory from a profile's saves folder.
///
/// # Arguments
///
/// * `profile_id` - UUID of the profile containing the world.
/// * `world_folder` - The name of the world folder to delete within the profile's 'saves' directory.
///
/// # Returns
///
/// Returns `Ok(())` on success, or an `AppError` variant on failure.
pub async fn delete_world_directory(profile_id: Uuid, world_folder: &str) -> Result<()> {
    info!(
        "Attempting to delete world '{}' from profile {}",
        world_folder, profile_id
    );

    // Basic validation
    if world_folder.is_empty() || world_folder.contains('/') || world_folder.contains('\\') {
        error!(
            "Invalid world folder name provided for deletion: '{}'",
            world_folder
        );
        return Err(AppError::InvalidInput(
            "Invalid world folder name provided.".to_string(),
        ));
    }

    let state = State::get().await?;
    let profile_manager = &state.profile_manager;

    // --- Calculate Path ---
    let instance_path = profile_manager
        .get_profile_instance_path(profile_id)
        .await?;
    let saves_path = instance_path.join("saves");
    let world_path = saves_path.join(world_folder);

    info!("Target world path for deletion: {}", world_path.display());

    // --- Validate Existence ---
    if !world_path.is_dir() {
        error!(
            "World directory not found for deletion: {}",
            world_path.display()
        );
        // Return WorldNotFound even if it might exist but isn't a directory
        return Err(AppError::WorldNotFound {
            profile_id,
            world_folder: world_folder.to_string(),
        });
    }

    // --- Check Session Lock ---
    if let Err(e) = check_world_session_lock(&world_path).await {
        if let AppError::WorldLocked { .. } = e {
            error!(
                "World '{}' in profile {} is locked and cannot be deleted.",
                world_folder, profile_id
            );
            // Return the specific locked error, enriching it with IDs
            return Err(AppError::WorldLocked {
                profile_id,
                world_folder: world_folder.to_string(),
            });
        } else {
            error!(
                "Error checking session lock for world '{}' before deletion: {}",
                world_folder, e
            );
            return Err(e); // Propagate other errors from lock check
        }
    }
    info!(
        "World '{}' is not locked, proceeding with deletion.",
        world_folder
    );

    // --- Move to Trash ---
    info!("Moving world directory to trash: {}", world_path.display());
    crate::utils::trash_utils::move_path_to_trash(&world_path, Some("worlds")).await?;

    info!(
        "World directory '{}' moved to trash for profile {}",
        world_folder, profile_id
    );
    Ok(())
}

// --- Error Enum Extension (add FsExtra and WorldLocked variants in error.rs) ---
// Need to add these to the main AppError enum in src-tauri/src/error.rs
// #[error("World '{world_folder}' in profile {profile_id} is currently locked (in use).")]
