use std::path::{Path, PathBuf};
use std::sync::RwLock;

use once_cell::sync::Lazy;
use serde::Serialize;

use crate::commands::analytics_command::{megabytes, tenths, track};
use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::utils::download_utils::{DownloadConfig, DownloadUtils};

const ENGINE_NAMES: [&str; 2] = [
    "norisk-capture.exe",
    "norisk-capture-x86_64-pc-windows-msvc.exe",
];
const COMPLETE_MARKER: &str = ".complete";
const SHA256_LEN: usize = 64;
const DIR_NAME_LEN: usize = 16;

const RUNTIME_LIBRARIES: [&str; 6] = [
    "avcodec-62.dll",
    "avformat-62.dll",
    "avutil-60.dll",
    "swresample-6.dll",
    "graphics-hook64.dll",
    "graphics-hook32.dll",
];
const RUNTIME_LICENCES: [&str; 3] = [
    "ffmpeg-LICENSE.txt",
    "ffmpeg-NOTICE.txt",
    "graphics-hook-NOTICE.txt",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum RuntimeState {
    Ready,
    Missing,
    Downloading { downloaded: u64, total: Option<u64> },
    Failed { message: String },
}

static STATE: Lazy<RwLock<RuntimeState>> = Lazy::new(|| RwLock::new(RuntimeState::Missing));
static INSTALL_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));

static PINNED: Lazy<Option<(&'static str, &'static str)>> = Lazy::new(|| {
    let sha = option_env!("NRC_CAPTURE_RUNTIME_SHA256")?;
    let url = option_env!("NRC_CAPTURE_RUNTIME_URL")?;

    if !is_sha256(sha) {
        log::error!("Ignoring a capture runtime pin: the hash is not a SHA256 digest");
        return None;
    }
    if !url.starts_with("https://") {
        log::error!("Ignoring a capture runtime pin: the URL is not https");
        return None;
    }
    Some((sha, url))
});

