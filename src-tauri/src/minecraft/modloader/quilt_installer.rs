use crate::error::Result;
use crate::minecraft::api::quilt_api::QuiltApi;
use crate::minecraft::downloads::quilt_libraries_download::QuiltLibrariesDownloadService;
use crate::minecraft::dto::quilt_meta::QuiltVersionInfo;
use crate::state::event_state::{EventPayload, EventType};
use crate::state::profile_state::Profile;
use crate::state::state_manager::State;
use log::info;
use std::path::PathBuf;
use uuid::Uuid;

pub struct QuiltInstaller {
    concurrent_downloads: usize,
}

impl QuiltInstaller {
    pub fn new() -> Self {
        Self {
            concurrent_downloads: 10, // Default value
        }
    }

    pub fn set_concurrent_downloads(&mut self, count: usize) -> &mut Self {
        self.concurrent_downloads = count;
        self
    }

    pub async fn install(&self, version_id: &str, profile: &Profile) -> Result<Vec<PathBuf>> {
        // Emit Quilt installation event
        let quilt_event_id = Uuid::new_v4();
        let state = State::get().await?;
        state
            .emit_event(EventPayload {
                event_id: quilt_event_id,
                event_type: EventType::InstallingQuilt,
                target_id: Some(profile.id),
                message: "Installing Quilt...".to_string(),
                progress: Some(0.0),
                error: None,
            })
            .await?;

        info!("Installing Quilt...");
        let quilt_api = QuiltApi::new();
        let mut quilt_libraries_download = QuiltLibrariesDownloadService::new();

        // Setze die Anzahl der konkurrenten Downloads
        quilt_libraries_download.set_concurrent_downloads(self.concurrent_downloads);

        // --- Determine Quilt Version ---
        let quilt_version = match &profile.loader_version {
            Some(specific_version_str) if !specific_version_str.is_empty() => {
                info!(
                    "Attempting to find specific Quilt version: {}",
                    specific_version_str
                );
                let all_versions = quilt_api.get_loader_versions(version_id).await?;

                // Strip " (stable)" suffix if present for comparison
                let target_version = specific_version_str.trim_end_matches(" (stable)").trim();

                match all_versions
                    .into_iter()
                    .find(|v| v.loader.version == target_version)
                {
                    Some(found_version) => {
                        info!("Found specified Quilt version: {}", specific_version_str);
                        found_version
                    }
                    None => {
                        log::warn!(
                            "Specified Quilt version '{}' not found for MC {}. Falling back to latest stable.",
                            specific_version_str, version_id
                        );
                        // Fallback to latest stable if specific version not found
                        quilt_api.get_latest_stable_version(version_id).await?
                    }
                }
            }
            _ => {
                // Fallback to latest stable if no specific version is set in the profile
                info!("No specific Quilt version set in profile, using latest stable.");
                quilt_api.get_latest_stable_version(version_id).await?
            }
        };
        // --- End Determine Quilt Version ---

        info!(
            "Using Quilt version: {} (Stable: {})",
            quilt_version.loader.version, quilt_version.loader.stable
        );

        quilt_libraries_download
            .download_quilt_libraries(&quilt_version) // Use the determined version
            .await?;
        info!("Quilt installation completed!");

        state
            .emit_event(EventPayload {
                event_id: quilt_event_id,
                event_type: EventType::InstallingQuilt,
                target_id: Some(profile.id),
                message: "Quilt installation completed!".to_string(),
                progress: Some(1.0),
                error: None,
            })
            .await?;

        // Collect library paths for the determined version
        let libraries = quilt_libraries_download
            .get_library_paths(&quilt_version)
            .await?;

        Ok(libraries)
    }

    pub fn get_main_class(&self, quilt_version: &QuiltVersionInfo) -> String {
        quilt_version.launcher_meta.main_class.get_client()
    }
}
