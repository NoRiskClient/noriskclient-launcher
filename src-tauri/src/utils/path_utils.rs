use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result}; // Dein Result- und Fehlertyp
use crate::integrations::norisk_packs::{get_norisk_pack_mod_filename, NoriskModEntryDefinition};
use futures::future::try_join_all; // Added for joining futures
use log::{error, info, warn};
use std::path::{Path, PathBuf};
use std::sync::Arc; // Added for Arc<Semaphore>
use tokio::fs; // Verwende tokio::fs für async checks
use tokio::sync::Semaphore; // Added for io_semaphore
use uuid::Uuid;

/// Findet einen eindeutigen Verzeichnisnamen (Segment) in einem Basisverzeichnis.
/// Wenn "desired_segment" schon existiert, werden Suffixe wie "(1)", "(2)" usw. angehängt.
/// Stellt zusätzlich sicher, dass keine problematischen Character enthalten sind.
/// Gibt den eindeutigen Segmentnamen als String zurück.
pub async fn find_unique_profile_segment(
    base_profiles_dir: &Path,
    desired_segment: &str,
) -> Result<String> {
    info!(
        "Finding unique profile segment for '{}' in base dir '{}'",
        desired_segment,
        base_profiles_dir.display()
    );

    // Problematische Character durch '_' ersetzen
    let sanitized_segment = desired_segment.replace(
        ['/', '\\', '?', '!', '<', '>', '*', ':', '\'', '\"', '|'],
        "_",
    );

    // Bereinigen und sicherstellen, dass der Segmentname nicht leer ist
    let clean_segment = sanitized_segment.trim();
    if clean_segment.is_empty() {
        error!("Desired segment name cannot be empty.");
        // Erwäge, hier einen Standardnamen oder einen eindeutigen Zeitstempel zu generieren
        return Err(AppError::Other(
            "Desired profile segment name is empty".to_string(),
        ));
    }

    let initial_path = base_profiles_dir.join(clean_segment);

    // Prüfe zuerst den ursprünglichen Namen
    match fs::try_exists(&initial_path).await {
        Ok(false) => {
            info!("Initial segment '{}' is unique.", clean_segment);
            return Ok(clean_segment.to_string()); // Ursprünglicher Name ist frei
        }
        Ok(true) => {
            info!("Initial path '{}' already exists.", initial_path.display());
            // Fange an zu zählen
        }
        Err(e) => {
            error!(
                "Error checking existence of path '{}': {}",
                initial_path.display(),
                e
            );
            return Err(AppError::Io(e)); // Fehler beim Prüfen weitergeben
        }
    }

    // Beginne mit dem Zählen der Suffixe
    let mut counter = 1u32;
    loop {
        // Verwende clean_segment für die Basis des suffixed Namens
        let suffixed_segment = format!("{}({})", clean_segment, counter);
        let candidate_path = base_profiles_dir.join(&suffixed_segment);
        info!("Checking candidate path: {}", candidate_path.display());

        match fs::try_exists(&candidate_path).await {
            Ok(false) => {
                info!("Found unique segment: '{}'", suffixed_segment);
                return Ok(suffixed_segment); // Eindeutigen Namen gefunden
            }
            Ok(true) => {
                // Dieser Name ist auch belegt, erhöhe den Zähler
                counter = counter.checked_add(1).ok_or_else(|| {
                    error!(
                        "Counter overflow while finding unique segment for '{}'",
                        clean_segment
                    );
                    AppError::Other(format!("Counter overflow for segment '{}'", clean_segment))
                })?;

                // Sicherheitslimit, um Endlosschleifen zu verhindern
                if counter > 1000 {
                    // Oder ein anderer sinnvoller Wert
                    error!(
                        "Could not find unique segment for '{}' after {} attempts.",
                        clean_segment, counter
                    );
                    return Err(AppError::Other(format!(
                        "Too many profiles with similar names starting with '{}'",
                        clean_segment
                    )));
                }
            }
            Err(e) => {
                error!(
                    "Error checking existence of candidate path '{}': {}",
                    candidate_path.display(),
                    e
                );
                return Err(AppError::Io(e));
            }
        }
    }
}

