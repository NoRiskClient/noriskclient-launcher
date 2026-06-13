use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::AppError;
use crate::integrations::norisk_packs;
use crate::state::profile_state;
use crate::state::state_manager::State;
use crate::utils::trash_utils;
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use tokio::fs;

const CLEANUP_INTERVAL_MS: i64 = 24 * 3600 * 1000; // 24h

/// Every filename that ANY profile or ANY pack could place in mod_cache.
/// Pure, in-memory (config + profiles); no FS, no network. Superset keep-set.
pub async fn expected_cache_filenames(state: &State) -> HashSet<String> {
    let mut set = HashSet::new();

    // 1. All packs (resolved) × all mods × all mc/loader targets
    let config = state.norisk_pack_manager.get_config().await;
    for pack_id in config.packs.keys() {
        let resolved = match config.get_resolved_pack_definition(pack_id) {
            Ok(p) => p,
            Err(_) => continue, // missing parent / circular inheritance → skip
        };
        for entry in &resolved.mods {
            for loader_map in entry.compatibility.values() {
                for target in loader_map.values() {
                    let source = target.source.as_ref().unwrap_or(&entry.source);
                    if let Ok(f) =
                        norisk_packs::get_norisk_pack_mod_filename(source, target, &entry.id)
                    {
                        set.insert(f);
                    }
                }
            }
        }
    }

    // 2. All profiles × their own mods
    if let Ok(profiles) = state.profile_manager.list_profiles().await {
        for profile in &profiles {
            for m in &profile.mods {
                if let Ok(f) = profile_state::get_profile_mod_filename(&m.source) {
                    set.insert(f);
                }
            }
        }
    }

    set
}

#[derive(Debug, Serialize)]
pub struct ModCacheCleanupStats {
    /// Total `.jar` files scanned in mod_cache.
    pub scanned: usize,
    /// Filenames deleted (orphans not in the keep-set).
    pub deleted: Vec<String>,
    /// Bytes freed by deletions.
    pub freed_bytes: u64,
    /// Files whose deletion failed (e.g. locked by a running instance).
    pub failed: Vec<String>,
    /// True if the keep-set came back empty (config not loaded) → nothing deleted.
    pub skipped_empty_keepset: bool,
}

/// Move mod_cache jars not in the keep-set (orphans = stale/unused versions) to trash.
/// Guard: an empty keep-set means the config never loaded — abort, touch nothing.
pub async fn clean_mod_cache(state: &State) -> Result<ModCacheCleanupStats, AppError> {
    let keep = expected_cache_filenames(state).await;

    let mut stats = ModCacheCleanupStats {
        scanned: 0,
        deleted: Vec::new(),
        freed_bytes: 0,
        failed: Vec::new(),
        skipped_empty_keepset: false,
    };

    if keep.is_empty() {
        log::warn!("[mod_cache] keep-set is empty (config not loaded?) — skipping cleanup");
        stats.skipped_empty_keepset = true;
        return Ok(stats);
    }

    let cache_dir = LAUNCHER_DIRECTORY.meta_dir().join("mod_cache");
    let mut rd = match fs::read_dir(&cache_dir).await {
        Ok(rd) => rd,
        Err(_) => return Ok(stats), // no cache dir yet → nothing to clean
    };

    while let Some(entry) = rd.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jar") {
            continue; // only ever touch mod jars
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        stats.scanned += 1;
        if keep.contains(&name) {
            continue;
        }
        // orphan → move to trash (recoverable; retention-purged), not hard-deleted
        let size = entry.metadata().await.map(|m| m.len()).unwrap_or(0);
        match trash_utils::move_path_to_trash(&path, Some("mod_cache")).await {
            Ok(_) => {
                stats.freed_bytes += size;
                stats.deleted.push(name);
            }
            Err(e) => {
                log::warn!("[mod_cache] failed to trash orphan {}: {}", name, e);
                stats.failed.push(name);
            }
        }
    }

    log::info!(
        "[mod_cache] cleanup: scanned {}, deleted {}, failed {}, freed {} bytes",
        stats.scanned,
        stats.deleted.len(),
        stats.failed.len(),
        stats.freed_bytes
    );
    Ok(stats)
}

/// Debug only: dump the keep-set sorted, to eyeball against the real mod_cache.
#[tauri::command]
pub async fn debug_list_expected_cache_filenames() -> Result<Vec<String>, crate::error::CommandError>
{
    let state = State::get().await?;
    let mut names: Vec<String> = expected_cache_filenames(&state).await.into_iter().collect();
    names.sort();
    log::info!("[mod_cache] expected keep-set: {} filenames", names.len());
    for f in &names {
        log::info!("[mod_cache]   keep: {}", f);
    }
    Ok(names)
}

/// Trash orphaned mod_cache jars (not in the keep-set). Returns what was moved.
#[tauri::command]
pub async fn clean_mod_cache_command() -> Result<ModCacheCleanupStats, crate::error::CommandError> {
    let state = State::get().await?;
    Ok(clean_mod_cache(&state).await?)
}

fn last_cleanup_path() -> PathBuf {
    LAUNCHER_DIRECTORY.meta_dir().join("mod_cache_last_cleanup")
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

async fn cleanup_is_due() -> bool {
    match fs::read_to_string(last_cleanup_path()).await {
        Ok(c) => match c.trim().parse::<i64>() {
            // saturating: future ts (clock skew) or huge-negative corrupt value → no overflow panic
            Ok(last) => now_millis().saturating_sub(last) >= CLEANUP_INTERVAL_MS,
            Err(_) => true, // corrupt → due (fail-open: cleanup is cheap+safe)
        },
        Err(_) => true, // no record → due
    }
}

async fn stamp_cleanup_now() {
    let path = last_cleanup_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent).await;
    }
    let _ = fs::write(&path, now_millis().to_string()).await;
}

/// Startup entry: debounced (1×/24h), best-effort. Never panics, swallows all errors.
pub async fn run_startup_cleanup() {
    if !cleanup_is_due().await {
        log::info!("[mod_cache] startup cleanup skipped (ran <24h ago)");
        return;
    }
    let state = match State::get().await {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[mod_cache] startup cleanup: state unavailable: {}", e);
            return;
        }
    };
    match clean_mod_cache(&state).await {
        Ok(stats) if stats.skipped_empty_keepset => {
            // config not loaded / fresh install → do NOT stamp → retry next startup
            log::info!("[mod_cache] startup cleanup deferred (empty keep-set)");
        }
        Ok(stats) => {
            log::info!(
                "[mod_cache] startup cleanup: deleted {}, failed {}, freed {} bytes",
                stats.deleted.len(),
                stats.failed.len(),
                stats.freed_bytes
            );
            stamp_cleanup_now().await; // stamp only on a real completed run
        }
        Err(e) => log::warn!("[mod_cache] startup cleanup failed: {}", e),
    }
}
