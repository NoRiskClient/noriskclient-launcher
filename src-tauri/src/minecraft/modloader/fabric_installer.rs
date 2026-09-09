use crate::error::Result;
use crate::minecraft::api::fabric_api::FabricApi;
use crate::minecraft::downloads::fabric_libraries_download::FabricLibrariesDownloadService;
use crate::minecraft::dto::fabric_meta::FabricVersionInfo;
use crate::state::event_state::{EventPayload, EventType};
use crate::state::profile_state::Profile;
use crate::state::state_manager::State;
use log::info;
use std::path::PathBuf;
use uuid::Uuid;

pub struct FabricInstaller {
    concurrent_downloads: usize,
}

impl FabricInstaller {
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
        // Emit Fabric installation event
        let fabric_event_id = Uuid::new_v4();
        let state = State::get().await?;
        state
            .emit_event(EventPayload {
                event_id: fabric_event_id,
                event_type: EventType::InstallingFabric,
                target_id: Some(profile.id),
                message: "Installing Fabric...".to_string(),
                progress: Some(0.0),
                error: None,
            })
            .await?;

        info!("Installing Fabric...");
        let fabric_api = FabricApi::new();
        let mut fabric_libraries_download = FabricLibrariesDownloadService::new();

        // Setze die Anzahl der konkurrenten Downloads
        fabric_libraries_download.set_concurrent_downloads(self.concurrent_downloads);

        // --- Determine Fabric Version ---
        let fabric_version = match &profile.loader_version {
            Some(specific_version_str) if !specific_version_str.is_empty() => {
                info!(
                    "Attempting to find specific Fabric version: {}",
                    specific_version_str
                );
                let all_versions = fabric_api.get_loader_versions(version_id).await?;

                // Strip " (stable)" suffix if present for comparison
                let target_version = specific_version_str.trim_end_matches(" (stable)").trim();

                match all_versions
                    .into_iter()
                    .find(|v| v.loader.version == target_version)
                {
                    Some(found_version) => {
                        info!("Found specified Fabric version: {}", specific_version_str);
                        found_version
                    }
                    None => {
                        log::warn!(
                            "Specified Fabric version '{}' not found for MC {}. Falling back to latest stable.",
                            specific_version_str, version_id
                        );
                        // Fallback to latest stable if specific version not found
                        fabric_api.get_latest_stable_version(version_id).await?
                    }
                }
            }
            _ => {
                // Fallback to latest stable if no specific version is set in the profile
                info!("No specific Fabric version set in profile, using latest stable.");
                fabric_api.get_latest_stable_version(version_id).await?
            }
        };
        // --- End Determine Fabric Version ---

        info!(
            "Using Fabric version: {} (Stable: {})",
            fabric_version.loader.version, fabric_version.loader.stable
        );

        fabric_libraries_download
            .download_fabric_libraries(&fabric_version) // Use the determined version
            .await?;
        info!("Fabric installation completed!");

        state
            .emit_event(EventPayload {
                event_id: fabric_event_id,
                event_type: EventType::InstallingFabric,
                target_id: Some(profile.id),
                message: "Fabric installation completed!".to_string(),
                progress: Some(1.0),
                error: None,
            })
            .await?;

        // Collect library paths for the determined version
        let libraries = fabric_libraries_download
            .get_library_paths(&fabric_version)
            .await?;

        Ok(libraries)
    }

    pub fn get_main_class(&self, fabric_version: &FabricVersionInfo) -> String {
        fabric_version.launcher_meta.main_class.get_client()
    }
}
