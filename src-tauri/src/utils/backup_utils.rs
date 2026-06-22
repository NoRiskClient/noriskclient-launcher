use crate::config::{LAUNCHER_DIRECTORY, ProjectDirsExt};
use crate::error::{AppError, Result};
use chrono::{DateTime, Datelike, Utc};
use log::{error, info, warn};
use std::collections::HashSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

/// Generational (Grandfather-Father-Son) retention. Independent day/week/month
/// buckets mean heavy same-day churn can't evict older daily/weekly/monthly snapshots.
#[derive(Debug, Clone)]
pub struct GfsPolicy {
    pub keep_recent: usize,
    pub daily_days: i64,
    pub weekly_weeks: i64,
    pub monthly_months: i64,
}

impl Default for GfsPolicy {
    fn default() -> Self {
        Self {
            keep_recent: 10,
            daily_days: 14,
            weekly_weeks: 8,
            monthly_months: 12,
        }
    }
}

/// Backup configuration for automatic backups
#[derive(Debug, Clone)]
pub struct BackupConfig {
    /// Maximum number of backups to keep per file
    pub max_backups_per_file: usize,
    /// Maximum age in seconds for backups before they're considered for cleanup
    pub max_backup_age_seconds: u64,
    /// Minimum time between backups in seconds (to prevent spam)
    pub min_backup_interval_seconds: u64,
    /// When set, generational GFS retention replaces the flat "keep N newest" prune.
    pub gfs: Option<GfsPolicy>,
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            max_backups_per_file: 10,
            max_backup_age_seconds: 30 * 24 * 60 * 60, // 30 days
            min_backup_interval_seconds: 60, // 1 minute
            gfs: None,
        }
    }
}

/// Returns the backup root directory path: <meta_dir>/backups
pub fn get_backup_root() -> PathBuf {
    LAUNCHER_DIRECTORY.meta_dir().join("backups")
}

/// Ensure backup root (and optional category) exists
async fn ensure_backup_dir(category: Option<&str>) -> Result<PathBuf> {
    let mut base = get_backup_root();
    if let Some(cat) = category {
        base = base.join(cat);
    }
    fs::create_dir_all(&base).await.map_err(AppError::Io)?;
    Ok(base)
}

/// Backs up a file. Skips if byte-identical to the most recent backup.
pub async fn create_backup<P: AsRef<Path>>(
    source_path: P,
    category: Option<&str>,
    config: &BackupConfig,
) -> Result<PathBuf> {
    create_backup_inner(source_path.as_ref(), category, config).await
}

async fn create_backup_inner(
    source_path: &Path,
    category: Option<&str>,
    config: &BackupConfig,
) -> Result<PathBuf> {
    if !source_path.exists() {
        return Err(AppError::Other(format!(
            "Source file does not exist: {}",
            source_path.display()
        )));
    }

    let backup_base = ensure_backup_dir(category).await?;

    // Generate backup filename with Unix timestamp and UUID
    let timestamp: DateTime<Utc> = Utc::now();
    let unix_timestamp = timestamp.timestamp(); // Unix timestamp as i64

    // Get original filename
    let original_name = source_path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("unknown");

    // Create backup filename: original_name.unix_timestamp.uuid.backup
    let backup_filename = format!(
        "{}.{}.{}.backup",
        original_name,
        unix_timestamp,
        Uuid::new_v4().simple()
    );

    let backup_path = backup_base.join(backup_filename);

    // Skip if identical to most recent backup (dedup by content, not by time).
    if let Some(latest) = latest_backup_path(&backup_base, original_name).await {
        if files_equal(source_path, &latest).await {
            info!(
                "Skipping backup for {} - content identical to latest backup",
                source_path.display()
            );
            return Ok(latest);
        }
    }

    // Copy the file atomically
    fs::copy(&source_path, &backup_path).await.map_err(AppError::Io)?;

    info!(
        "Created backup of '{}' at '{}'",
        source_path.display(),
        backup_path.display()
    );

    // Write metadata file with backup info
    let metadata_path = backup_path.with_extension("backup.meta");
    let metadata = format!(
        "original_path={}\nbackup_time={}\nfile_size={}\n",
        source_path.display(),
        timestamp.to_rfc3339(),
        fs::metadata(&source_path).await?.len()
    );

    fs::write(&metadata_path, metadata.as_bytes()).await.map_err(AppError::Io)?;

    if let Some(policy) = &config.gfs {
        cleanup_old_backups_generational(source_path, category, policy).await?;
    } else {
        cleanup_old_backups(source_path, category, config).await?;
    }

    Ok(backup_path)
}