/// Copies a source file to the custom_mods directory if it doesn't exist.
/// Logs success, skips, or errors.
pub async fn copy_as_custom_mod(
    src_path_buf: &PathBuf,
    custom_mods_dir: &PathBuf,
    profile_id: Uuid,             // Keep profile_id for logging context
    custom_added_count: &mut u64, // Assuming usize or u64 is better here
    skipped_count: &mut u64,      // Assuming usize or u64 is better here
) {
    // Check extension (optional, but good safeguard)
    if src_path_buf
        .extension()
        .map_or(false, |ext| ext.eq_ignore_ascii_case("jar"))
    {
        if let Some(filename) = src_path_buf.file_name() {
            let dest_path = custom_mods_dir.join(filename);

            if dest_path.exists() {
                warn!("Skipping custom import: File '{}' already exists in custom_mods for profile {}.", filename.to_string_lossy(), profile_id);
                *skipped_count += 1;
                return;
            }

            match fs::copy(&src_path_buf, &dest_path).await {
                // Use fs::copy directly
                Ok(_) => {
                    info!(
                        "Successfully imported '{}' as custom mod to profile {}.",
                        filename.to_string_lossy(),
                        profile_id
                    );
                    *custom_added_count += 1;
                }
                Err(e) => {
                    error!(
                        "Failed to copy file '{}' as custom mod for profile {}: {}",
                        filename.to_string_lossy(),
                        profile_id,
                        e
                    );
                    *skipped_count += 1; // Count as skipped due to error
                }
            }
        } else {
            warn!("Could not extract filename from path: {:?}", src_path_buf);
            *skipped_count += 1;
        }
    } else {
        warn!(
            "Skipping custom import as it does not have a .jar extension: {:?}",
            src_path_buf
        );
        *skipped_count += 1;
    }
}

/// Represents a node in a file system tree.
/// Can be either a file or a directory containing other nodes.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileNode {
    /// Name of the file or directory (just the filename, not the full path)
    pub name: String,
    /// Full path to the file or directory
    pub path: PathBuf,
    /// Whether this node is a directory
    pub is_dir: bool,
    /// Child nodes (empty for files)
    pub children: Vec<FileNode>,
    /// File size in bytes (0 for directories)
    pub size: u64,
    /// Last modified timestamp (as seconds since UNIX epoch)
    pub last_modified: Option<u64>,
}

/// Gets a tree structure of all files and directories under the given path.
/// This function traverses directories recursively and builds a hierarchical structure.
///
/// # Arguments
/// * `root_path` - The directory to scan
/// * `include_hidden` - Whether to include hidden files and directories (those starting with `.`)
///
/// # Returns
/// A Result containing the root FileNode with all its children
pub async fn get_directory_structure(root_path: &Path, include_hidden: bool) -> Result<FileNode> {
    // Get metadata for the root path
    let metadata = fs::metadata(root_path).await.map_err(|e| AppError::Io(e))?;

    let name = root_path
        .file_name()
        .unwrap_or_else(|| root_path.as_os_str())
        .to_string_lossy()
        .to_string();

    let last_modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs());

    // If it's a file, return a leaf node
    if !metadata.is_dir() {
        return Ok(FileNode {
            name,
            path: root_path.to_path_buf(),
            is_dir: false,
            children: Vec::new(),
            size: metadata.len(),
            last_modified,
        });
    }

    // If it's a directory, read its entries and process each one
    let mut children = Vec::new();
    let mut entries = fs::read_dir(root_path).await.map_err(|e| AppError::Io(e))?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| AppError::Io(e))? {
        let path = entry.path();
        let file_name = path
            .file_name()
            .unwrap_or_else(|| path.as_os_str())
            .to_string_lossy();

        // Skip hidden files/directories if not included
        if !include_hidden && file_name.starts_with('.') {
            continue;
        }

        // Recursively process this entry - using Box::pin to handle recursion
        match Box::pin(get_directory_structure(&path, include_hidden)).await {
            Ok(node) => children.push(node),
            Err(e) => {
                // Log the error but continue with other entries
                error!("Error processing entry {}: {}", path.display(), e);
            }
        }
    }

    // Sort children: directories first, then files, both alphabetically
    children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(FileNode {
        name,
        path: root_path.to_path_buf(),
        is_dir: true,
        children,
        size: 0, // Directories themselves have no size
        last_modified,
    })
}

