use crate::config::HTTP_CONNECT_TIMEOUT;
use crate::error::{AppError, Result as AppResult};
use log::{debug, error, info, trace};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;
use tokio::time::{sleep, Duration};

const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(20);
const UPDATE_CHECK_CACHE_TTL: Duration = Duration::from_secs(60);

struct CachedUpdateCheck {
    checked_at: Instant,
    is_beta_channel: bool,
    result: Option<UpdateInfo>,
}

static LAST_UPDATE_CHECK: Mutex<Option<CachedUpdateCheck>> = Mutex::new(None);

fn cached_update_check(is_beta_channel: bool) -> Option<Option<UpdateInfo>> {
    let guard = LAST_UPDATE_CHECK.lock().ok()?;
    let cached = guard.as_ref()?;
    if cached.is_beta_channel != is_beta_channel
        || cached.checked_at.elapsed() > UPDATE_CHECK_CACHE_TTL
    {
        return None;
    }
    Some(cached.result.clone())
}

fn remember_update_check(is_beta_channel: bool, result: Option<UpdateInfo>) {
    if let Ok(mut guard) = LAST_UPDATE_CHECK.lock() {
        *guard = Some(CachedUpdateCheck {
            checked_at: Instant::now(),
            is_beta_channel,
            result,
        });
    }
}

/// Checks if the application is running inside a Flatpak environment.
///
/// Flatpak sets the environment variable FLATPAK_ID to the application ID of the running app.
///
/// # Returns
///
/// * `bool` - `true` if running in Flatpak, `false` otherwise.
pub fn is_flatpak() -> bool {
    let is_flatpak = std::env::var("FLATPAK_ID").is_ok();

    if is_flatpak {
        info!("Flatpak environment detected (FLATPAK_ID environment variable is set).");
    } else {
        trace!("Not running in Flatpak environment (FLATPAK_ID environment variable not found).");
    }

    is_flatpak
}

pub fn build_updater(
    app_handle: &AppHandle,
    is_beta_channel: bool,
) -> AppResult<tauri_plugin_updater::Updater> {
    let base_repo_url = if is_beta_channel {
        "https://api-staging.norisk.gg/api/v1/launcher/releases-v2"
    } else {
        "https://api.norisk.gg/api/v1/launcher/releases-v2"
    };

    let mut platform_specific_target = "{{target}}".to_string(); // Default: Tauri replaces {{target}}

    if cfg!(target_os = "linux") {
        if std::env::var("APPIMAGE").is_ok() {
            info!("Linux AppImage detected. Updater will use default target for manifest URL.");
            // platform_specific_target remains "{{target}}" for AppImage
        } else {
            let package_target = match tauri::utils::platform::bundle_type() {
                Some(tauri::utils::config::BundleType::Rpm) => "rpm",
                _ => "debian",
            };
            info!(
                "Linux package install detected. Modifying manifest URL to use target: {}",
                package_target
            );
            platform_specific_target = package_target.to_string();
        }
    }

    // Construct the final update URL string
    let update_url_str = std::env::var("NRC_UPDATE_ENDPOINT").unwrap_or_else(|_| {
        format!(
            "{}/{}/{{{{arch}}}}/{{{{current_version}}}}",
            base_repo_url, platform_specific_target
        )
    });

    trace!("Using update endpoint template: {}", update_url_str);

    let update_url = update_url_str.parse()
        .map_err(|e| AppError::Other(format!("Failed to parse update URL '{}': {}", update_url_str, e)))?;

    app_handle
        .updater_builder()
        .configure_client(|c| c.connect_timeout(HTTP_CONNECT_TIMEOUT))
        .endpoints(vec![update_url])
        .map_err(|e| AppError::Other(format!("Failed to set updater endpoints: {}", e)))?
        .build()
        .map_err(|e| AppError::Other(format!("Failed to build updater: {}", e)))
}

