use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::minecraft::api::forge_api::ForgeApi;
use crate::minecraft::dto::forge_install_profile::ForgeInstallProfile;
use crate::minecraft::downloads::{ForgeInstallerDownloadService, ForgeLibrariesDownload};
use crate::minecraft::launch::forge_arguments::ForgeArguments;
use crate::minecraft::ForgePatcher;
use crate::state::event_state::{EventPayload, EventType};
use crate::state::profile_state::Profile;
use crate::state::state_manager::State;
use log::info;
use std::path::PathBuf;
use uuid::Uuid;

pub struct ForgeInstaller {
    java_path: PathBuf,
    concurrent_downloads: usize,
}

impl ForgeInstaller {
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

    pub async fn install(&self, version_id: &str, profile: &Profile) -> Result<ForgeInstallResult> {
        let forge_event_id = Uuid::new_v4();
        let state = State::get().await?;
        state
            .emit_event(EventPayload {
                event_id: forge_event_id,
                event_type: EventType::InstallingForge,
                target_id: Some(profile.id),
                message: "Installing Forge...".to_string(),
                progress: Some(0.0),
                error: None,
            })
            .await?;

        info!("Installing Forge...");

        let forge_api = ForgeApi::new();
        let mut forge_libraries_download = ForgeLibrariesDownload::new();
        let forge_installer_download = ForgeInstallerDownloadService::new();

        forge_libraries_download.set_concurrent_downloads(self.concurrent_downloads);

        let forge_metadata = forge_api.get_all_versions().await?;
        let compatible_versions = forge_metadata.get_versions_for_minecraft(version_id);

        if compatible_versions.is_empty() {
            return Err(AppError::VersionNotFound(format!(
                "No Forge versions found for Minecraft {}",
                version_id
            )));
        }

        let target_forge_version = match &profile.loader_version {
            Some(specific_version_str) if !specific_version_str.is_empty() => {
                info!(
                    "Attempting to find specific Forge version: {}",
                    specific_version_str
                );

                // compatible_versions holds full Maven strings ("1.20.1-47.4.20"), while a
                // profile — and a .mrpack's `dependencies.forge` — usually carries just the
                // build ("47.4.20"). Comparing the two directly never matches, so every pack
                // with a pinned Forge version silently fell back to latest. Accept both.
                let wanted = specific_version_str.trim();
                let prefix = format!("{}-", version_id);
                let matched = compatible_versions.iter().find(|candidate| {
                    candidate.as_str() == wanted
                        || candidate
                            .strip_prefix(prefix.as_str())
                            .map_or(false, |build| build == wanted)
                });

                if let Some(found) = matched {
                    info!("Found specified Forge version: {}", found);
                    found.clone()
                } else {
                    log::warn!(
                        "Specified Forge version '{}' not found or incompatible with MC {}. Falling back to latest.",
                        specific_version_str, version_id
                    );
                    compatible_versions.first().unwrap().clone() // Unsafe unwrap okay due to is_empty check above
                }
            }
            _ => {
                info!(
                    "No specific Forge version set in profile, using latest for MC {}.",
                    version_id
                );
                compatible_versions.first().unwrap().clone() // Unsafe unwrap okay due to is_empty check above
            }
        };

        info!("Using Forge version: {}", target_forge_version);

        state
            .emit_event(EventPayload {
                event_id: forge_event_id,
                event_type: EventType::InstallingForge,
                target_id: Some(profile.id),
                message: format!("Forge Version {} wird verwendet", target_forge_version),
                progress: Some(0.1),
                error: None,
            })
            .await?;

        state
            .emit_event(EventPayload {
                event_id: forge_event_id,
                event_type: EventType::InstallingForge,
                target_id: Some(profile.id),
                message: "Downloading Forge installer...".to_string(),
                progress: Some(0.2),
                error: None,
            })
            .await?;

        forge_installer_download
            .download_installer(&target_forge_version)
            .await?;

        state
            .emit_event(EventPayload {
                event_id: forge_event_id,
                event_type: EventType::InstallingForge,
                target_id: Some(profile.id),
                message: "Forge Installer wird extrahiert...".to_string(),
                progress: Some(0.3),
                error: None,
            })
            .await?;

        let forge_version = forge_installer_download
            .extract_version_json(&target_forge_version)
            .await?;
        let profile_json = forge_installer_download
            .extract_install_profile(&target_forge_version)
            .await?;
        forge_installer_download
            .extract_data_folder(&target_forge_version)
            .await?;
        forge_installer_download
            .extract_maven_folder(&target_forge_version)
            .await?;
        forge_installer_download
            .extract_jars(&target_forge_version)
            .await?;

        state
            .emit_event(EventPayload {
                event_id: forge_event_id,
                event_type: EventType::InstallingForge,
                target_id: Some(profile.id),
                message: "Forge Libraries werden heruntergeladen...".to_string(),
                progress: Some(0.4),
                error: None,
            })
            .await?;

        forge_libraries_download
            .download_libraries(&forge_version)
            .await?;
        let libraries = forge_libraries_download
            .get_library_paths(&forge_version, profile_json.is_none())
            .await?;

        info!("Forge Libraries: {:?}", libraries);

        let installer_path = forge_installer_download.get_installer_path(&target_forge_version);

        // None for the jarmod generation, which ships no processors at all and delivers its
        // Forge code as an ordinary library. Assuming a patched jar there puts a file that was
        // never written on the classpath — Java skips missing entries silently, so the
        // Minecraft jar just goes absent.
        let patched_client_jar = profile_json.as_ref().and_then(declared_patched_client_jar);

        if let Some(forge_profile) = profile_json {
            state
                .emit_event(EventPayload {
                    event_id: forge_event_id,
                    event_type: EventType::InstallingForge,
                    target_id: Some(profile.id),
                    message: "Forge Installer Libraries werden heruntergeladen...".to_string(),
                    progress: Some(0.6),
                    error: None,
                })
                .await?;

            forge_libraries_download
                .download_installer_libraries(&forge_profile)
                .await?;

            // Processors only need to run when their output is missing. A build that declares
            // no patched jar has nothing to skip, so it always runs them.
            let should_run_patcher = match &patched_client_jar {
                Some(jar) if jar.exists() => {
                    info!("✅ Pre-patched Forge client found: {}", jar.display());
                    false
                }
                Some(jar) => {
                    info!("Patched Forge client missing, running processors: {}", jar.display());
                    true
                }
                None => true,
            };

            if should_run_patcher {
                state
                    .emit_event(EventPayload {
                        event_id: forge_event_id,
                        event_type: EventType::InstallingForge,
                        target_id: Some(profile.id),
                        message: "Forge wird gepatcht...".to_string(),
                        progress: Some(0.7),
                        error: None,
                    })
                    .await?;

                let forge_patcher = ForgePatcher::new(self.java_path.clone(), version_id);
                forge_patcher
                    .with_event_id(forge_event_id)
                    .with_profile_id(profile.id)
                    .apply_processors(&forge_profile, version_id, true, &installer_path)
                    .await?;
            } else {
                state
                    .emit_event(EventPayload {
                        event_id: forge_event_id,
                        event_type: EventType::InstallingForge,
                        target_id: Some(profile.id),
                        message:
                            "Vorgepatchte Forge-Client Datei gefunden, überspringe Patching..."
                                .to_string(),
                        progress: Some(0.7),
                        error: None,
                    })
                    .await?;
            }

        } else {
            state
                .emit_event(EventPayload {
                    event_id: forge_event_id,
                    event_type: EventType::InstallingForge,
                    target_id: Some(profile.id),
                    message: "Legacy Forge Libraries werden heruntergeladen...".to_string(),
                    progress: Some(0.8),
                    error: None,
                })
                .await?;

            forge_libraries_download
                .download_legacy_libraries(&forge_version)
                .await?;
        }

        info!("Forge installation completed!");

        state
            .emit_event(EventPayload {
                event_id: forge_event_id,
                event_type: EventType::InstallingForge,
                target_id: Some(profile.id),
                message: "Forge installation completed!".to_string(),
                progress: Some(1.0),
                error: None,
            })
            .await?;

        let launch_kind = ForgeLaunchKind::from_main_class(&forge_version.main_class);
        info!(
            "Forge launch generation: {:?} (mainClass {})",
            launch_kind, forge_version.main_class
        );

        // Which jar goes on the classpath as *the* Minecraft jar.
        //
        // The patched jar holds code only — assets, data and version.json sit in the
        // client-extra half of Forge's split. The module-layer generation finds its patched
        // classes through -DlibraryDirectory anyway, so it gets plain vanilla; handing it the
        // code-only jar leaves nothing on the classpath providing version.json, and mods that
        // read it through getSystemClassLoader() (CustomSkinLoader) then fall back to their
        // oldest protocol and load 1.12-era classes, colliding with the real minecraft module.
        //
        // ModLauncher keeps the patched jar: it runs on a flat classpath where that jar has to
        // be the single Minecraft jar.
        let custom_client_path = if launch_kind == ForgeLaunchKind::Bootstrap {
            info!("Module-layer generation — keeping the vanilla jar on the classpath");
            None
        } else {
            // Never hand on a path the processors did not actually produce: Java drops missing
            // classpath entries without a word, which would leave the instance with no
            // Minecraft jar at all and no hint as to why.
            match patched_client_jar {
                Some(jar) if !jar.exists() => {
                    return Err(AppError::Other(format!(
                        "Forge processors did not produce the patched client jar declared by the \
                         install profile: {}",
                        jar.display()
                    )))
                }
                other => other,
            }
        };

        let result = ForgeInstallResult {
            libraries,
            main_class: forge_version.main_class.clone(),
            jvm_args: ForgeArguments::get_jvm_arguments(
                &forge_version,
                &LAUNCHER_DIRECTORY.meta_dir().join("libraries"),
                // ${version_name} feeds -DignoreList: the jar BootstrapLauncher must NOT
                // turn into a module. It has to name the Minecraft jar we actually put on the
                // classpath, otherwise that jar becomes a second module and resolution fails
                // with "Modules minecraft and _1._20._1 export package ...".
                if launch_kind == ForgeLaunchKind::Bootstrap {
                    version_id
                } else {
                    &target_forge_version
                },
            ),
            game_args: ForgeArguments::get_game_arguments(&forge_version),
            minecraft_arguments: forge_version.minecraft_arguments.clone(),
            custom_client_path,
        };

        Ok(result)
    }
}

