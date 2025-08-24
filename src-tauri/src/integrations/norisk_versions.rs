use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::state::profile_state::Profile;
use crate::state::state_manager::State;
use log::{self, error, info, warn};
use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use tokio::fs;

const NORISK_API_BASE_URL: &str = "https://api.noriskclient.com/v1";

/// Helper to compute versions file path based on experimental flag
fn norisk_versions_path_for(is_experimental: bool) -> PathBuf {
    let filename = if is_experimental {
        "norisk_versions_exp.json"
    } else {
        "norisk_versions.json"
    };
    LAUNCHER_DIRECTORY.root_dir().join(filename)
}

/// Represents the overall structure of the standard profiles from the backend
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NoriskVersionsConfig {
    /// A list of standard profiles
    pub profiles: Vec<Profile>,
}

impl Default for NoriskVersionsConfig {
    fn default() -> Self {
        Self { profiles: vec![] }
    }
}

/// Loads standard profiles from the local `norisk_versions.json` file.
/// Returns an empty config if the file doesn't exist.
pub async fn load_local_standard_profiles() -> Result<NoriskVersionsConfig> {
    let file_path = if let Ok(state) = State::get().await {
        let is_exp = state.config_manager.is_experimental_mode().await;
        norisk_versions_path_for(is_exp)
    } else {
        LAUNCHER_DIRECTORY.root_dir().join("norisk_versions.json")
    };

    info!(
        "Attempting to load local standard profiles from: {:?}",
        file_path
    );

    if !file_path.exists() {
        warn!(
            "Local standard profiles file not found at {:?}. Returning empty config.",
            file_path
        );
        return Ok(NoriskVersionsConfig { profiles: vec![] });
    }

    let data = fs::read_to_string(&file_path).await.map_err(|e| {
        error!(
            "Failed to read local standard profiles file {:?}: {}",
            file_path, e
        );
        AppError::Io(e)
    })?;

    let profiles_config: NoriskVersionsConfig = serde_json::from_str(&data).map_err(|e| {
        error!(
            "Failed to parse local standard profiles file {:?}: {}",
            file_path, e
        );
        AppError::ParseError(format!("Failed to parse norisk_versions.json: {}", e))
    })?;

    info!(
        "Successfully loaded {} local standard profiles from {:?}",
        profiles_config.profiles.len(),
        file_path
    );
    Ok(profiles_config)
}

/// Copies a dummy/default `norisk_versions.json` from the project's source directory
/// (assuming a development environment structure) to the launcher's root directory
/// if it doesn't already exist.
///
/// Note: This path resolution using CARGO_MANIFEST_DIR might not work correctly
/// in a packaged production build. Consider using Tauri's resource resolver for that.
pub async fn load_dummy_versions() -> Result<()> {
    let target_dir = LAUNCHER_DIRECTORY.root_dir();
    // Choose target file based on experimental mode when available
    let target_file = if let Ok(state) = State::get().await {
        let is_exp = state.config_manager.is_experimental_mode().await;
        norisk_versions_path_for(is_exp)
    } else {
        target_dir.join("norisk_versions.json")
    };

    if target_file.exists() {
        //info!("Target file {:?} already exists. Skipping dummy version loading.", target_file);
        //return Ok(());
    }

    // --- Path resolution based on CARGO_MANIFEST_DIR ---
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // Assuming the project root is one level above the crate's manifest (src-tauri)
    let project_root = manifest_dir.parent().ok_or_else(|| {
        AppError::Other("Failed to get parent directory of CARGO_MANIFEST_DIR".to_string())
    })?;

    let source_path = project_root.join("minecraft-data/nrc/norisk_versions.json");
    // --- End path resolution ---

    if source_path.exists() {
        info!("Found dummy versions source at: {:?}", source_path);
        // Ensure the target directory exists
        fs::create_dir_all(&target_dir).await.map_err(|e| {
            error!("Failed to create target directory {:?}: {}", target_dir, e);
            AppError::Io(e)
        })?;

        // Copy the file
        fs::copy(&source_path, &target_file).await.map_err(|e| {
            error!(
                "Failed to copy dummy versions from {:?} to {:?}: {}",
                source_path, target_file, e
            );
            AppError::Io(e)
        })?;
        info!("Successfully copied dummy versions to {:?}", target_file);
    } else {
        error!(
            "Dummy versions source file not found at expected path: {:?}",
            source_path
        );
        // Use a more general error as it's not a Tauri resource issue anymore
        return Err(AppError::Other(format!(
            "Source file not found for dummy versions: {}",
            source_path.display()
        )));
    }

    Ok(())
}