/// Flattens a directory structure into a vector of paths with their relative depths.
/// Useful for UI rendering where a flat list with indentation is preferred.
///
/// # Arguments
/// * `node` - The root node to flatten
/// * `depth` - The current depth (should be 0 for the initial call)
/// * `result` - The vector to populate (should be empty for the initial call)
pub fn flatten_directory_structure(
    node: &FileNode,
    depth: usize,
    result: &mut Vec<(FileNode, usize)>,
) {
    result.push((node.clone(), depth));

    for child in &node.children {
        flatten_directory_structure(child, depth + 1, result);
    }
}

/// Filters a directory structure based on a set of excluded paths.
/// Returns a new tree with only the files and directories that should be included.
///
/// # Arguments
/// * `node` - The root node to filter
/// * `excluded_paths` - Set of paths (as strings) that should be excluded
///
/// # Returns
/// A new FileNode with excluded paths removed
pub fn filter_directory_structure(
    node: &FileNode,
    excluded_paths: &std::collections::HashSet<String>,
) -> Option<FileNode> {
    // If this node's path is excluded, skip the entire subtree
    if excluded_paths.contains(&node.path.to_string_lossy().to_string()) {
        return None;
    }

    // For files, simply return a clone if not excluded
    if !node.is_dir {
        return Some(node.clone());
    }

    // For directories, filter children and keep the directory if it has any children left
    let filtered_children: Vec<FileNode> = node
        .children
        .iter()
        .filter_map(|child| filter_directory_structure(child, excluded_paths))
        .collect();

    // Only return the directory if it has children or is the root
    if !filtered_children.is_empty() || node.path.parent().is_none() {
        let mut filtered_node = node.clone();
        filtered_node.children = filtered_children;
        Some(filtered_node)
    } else {
        None
    }
}

/// Filters a directory structure based on a set of included paths.
/// Returns a new tree with only the files and directories that should be included.
///
/// # Arguments
/// * `node` - The root node to filter
/// * `included_paths` - Set of paths (as strings) that should be included
///
/// # Returns
/// A new FileNode with only included paths
pub fn filter_directory_structure_by_includes(
    node: &FileNode,
    included_paths: &std::collections::HashSet<String>,
) -> Option<FileNode> {
    // For directories, filter children and keep the directory if it has any children left
    if node.is_dir {
        // Process children first
        let filtered_children: Vec<FileNode> = node
            .children
            .iter()
            .filter_map(|child| filter_directory_structure_by_includes(child, included_paths))
            .collect();

        // Only return the directory if:
        // 1. It has remaining children after filtering, or
        // 2. It's explicitly included, or
        // 3. It's the root node (to maintain structure)
        if !filtered_children.is_empty()
            || included_paths.contains(&node.path.to_string_lossy().to_string())
            || node.path.parent().is_none()
        {
            let mut filtered_node = node.clone();
            filtered_node.children = filtered_children;
            Some(filtered_node)
        } else {
            None
        }
    } else {
        // For files, only include if the path is in the included_paths set
        if included_paths.contains(&node.path.to_string_lossy().to_string()) {
            Some(node.clone())
        } else {
            None
        }
    }
}

