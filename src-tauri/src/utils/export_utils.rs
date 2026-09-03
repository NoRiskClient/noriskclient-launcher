use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::state::profile_state::{self, Mod, Profile};
use crate::state::state_manager::State;
use crate::utils::import_safety::safe_file_component;
use async_zip::tokio::write::ZipFileWriter;
use async_zip::{Compression, ZipEntryBuilder};
use futures::future::{join_all, BoxFuture};
use log::{debug, info, warn};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::fs;
use tokio::task::JoinHandle;
use uuid::Uuid;

pub(crate) const MOD_CACHE_DIR_NAME: &str = "mod_cache";
pub(crate) const OVERRIDES_DIR_NAME: &str = "overrides";
pub const OVERRIDES_MODS_PREFIX: &str = "overrides/mods/";

const NEVER_EXPORTABLE_PREFIXES: &[&str] = &[
    "profile.json",
    "logs/",
    "crash-reports/",
    ".fabric/",
    ".mixin.out/",
    "__MACOSX/",
];
const NEVER_EXPORTABLE_SUFFIXES: &[&str] = &[".DS_Store"];

/// Determines the optimal compression type for a file based on its extension and size.
/// Already-compressed files and large files use Stored (no compression) for speed.
/// Small text/config files use Deflate for better compression.
pub(crate) fn determine_compression(file_path: &Path, file_size: u64) -> Compression {
    // Files larger than 1MB - use Stored for speed
    if file_size > 1_048_576 {
        return Compression::Stored;
    }

    // Check file extension for already-compressed formats
    if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
        let ext_lower = ext.to_lowercase();
        match ext_lower.as_str() {
            // Already compressed formats
            "png" | "jpg" | "jpeg" | "gif" | "zip" | "jar" | "gz" | "mca" | "dat" | "dat_old" | "dat_mcr" => {
                return Compression::Stored;
            }
            // Text files benefit from compression
            "json" | "txt" | "toml" | "cfg" | "properties" | "yml" | "yaml" => {
                return Compression::Deflate;
            }
            _ => {}
        }
    }

    // Default to Deflate for small files
    Compression::Deflate
}

pub(crate) struct ExportEntry {
    pub source_path: PathBuf,
    pub zip_path: String,
}

pub fn normalize_loader_version(version: &str, game_version: &str) -> String {
    let trimmed = version.trim();
    let bare = trimmed.split_whitespace().next().unwrap_or(trimmed);
    let stripped = bare
        .strip_prefix(&format!("{}-", game_version))
        .unwrap_or(bare);
    let stripped = stripped
        .strip_suffix(&format!("-{}", game_version))
        .unwrap_or(stripped);

    if stripped.is_empty() {
        trimmed.to_string()
    } else {
        stripped.to_string()
    }
}

pub(crate) async fn resolve_export_loader_version(
    state: &crate::state::state_manager::State,
    profile: &Profile,
    pack_format: &str,
) -> Result<String> {
    if let Some(version) = &profile.loader_version {
        if !version.trim().is_empty() {
            return Ok(normalize_loader_version(version, &profile.game_version));
        }
    }

    let config = state.norisk_pack_manager.get_config().await;
    crate::minecraft::modloader::ModloaderFactory::resolve_loader_version(
        profile,
        &profile.game_version,
        Some(&config),
    )
    .await
    .version
    .map(|version| normalize_loader_version(&version, &profile.game_version))
    .ok_or_else(|| {
        AppError::Other(format!(
            "Could not resolve a {} version for MC {} - {} requires an exact loader version",
            profile.loader.as_str(),
            profile.game_version,
            pack_format
        ))
    })
}

pub fn relative_zip_path(base: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(base)
        .ok()
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
}

pub async fn select_export_files(
    instance_path: &Path,
    include_files: Option<&Vec<PathBuf>>,
) -> Result<Vec<PathBuf>> {
    let Some(include_paths) = include_files else {
        return Ok(Vec::new());
    };

    let mut all_files = Vec::new();
    collect_all_files_recursive(instance_path, &mut all_files).await?;

    let include_paths_str: Vec<String> = include_paths
        .iter()
        .filter_map(|p| relative_zip_path(instance_path, p))
        .collect();

    all_files.retain(|file_path| {
        relative_zip_path(instance_path, file_path).is_some_and(|rel_path| {
            include_paths_str
                .iter()
                .any(|include_str| rel_path.starts_with(include_str))
        })
    });

    Ok(all_files)
}

