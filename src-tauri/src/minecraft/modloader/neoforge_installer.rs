use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::downloads::{NeoForgeInstallerDownloadService, NeoForgeLibrariesDownload};
use crate::minecraft::launch::neo_forge_arguments::NeoForgeArguments;
use crate::minecraft::launch::version::compare_versions;
use crate::minecraft::{NeoForgeApi, NeoForgePatcher};
use crate::state::event_state::{EventPayload, EventType};
use crate::state::profile_state::Profile;
use crate::state::state_manager::State;
use log::info;
use std::path::PathBuf;
use uuid::Uuid;

pub struct NeoForgeInstaller {
    java_path: PathBuf,
    concurrent_downloads: usize,
}

impl NeoForgeInstaller {
    pub fn new(java_path: PathBuf) -> Self {
        Self {
            java_path,
            concurrent_downloads: 10, // Default value
        }
    }

    pub fn set_concurrent_downloads(&mut self, count: usize) -> &mut Self {
        self.concurrent_downloads = count;
        self
    }

    pub async fn install(
        &self,
        version_id: &str,
        profile: &Profile,
    ) -> Result<NeoForgeInstallResult> {
        let neoforge_event_id = Uuid::new_v4();
        let state = State::get().await?;
        state
            .emit_event(EventPayload {
                event_id: neoforge_event_id,
                event_type: EventType::InstallingNeoForge,
                target_id: Some(profile.id),
                message: "Installing NeoForge...".to_string(),
                progress: Some(0.0),
                error: None,
            })
            .await?;

        info!("\nInstalling NeoForge...");

        let neoforge_api = NeoForgeApi::new();
        let mut neoforge_libraries_download = NeoForgeLibrariesDownload::new();
        let neoforge_installer_download = NeoForgeInstallerDownloadService::new();

        neoforge_libraries_download.set_concurrent_downloads(self.concurrent_downloads);

        let neoforge_metadata = neoforge_api.get_all_versions().await?;
        let compatible_versions = neoforge_metadata.get_versions_for_minecraft(version_id);

        if compatible_versions.is_empty() {
            return Err(AppError::VersionNotFound(format!(
                "No NeoForge versions found for Minecraft {}",
                version_id
            )));
        }

        let target_neoforge_version = match &profile.loader_version {
            Some(specific_version_str) if !specific_version_str.is_empty() => {
                info!(
                    "Attempting to find specific NeoForge version: {}",
                    specific_version_str
                );

                // Check if the specific version exists in the compatible list
                if compatible_versions.contains(specific_version_str) {
                    info!("Found specified NeoForge version: {}", specific_version_str);
                    specific_version_str.clone() // Clone the string to own it
                } else {
                    log::warn!(
                        "Specified NeoForge version '{}' not found or incompatible with MC {}. Falling back to latest.",
                        specific_version_str, version_id
                    );
                    compatible_versions.first().unwrap().clone() // Unsafe unwrap okay due to is_empty check above
                }
            }
            _ => {
                info!(
                    "No specific NeoForge version set in profile, using latest for MC {}.",
                    version_id
                );
                compatible_versions.first().unwrap().clone() // Unsafe unwrap okay due to is_empty check above
            }
        };

        info!("Using NeoForge version: {}", target_neoforge_version);

        state
            .emit_event(EventPayload {
                event_id: neoforge_event_id,
                event_type: EventType::InstallingNeoForge,
                target_id: Some(profile.id),
                message: format!(
                    "NeoForge Version {} wird verwendet",
                    target_neoforge_version
                ),
                progress: Some(0.1),
                error: None,
            })
            .await?;

        state
            .emit_event(EventPayload {
                event_id: neoforge_event_id,
                event_type: EventType::InstallingNeoForge,
                target_id: Some(profile.id),
                message: "Downloading NeoForge installer...".to_string(),
                progress: Some(0.2),
                error: None,
            })
            .await?;

        neoforge_installer_download
            .download_installer(&target_neoforge_version)
            .await?;

        state
            .emit_event(EventPayload {
                event_id: neoforge_event_id,
                event_type: EventType::InstallingNeoForge,
                target_id: Some(profile.id),
                message: "NeoForge Installer wird extrahiert...".to_string(),
                progress: Some(0.3),
                error: None,
            })
            .await?;

        let neoforge_version = neoforge_installer_download
            .extract_version_json(&target_neoforge_version)
            .await?;
        let profile_json = neoforge_installer_download
            .extract_install_profile(&target_neoforge_version)
            .await?;
        neoforge_installer_download
            .extract_data_folder(&target_neoforge_version)
            .await?;
        neoforge_installer_download
            .extract_maven_folder(&target_neoforge_version)
            .await?;
        neoforge_installer_download
            .extract_jars(&target_neoforge_version)
            .await?;

        state
            .emit_event(EventPayload {
                event_id: neoforge_event_id,
                event_type: EventType::InstallingNeoForge,
                target_id: Some(profile.id),
                message: "NeoForge Libraries werden heruntergeladen...".to_string(),
                progress: Some(0.4),
                error: None,
            })
            .await?;

        // Download NeoForge libraries
        neoforge_libraries_download
            .download_libraries(&neoforge_version)
            .await?;
        let libraries = neoforge_libraries_download
            .get_library_paths(&neoforge_version, profile_json.is_none())
            .await?;

        info!("NeoForge Libraries: {:?}", libraries);
        let neo_forge_game_arguments = NeoForgeArguments::get_game_arguments(&neoforge_version);

        // Use determined target_neoforge_version for client path and installer path
        let custom_client_path =
            neoforge_installer_download.get_client_path(&target_neoforge_version);
        let installer_path =
            neoforge_installer_download.get_installer_path(&target_neoforge_version);


        if let Some(neoforge_profile) = profile_json {
            state
                .emit_event(EventPayload {
                    event_id: neoforge_event_id,
                    event_type: EventType::InstallingNeoForge,
                    target_id: Some(profile.id),
                    message: "NeoForge Installer Libraries werden heruntergeladen...".to_string(),
                    progress: Some(0.6),
                    error: None,
                })
                .await?;

            neoforge_libraries_download
                .download_installer_libraries(&neoforge_profile)
                .await?;

            // Prüfen, ob Patching übersprungen werden kann
            let mut should_run_patcher = true;

            if let Some(patched) = neoforge_profile.data.get("PATCHED") {
                let client_path_str = &patched.client;
                // Maven-Koordinaten extrahieren: [group:artifact:version:classifier]
                if client_path_str.starts_with('[') && client_path_str.ends_with(']') {
                    let maven_coords = &client_path_str[1..client_path_str.len() - 1];
                    let parts: Vec<&str> = maven_coords.split(':').collect();

                    if parts.len() >= 4 {
                        let (group, artifact, version, classifier) =
                            (parts[0], parts[1], parts[2], parts[3]);

                        // Berechne Dateipfad
                        let group_path = group.replace('.', "/");
                        let file_name = format!("{}-{}-{}.jar", artifact, version, classifier);

                        let library_path = LAUNCHER_DIRECTORY
                            .meta_dir()
                            .join("libraries")
                            .join(group_path)
                            .join(artifact)
                            .join(version)
                            .join(file_name);

                        info!(
                            "Checking for pre-patched NeoForge client: {}",
                            library_path.display()
                        );

                        // Prüfe ob die Datei existiert
                        if library_path.exists() {
                            info!(
                                "✅ Pre-patched NeoForge client found: {}",
                                library_path.display()
                            );
                            should_run_patcher = false;
                        } else {
                            info!(
                                "❌ Patched NeoForge client file not found, patching required: {}",
                                library_path.display()
                            );
                        }
                    }
                }
            }

            if should_run_patcher {
                state
                    .emit_event(EventPayload {
                        event_id: neoforge_event_id,
                        event_type: EventType::InstallingNeoForge,
                        target_id: Some(profile.id),
                        message: "NeoForge wird gepatcht...".to_string(),
                        progress: Some(0.7),
                        error: None,
                    })
                    .await?;

                let neoforge_patcher = NeoForgePatcher::new(self.java_path.clone(), version_id);
                neoforge_patcher
                    .with_event_id(neoforge_event_id)
                    .with_profile_id(profile.id)
                    .apply_processors(&neoforge_profile, version_id, true, &installer_path)
                    .await?;
            } else {
                state
                    .emit_event(EventPayload {
                        event_id: neoforge_event_id,
                        event_type: EventType::InstallingNeoForge,
                        target_id: Some(profile.id),
                        message:
                            "Vorgepatchte NeoForge-Client Datei gefunden, überspringe Patching..."
                                .to_string(),
                        progress: Some(0.7),
                        error: None,
                    })
                    .await?;
            }

        } else {
            state
                .emit_event(EventPayload {
                    event_id: neoforge_event_id,
                    event_type: EventType::InstallingNeoForge,
                    target_id: Some(profile.id),
                    message: "Legacy NeoForge Libraries werden heruntergeladen...".to_string(),
                    progress: Some(0.8),
                    error: None,
                })
                .await?;

            neoforge_libraries_download
                .download_legacy_libraries(&neoforge_version)
                .await?;
        }

        info!("NeoForge installation completed!");

        state
            .emit_event(EventPayload {
                event_id: neoforge_event_id,
                event_type: EventType::InstallingNeoForge,
                target_id: Some(profile.id),
                message: "NeoForge installation completed!".to_string(),
                progress: Some(1.0),
                error: None,
            })
            .await?;

        let result = NeoForgeInstallResult {
            libraries,
            main_class: neoforge_version.main_class.clone(),
            jvm_args: NeoForgeArguments::get_jvm_arguments(
                &neoforge_version,
                &LAUNCHER_DIRECTORY.meta_dir().join("libraries"),
                // ${version_name} feeds -DignoreList: the jar BootstrapLauncher must NOT turn
                // into a module. NeoForge only exists from 1.20.2 on, so this is always the
                // BootstrapLauncher path and the name has to match the Minecraft jar on the
                // classpath — not the loader version. See forge_installer for the full story.
                version_id,
            ),
            game_args: neo_forge_game_arguments,
            minecraft_arguments: neoforge_version.minecraft_arguments.clone(),
            // NeoForge is module-layer throughout: it finds its patched classes through
            // -DlibraryDirectory, and the patched jar carries code only — assets, data and
            // version.json sit in the client-extra half of the split.
            custom_client_path: None,
        };

        Ok(result)
    }
}

pub struct NeoForgeInstallResult {
    pub libraries: Vec<PathBuf>,
    pub main_class: String,
    pub jvm_args: Vec<String>,
    pub game_args: Vec<String>,
    pub minecraft_arguments: Option<String>,
    pub custom_client_path: Option<PathBuf>,
}