/// Copies files and directories from a source profile to a destination profile
/// based on a list of included paths.
///
/// # Arguments
/// * `source_root` - The root directory of the source profile
/// * `dest_root` - The root directory of the destination profile
/// * `include_paths` - List of paths to include (only these will be copied)
///
/// # Returns
/// Result with the number of files copied
pub async fn copy_profile_with_includes(
    source_root: &Path,
    dest_root: &Path,
    include_paths: &[PathBuf],
) -> Result<u64> {
    info!(
        "Copying selected files from {} to {}",
        source_root.display(),
        dest_root.display()
    );

    // Get the io_semaphore from global state
    let state = crate::state::State::get().await?;
    let io_semaphore = state.io_semaphore.clone();

    // Get the complete file structure
    let source_structure = get_directory_structure(source_root, false).await?;

    // Convert included paths to strings for comparison
    let included_set: std::collections::HashSet<String> = include_paths
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    info!(
        "Filtering directory structure with {} include paths",
        included_set.len()
    );

    // Filter the structure to keep only included paths
    let filtered_structure = filter_directory_structure_by_includes(
        &source_structure,
        &included_set,
    )
    .ok_or_else(|| {
        AppError::Other("No files matched the include criteria, nothing to copy".to_string())
    })?;

    // Create the destination directory if it doesn't exist
    if !dest_root.exists() {
        fs::create_dir_all(dest_root)
            .await
            .map_err(|e| AppError::Io(e))?;
    }

    // Copy the files according to the filtered structure
    let files_copied =
        copy_profile_files(&filtered_structure, source_root, dest_root, io_semaphore).await?;

    info!("Profile copy completed. Copied {} files.", files_copied);

    Ok(files_copied)
}

/// Helper function to recursively collect file copy operations and create directories.
async fn collect_file_ops_and_create_dirs(
    structure: &FileNode,
    source_root: &Path,
    dest_root: &Path,
    file_ops: &mut Vec<(PathBuf, PathBuf)>,
) -> Result<()> {
    if structure.is_dir {
        let rel_path = structure.path.strip_prefix(source_root).map_err(|e| {
            AppError::Other(format!(
                "Path prefix error (dir): {} for path {}",
                e,
                structure.path.display()
            ))
        })?;
        let dest_dir_path = dest_root.join(rel_path);

        if !dest_dir_path.exists() {
            fs::create_dir_all(&dest_dir_path)
                .await
                .map_err(|e| AppError::Io(e))?;
            info!("Created directory: {}", dest_dir_path.display());
        }

        for child in &structure.children {
            Box::pin(collect_file_ops_and_create_dirs(
                child,
                source_root,
                dest_root,
                file_ops,
            ))
            .await?;
        }
    } else {
        // It's a file, calculate source and dest paths
        let rel_path = structure.path.strip_prefix(source_root).map_err(|e| {
            AppError::Other(format!(
                "Path prefix error (file): {} for path {}",
                e,
                structure.path.display()
            ))
        })?;
        let dest_file_path = dest_root.join(rel_path);

        // Ensure parent directory of the file exists (it should have been created by the dir part)
        if let Some(parent_dir) = dest_file_path.parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir)
                    .await
                    .map_err(|e| AppError::Io(e))?;
                info!(
                    "Created parent directory for file: {}",
                    parent_dir.display()
                );
            }
        }
        file_ops.push((structure.path.clone(), dest_file_path));
    }
    Ok(())
}