pub struct ForgeInstallResult {
    pub libraries: Vec<PathBuf>,
    pub main_class: String,
    pub jvm_args: Vec<String>,
    pub game_args: Vec<String>,
    pub minecraft_arguments: Option<String>,
    pub custom_client_path: Option<PathBuf>,
}

/// Resolves the patched client jar that the install profile declares in `data.PATCHED`,
/// returning `None` for builds that patch nothing.
///
/// The declared coordinate must not be reconstructed from a naming convention: Forge writes
/// `[net.minecraftforge:forge:<version>:client]`, NeoForge up to 21.9
/// `[net.neoforged:neoforge:<version>:client]`, and NeoForge from 21.10 on
/// `[net.neoforged:minecraft-client-patched:<version>]` — a different artifact with no
/// classifier at all.
fn declared_patched_client_jar(profile: &ForgeInstallProfile) -> Option<PathBuf> {
    let declared = profile.data.get("PATCHED")?.client.trim();
    let coordinate = declared.strip_prefix('[')?.strip_suffix(']')?;

    let mut parts = coordinate.split(':');
    let group = parts.next()?;
    let artifact = parts.next()?;
    let version = parts.next()?;
    let classifier = parts.next();

    let file_name = match classifier {
        Some(c) => format!("{}-{}-{}.jar", artifact, version, c),
        None => format!("{}-{}.jar", artifact, version),
    };

    Some(
        LAUNCHER_DIRECTORY
            .meta_dir()
            .join("libraries")
            .join(group.replace('.', "/"))
            .join(artifact)
            .join(version)
            .join(file_name),
    )
}