/// Checks if an update is available and returns detailed information including the pending update.
/// This version provides all necessary information to proceed with download/installation without redundancy.
///
/// # Arguments
///
/// * `app_handle` - The Tauri AppHandle.
/// * `is_beta_channel` - `true` to check the beta channel, `false` for stable.
///
/// # Returns
///
/// * `Result<Option<UpdateCheckResult>>` - Detailed update information with the pending update, or None if up to date.
pub async fn check_update_available_detailed(
    app_handle: &AppHandle,
    is_beta_channel: bool,
) -> AppResult<Option<UpdateCheckResult>> {
    let current_version = app_handle.package_info().version.to_string();
    let channel = if is_beta_channel { "Beta" } else { "Stable" };

    trace!(
        "Checking for available updates (detailed) (Current: {}). Channel: {}",
        current_version, channel
    );

    let updater = build_updater(app_handle, is_beta_channel)?;

    trace!("Updater built successfully. Checking for updates...");

    let check_result = tokio::time::timeout(UPDATE_CHECK_TIMEOUT, updater.check())
        .await
        .map_err(|_| {
            AppError::Other(format!(
                "Update check timed out after {:?}",
                UPDATE_CHECK_TIMEOUT
            ))
        })?;

    match check_result {
        Ok(Some(update)) => {
            let update_info = UpdateInfo {
                version: update.version.clone(),
                date: update.date.map(|d| format!("{}", d)),
                body: update.body.clone(),
                download_url: None, // TODO: Convert update.download_url to String
            };

            info!(
                "Update check: {} available (current {}, {} channel, released {:?})",
                update.version,
                current_version,
                channel,
                update.date
            );
            remember_update_check(is_beta_channel, Some(update_info.clone()));

            let result = UpdateCheckResult {
                update_info,
                update,
            };

            Ok(Some(result))
        }
        Ok(None) => {
            info!(
                "Update check: up to date ({}, {} channel)",
                current_version, channel
            );
            remember_update_check(is_beta_channel, None);
            Ok(None)
        }
        Err(e) => {
            error!("Error during update check for {} channel: {}", channel, e);
            Err(AppError::Other(format!("Update check error: {}", e)))
        }
    }
}

/// Checks if an update is available without downloading or installing it.
///
/// This function performs the same update check logic as `check_for_updates` but only
/// returns information about available updates without triggering any downloads.
/// This is a lightweight version that only returns UpdateInfo.
///
/// # Arguments
///
/// * `app_handle` - The Tauri AppHandle.
/// * `is_beta_channel` - `true` to check the beta channel, `false` for stable.
///
/// # Returns
///
/// * `Result<Option<UpdateInfo>>` - Information about the available update, or None if up to date.
pub async fn check_update_available(
    app_handle: &AppHandle,
    is_beta_channel: bool,
) -> AppResult<Option<UpdateInfo>> {
    if let Some(cached) = cached_update_check(is_beta_channel) {
        debug!("Update check: serving cached result");
        return Ok(cached);
    }
    // Use the detailed version but only return the UpdateInfo part
    match check_update_available_detailed(app_handle, is_beta_channel).await? {
        Some(result) => Ok(Some(result.update_info)),
        None => Ok(None),
    }
}

// Define the payload structure for updater status events
#[derive(Clone, Serialize)] // Add derive macros
struct UpdaterStatusPayload {
    message: String,
    status: String, // Use String for simplicity, map specific statuses when emitting
    progress: Option<u64>,
    total: Option<u64>,
    chunk: Option<u64>,
}

// Structure to hold available update information
#[derive(Clone, Debug, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub download_url: Option<String>,
}

// Structure to hold update information along with the pending update
pub struct UpdateCheckResult {
    pub update_info: UpdateInfo,
    pub update: tauri_plugin_updater::Update,
}

// Helper function to emit status updates
pub fn emit_status(
    app_handle: &AppHandle,
    status: &str,
    message: String,
    progress_info: Option<(u64, u64)>,
) {
    let payload = UpdaterStatusPayload {
        message,
        status: status.to_string(),
        progress: progress_info.map(|(chunk, total)| chunk * 100 / total.max(1)),
        total: progress_info.map(|(_, total)| total),
        chunk: progress_info.map(|(chunk, _)| chunk),
    };
    if let Err(e) = app_handle.emit("updater_status", payload) {
        error!("Failed to emit updater status event: {}", e);
    }
}

/// Creates and configures the dedicated updater window.
///
/// # Arguments
///
/// * `app_handle` - The Tauri AppHandle.
///
/// # Returns
///
/// * `Result<WebviewWindow>` - The created Tauri webview window instance or an error.
pub fn create_updater_window(app_handle: &AppHandle) -> tauri::Result<WebviewWindow> {
    trace!("Creating updater window...");
    let window = WebviewWindowBuilder::new(
        app_handle,
        "updater",                              // Unique label
        WebviewUrl::App("updater.html".into()), // Load local HTML file
    )
    .title("NoRiskClient Updater")
    .inner_size(325.0, 400.0)
    .resizable(false)
    .center()
    .decorations(false) // Optional: remove window chrome
    .skip_taskbar(false) // Optional: hide from taskbar
    .always_on_top(false) // Keep updater visible
    .visible(false) // Start hidden, show when needed
    .build()?;

    trace!("Updater window created successfully (label: 'updater').");
    Ok(window)
}