pub(crate) async fn write_export_archive(
    state: &Arc<crate::state::state_manager::State>,
    profile_id: Uuid,
    output_path: &Path,
    entries: Vec<ExportEntry>,
    trailing_entries: Vec<(String, Vec<u8>)>,
) -> Result<()> {
    let total_files = entries.len();
    info!(
        "Creating export archive at {} ({} files)",
        output_path.display(),
        total_files
    );

    if let Some(parent) = output_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).await.map_err(AppError::Io)?;
        }
    }

    let mut file = fs::File::create(output_path).await.map_err(AppError::Io)?;
    let mut writer = ZipFileWriter::with_tokio(&mut file);

    let export_event_id = Uuid::new_v4();
    let completed_files = Arc::new(AtomicUsize::new(0));

    emit_export_progress(
        state,
        export_event_id,
        profile_id,
        format!("Starting export of {} files...", total_files),
        0.0,
    )
    .await?;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<(String, Vec<u8>, Compression)>(100);
    let mut tasks: Vec<JoinHandle<Result<()>>> = Vec::new();
    let io_semaphore = state.io_semaphore.clone();

    for entry in entries {
        let tx_clone = tx.clone();
        let semaphore_clone = io_semaphore.clone();
        let completed_clone = completed_files.clone();
        let state_clone = state.clone();
        let total = total_files.max(1);

        let task = tokio::spawn(async move {
            let _permit = semaphore_clone
                .acquire()
                .await
                .map_err(|e| AppError::Other(format!("Failed to acquire semaphore: {}", e)))?;

            let metadata = fs::metadata(&entry.source_path)
                .await
                .map_err(AppError::Io)?;
            let compression = determine_compression(&entry.source_path, metadata.len());
            let data = fs::read(&entry.source_path).await.map_err(AppError::Io)?;

            tx_clone
                .send((entry.zip_path, data, compression))
                .await
                .map_err(|e| AppError::Other(format!("Failed to send file data: {}", e)))?;

            let completed = completed_clone.fetch_add(1, Ordering::SeqCst) + 1;
            let progress = (completed as f64) / (total as f64);

            // Emit progress every 5% or every 100 files
            if completed % 100 == 0 || (progress - (completed as f64 - 1.0) / total as f64) >= 0.05 {
                let _ = emit_export_progress(
                    &state_clone,
                    export_event_id,
                    profile_id,
                    format!("Exporting files... {}/{}", completed, total),
                    progress,
                )
                .await;
            }

            debug!("Processed file: {}", entry.source_path.display());
            Ok(())
        });

        tasks.push(task);
    }

    // Drop the original sender so the channel closes when all tasks finish
    drop(tx);

    let workers_handle = tokio::spawn(async move {
        for result in join_all(tasks).await {
            match result {
                Ok(Ok(())) => {}
                Ok(Err(e)) => return Err(e),
                Err(e) => return Err(AppError::Other(format!("Task panicked: {}", e))),
            }
        }
        Ok(())
    });

    while let Some((zip_path, data, compression)) = rx.recv().await {
        let entry_builder = ZipEntryBuilder::new(zip_path.into(), compression);
        writer
            .write_entry_whole(entry_builder, &data)
            .await
            .map_err(|e| AppError::Other(format!("Failed to write zip entry: {}", e)))?;
    }

    workers_handle
        .await
        .map_err(|e| AppError::Other(format!("Workers task panicked: {}", e)))??;

    for (zip_path, data) in trailing_entries {
        let entry_builder = ZipEntryBuilder::new(zip_path.clone().into(), Compression::Deflate);
        writer
            .write_entry_whole(entry_builder, &data)
            .await
            .map_err(|e| AppError::Other(format!("Failed to write {} to zip: {}", zip_path, e)))?;
    }

    writer
        .close()
        .await
        .map_err(|e| AppError::Other(format!("Failed to finalize zip file: {}", e)))?;

    emit_export_progress(
        state,
        export_event_id,
        profile_id,
        format!("Export completed! {} files exported.", total_files),
        1.0,
    )
    .await?;

    Ok(())
}

async fn emit_export_progress(
    state: &Arc<crate::state::state_manager::State>,
    event_id: Uuid,
    profile_id: Uuid,
    message: String,
    progress: f64,
) -> Result<()> {
    state
        .event_state
        .emit(crate::state::event_state::EventPayload {
            event_id,
            event_type: crate::state::event_state::EventType::ExportingProfile,
            target_id: Some(profile_id),
            message,
            progress: Some(progress),
            error: None,
        })
        .await
}

/// Collect all files recursively (like Modrinth's add_all_recursive_folder_paths)
pub fn collect_all_files_recursive<'a>(
    dir_path: &'a Path,
    file_list: &'a mut Vec<PathBuf>,
) -> BoxFuture<'a, Result<()>> {
    Box::pin(async move {
        let mut visited = HashSet::new();
        if let Ok(root) = fs::canonicalize(dir_path).await {
            visited.insert(root);
        }
        collect_files_guarded(dir_path, file_list, &mut visited).await
    })
}

