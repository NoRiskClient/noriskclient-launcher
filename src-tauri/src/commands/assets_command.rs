use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, CommandError};
use crate::utils::download_utils::{DownloadConfig, DownloadUtils};
use log::{debug, error, info};
use std::path::PathBuf;
use tauri::command;
use url::Url;

type Result<T> = std::result::Result<T, CommandError>;

/// Gets or downloads an asset model file from a CDN URL.
/// 
/// The function first checks if the file exists locally. If it does, it returns the local path immediately.
/// If not, it downloads the file from the URL and saves it to the local assets directory.
/// 
/// # Arguments
/// 
/// * `url` - The CDN URL of the asset model (e.g., "https://cdn.norisk.gg/asset-models/cosmetics/hat/amethyst_halo/amethyst_halo.gltf")
/// 
/// # Returns
/// 
/// * `Result<String>` - The local file path as a string, or an error if the download fails.
#[command]
pub async fn get_or_download_asset_model(url: &str) -> Result<String> {
    info!("get_or_download_asset_model called with URL: {}", url);

    // Parse the URL to extract the path components
    let parsed_url = Url::parse(url).map_err(|e| {
        error!("Failed to parse URL {}: {}", url, e);
        AppError::InvalidInput(format!("Invalid URL: {}", e))
    })?;

    // Extract the relative path from the URL (e.g., "/asset-models/cosmetics/hat/amethyst_halo/amethyst_halo.gltf")
    let url_path = parsed_url.path();
    
    // Remove leading slash and split into components
    let path_components: Vec<&str> = url_path
        .trim_start_matches('/')
        .split('/')
        .collect();

    if path_components.is_empty() {
        return Err(AppError::InvalidInput("URL path is empty".to_string()).into());
    }

    // Build the local path: meta/assets/assets-models/...
    let assets_dir = LAUNCHER_DIRECTORY.meta_dir().join("assets").join("assets-models");
    
    // Reconstruct the relative path from URL components (skip "asset-models" if present)
    let relative_path: PathBuf = if path_components[0] == "asset-models" {
        path_components[1..].iter().collect()
    } else {
        path_components.iter().collect()
    };

    let local_file_path = assets_dir.join(&relative_path);

    debug!(
        "Resolved local path: {:?} from URL: {}",
        local_file_path, url
    );

    // Check if file already exists
    let file_exists = local_file_path.exists();
    
    if file_exists {
        info!(
            "Asset model exists locally: {:?}, returning immediately and updating in background",
            local_file_path
        );
        
        // Return immediately with existing file path
        // Start background download to update the file
        let url_clone = url.to_string();
        let path_clone = local_file_path.clone();
        
        tokio::spawn(async move {
            // Ensure parent directories exist
            if let Some(parent) = path_clone.parent() {
                if let Err(e) = tokio::fs::create_dir_all(parent).await {
                    error!("Failed to create parent directory {:?}: {}", parent, e);
                    return;
                }
            }

            // Download the file using DownloadUtils (always overwrite to get latest version)
            let config = DownloadConfig::default()
                .with_streaming(true)
                .with_force_overwrite(true);

            match DownloadUtils::download_file(&url_clone, &path_clone, config).await {
                Ok(()) => {
                    info!(
                        "Successfully updated asset model in background: {:?}",
                        path_clone
                    );
                }
                Err(e) => {
                    error!("Failed to update asset model in background from {}: {}", url_clone, e);
                }
            }
        });
        
        // Return immediately with existing file path
        return Ok(local_file_path.to_string_lossy().to_string());
    }

    // File doesn't exist, download it synchronously (blocking)
    info!("Asset model not found locally, downloading from: {}", url);

    // Ensure parent directories exist
    if let Some(parent) = local_file_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            error!("Failed to create parent directory {:?}: {}", parent, e);
            AppError::Io(e)
        })?;
    }

    // Download the file using DownloadUtils (always overwrite to get latest version)
    let config = DownloadConfig::default()
        .with_streaming(true)
        .with_force_overwrite(true);

    DownloadUtils::download_file(url, &local_file_path, config)
        .await
        .map_err(|e| {
            error!("Failed to download asset model from {}: {}", url, e);
            AppError::Download(format!("Failed to download asset model: {}", e))
        })?;

    info!(
        "Successfully downloaded asset model to: {:?}",
        local_file_path
    );

    Ok(local_file_path.to_string_lossy().to_string())
}

