use crate::config::ProjectDirsExt;
use crate::config::LAUNCHER_DIRECTORY;
use crate::error::{AppError, Result};
use chrono::{DateTime, Utc};
use log::{error, info, warn};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

/// Returns the trash root directory path: <meta_dir>/trash
pub fn get_trash_root() -> PathBuf {
    LAUNCHER_DIRECTORY.meta_dir().join("trash")
}

/// Ensure trash root (and optional category) exists
async fn ensure_trash_dir(category: Option<&str>) -> Result<PathBuf> {
    let mut base = get_trash_root();
    if let Some(cat) = category {
        base = base.join(cat);
    }
    fs::create_dir_all(&base).await.map_err(AppError::Io)?;
    Ok(base)
}

/// Moves a file or directory at `source_path` into the trash under an optional category.
/// Returns the final wrapper directory created in the trash that contains the moved item.
pub async fn move_path_to_trash<P: AsRef<Path>>(source_path: P, category: Option<&str>) -> Result<PathBuf> {
    let source_path = source_path.as_ref();

    if !source_path.exists() {
        return Err(AppError::Other(format!(
            "Source path does not exist: {}",
            source_path.display()
        )));
    }

    let trash_base = ensure_trash_dir(category).await?;

    let timestamp: DateTime<Utc> = Utc::now();
    let ts_str = timestamp.format("%Y%m%dT%H%M%SZ").to_string();

    // derive a safe display name
    let original_name = source_path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("unknown");

    // wrapper dir to keep metadata and avoid name collisions
    let wrapper_dir = trash_base.join(format!(
        "{}__{}__{}",
        ts_str,
        Uuid::new_v4().simple(),
        sanitize_filename::sanitize(original_name)
    ));

    fs::create_dir_all(&wrapper_dir).await.map_err(AppError::Io)?;

    // target path inside wrapper keeps original name
    let target_path = wrapper_dir.join(original_name);

    // try fast rename (same volume)
    match fs::rename(&source_path, &target_path).await {
        Ok(_) => {
            info!(
                "Moved '{}' to trash at '{}'",
                source_path.display(),
                target_path.display()
            );
        }
        Err(rename_err) => {
            warn!(
                "Rename failed moving to trash ({}). Falling back to copy+remove: {}",
                source_path.display(),
                rename_err
            );
            // copy recursively if dir, else copy file
            let meta = fs::metadata(&source_path).await.map_err(AppError::Io)?;
            if meta.is_dir() {
                // recursive copy via walkdir
                if let Err(e) = copy_dir_recursive(&source_path, &target_path).await {
                    error!(
                        "Failed to copy directory '{}' to trash '{}': {}",
                        source_path.display(),
                        target_path.display(),
                        e
                    );
                    return Err(e);
                }
                fs::remove_dir_all(&source_path).await.map_err(AppError::Io)?;
            } else {
                fs::copy(&source_path, &target_path).await.map_err(AppError::Io)?;
                fs::remove_file(&source_path).await.map_err(AppError::Io)?;
            }
        }
    }

    // write trashed_at marker
    let trashed_at_path = wrapper_dir.join(".trashed_at");
    let mut f = fs::File::create(&trashed_at_path).await.map_err(AppError::Io)?;
    f.write_all(ts_str.as_bytes()).await.map_err(AppError::Io)?;

    Ok(wrapper_dir)
}

