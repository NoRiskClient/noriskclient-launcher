//! Remembers which cached files already went through their integrity check.
//!
//! Re-hashing a jar on every launch only re-proves what the previous launch proved. A file
//! is trusted again for as long as its size and modification time are the ones recorded
//! when it was checked: a download, a truncation or any other rewrite changes at least one
//! of them and sends the file through the full check again.
//!
//! Corruption that keeps both is not caught here. That is what Repair is for, and it
//! deletes the cached file, so the next launch downloads and checks it from scratch.

use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::utils::file_utils::write_atomic;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::UNIX_EPOCH;

const FILE_NAME: &str = "verified_files.json";

#[derive(Serialize, Deserialize, PartialEq)]
struct Stamp {
    size: u64,
    modified_ns: u64,
    /// The hash the file matched, or `None` when its source publishes no checksum and it
    /// passed the structural check only.
    sha1: Option<String>,
}

#[derive(Default)]
struct Registry {
    stamps: HashMap<PathBuf, Stamp>,
    unsaved: bool,
}

static REGISTRY: LazyLock<Mutex<Registry>> = LazyLock::new(|| {
    let stamps = std::fs::read(registry_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    Mutex::new(Registry { stamps, unsaved: false })
});

fn registry_path() -> PathBuf {
    LAUNCHER_DIRECTORY.meta_dir().join(FILE_NAME)
}

fn registry() -> MutexGuard<'static, Registry> {
    REGISTRY.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

async fn stamp_of(path: &Path, sha1: Option<&str>) -> Option<Stamp> {
    let metadata = tokio::fs::metadata(path).await.ok()?;
    let modified = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some(Stamp {
        size: metadata.len(),
        modified_ns: modified.as_nanos() as u64,
        sha1: sha1.map(str::to_ascii_lowercase),
    })
}

/// Whether `path` is unchanged since it last passed its check. With `expected_sha1` it must
/// also have matched exactly that hash.
pub async fn is_verified(path: &Path, expected_sha1: Option<&str>) -> bool {
    let Some(mut current) = stamp_of(path, None).await else {
        return false;
    };
    let registry = registry();
    let Some(recorded) = registry.stamps.get(path) else {
        return false;
    };
    current.sha1 = match expected_sha1 {
        Some(expected) => Some(expected.to_ascii_lowercase()),
        None => recorded.sha1.clone(),
    };
    *recorded == current
}

/// Records that `path`, as it is on disk now, passed its check.
pub async fn mark_verified(path: &Path, sha1: Option<&str>) {
    if let Some(stamp) = stamp_of(path, sha1).await {
        let mut registry = registry();
        registry.stamps.insert(path.to_path_buf(), stamp);
        registry.unsaved = true;
    }
}

/// Writes new stamps to disk and forgets files that no longer exist. Losing unsaved stamps
/// is harmless: those files are simply checked once more.
pub async fn save() -> Result<()> {
    let contents = tokio::task::spawn_blocking(|| {
        let mut registry = registry();
        if !registry.unsaved {
            return None;
        }
        registry.stamps.retain(|path, _| path.exists());
        registry.unsaved = false;
        serde_json::to_vec(&registry.stamps).ok()
    })
    .await
    .ok()
    .flatten();

    match contents {
        Some(contents) => write_atomic(registry_path(), contents).await,
        None => Ok(()),
    }
}