fn is_sha256(value: &str) -> bool {
    value.len() == SHA256_LEN && value.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn state() -> RuntimeState {
    let current = STATE.read().unwrap_or_else(|e| e.into_inner()).clone();
    if current == RuntimeState::Missing && installed_engine().is_some() {
        set_state(RuntimeState::Ready);
        return RuntimeState::Ready;
    }
    current
}

fn set_state(next: RuntimeState) {
    *STATE.write().unwrap_or_else(|e| e.into_inner()) = next;
}

pub fn installed_engine() -> Option<PathBuf> {
    match *PINNED {
        Some((sha, _)) => {
            let dir = runtime_dir(sha);
            dir.join(COMPLETE_MARKER)
                .is_file()
                .then(|| engine_in(&dir))
                .flatten()
        }
        None => engine_next_to_launcher(),
    }
}

pub async fn ensure_engine() -> Result<PathBuf> {
    if !cfg!(windows) {
        return Ok(PathBuf::new());
    }
    if let Some(engine) = installed_engine() {
        return Ok(engine);
    }

    let Some((sha, url)) = *PINNED else {
        return Err(AppError::Other(
            "norisk-capture.exe was not found next to the launcher. \
             Build it with: cargo build -p norisk-capture"
                .into(),
        ));
    };

    let _guard = INSTALL_LOCK.lock().await;
    if let Some(engine) = installed_engine() {
        return Ok(engine);
    }

    match download_and_unpack(sha, url).await {
        Ok(engine) => {
            set_state(RuntimeState::Ready);
            Ok(engine)
        }
        Err(e) => {
            set_state(RuntimeState::Failed {
                message: e.to_string(),
            });
            Err(e)
        }
    }
}

pub fn remove_legacy_install_files() {
    if PINNED.is_none() {
        return;
    }
    let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    else {
        return;
    };

    let mut removed = 0;
    let candidates = ENGINE_NAMES
        .iter()
        .chain(RUNTIME_LIBRARIES.iter())
        .map(|name| dir.join(name))
        .chain(
            RUNTIME_LICENCES
                .iter()
                .map(|name| dir.join("licenses").join(name)),
        );
    for path in candidates {
        if !path.is_file() {
            continue;
        }
        match std::fs::remove_file(&path) {
            Ok(()) => removed += 1,
            Err(e) => log::debug!("Could not remove {}: {e}", path.display()),
        }
    }
    let _ = std::fs::remove_dir(dir.join("licenses"));

    if removed > 0 {
        log::info!("Removed {removed} capture file(s) left behind by an older installer");
    }
}

async fn download_and_unpack(sha: &str, url: &str) -> Result<PathBuf> {
    let started = std::time::Instant::now();
    let dir = runtime_dir(sha);
    let base = capture_base_dir();
    tokio::fs::create_dir_all(&base).await?;

    let archive = base.join(format!("{}.zip", short_name(sha)));
    set_state(RuntimeState::Downloading {
        downloaded: 0,
        total: None,
    });
    log::info!("Downloading the capture runtime from {url}");

    let config = DownloadConfig::new()
        .with_sha256(sha)
        .with_force_overwrite(true)
        .with_progress_callback(|downloaded, total| {
            set_state(RuntimeState::Downloading { downloaded, total });
        });
    DownloadUtils::download_file(url, &archive, config)
        .await
        .map_err(|e| AppError::Other(format!("capture runtime download failed: {e}")))?;

    let unpack_dir = dir.clone();
    let unpack_archive = archive.clone();
    tokio::task::spawn_blocking(move || unpack(&unpack_archive, &unpack_dir))
        .await
        .map_err(|e| AppError::Other(format!("capture runtime unpack task failed: {e}")))??;
    let _ = tokio::fs::remove_file(&archive).await;

    let engine = engine_in(&dir).ok_or_else(|| {
        AppError::Other("the capture runtime archive holds no norisk-capture.exe".into())
    })?;
    tokio::fs::write(dir.join(COMPLETE_MARKER), sha).await?;
    remove_stale_runtimes(&dir).await;

    let size = crate::utils::path_utils::calculate_dir_size_recursively(&dir)
        .await
        .unwrap_or(0);
    log::info!(
        "Capture runtime ready in {} ({:.0} MB, {:.1}s)",
        dir.display(),
        size as f64 / 1e6,
        started.elapsed().as_secs_f64()
    );
    track(
        "clip_runtime_downloaded",
        serde_json::json!({
            "seconds": tenths(started.elapsed().as_secs_f64()),
            "size_mb": megabytes(size),
        }),
    );

    Ok(engine)
}

fn unpack(archive: &Path, dir: &Path) -> Result<()> {
    if dir.exists() {
        std::fs::remove_dir_all(dir)?;
    }
    std::fs::create_dir_all(dir)?;

    let file = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Other(format!("capture runtime archive is unreadable: {e}")))?;
    zip.extract(dir)
        .map_err(|e| AppError::Other(format!("capture runtime could not be unpacked: {e}")))?;
    Ok(())
}

async fn remove_stale_runtimes(keep: &Path) {
    let base = capture_base_dir();
    if keep.parent() != Some(base.as_path()) {
        return;
    }
    let Ok(mut entries) = tokio::fs::read_dir(&base).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        if path == keep {
            continue;
        }
        if path.is_dir() {
            if let Err(e) = tokio::fs::remove_dir_all(&path).await {
                log::debug!(
                    "Could not remove an older capture runtime {}: {e}",
                    path.display()
                );
            }
        } else {
            let _ = tokio::fs::remove_file(&path).await;
        }
    }
}

fn capture_base_dir() -> PathBuf {
    LAUNCHER_DIRECTORY.root_dir().join("capture")
}

fn runtime_dir(sha: &str) -> PathBuf {
    capture_base_dir().join(short_name(sha))
}

fn short_name(sha: &str) -> &str {
    debug_assert!(is_sha256(sha));
    &sha[..DIR_NAME_LEN.min(sha.len())]
}

fn engine_in(dir: &Path) -> Option<PathBuf> {
    ENGINE_NAMES
        .iter()
        .map(|name| dir.join(name))
        .find(|candidate| candidate.is_file())
}

fn engine_next_to_launcher() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    engine_in(dir).or_else(|| engine_in(&dir.join("../../binaries")))
}