/// Copies files and directories from a source profile to a destination profile
/// based on the filtered directory structure, using a semaphore for parallelism.
///
/// # Arguments
/// * `structure` - The filtered directory structure to copy
/// * `source_root` - The root directory of the source profile
/// * `dest_root` - The root directory of the destination profile
/// * `semaphore` - Semaphore to limit concurrent I/O operations
///
/// # Returns
/// Result with the number of files copied
pub async fn copy_profile_files(
    structure: &FileNode,
    source_root: &Path,
    dest_root: &Path,
    semaphore: Arc<Semaphore>,
) -> Result<u64> {
    info!(
        "Collecting file operations and creating directories from {} to {}",
        source_root.display(),
        dest_root.display()
    );

    let mut file_ops: Vec<(PathBuf, PathBuf)> = Vec::new();
    collect_file_ops_and_create_dirs(structure, source_root, dest_root, &mut file_ops).await?;

    info!(
        "Collected {} file copy operations. Starting parallel copy.",
        file_ops.len()
    );

    let mut copy_tasks = Vec::new();

    for (source_file, dest_file) in file_ops {
        let sem_clone = semaphore.clone();
        let task = tokio::spawn(async move {
            let _permit = sem_clone
                .acquire_owned()
                .await
                .map_err(|e| AppError::Other(format!("Semaphore acquire error: {}", e)))?;

            // Ensure parent directory exists one last time (should be redundant if collect_file_ops_and_create_dirs worked)
            if let Some(parent_dir) = dest_file.parent() {
                if !parent_dir.exists() {
                    fs::create_dir_all(parent_dir)
                        .await
                        .map_err(|e| AppError::Io(e))?;
                }
            }

            fs::copy(&source_file, &dest_file).await.map_err(|e| {
                error!(
                    "Failed to copy file {} to {}: {}",
                    source_file.display(),
                    dest_file.display(),
                    e
                );
                AppError::Io(e)
            })?;
            info!(
                "Copied file: {} to {}",
                source_file.display(),
                dest_file.display()
            );
            Ok::<_, AppError>(1u64) // Return 1 for one copied file
        });
        copy_tasks.push(task);
    }

    let results = try_join_all(copy_tasks).await.map_err(|e| {
        error!("Error during parallel copy task execution: {:?}", e);
        // If it's a JoinError, it means a task panicked. Otherwise, it's our AppError.
        if e.is_panic() {
            AppError::Other(format!("A file copy task panicked: {:?}", e))
        } else {
            // If we got an AppError from one of the tasks, it means fs::copy failed.
            // The actual error was logged in the task. Here we just propagate a general error.
            AppError::Other(format!(
                "One or more file copy operations failed. See logs for details. Task error: {:?}",
                e
            ))
        }
    })?;

    let total_files_copied = results.into_iter().filter_map(Result::ok).sum::<u64>();

    info!(
        "Successfully copied {} files in parallel.",
        total_files_copied
    );

    Ok(total_files_copied)
}

/// Example function showing how to copy a profile with exclusions.
/// This demonstrates how to use the directory structure and filtering functions.
///
/// # Arguments
/// * `source_profile_path` - The source profile directory path
/// * `dest_profile_path` - The destination profile directory path
/// * `excluded_paths` - Paths to exclude from copying
///
/// # Returns
/// Result with the number of files copied
pub async fn copy_profile_with_exclusions(
    source_profile_path: &Path,
    dest_profile_path: &Path,
    excluded_paths: &[PathBuf],
) -> Result<u64> {
    info!(
        "Copying profile from {} to {} with {} exclusions",
        source_profile_path.display(),
        dest_profile_path.display(),
        excluded_paths.len()
    );

    // Get the io_semaphore from global state
    let state = crate::state::State::get().await?;
    let io_semaphore = state.io_semaphore.clone();

    // Convert excluded paths to strings and put them in a HashSet for efficient lookup
    let excluded_set: std::collections::HashSet<String> = excluded_paths
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    // First, get the complete directory structure
    let dir_structure = get_directory_structure(source_profile_path, false).await?;

    // Filter the structure based on exclusions
    let filtered_structure = filter_directory_structure(&dir_structure, &excluded_set)
        .ok_or_else(|| AppError::Other("All files were excluded, nothing to copy".to_string()))?;

    // Create the destination directory if it doesn't exist
    if !dest_profile_path.exists() {
        fs::create_dir_all(dest_profile_path)
            .await
            .map_err(|e| AppError::Io(e))?;
    }

    // Copy the files according to the filtered structure
    let files_copied = copy_profile_files(
        &filtered_structure,
        source_profile_path,
        dest_profile_path,
        io_semaphore,
    )
    .await?;

    info!("Profile copy completed. Copied {} files.", files_copied);

    Ok(files_copied)
}

// Konstante aus dem mod_downloader/norisk_pack_downloader übernehmen
const MOD_CACHE_DIR_NAME: &str = "mod_cache";

