use crate::error::{AppError, Result as AppResult};
use log::{error, info, warn};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;
use tokio::time::{sleep, Duration};

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
        info!("Not running in Flatpak environment (FLATPAK_ID environment variable not found).");
    }

    is_flatpak
}

/// Checks if an update is available and returns detailed information including the updater instance.
/// This version provides all necessary information to proceed with download/installation without redundancy.
///
/// # Arguments
///
/// * `app_handle` - The Tauri AppHandle.
/// * `is_beta_channel` - `true` to check the beta channel, `false` for stable.
///
/// # Returns
///
/// * `Result<Option<UpdateCheckResult>>` - Detailed update information with updater instance, or None if up to date.
pub async fn check_update_available_detailed(
    app_handle: &AppHandle,
    is_beta_channel: bool,
) -> AppResult<Option<UpdateCheckResult>> {
    let current_version = app_handle.package_info().version.to_string();
    let channel = if is_beta_channel { "Beta" } else { "Stable" };

    info!(
        "Checking for available updates (detailed) (Current: {}). Channel: {}",
        current_version, channel
    );

    // Determine the base part of the URL and the platform-specific segment template
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
            // Not an AppImage, assume .deb or similar package manager context.
            let deb_target_identifier = "debian";
            info!(
                "Linux non-AppImage (e.g., .deb) detected. Modifying manifest URL to use target: {}",
                deb_target_identifier
            );
            platform_specific_target = deb_target_identifier.to_string();
        }
    }

    // Construct the final update URL string
    let update_url_str = format!(
        "{}/{}/{{{{arch}}}}/{{{{current_version}}}}",
        base_repo_url, platform_specific_target
    );

    info!("Using update endpoint template: {}", update_url_str);

    let update_url = update_url_str.parse()
        .map_err(|e| AppError::Other(format!("Failed to parse update URL '{}': {}", update_url_str, e)))?;

    let updater_builder = app_handle.updater_builder().endpoints(vec![update_url])
        .map_err(|e| AppError::Other(format!("Failed to set updater endpoints: {}", e)))?;

    let updater = updater_builder
        .build()
        .map_err(|e| AppError::Other(format!("Failed to build updater: {}", e)))?;

    info!("Updater built successfully. Checking for updates...");

    match updater.check().await {
        Ok(Some(update)) => {
            let update_info = UpdateInfo {
                version: update.version.clone(),
                date: update.date.map(|d| format!("{}", d)),
                body: update.body.clone(),
                download_url: None, // TODO: Convert update.download_url to String
            };

            info!(
                "Update available: Version {}, Released: {:?}",
                update.version,
                update.date
            );

            let result = UpdateCheckResult {
                update_info,
                updater,
                update,
            };

            Ok(Some(result))
        }
        Ok(None) => {
            info!("No update available for the {} channel.", channel);
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

// Structure to hold update information along with the updater instance
pub struct UpdateCheckResult {
    pub update_info: UpdateInfo,
    pub updater: tauri_plugin_updater::Updater,
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
        progress: progress_info.map(|(chunk, total)| (chunk * 100 / total.max(1))),
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
pub async fn create_updater_window(app_handle: &AppHandle) -> tauri::Result<WebviewWindow> {
    info!("Creating updater window...");
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

    info!("Updater window created successfully (label: 'updater').");
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

    // --- Step 2: Install the update ---
    // This block can be commented out for testing to prevent actual installation
    /* START INSTALL BLOCK */
    info!("Starting update installation...");
    update
        .install(bytes) // Use the install method with the downloaded bytes
        .map_err(|e| {
            error!("Update installation failed: {}", e);
            // Convert updater::Error to AppError::Other for install step
            AppError::Other(format!("Updater install error: {}", e))
        })?;
    // Simulate install time if commented out
    #[cfg(debug_assertions)]
    if true {
        // Change to check if install block IS commented out if needed
        info!("DEBUG: Simulating installation time...");
        sleep(Duration::from_secs(2)).await;
        info!("DEBUG: Simulated installation finished.");
    } else {
        info!("DEBUG: Installation block active (no extra delay added here).");
    }
    // Remove the line below if install block is active
    info!("Skipping actual installation (commented out).");
    /* END INSTALL BLOCK */

    // Emit final statuses after successful install (or after download if install is commented out)
    emit_status(
        &app_handle,
        "installing",
        "Installation complete.".to_string(),
        None,
    );
    emit_status(
        &app_handle,
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

/// Prüft auf Anwendungsupdates für den spezifizierten Kanal.
///
/// # Arguments
///
/// * `app_handle` - The Tauri AppHandle.
/// * `is_beta_channel` - `true` to check the beta channel, `false` for stable.
/// * `updater_window` - An optional WebviewWindow handle to show the updater window.
pub async fn check_for_updates(
    app_handle: AppHandle,
    is_beta_channel: bool,
    updater_window: Option<WebviewWindow>,
) {
    let current_version = app_handle.package_info().version.to_string();
    let channel = if is_beta_channel { "Beta" } else { "Stable" };
    let mut final_status: String = "unknown".to_string();
    let mut final_message: String = "Update process ended.".to_string();

    info!(
        "Checking for updates (Current: {}). Channel: {}",
        current_version, channel
    );
    emit_status(
        &app_handle,
        "checking",
        format!("Checking for {} updates...", channel),
        None,
    );

    // Determine the base part of the URL and the platform-specific segment template
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
            // Not an AppImage, assume .deb or similar package manager context.
            // The server must be configured to serve a .deb manifest for this specific target string.
            // IMPORTANT: "debian" is a placeholder. Confirm with your backend/server team
            // what target string they expect for .deb packages (e.g., "debian", "linux-deb").
            let deb_target_identifier = "debian";
            info!(
                "Linux non-AppImage (e.g., .deb) detected. Modifying manifest URL to use target: {}",
                deb_target_identifier
            );
            platform_specific_target = deb_target_identifier.to_string();
        }
    }

    // Construct the final update URL string
    // Tauri will replace {{arch}} and {{current_version}}.
    // {{target}} will also be replaced by Tauri *if* platform_specific_target is "{{target}}".
    // Otherwise, our specific target (e.g., "debian") is used directly.
    let update_url_str = format!(
        "{}/{}/{{{{arch}}}}/{{{{current_version}}}}",
        base_repo_url, platform_specific_target
    );

    info!("Using update endpoint template: {}", update_url_str);

    let update_url = match update_url_str.parse() {
        Ok(url) => url,
        Err(e) => {
            error!("Failed to parse update URL '{}': {}", update_url_str, e);
            final_status = "error".to_string();
            final_message = format!("Failed to parse update URL: {}", e);
            emit_status(&app_handle, &final_status, final_message.clone(), None);
            emit_status(&app_handle, "close", final_message.clone(), None);
            return;
        }
    };

    let updater_result = app_handle.updater_builder().endpoints(vec![update_url]);

    let updater = match updater_result {
        Ok(builder) => match builder.build() {
            Ok(updater) => updater,
            Err(e) => {
                error!("Failed to build updater: {}", e);
                final_status = "error".to_string();
                final_message = format!("Failed to build updater: {}", e);
                emit_status(&app_handle, &final_status, final_message.clone(), None);
                emit_status(&app_handle, "close", final_message.clone(), None);
                return;
            }
        },
        Err(e) => {
            error!("Failed to set updater endpoints: {}", e);
            final_status = "error".to_string();
            final_message = format!("Failed to set updater endpoints: {}", e);
            emit_status(&app_handle, &final_status, final_message.clone(), None);
            emit_status(&app_handle, "close", final_message.clone(), None);
            return;
        }
    };

    info!("Updater built successfully. Checking for updates...");

    match updater.check().await {
        Ok(Some(update)) => {
            let update_version = update.version.clone();
            info!(
                "Update available: Version {}, Released: {:?}, Body:\n{}",
                update.version,
                update.date,
                update.body.as_deref().unwrap_or_default()
            );

            if let Some(win) = &updater_window {
                info!("Update found. Showing updater window...");
                if let Err(e) = win.show() {
                    error!("Failed to show updater window: {}", e);
                }
            } else {
                warn!("Update found, but no updater window handle available to show.");
            }

            emit_status(
                &app_handle,
                "pending",
                format!("Update {} found!", update_version),
                None,
            );

            match handle_update(update, app_handle.clone()).await {
                Ok(_) => {
                    final_status = "finished".to_string();
                    final_message = "Update successful.".to_string();
                }
                Err(e) => {
                    final_status = "error".to_string();
                    final_message = format!("Update download/install failed: {}", e);
                    emit_status(&app_handle, &final_status, final_message.clone(), None);
                }
            }
        }
        Ok(None) => {
            info!("No update available for the {} channel.", channel);
            final_status = "uptodate".to_string();
            final_message = "Application is up to date.".to_string();
            emit_status(&app_handle, &final_status, final_message.clone(), None);
        }
        Err(e) => {
            error!("Error during update check for {} channel: {}", channel, e);
            final_status = "error".to_string();
            final_message = format!("Update check error: {}", e);
            emit_status(&app_handle, &final_status, final_message.clone(), None);
        }
    }

    //TODO: Remove this line when the updater is fully implemented
    emit_status(&app_handle, "close", final_message.clone(), None);
    info!(
        "Update check process fully completed (Status: {}). Final Message: {}",
        final_status, final_message
    );
}