/// Forge's launch generations, which differ in how the Minecraft classes reach the JVM.
/// Identified by the `mainClass` the version JSON declares, never by the Minecraft version
/// number — the generation is a property of the Forge build.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ForgeLaunchKind {
    /// `net.minecraft.launchwrapper.Launch` — flat classpath. Forge ships as an ordinary
    /// library and transforms vanilla at load time, so no patched jar is ever produced.
    LaunchWrapper,
    /// `cpw.mods.modlauncher.Launcher` — binary patches produce a patched client jar that
    /// takes the Minecraft jar's place on a flat classpath.
    ModLauncher,
    /// Module-layer era. Forge builds the layer itself from `-DlibraryDirectory`, so the
    /// classpath carries plain vanilla and the patches ride along as libraries.
    Bootstrap,
}

impl ForgeLaunchKind {
    /// The module-layer era alone uses three different main classes
    /// (`cpw.mods.bootstraplauncher.BootstrapLauncher` up to 1.21.0,
    /// `net.minecraftforge.bootstrap.ForgeBootstrap` from 1.21.1,
    /// `net.neoforged.fml.startup.Client` on NeoForge), so only the two legacy generations are
    /// matched by name and anything unknown counts as module-layer. Legacy is frozen and
    /// cannot gain new main classes; everything new goes the other way.
    fn from_main_class(main_class: &str) -> Self {
        match main_class {
            "net.minecraft.launchwrapper.Launch" | "" => Self::LaunchWrapper,
            "cpw.mods.modlauncher.Launcher" => Self::ModLauncher,
            _ => Self::Bootstrap,
        }
    }
}