async fn latest_backup_path(backup_base: &Path, original_name: &str) -> Option<PathBuf> {
    let mut latest: Option<(PathBuf, std::time::SystemTime)> = None;
    if let Ok(mut entries) = fs::read_dir(backup_base).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if let Some(filename) = path.file_name().and_then(OsStr::to_str) {
                if filename.starts_with(original_name) && filename.ends_with(".backup") {
                    if let Ok(md) = fs::metadata(&path).await {
                        if let Ok(modified) = md.modified() {
                            match &latest {
                                Some((_, t)) if *t >= modified => {}
                                _ => latest = Some((path.clone(), modified)),
                            }
                        }
                    }
                }
            }
        }
    }
    latest.map(|(p, _)| p)
}

async fn files_equal(a: &Path, b: &Path) -> bool {
    match (fs::read(a).await, fs::read(b).await) {
        (Ok(da), Ok(db)) => da == db,
        _ => false,
    }
}

/// Cleans up old backups according to the configuration
pub async fn cleanup_old_backups(
    source_path: &Path,
    category: Option<&str>,
    config: &BackupConfig,
) -> Result<()> {
    let backup_base = ensure_backup_dir(category).await?;
    let now = Utc::now();

    let original_name = source_path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("unknown");

    // Collect all backup files for this source with their metadata
    let mut backup_files = Vec::new();

    if let Ok(mut entries) = fs::read_dir(&backup_base).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if let Some(filename) = path.file_name().and_then(OsStr::to_str) {
                if filename.starts_with(original_name) && filename.ends_with(".backup") {
                    if let Ok(metadata) = fs::metadata(&path).await {
                        if let Ok(modified) = metadata.modified() {
                            backup_files.push((path, modified));
                        }
                    }
                }
            }
        }
    }

    // Sort by modification time (newest first)
    backup_files.sort_by_key(|(_, time)| std::cmp::Reverse(*time));

    // Remove old backups beyond the limit
    if backup_files.len() > config.max_backups_per_file {
        let to_remove = backup_files.iter().skip(config.max_backups_per_file);
        for (backup_path, _) in to_remove {
            if let Err(e) = fs::remove_file(backup_path).await {
                warn!("Failed to remove old backup '{}': {}", backup_path.display(), e);
            } else {
                // Also remove metadata file
                let meta_path = backup_path.with_extension("backup.meta");
                let _ = fs::remove_file(&meta_path).await;
                info!("Removed old backup: {}", backup_path.display());
            }
        }
    }

    // Remove backups older than max age
    for (backup_path, modified_time) in &backup_files {
        let modified_dt: DateTime<Utc> = (*modified_time).into();
        let age_seconds = now.signed_duration_since(modified_dt).num_seconds();

        if age_seconds > config.max_backup_age_seconds as i64 {
            if let Err(e) = fs::remove_file(backup_path).await {
                warn!("Failed to remove expired backup '{}': {}", backup_path.display(), e);
            } else {
                // Also remove metadata file
                let meta_path = backup_path.with_extension("backup.meta");
                let _ = fs::remove_file(&meta_path).await;
                info!("Removed expired backup: {}", backup_path.display());
            }
        }
    }

    Ok(())
}