fn collect_files_guarded<'a>(
    dir_path: &'a Path,
    file_list: &'a mut Vec<PathBuf>,
    visited: &'a mut HashSet<PathBuf>,
) -> BoxFuture<'a, Result<()>> {
    Box::pin(async move {
        let mut entries = fs::read_dir(dir_path).await.map_err(|e| AppError::Io(e))?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| AppError::Io(e))? {
            let path = entry.path();

            // Resolves through symlinks, so linked-in content is still exported.
            let metadata = match fs::metadata(&path).await {
                Ok(metadata) => metadata,
                Err(e) => {
                    warn!("Skipping unreadable entry {}: {}", path.display(), e);
                    continue;
                }
            };

            if metadata.is_dir() {
                let identity = fs::canonicalize(&path).await.unwrap_or_else(|_| path.clone());
                if !visited.insert(identity) {
                    warn!(
                        "Skipping already visited directory, symlink loop: {}",
                        path.display()
                    );
                    continue;
                }
                // Recurse into directories
                collect_files_guarded(&path, file_list, visited).await?;
            } else if metadata.is_file() {
                // Add files to the list
                file_list.push(path);
            }
        }

        Ok(())
    })
}

pub fn override_zip_path(rel_path: &str) -> Option<String> {
    let is_excluded = NEVER_EXPORTABLE_PREFIXES
        .iter()
        .any(|prefix| rel_path.starts_with(prefix))
        || NEVER_EXPORTABLE_SUFFIXES
            .iter()
            .any(|suffix| rel_path.ends_with(suffix));
    if is_excluded {
        return None;
    }

    let is_managed_mod = rel_path.starts_with("mods/nrc-") || rel_path.starts_with("custom_mods/");
    if is_managed_mod {
        let filename = rel_path.rsplit('/').next()?;
        return Some(format!("{}{}", OVERRIDES_MODS_PREFIX, filename));
    }

    Some(format!("{}/{}", OVERRIDES_DIR_NAME, rel_path))
}

pub(crate) fn mod_file_name(mod_info: &Mod) -> Option<String> {
    let raw = match &mod_info.file_name_override {
        Some(name) => Ok(name.clone()),
        None => profile_state::get_profile_mod_filename(&mod_info.source),
    };

    match raw.and_then(|name| safe_file_component(&name)) {
        Ok(name) => Some(name),
        Err(e) => {
            warn!("Skipping mod without resolvable filename: {}", e);
            None
        }
    }
}

pub(crate) async fn locate_mod_jar(
    state: &State,
    profile: &Profile,
    instance_path: &Path,
    filename: &str,
) -> Option<PathBuf> {
    let mut candidates = vec![instance_path.join("mods").join(filename)];
    if let Ok(managed_dir) = state.profile_manager.get_profile_mods_path(profile) {
        candidates.push(managed_dir.join(filename));
    }
    candidates.push(instance_path.join("custom_mods").join(filename));
    candidates.push(
        LAUNCHER_DIRECTORY
            .meta_dir()
            .join(MOD_CACHE_DIR_NAME)
            .join(filename),
    );

    for candidate in candidates {
        if fs::metadata(&candidate)
            .await
            .is_ok_and(|meta| meta.is_file())
        {
            return Some(candidate);
        }
    }
    None
}

pub(crate) async fn collect_export_entries(
    state: &State,
    profile: &Profile,
    instance_path: &Path,
    include_files: Option<&Vec<PathBuf>>,
    indexed_mod_filenames: &HashSet<String>,
    bundled_mod_filenames: &[String],
) -> Result<Vec<ExportEntry>> {
    let mut claimed_zip_paths: HashSet<String> = HashSet::new();
    let mut entries: Vec<ExportEntry> = Vec::new();

    for source_path in select_export_files(instance_path, include_files).await? {
        let Some(rel_path) = relative_zip_path(instance_path, &source_path) else {
            continue;
        };
        let Some(zip_path) = override_zip_path(&rel_path) else {
            continue;
        };
        if let Some(rest) = zip_path.strip_prefix(OVERRIDES_MODS_PREFIX) {
            let name = rest.rsplit('/').next().unwrap_or(rest);
            if indexed_mod_filenames.contains(name) {
                continue;
            }
        }
        if !claimed_zip_paths.insert(zip_path.clone()) {
            continue;
        }
        entries.push(ExportEntry {
            source_path,
            zip_path,
        });
    }

    for filename in bundled_mod_filenames {
        let zip_path = format!("{}{}", OVERRIDES_MODS_PREFIX, filename);
        if claimed_zip_paths.contains(&zip_path) {
            continue;
        }
        match locate_mod_jar(state, profile, instance_path, filename).await {
            Some(source_path) => {
                claimed_zip_paths.insert(zip_path.clone());
                entries.push(ExportEntry {
                    source_path,
                    zip_path,
                });
            }
            None => warn!(
                "Could not locate jar for mod '{}', it will be missing from the exported pack",
                filename
            ),
        }
    }

    Ok(entries)
}