/// Gibt den vollständigen Pfad zu einem Norisk-Mod im Cache-Verzeichnis zurück.
///
/// # Arguments
///
/// * `mod_entry` - Die Mod-Definition aus dem Norisk-Pack
/// * `minecraft_version` - Die Minecraft-Version, für die der Mod benötigt wird
/// * `loader` - Der Mod-Loader (z.B. "fabric", "forge")
///
/// # Returns
///
/// * `Ok(PathBuf)` - Den Pfad zur .jar Datei im Cache-Verzeichnis
/// * `Err(AppError)` - Wenn kein kompatibler Mod gefunden wurde oder der Dateiname nicht ermittelt werden konnte
pub fn get_norisk_mod_cache_path(
    mod_entry: &NoriskModEntryDefinition,
    minecraft_version: &str,
    loader: &str,
) -> Result<PathBuf> {
    // Überprüfe die Kompatibilität des Mods für die angegebene MC-Version und den Loader
    let compatibility_target = mod_entry
        .compatibility
        .get(minecraft_version)
        .and_then(|loader_map| loader_map.get(loader))
        .ok_or_else(|| {
            let display_name = mod_entry.display_name.as_deref().unwrap_or(&mod_entry.id);
            AppError::Other(format!(
                "Kein kompatibler Mod '{}' (ID: {}) für MC {} / Loader {} gefunden.",
                display_name, mod_entry.id, minecraft_version, loader
            ))
        })?
        .clone();

    // Ermittle den Dateinamen mit der vorhandenen Hilfsfunktion
    let filename =
        get_norisk_pack_mod_filename(&mod_entry.source, &compatibility_target, &mod_entry.id)?;

    // Erstelle den vollständigen Pfad zum Cache-Verzeichnis
    let mod_cache_dir = LAUNCHER_DIRECTORY.meta_dir().join(MOD_CACHE_DIR_NAME);

    // Gib den vollständigen Pfad zur .jar-Datei zurück
    Ok(mod_cache_dir.join(filename))
}

/// Helper function to recursively collect file copy operations.
async fn collect_copy_operations(
    src: &Path,
    dst: &Path,
    ops: &mut Vec<(PathBuf, PathBuf)>,
) -> Result<()> {
    if !src.exists() {
        return Ok(());
    }

    if src.is_dir() {
        fs::create_dir_all(dst).await.map_err(AppError::Io)?;
        let mut entries = fs::read_dir(src).await.map_err(AppError::Io)?;
        while let Some(entry) = entries.next_entry().await.map_err(AppError::Io)? {
            let entry_path = entry.path();
            let dst_path = dst.join(entry.file_name());
            Box::pin(collect_copy_operations(&entry_path, &dst_path, ops)).await?;
        }
    } else if src.is_file() {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).await.map_err(AppError::Io)?;
        }
        ops.push((src.to_path_buf(), dst.to_path_buf()));
    }
    Ok(())
}

/// Recursively copies a directory from a source to a destination, using a semaphore for parallelism.
/// If the destination directory does not exist, it will be created.
///
/// # Arguments
///
/// * `src` - The source directory path.
/// * `dst` - The destination directory path.
/// * `semaphore` - Semaphore to limit concurrent I/O operations.
///
/// # Returns
///
/// A `Result` indicating success or failure.
pub async fn copy_dir_recursively(src: &Path, dst: &Path, semaphore: Arc<Semaphore>) -> Result<()> {
    info!(
        "Recursively copying from {} to {} with parallelism",
        src.display(),
        dst.display()
    );

    let mut ops = Vec::new();
    collect_copy_operations(src, dst, &mut ops).await?;

    info!(
        "Collected {} file copy operations. Starting parallel copy.",
        ops.len()
    );

    let mut copy_futures = Vec::new();
    for (source_file, dest_file) in ops {
        let sem_clone = semaphore.clone();
        let fut = async move {
            let _permit = sem_clone
                .acquire_owned()
                .await
                .map_err(|e| AppError::Other(format!("Semaphore acquire error: {}", e)))?;

            fs::copy(&source_file, &dest_file).await.map_err(|e| {
                error!(
                    "Failed to copy file {} to {}: {}",
                    source_file.display(),
                    dest_file.display(),
                    e
                );
                AppError::Io(e)
            })?;
            Ok::<(), AppError>(())
        };
        copy_futures.push(fut);
    }

    try_join_all(copy_futures).await?;

    info!(
        "Parallel copy from {} to {} completed.",
        src.display(),
        dst.display()
    );

    Ok(())
}