/// Generational (GFS) cleanup. See [`GfsPolicy`].
pub async fn cleanup_old_backups_generational(
    source_path: &Path,
    category: Option<&str>,
    policy: &GfsPolicy,
) -> Result<()> {
    let backups = list_backups(source_path, category).await?; // newest-first
    if backups.len() <= policy.keep_recent {
        return Ok(());
    }

    let now = Utc::now();
    let mut keep: HashSet<PathBuf> = HashSet::new();

    for (path, _) in backups.iter().take(policy.keep_recent) {
        keep.insert(path.clone());
    }

    // Newest-first iteration: first entry to claim a bucket key is its survivor.
    let mut daily_seen: HashSet<i64> = HashSet::new();
    let mut weekly_seen: HashSet<i64> = HashSet::new();
    let mut monthly_seen: HashSet<i64> = HashSet::new();

    for (path, ts) in backups.iter() {
        let age_days = now.signed_duration_since(*ts).num_days();
        let day_key = ts.num_days_from_ce() as i64;

        if age_days < policy.daily_days && daily_seen.insert(day_key) {
            keep.insert(path.clone());
        }
        if age_days < policy.weekly_weeks * 7 && weekly_seen.insert(day_key / 7) {
            keep.insert(path.clone());
        }
        let month_key = ts.year() as i64 * 12 + ts.month() as i64;
        if age_days < policy.monthly_months * 31 && monthly_seen.insert(month_key) {
            keep.insert(path.clone());
        }
    }

    for (path, _) in backups.iter() {
        if !keep.contains(path) {
            if let Err(e) = fs::remove_file(path).await {
                warn!("Failed to remove old backup '{}': {}", path.display(), e);
            } else {
                let meta_path = path.with_extension("backup.meta");
                let _ = fs::remove_file(&meta_path).await;
                info!("GFS prune: removed backup {}", path.display());
            }
        }
    }

    Ok(())
}

/// Valid = parses as a non-empty JSON array.
async fn is_valid_profiles_backup(path: &Path) -> bool {
    match fs::read_to_string(path).await {
        Ok(data) => matches!(
            serde_json::from_str::<Vec<serde_json::Value>>(&data),
            Ok(entries) if !entries.is_empty()
        ),
        Err(_) => false,
    }
}

/// Restores a file from backup. For "profiles", picks the newest backup that is
/// a non-empty JSON array (skips empty/corrupt newest), else the plain newest.
pub async fn restore_from_backup<P: AsRef<Path>>(
    target_path: P,
    category: Option<&str>,
) -> Result<PathBuf> {
    let target_path = target_path.as_ref();

    let backups = list_backups(target_path, category).await?; // newest-first

    let chosen: Option<PathBuf> = if category == Some("profiles") {
        let mut pick = None;
        for (path, _) in &backups {
            if is_valid_profiles_backup(path).await {
                pick = Some(path.clone());
                break;
            }
        }
        pick.or_else(|| backups.first().map(|(p, _)| p.clone()))
    } else {
        backups.first().map(|(p, _)| p.clone())
    };

    if let Some(backup_path) = chosen {
        // Create a timestamped copy of the current file (if it exists) before restoring
        if target_path.exists() {
            let corrupted_path = target_path.with_extension(format!(
                "corrupted.{}",
                Utc::now().format("%Y%m%d_%H%M%S")
            ));
            fs::copy(&target_path, &corrupted_path).await?;
            info!("Saved potentially corrupted file as: {}", corrupted_path.display());
        }

        // Restore from backup
        fs::copy(&backup_path, &target_path).await.map_err(AppError::Io)?;

        info!(
            "Restored '{}' from backup '{}'",
            target_path.display(),
            backup_path.display()
        );

        Ok(target_path.to_path_buf())
    } else {
        Err(AppError::Other(format!(
            "No backup found for '{}'",
            target_path.display()
        )))
    }
}