/// Downloads and installs an available update, then restarts the application.
/// This is a public version of handle_update for use in commands.
///
/// # Arguments
///
/// * `app_handle` - The Tauri AppHandle.
/// * `is_beta_channel` - `true` to check the beta channel, `false` for stable.
///
/// # Returns
///
/// * `Result<(), AppError>` - Ok if update was successful, Error otherwise.
pub async fn download_and_install_update(
    app_handle: &AppHandle,
    is_beta_channel: bool,
) -> AppResult<()> {
    info!("Starting manual update download and installation process...");

    if let Some(pending) = crate::utils::background_updater::take_pending() {
        info!("Installing the already downloaded update {}", pending.update.version);
        return install_and_restart(&pending.update, &pending.bytes, app_handle);
    }

    // Check for available updates with detailed information
    match check_update_available_detailed(app_handle, is_beta_channel).await? {
        Some(update_check_result) => {
            info!("Update available: {}. Proceeding with download...", update_check_result.update_info.version);

            // Use the update object directly from the check result
            handle_update(update_check_result.update, app_handle.clone()).await
        }
        None => {
            info!("No update available to download");
            Err(AppError::Other("No update available".to_string()))
        }
    }
}

/// Versucht, ein gefundenes Update herunterzuladen, zu installieren und ggf. die App neu zu starten.
async fn handle_update(
    update: tauri_plugin_updater::Update,
    app_handle: AppHandle,
) -> AppResult<()> {
    info!("Attempting to automatically download and install update...");
    emit_status(
        &app_handle,
        "pending",
        "Update found, preparing download...".to_string(),
        None,
    );

    // --- Debug Delay 1 ---
    #[cfg(debug_assertions)]
    {
        info!("DEBUG: Pausing after 'pending' status...");
        sleep(Duration::from_secs(2)).await;
    }
    // --- End Debug Delay ---

    let app_handle_progress = app_handle.clone();
    let mut total_downloaded: u64 = 0; // Track total downloaded bytes

    // Define closures for download progress and finish
    let on_chunk = move |chunk_length: usize, content_length: Option<u64>| {
        let chunk_u64 = chunk_length as u64;
        total_downloaded += chunk_u64; // Accumulate downloaded bytes
        let total_u64_opt = content_length;

        if let Some(total_u64) = total_u64_opt {
            // Use total_downloaded for the message and progress calculation
            let msg = format!(
                "Downloading update: {} / {} bytes",
                total_downloaded, total_u64
            );
            // Log the cumulative progress
            info!("{}", msg);
            // Pass the cumulative total_downloaded to emit_status
            emit_status(
                &app_handle_progress,
                "downloading",
                msg,
                Some((total_downloaded, total_u64)),
            );
        } else {
            // Handle download without total size known
            let msg = format!("Downloading update: {} bytes", total_downloaded); // Show accumulated bytes
            info!("{}", msg);
            let payload = UpdaterStatusPayload {
                message: msg,
                status: "downloading".to_string(),
                progress: None, // No percentage available
                total: None,
                chunk: Some(total_downloaded), // Send accumulated bytes
            };
            if let Err(e) = app_handle_progress.emit("updater_status", payload) {
                error!("Failed to emit updater status event (no total): {}", e);
            }
        }
    };
    let on_download_finish = || {
        info!("Download complete. Preparing installation...");
    };

    // --- Step 1: Download the update ---
    info!("Starting update download...");
    let bytes = update
        .download(on_chunk, on_download_finish) // Use the download method
        .await
        .map_err(|e| {
            error!("Update download failed: {}", e);
            // Convert updater::Error to AppError::Other for download step
            AppError::Other(format!("Updater download error: {}", e))
        })?;
    info!(
        "Update download finished successfully ({} bytes).",
        bytes.len()
    );

    // --- Debug Delay 2 ---
    #[cfg(debug_assertions)]
    {
        info!("DEBUG: Pausing after download completed...");
        sleep(Duration::from_secs(2)).await;
    }
    // --- End Debug Delay ---

    install_and_restart(&update, &bytes, &app_handle)
}

pub fn install_and_restart(
    update: &tauri_plugin_updater::Update,
    bytes: &[u8],
    app_handle: &AppHandle,
) -> AppResult<()> {
    info!("Starting update installation...");
    emit_status(
        app_handle,
        "installing",
        format!("Installing update {}...", update.version),
        None,
    );
    update.install(bytes).map_err(|e| {
        error!("Update installation failed: {}", e);
        AppError::Other(format!("Updater install error: {}", e))
    })?;

    emit_status(
        app_handle,
        "installing",
        "Installation complete.".to_string(),
        None,
    );
    emit_status(
        app_handle,
        "finished",
        "Update installed successfully!".to_string(),
        None,
    );

    #[cfg(not(target_os = "windows"))]
    {
        info!("Attempting to restart the application (non-Windows)...");
        app_handle.restart();
    }

    Ok(())
}