/// Recursively copy a directory tree from src to dst
async fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst).await.map_err(AppError::Io)?;
    let mut dirs = vec![src.to_path_buf()];

    while let Some(current) = dirs.pop() {
        let rel = current.strip_prefix(src).unwrap_or(Path::new(""));
        let target_current = dst.join(rel);
        fs::create_dir_all(&target_current).await.map_err(AppError::Io)?;

        let mut read_dir = fs::read_dir(&current).await.map_err(AppError::Io)?;
        while let Some(entry) = read_dir.next_entry().await.map_err(AppError::Io)? {
            let path = entry.path();
            let file_type = entry.file_type().await.map_err(AppError::Io)?;
            if file_type.is_dir() {
                dirs.push(path);
            } else if file_type.is_file() {
                let rel_file = path.strip_prefix(src).unwrap_or(&path);
                let target_file = dst.join(rel_file);
                if let Some(parent) = target_file.parent() {
                    fs::create_dir_all(parent).await.map_err(AppError::Io)?;
                }
                fs::copy(&path, &target_file).await.map_err(AppError::Io)?;
            } else if file_type.is_symlink() {
                // For safety, skip symlinks
                warn!("Skipping symlink during trash copy: {}", path.display());
            }
        }
    }

    Ok(())
}

/// Purges trashed items older than `max_age_seconds` from the trash directory.
/// Returns the number of items (wrapper directories) removed.
pub async fn purge_expired(max_age_seconds: u64) -> Result<u64> {
    let trash_root = ensure_trash_dir(None).await?;
    let now = Utc::now();
    let mut removed: u64 = 0;

    let mut cat_iter = fs::read_dir(&trash_root).await.map_err(AppError::Io)?;
    while let Some(cat_entry) = cat_iter.next_entry().await.map_err(AppError::Io)? {
        let cat_path = cat_entry.path();
        if !cat_entry.file_type().await.map_err(AppError::Io)?.is_dir() {
            continue;
        }

        let mut item_iter = fs::read_dir(&cat_path).await.map_err(AppError::Io)?;
        while let Some(item_entry) = item_iter.next_entry().await.map_err(AppError::Io)? {
            let item_path = item_entry.path();
            if !item_entry.file_type().await.map_err(AppError::Io)?.is_dir() {
                continue;
            }

            let age_secs_opt = match read_trashed_at(&item_path).await {
                Ok(age_secs) => Some(age_secs),
                Err(_) => match infer_age_from_fs(&item_path).await {
                    Ok(age) => Some(age),
                    Err(e) => {
                        warn!(
                            "Failed to determine age for trashed item '{}': {}",
                            item_path.display(),
                            e
                        );
                        None
                    }
                },
            };

            if let Some(age_secs) = age_secs_opt {
                if age_secs > max_age_seconds {
                    match fs::remove_dir_all(&item_path).await {
                        Ok(_) => {
                            info!("Purged trashed item: {}", item_path.display());
                            removed += 1;
                        }
                        Err(e) => warn!(
                            "Failed to purge trashed item '{}': {}",
                            item_path.display(),
                            e
                        ),
                    }
                }
            }
        }
    }

    Ok(removed)
}

async fn read_trashed_at(wrapper_dir: &Path) -> Result<u64> {
    let now = Utc::now();
    let trashed_at_path = wrapper_dir.join(".trashed_at");
    let content = fs::read(&trashed_at_path).await.map_err(AppError::Io)?;
    let s = String::from_utf8_lossy(&content);
    let parsed = DateTime::parse_from_rfc3339(&s)
        .or_else(|_| DateTime::parse_from_str(&s, "%Y%m%dT%H%M%SZ"))
        .map_err(|e| AppError::Other(format!("Failed to parse .trashed_at: {}", e)))?;
    let trashed_at_utc = parsed.with_timezone(&Utc);
    let age_secs = now
        .signed_duration_since(trashed_at_utc)
        .num_seconds();
    Ok(if age_secs < 0 { 0 } else { age_secs as u64 })
}

async fn infer_age_from_fs(path: &Path) -> Result<u64> {
    let now = Utc::now();
    let meta = fs::metadata(path).await.map_err(AppError::Io)?;
    // use modified time as fallback
    let modified = meta.modified().map_err(|e| AppError::Io(e))?;
    let modified_dt: DateTime<Utc> = modified.into();
    let age_secs = now
        .signed_duration_since(modified_dt)
        .num_seconds();
    Ok(if age_secs < 0 { 0 } else { age_secs as u64 })
} 