/// Lists all available backups for a file
pub async fn list_backups<P: AsRef<Path>>(
    source_path: P,
    category: Option<&str>,
) -> Result<Vec<(PathBuf, DateTime<Utc>)>> {
    let source_path = source_path.as_ref();
    let backup_base = ensure_backup_dir(category).await?;

    let original_name = source_path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("unknown");

    let mut backups = Vec::new();

    if let Ok(mut entries) = fs::read_dir(&backup_base).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if let Some(filename) = path.file_name().and_then(OsStr::to_str) {
                if filename.starts_with(original_name) && filename.ends_with(".backup") {
                    if let Ok(metadata) = fs::metadata(&path).await {
                        if let Ok(modified) = metadata.modified() {
                            let modified_dt: DateTime<Utc> = modified.into();
                            backups.push((path, modified_dt));
                        }
                    }
                }
            }
        }
    }

    // Sort by time (newest first)
    backups.sort_by(|a, b| b.1.cmp(&a.1));

    Ok(backups)
}

/// Gets backup statistics
pub async fn get_backup_stats(category: Option<&str>) -> Result<BackupStats> {
    let backup_base = ensure_backup_dir(category).await?;

    let mut total_backups = 0;
    let mut total_size = 0u64;
    let mut oldest_backup: Option<DateTime<Utc>> = None;
    let mut newest_backup: Option<DateTime<Utc>> = None;

    if let Ok(mut entries) = fs::read_dir(&backup_base).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if let Some(filename) = path.file_name().and_then(OsStr::to_str) {
                if filename.ends_with(".backup") {
                    total_backups += 1;

                    if let Ok(metadata) = fs::metadata(&path).await {
                        total_size += metadata.len();

                        if let Ok(modified) = metadata.modified() {
                            let modified_dt: DateTime<Utc> = modified.into();

                            oldest_backup = Some(match oldest_backup {
                                Some(oldest) => oldest.min(modified_dt),
                                None => modified_dt,
                            });

                            newest_backup = Some(match newest_backup {
                                Some(newest) => newest.max(modified_dt),
                                None => modified_dt,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(BackupStats {
        total_backups,
        total_size,
        oldest_backup,
        newest_backup,
    })
}

/// Statistics about backups
#[derive(Debug)]
pub struct BackupStats {
    pub total_backups: usize,
    pub total_size: u64,
    pub oldest_backup: Option<DateTime<Utc>>,
    pub newest_backup: Option<DateTime<Utc>>,
}

/// Safe write operation with automatic backup
pub async fn safe_write_with_backup<P: AsRef<Path>, C: AsRef<[u8]>>(
    file_path: P,
    contents: C,
    category: Option<&str>,
    config: &BackupConfig,
) -> Result<()> {
    let file_path = file_path.as_ref();

    // Create backup if file exists
    if file_path.exists() {
        create_backup(file_path, category, config).await?;
    }

    // Write new content (atomic operation)
    let temp_path = file_path.with_extension("tmp");
    fs::write(&temp_path, contents).await.map_err(AppError::Io)?;

    // Atomic move
    fs::rename(&temp_path, file_path).await.map_err(AppError::Io)?;

    info!("Successfully wrote file with backup: {}", file_path.display());
    Ok(())
}

/// Validates a backup file
pub async fn validate_backup(backup_path: &Path) -> Result<bool> {
    if !backup_path.exists() {
        return Ok(false);
    }

    // Check if metadata file exists
    let meta_path = backup_path.with_extension("backup.meta");
    if !meta_path.exists() {
        warn!("Backup metadata missing for: {}", backup_path.display());
        return Ok(false);
    }

    // Try to read metadata
    match fs::read_to_string(&meta_path).await {
        Ok(metadata) => {
            // Basic validation - check if required fields are present
            let has_original_path = metadata.contains("original_path=");
            let has_backup_time = metadata.contains("backup_time=");
            let has_file_size = metadata.contains("file_size=");

            if !has_original_path || !has_backup_time || !has_file_size {
                warn!("Backup metadata incomplete for: {}", backup_path.display());
                return Ok(false);
            }

            Ok(true)
        }
        Err(e) => {
            error!("Failed to read backup metadata '{}': {}", meta_path.display(), e);
            Ok(false)
        }
    }
}

