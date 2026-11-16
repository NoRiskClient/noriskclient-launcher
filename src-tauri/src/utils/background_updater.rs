use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::state::state_manager::State;
use crate::utils::file_utils::write_atomic_sync;
use crate::utils::metered_network;
use crate::utils::updater_utils;
use log::{error, info, warn};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_updater::Update;

const CHECK_INTERVAL_SECS: std::ops::RangeInclusive<u64> = 5 * 60..=15 * 60;
const RELEASE_FILE: &str = "release.json";
const PACKAGE_FILE: &str = "package";

pub struct PendingUpdate {
    pub update: Update,
    pub bytes: Vec<u8>,
}

#[derive(Debug, PartialEq)]
pub struct DownloadedUpdate {
    pub release: serde_json::Value,
    pub package: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct ReleaseFile {
    beta_channel: bool,
    release: serde_json::Value,
}

static PENDING: Mutex<Option<PendingUpdate>> = Mutex::new(None);

fn pending() -> MutexGuard<'static, Option<PendingUpdate>> {
    PENDING.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn take_pending() -> Option<PendingUpdate> {
    let taken = pending().take();
    if taken.is_some() {
        discard_downloaded(&pending_dir());
    }
    taken
}

fn pending_dir() -> PathBuf {
    LAUNCHER_DIRECTORY.root_dir().join("pending_update")
}

pub fn save_downloaded(
    dir: &Path,
    beta_channel: bool,
    release: &serde_json::Value,
    package: &[u8],
) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    write_atomic_sync(&dir.join(PACKAGE_FILE), package)?;
    let release = ReleaseFile {
        beta_channel,
        release: release.clone(),
    };
    write_atomic_sync(&dir.join(RELEASE_FILE), &serde_json::to_vec(&release)?)
}

pub fn take_downloaded(dir: &Path, beta_channel: bool) -> Option<DownloadedUpdate> {
    let release = std::fs::read(dir.join(RELEASE_FILE));
    let package = std::fs::read(dir.join(PACKAGE_FILE));
    discard_downloaded(dir);
    let release: ReleaseFile = serde_json::from_slice(&release.ok()?).ok()?;
    if release.beta_channel != beta_channel {
        return None;
    }
    Some(DownloadedUpdate {
        release: release.release,
        package: package.ok()?,
    })
}

pub fn discard_downloaded(dir: &Path) {
    if let Err(e) = std::fs::remove_dir_all(dir) {
        if e.kind() != std::io::ErrorKind::NotFound {
            warn!("[Updater] Could not remove the downloaded update: {}", e);
        }
    }
}

async fn update_channel() -> Option<bool> {
    if cfg!(debug_assertions) || updater_utils::is_flatpak() {
        return None;
    }
    let config = State::get().await.ok()?.config_manager.get_config().await;
    config.auto_check_updates.then_some(config.check_beta_channel)
}

pub fn next_check_in() -> Duration {
    Duration::from_secs(rand::thread_rng().gen_range(CHECK_INTERVAL_SECS))
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Some(beta_channel) = update_channel().await {
                if let Err(e) = download_latest(&app, beta_channel).await {
                    warn!("[Updater] Background update failed: {}", e);
                }
            }
            tokio::time::sleep(next_check_in()).await;
        }
    });
}

async fn download_latest(app: &AppHandle, beta_channel: bool) -> Result<()> {
    let Some(found) = updater_utils::check_update_available_detailed(app, beta_channel).await? else {
        return Ok(());
    };
    let update = found.update;
    if pending().as_ref().is_some_and(|p| p.update.version == update.version) {
        return Ok(());
    }
    if metered_network::is_metered().await {
        info!("[Updater] Update {} found, waiting for an unmetered connection to download it", update.version);
        return Ok(());
    }

    info!("[Updater] Downloading update {} in the background", update.version);
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| AppError::Other(format!("Update download failed: {}", e)))?;

    let release = update.raw_json.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        save_downloaded(&pending_dir(), beta_channel, &release, &bytes).map(|()| bytes)
    })
    .await??;

    info!("[Updater] Update {} is ready and installs when the launcher closes", update.version);
    *pending() = Some(PendingUpdate { update, bytes });
    Ok(())
}

pub fn install_on_exit() {
    let Some(PendingUpdate { update, bytes }) = take_pending() else {
        return;
    };
    let version = update.version.clone();
    info!("[Updater] Installing update {} on exit", version);
    if let Err(e) = update.restart_after_install(false).install(&bytes) {
        error!("[Updater] Installing update {} on exit failed: {}", version, e);
    }
}

pub async fn install_from_last_session(
    app: &AppHandle,
    updater_window: impl Future<Output = Option<WebviewWindow>>,
) {
    let Some(beta_channel) = update_channel().await else {
        return;
    };
    let dir = pending_dir();
    let downloaded = tauri::async_runtime::spawn_blocking(move || take_downloaded(&dir, beta_channel))
        .await
        .ok()
        .flatten();
    let Some(downloaded) = downloaded else {
        return;
    };

    let restored = updater_utils::build_updater(app, beta_channel).and_then(|updater| {
        updater
            .restore_update(downloaded.release)
            .map_err(|e| AppError::Other(format!("Restoring the update failed: {}", e)))
    });
    let update = match restored {
        Ok(Some(update)) => update,
        Ok(None) => return,
        Err(e) => {
            warn!("[Updater] Could not restore the downloaded update: {}", e);
            return;
        }
    };

    info!("[Updater] Installing update {} downloaded in the last session", update.version);
    if let Some(window) = updater_window.await {
        if let Err(e) = window.show() {
            error!("[Updater] Failed to show updater window: {}", e);
        }
    }
    if let Err(e) = updater_utils::install_and_restart(&update, &downloaded.package, app) {
        error!("[Updater] Installing update {} failed: {}", update.version, e);
    }
}
