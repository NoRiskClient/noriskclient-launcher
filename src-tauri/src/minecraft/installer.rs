use std::time::Instant;

use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::integrations::norisk_packs::NoriskModpacksConfig;
use crate::minecraft::api::mc_api::MinecraftApiService;
use crate::minecraft::downloads::java_download::JavaDownloadService;
use crate::minecraft::downloads::mc_assets_download::MinecraftAssetsDownloadService;
use crate::minecraft::downloads::mc_client_download::MinecraftClientDownloadService;
use crate::minecraft::downloads::mc_libraries_download::MinecraftLibrariesDownloadService;
use crate::minecraft::downloads::mc_natives_download::MinecraftNativesDownloadService;
use crate::minecraft::downloads::NoriskPackDownloadService;
use crate::minecraft::downloads::{ModDownloadService, NoriskClientAssetsDownloadService};
use crate::minecraft::dto::JavaDistribution;
use crate::minecraft::launch::launch_summary::LaunchSummary;
use crate::minecraft::{MinecraftLaunchParameters, MinecraftLauncher};
use crate::state::event_state::{EventPayload, EventType};
use crate::state::profile_state::{ModLoader, Profile};
use crate::state::state_manager::State;
use log::{error, info, trace, warn};
use rand::Rng;
use std::sync::Arc;
use uuid::Uuid;

use super::minecraft_auth::Credentials;
use super::modloader::ModloaderFactory;
use crate::minecraft::downloads::MinecraftLoggingDownloadService;
use crate::utils::mc_utils;
use crate::utils::system_info::Architecture;
use tokio::fs as async_fs;

async fn emit_progress_event(
    state: &State,
    event_type: EventType,
    profile_id: Uuid,
    message: &str,
    progress: f64,
    error: Option<String>,
) -> Result<Uuid> {
    let event_id = Uuid::new_v4();
    state
        .emit_event(EventPayload {
            event_id,
            event_type,
            target_id: Some(profile_id),
            message: message.to_string(),
            progress: Some(progress),
            error,
        })
        .await?;
    Ok(event_id)
}

/// Runs an async step with automatic start/completion events and timing.
/// Emits a start event ("label...") at 0%, runs the closure, then emits
/// a completion event ("label completed! (Xms)") at 100%.
/// The timing also appears in launcher.log via log::info!.
async fn timed_step<F, Fut, T>(
    state: &State,
    summary: &LaunchSummary,
    event_type: EventType,
    profile_id: Uuid,
    label: &str,
    f: F,
) -> Result<T>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    emit_progress_event(state, event_type.clone(), profile_id, &format!("{}...", label), 0.0, None).await?;
    trace!("{}", label);
    let start = Instant::now();
    let result = f().await?;
    let elapsed_ms = start.elapsed().as_millis();
    trace!("[Timing] {} took {}ms", label, elapsed_ms);
    summary.record_phase(label, elapsed_ms);
    emit_progress_event(state, event_type, profile_id, &format!("{} completed! ({}ms)", label, elapsed_ms), 1.0, None).await?;
    Ok(result)
}

macro_rules! summary_phase {
    ($summary:expr, $label:expr, $block:expr) => {{
        let __start = Instant::now();
        let __result = $block;
        $summary.record_phase(&$label.to_string(), __start.elapsed().as_millis());
        __result
    }};
}

pub async fn install_minecraft_version(
    version_id: &str,
    modloader_str: &str,
    profile: &Profile,
    credentials: Option<Credentials>,
    quick_play_singleplayer: Option<String>,
    quick_play_multiplayer: Option<String>,
    migration_info: Option<crate::utils::profile_utils::MigrationInfo>,
    extra_local_mods: Vec<std::path::PathBuf>,
    // Use the passed-in profile as-is instead of reloading by id (override launches).
    skip_profile_reload: bool,
) -> Result<()> {
    // Convert string modloader to ModLoader enum
    let modloader_enum = match modloader_str {
        "vanilla" => ModLoader::Vanilla,
        "fabric" => ModLoader::Fabric,
        "forge" => ModLoader::Forge,
        "neoforge" => ModLoader::NeoForge,
        "quilt" => ModLoader::Quilt,
        _ => {
            return Err(AppError::Unknown(format!(
                "Unbekannter Modloader: {}",
                modloader_str
            )))
        }
    };

    // Get version manifest and find the specific version
    info!(
        "Installing Minecraft version: {} with modloader: {:?}",
        version_id, modloader_enum
    );

    // Get experimental mode from global config
    let state = State::get().await?;
    let is_experimental_mode = state.config_manager.is_experimental_mode().await;
    let launcher_config = state.config_manager.get_config().await;

    let profile_owned;
    let profile = if skip_profile_reload {
        profile
    } else {
        if let Err(e) = state
            .profile_manager
            .resolve_and_migrate_pack_id(profile.id)
            .await
        {
            warn!("[PackFallback] Pack migration check failed for profile {}: {}.", profile.id, e);
        }
        profile_owned = state.profile_manager.get_profile(profile.id).await?;
        &profile_owned
    };

    info!(
        "[Launch] Setting experimental mode: {}",
        is_experimental_mode
    );
    info!(
        "[Launch] Using concurrent downloads: {}",
        launcher_config.concurrent_downloads
    );

    let total_start = Instant::now();
    let summary = Arc::new(LaunchSummary::default());

    // <--- HARDCODED TEST ERROR (50% CHANCE) --- >
    let should_throw_error = {
        let mut rng = rand::thread_rng(); // Create and use RNG in a tight scope
        rng.gen_bool(0.5) // 0.5 means 50% probability
    }; // rng goes out of scope here

    if should_throw_error {
        info!("[InstallTest] Randomly decided to throw test error.");
        //return Err(AppError::Unknown("Testfehler (50% Chance) für das Error-Handling!".to_string()));
    } else {
        info!("[InstallTest] Randomly decided NOT to throw test error. Proceeding normally.");
    }
    // <--- END HARDCODED TEST ERROR --- >

    // Execute migration if provided
    if let Some(migration) = &migration_info {
        info!("[Launch] Executing migration before installation: {:?}", migration);

        // Execute the migration (detailed progress events are sent from within execute_group_migration)
        match crate::utils::profile_utils::execute_group_migration(migration.clone(), Some(profile.id)).await {
            Ok(_) => {
                info!("[Launch] Migration completed successfully");
            }
            Err(e) => {
                error!("[Launch] Migration failed: {:?}", e);

                // Send migration failed event
                let migration_failed_payload = crate::state::event_state::EventPayload {
                    event_id: uuid::Uuid::new_v4(),
                    event_type: crate::state::event_state::EventType::MigrationFailed,
                    target_id: Some(profile.id),
                    message: format!("Migration failed: {:?}", e),
                    progress: Some(0.0),
                    error: Some(format!("{:?}", e)),
                };

                if let Err(e) = state.event_state.emit(migration_failed_payload).await {
                    warn!("[Launch] Failed to emit migration failed event: {}", e);
                }

                // Return the error to stop the launch process
                return Err(e);
            }
        }
    }

    if let Some(world) = &quick_play_singleplayer {
        info!(
            "[Launch] Quick Play: Launching directly into singleplayer world: {}",
            world
        );
    } else if let Some(server) = &quick_play_multiplayer {
        info!(
            "[Launch] Quick Play: Connecting directly to server: {}",
            server
        );
    }

    let api_service = MinecraftApiService::new();
    let manifest = api_service.get_version_manifest().await?;
    let version = manifest
        .versions
        .iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| AppError::VersionNotFound(format!("Version {} not found", version_id)))?;

    // Get version metadata
    let piston_meta = api_service.get_piston_meta(&version.url).await?;
    piston_meta.display_info();

    // Get Java version from Minecraft version manifest
    let java_version = piston_meta.java_version.major_version as u32;
    info!("Checking Java {} for Minecraft...", java_version);

    // Emit Java installation event
    let event_id = emit_progress_event(
        &state,
        EventType::InstallingJava,
        profile.id,
        &format!("Installing Java {}...", java_version),
        0.0,
        None,
    )
    .await?;

    // Check if profile uses a custom Java path
    let step_start = Instant::now();
    let mut custom_java_valid = false;
    let java_path = if profile.settings.use_custom_java_path && profile.settings.java_path.is_some()
    {
        // Try to use the custom Java path
        let custom_path = profile.settings.java_path.as_ref().unwrap();
        info!("Using custom Java path from profile: {}", custom_path);

        // Verify that the custom Java path exists and is valid
        let path = std::path::PathBuf::from(custom_path);
        if path.exists() {
            // Check if it's a valid Java installation
            use crate::utils::java_detector;
            match java_detector::get_java_info(&path).await {
                Ok(java_info) => {
                    info!(
                        "Verified custom Java: Version {}, Major version {}, 64-bit: {}, architecture: {:?}",
                        java_info.version,
                        java_info.major_version,
                        java_info.is_64bit,
                        java_info.architecture
                    );

                    let wrong_arch = java_info.architecture == Architecture::AARCH64
                        && JavaDownloadService::new()
                            .needs_x86_64_java(Some(&piston_meta.java_version.component));

                    if wrong_arch {
                        info!(
                            "Custom Java at {} is arm64, but this version needs x86_64 Java. Downloading Java...",
                            path.display()
                        );
                        custom_java_valid = false;
                        std::path::PathBuf::new()
                    } else if java_info.major_version >= java_version {
                        info!(
                            "Custom Java version {} meets the required version {}",
                            java_info.major_version, java_version
                        );
                        custom_java_valid = true;
                        path
                    } else {
                        info!(
                            "Custom Java version {} is lower than required version {}. Downloading Java...",
                            java_info.major_version, java_version
                        );
                        // The custom Java is too old, we need to download a newer version
                        custom_java_valid = false;
                        // Will be set by the download code below
                        std::path::PathBuf::new()
                    }
                }
                Err(e) => {
                    info!(
                        "Custom Java path exists but is not valid: {}. Downloading Java...",
                        e
                    );
                    // Will be set by the download code below
                    std::path::PathBuf::new()
                }
            }
        } else {
            info!(
                "Custom Java path does not exist: {}. Downloading Java...",
                custom_path
            );
            // Will be set by the download code below
            std::path::PathBuf::new()
        }
    } else {
        // No custom path or not enabled, initialize with empty path
        std::path::PathBuf::new()
    };

    // Download and setup Java if necessary
    let java_path = if custom_java_valid {
        info!("Using verified custom Java path: {:?}", java_path);

        // Update progress to 100% since we're using a custom path
        emit_progress_event(
            &state,
            EventType::InstallingJava,
            profile.id,
            &format!("Using custom Java installation! ({}ms)", step_start.elapsed().as_millis()),
            1.0,
            None,
        )
        .await?;

        java_path
    } else {
        // Download Java since custom path is not valid or not set
        info!("Downloading Java {}...", java_version);
        let java_service = JavaDownloadService::new();
        let downloaded_path = java_service
            .get_or_download_java(
                java_version,
                &JavaDistribution::Zulu,
                Some(&piston_meta.java_version.component),
            )
            .await?;

        info!("Java installation path: {:?}", downloaded_path);

        // Update progress to 100%
        emit_progress_event(
            &state,
            EventType::InstallingJava,
            profile.id,
            &format!("Java {} installation completed! ({}ms)", java_version, step_start.elapsed().as_millis()),
            1.0,
            None,
        )
        .await?;

        downloaded_path
    };
    summary.record_phase("java", step_start.elapsed().as_millis());

    // Create game directory
    let game_directory = state
        .profile_manager
        .calculate_instance_path_for_profile(profile)?;
    std::fs::create_dir_all(&game_directory)?;

    // --- NEW: Copy StartUpHelper data FIRST ---
    info!("Checking for StartUpHelper data to import...");

    // Load NoriskPackDefinition if a pack is selected
    let norisk_pack = if let Some(pack_id) = profile.effective_norisk_pack_id().await {
        let config = state.norisk_pack_manager.get_config().await;
        config.get_resolved_pack_definition(&pack_id).ok()
    } else {
        None
    };

    if let Err(e) = mc_utils::copy_startup_helper_data(profile, &game_directory, norisk_pack.as_ref()).await {
        // We will only log a warning because this is not a critical step for launching the game.
        // The installation can proceed even if this fails.
        warn!("Failed to import StartUpHelper data (non-critical error): {}", e);
    }
    info!("StartUpHelper data import check complete.");
    // --- END NEW ---

    // --- Copy initial data from default Minecraft installation ---
    info!("Checking for user data to import...");
    if let Err(e) =
        mc_utils::copy_initial_data_from_default_minecraft(profile, &game_directory).await
    {
        // We will only log a warning because this is not a critical step for launching the game.
        // The installation can proceed even if this fails.
        warn!("Failed to import user data (non-critical error): {}", e);
    }
    info!("User data import check complete.");

    // Download libraries
    let libraries_service = MinecraftLibrariesDownloadService::new()
        .with_concurrent_downloads(launcher_config.concurrent_downloads)
        .with_stats(summary.libraries.clone());
    timed_step(&state, &summary, EventType::DownloadingLibraries, profile.id, "libraries", || async {
        libraries_service.download_libraries(&piston_meta.libraries).await
    }).await?;

    // Extract natives
    let natives_service = MinecraftNativesDownloadService::new();
    let cache_natives = launcher_config.cache_natives_extraction;
    timed_step(&state, &summary, EventType::ExtractingNatives, profile.id, "natives", || async {
        natives_service.extract_natives(&piston_meta.libraries, version_id, cache_natives).await
    }).await?;

    // Download MC assets (handles progress events internally)
    let assets_service = MinecraftAssetsDownloadService::new()
        .with_concurrent_downloads(launcher_config.concurrent_downloads)
        .with_stats(summary.assets.clone());
    summary_phase!(summary, "assets", {
        assets_service
            .download_assets_with_progress(&piston_meta.asset_index, profile.id)
            .await?
    });

    // Download NoRiskClient assets (handles progress events internally)
    let norisk_assets_service = NoriskClientAssetsDownloadService::new()
        .with_concurrent_downloads(launcher_config.concurrent_downloads)
        .with_stats(summary.nrc_assets.clone());
    summary_phase!(summary, "nrc assets", {
        norisk_assets_service
            .download_nrc_assets_for_profile(&profile, credentials.as_ref(), is_experimental_mode)
            .await?
    });

    // Download Minecraft client
    let client_service = MinecraftClientDownloadService::new().with_stats(summary.client.clone());
    timed_step(&state, &summary, EventType::DownloadingClient, profile.id, "client", || async {
        client_service.download_client(&piston_meta.downloads.client, &piston_meta.id).await
    }).await?;

    // Create and use Minecraft launcher
    let launcher = MinecraftLauncher::new(
        java_path.clone(),
        game_directory.clone(),
        credentials.clone(),
    );

    info!("Preparing launch parameters...");

    // Get memory settings (global for standard profiles, profile-specific for custom)
    let memory_max = if profile.is_standard_version {
        let state = State::get().await?;
        let config = state.config_manager.get_config().await;
        config.global_memory_settings.max
    } else {
        profile.settings.memory.max
    };

    let mut launch_params = MinecraftLaunchParameters::new(profile.id, memory_max)
        .with_old_minecraft_arguments(piston_meta.minecraft_arguments.clone())
        .with_resolution(profile.settings.resolution.clone())
        .with_experimental_mode(is_experimental_mode);

    // Add Quick Play parameters if provided
    if let Some(world_name) = quick_play_singleplayer {
        launch_params = launch_params.with_quick_play_singleplayer(world_name);
    } else if let Some(server_address) = quick_play_multiplayer {
        launch_params = launch_params.with_quick_play_multiplayer(server_address);
    }

    // Install modloader using the factory
    if modloader_enum != ModLoader::Vanilla {
        // Resolve loader version using the new modloader factory method
        let mut install_profile = profile.clone();
        let config_now: NoriskModpacksConfig = state.norisk_pack_manager.get_config().await;
        let resolved_loader = crate::minecraft::modloader::ModloaderFactory::resolve_loader_version(
            profile,
            version_id,
            Some(&config_now),
        ).await;

        if let Some(version) = resolved_loader.version {
            let reason_str = match resolved_loader.reason {
                crate::minecraft::modloader::LoaderVersionReason::NoriskPack => "Norisk pack policy",
                crate::minecraft::modloader::LoaderVersionReason::UserOverwrite => "user overwrite",
                crate::minecraft::modloader::LoaderVersionReason::ProfileDefault => "profile default",
                crate::minecraft::modloader::LoaderVersionReason::NotResolved => "not resolved",
            };
            
            info!(
                "Applying loader version '{}' from {} for MC {} ({:?})",
                version,
                reason_str,
                version_id,
                modloader_enum
            );
            install_profile.loader_version = Some(version);
        }

        let modloader_installer = ModloaderFactory::create_installer_with_config(
            &modloader_enum,
            java_path.clone(),
            launcher_config.concurrent_downloads,
        );
        let modloader_result = summary_phase!(summary, "modloader", {
            modloader_installer.install(version_id, &install_profile).await?
        });

        // Apply modloader specific parameters to launch parameters
        if let Some(main_class) = modloader_result.main_class {
            launch_params = launch_params.with_main_class(&main_class);
        } else {
            launch_params = launch_params.with_main_class(&piston_meta.main_class);
        }

        if !modloader_result.libraries.is_empty() {
            launch_params = launch_params.with_additional_libraries(modloader_result.libraries);
        }

        if let Some(jvm_args) = modloader_result.jvm_args {
            launch_params = launch_params.with_additional_jvm_args(jvm_args);
        }

        if let Some(game_args) = modloader_result.game_args {
            launch_params = launch_params.with_additional_game_args(game_args);
        }

        if let Some(minecraft_arguments) = modloader_result.minecraft_arguments {
            launch_params = launch_params.with_old_minecraft_arguments(Some(minecraft_arguments));
        }

        if let Some(custom_client_path) = modloader_result.custom_client_path {
            launch_params = launch_params.with_custom_client_jar(custom_client_path);
        }

    } else {
        // Vanilla main class
        launch_params = launch_params.with_main_class(&piston_meta.main_class);
    }

    // Add custom JVM arguments (global for standard profiles, profile-specific for custom)
    let custom_jvm_args_str = if profile.is_standard_version {
        let state = State::get().await?;
        let config = state.config_manager.get_config().await;
        config.global_custom_jvm_args.clone()
    } else {
        profile.settings.custom_jvm_args.clone()
    };

    if let Some(jvm_args_str) = custom_jvm_args_str {
        if !jvm_args_str.trim().is_empty() {
            let mut current_jvm_args = launch_params.additional_jvm_args.clone();
            let custom_args: Vec<String> =
                jvm_args_str.split_whitespace().map(String::from).collect();
            info!(
                "Adding custom JVM arguments from {}: {:?}",
                if profile.is_standard_version { "global settings" } else { "profile" },
                custom_args
            );
            current_jvm_args.extend(custom_args);
            launch_params = launch_params.with_additional_jvm_args(current_jvm_args);
        }
    }

    // Combine Game arguments from modloader (if any) and profile settings (extra_game_args)
    let mut final_game_args = launch_params.additional_game_args.clone();
    final_game_args.extend(profile.settings.extra_game_args.clone());
    launch_params = launch_params.with_additional_game_args(final_game_args);

    // --- Fetch Norisk Config Once if a pack is selected ---
    let loaded_norisk_config: Option<NoriskModpacksConfig> = if let Some(pack_id) =
        &profile.selected_norisk_pack_id
    {
        info!(
            "Fetching Norisk config because pack '{}' is selected. Attempting to refresh first.",
            pack_id
        );
        if let Some(creds) = credentials.as_ref() {
            match creds
                .norisk_credentials
                .get_token_for_mode(is_experimental_mode)
            {
                Ok(norisk_token_value) => {
                    info!("Attempting to update Norisk pack configuration using obtained token for pack '{}'...", pack_id);
                    if let Err(update_err) = state
                        .norisk_pack_manager
                        .fetch_and_update_config(&norisk_token_value, is_experimental_mode)
                        .await
                    {
                        warn!(
                                "Failed to update Norisk pack '{}' configuration: {}. Will proceed with cached version.",
                                pack_id, update_err
                            );
                    } else {
                        info!(
                            "Successfully updated Norisk pack '{}' configuration from API.",
                            pack_id
                        );
                    }
                }
                Err(token_err) => {
                    warn!(
                            "Could not obtain Norisk token for pack '{}' to update configuration: {}. Will proceed with cached version.",
                            pack_id, token_err
                        );
                }
            }
        } else {
            error!(
                    "A Norisk pack ('{}') is selected, but no credentials were provided. Cannot attempt to update pack configuration.",
                    pack_id
                );
        }
        // No need to clone state here, it's still valid in this scope
        // Always attempt to get the config, which will be the latest if updated, or cached otherwise.
        Some(state.norisk_pack_manager.get_config().await)
    } else {
        None
    };

    // --- Step: Ensure profile-defined mods are downloaded/verified in cache ---
    let mod_downloader_service =
        ModDownloadService::with_concurrency(launcher_config.concurrent_downloads)
            .with_stats(summary.mods.clone());
    timed_step(&state, &summary, EventType::DownloadingMods, profile.id, "profile mods", || async {
        mod_downloader_service.download_mods_to_cache(&profile).await
    }).await?;

    // --- Step: Download mods from selected Norisk Pack (if any) ---
    if let Some(selected_pack_id) = profile.effective_norisk_pack_id().await {
        // Use the already loaded config
        if let Some(config) = loaded_norisk_config.as_ref() {
            let norisk_mods_event_id = emit_progress_event(
                &state,
                EventType::DownloadingMods,
                profile.id,
                &format!(
                    "Downloading Norisk Pack '{}' Mods... (Phase 2)",
                    selected_pack_id
                ),
                0.0,
                None,
            )
            .await?;

            info!(
                "Downloading mods for selected Norisk Pack '{}'...",
                selected_pack_id
            );

            let norisk_downloader_service =
                NoriskPackDownloadService::with_concurrency(launcher_config.concurrent_downloads)
                    .with_stats(summary.mods.clone());
            let loader_str = modloader_enum.as_str();
            let pack_download_start = Instant::now();
            match summary_phase!(summary, format!("pack mods '{}'", selected_pack_id), {
                norisk_downloader_service
                    .download_pack_mods_to_cache(
                        config,
                        &selected_pack_id,
                        version_id,
                        loader_str,
                    )
                    .await
            })
            {
                Ok(_) => {
                    info!(
                        "Norisk Pack '{}' mods download completed successfully.",
                        selected_pack_id
                    );
                    emit_progress_event(
                        &state,
                        EventType::DownloadingMods,
                        profile.id,
                        &format!(
                            "Norisk Pack '{}' Mods downloaded successfully! (Phase 2) ({}ms)",
                            selected_pack_id, pack_download_start.elapsed().as_millis()
                        ),
                        1.0,
                        None,
                    )
                    .await?;
                }
                Err(e) => {
                    error!(
                        "Failed to download Norisk Pack '{}' mods: {}",
                        selected_pack_id, e
                    );
                    emit_progress_event(
                        &state,
                        EventType::DownloadingMods,
                        profile.id,
                        &format!("Error downloading Norisk Pack '{}' mods!", selected_pack_id),
                        1.0,
                        Some(e.to_string()),
                    )
                    .await?;
                }
            }
        } else {
            // Should not happen if selected_pack_id is Some, but handle defensively
            error!(
                "Norisk config was expected but not loaded for pack ID: {}",
                selected_pack_id
            );
        }
    } else {
        info!(
            "No Norisk Pack selected for profile '{}', skipping pack download.",
            profile.name
        );
    }

    // --- Step: Resolve final mod list for syncing ---
    let resolve_event_id = emit_progress_event(
        &state,
        EventType::SyncingMods,
        profile.id,
        "Resolving final mod list...",
        0.0,
        None,
    )
    .await?;

    let mod_cache_dir = LAUNCHER_DIRECTORY.meta_dir().join("mod_cache");

    // ---> NEW: Get custom mods for this profile <---
    info!("Listing custom mods for profile '{}'...", profile.name);
    #[allow(deprecated)]
    let mut custom_mod_infos = state.profile_manager.list_custom_mods(&profile).await?;
    info!(
        "Found {} custom mods for profile '{}'",
        custom_mod_infos.len(),
        profile.name
    );
    // ---> END NEW <---

    // CLI temp launch: extra local mod jars referenced in place (not copied).
    // Fed through the custom-mod path so the resolver writes their absolute path
    // into the addMods meta file. Fabric + Forge/NeoForge only (vanilla has no
    // meta file).
    for path in &extra_local_mods {
        match path.file_name() {
            Some(name) => {
                info!("[Local Mods] Adding CLI local mod in-place: {}", path.display());
                custom_mod_infos.push(crate::state::profile_state::CustomModInfo {
                    filename: name.to_string_lossy().into_owned(),
                    is_enabled: true,
                    path: path.clone(),
                });
            }
            None => warn!(
                "[Local Mods] Skipping --mods path without filename: {}",
                path.display()
            ),
        }
    }

    // Call the resolver function using the already loaded config (or None)
    let resolve_start = Instant::now();
    let (target_mods, mut mod_resolution) = summary_phase!(summary, "resolve", {
        crate::minecraft::downloads::mod_resolver::resolve_target_mods(
            profile,
            loaded_norisk_config.as_ref(),
            Some(&custom_mod_infos),
            version_id,
            modloader_enum.as_str(),
            &mod_cache_dir,
        )
        .await?
    });

    emit_progress_event(
        &state,
        EventType::SyncingMods,
        profile.id,
        &format!("Resolved {} mods for sync. ({}ms)", target_mods.len(), resolve_start.elapsed().as_millis()),
        1.0,
        None,
    )
    .await?;

    // --- Provide managed mods via meta file (Fabric: addMods, Forge: NrcCoreMod) ---
    if modloader_enum == ModLoader::Fabric {
        // Loose jars in <instance>/mods are invisible to Fabric, because fabric.modsFolder
        // replaces that directory rather than adding to it. Pass them through addMods so
        // dropping a jar into mods/ behaves the same as it does on Forge.
        let instance_path = state
            .profile_manager
            .calculate_instance_path_for_profile(profile)?;
        let root_mods =
            crate::minecraft::downloads::mod_resolver::collect_instance_root_mods(&instance_path)
                .await;
        if !root_mods.is_empty() {
            info!(
                "Including {} loose jar(s) from {}/mods for profile '{}'",
                root_mods.len(),
                instance_path.display(),
                profile.name
            );
        }
        let add_mods_arg = crate::minecraft::downloads::mod_resolver::build_fabric_add_mods_arg(
            profile.id,
            version_id,
            &target_mods,
            &root_mods,
        )
        .await?;
        let mut current_jvm_args = launch_params.additional_jvm_args.clone();
        current_jvm_args.push(add_mods_arg);
        launch_params = launch_params.with_additional_jvm_args(current_jvm_args);
        info!("Configured Fabric addMods meta file for profile '{}'", profile.name);
    } else if modloader_enum == ModLoader::Forge || modloader_enum == ModLoader::NeoForge {
        let loader_str = if modloader_enum == ModLoader::NeoForge { "neoforge" } else { "forge" };
        let is_legacy_forge = modloader_enum == ModLoader::Forge
            && ["1.7.10", "1.8.9", "1.12.2"].contains(&version_id);

        // Early services go through the meta file like everything else: the loader registers an
        // ITransformerDiscoveryService, and ModLauncher puts what it reports into Layer.SERVICE.
        // Handing those jars to the class path instead made BootstrapLauncher own them from
        // MC-BOOTSTRAP, which a class-transforming mod rejects.
        let meta_path = crate::minecraft::downloads::mod_resolver::build_forge_add_mods_meta(
            profile.id,
            version_id,
            &target_mods,
        )
        .await?;

        let forge_libs = crate::minecraft::downloads::forge_libraries_download::ForgeLibrariesDownload::new();
        let loader_path = forge_libs.resolve_forgeloader(version_id, loader_str).await?;

        let mut current_jvm_args = launch_params.additional_jvm_args.clone();
        let meta_path_str = meta_path.to_string_lossy().replace("\\", "/");
        current_jvm_args.push(format!("-Dnrc.addMods=@{}", meta_path_str));

        if is_legacy_forge {
            current_jvm_args.push("-Dfml.coreMods.load=gg.norisk.forgeloader.forge.ForgeModLoader".to_string());
        }
        launch_params = launch_params.with_additional_jvm_args(current_jvm_args);

        let mut libs = launch_params.additional_libraries.clone();
        libs.push(loader_path);
        launch_params = launch_params.with_additional_libraries(libs);

        info!(
            "Configured {} ForgeModLoader for profile '{}' ({} mods)",
            loader_str, profile.name, target_mods.len()
        );
    }

    // --- Step: Sync mods from cache to profile directory ---
    let profile_mods_path = state.profile_manager.get_profile_mods_path(profile)?;

    timed_step(&state, &summary, EventType::SyncingMods, profile.id, "sync mods", || async {
        if modloader_enum == ModLoader::Vanilla {
            info!("Vanilla loader: skipping mod sync — vanilla does not load mods from mods/.");
        } else {
            async_fs::create_dir_all(&profile_mods_path).await?;
            if modloader_enum == ModLoader::Fabric || modloader_enum == ModLoader::Forge || modloader_enum == ModLoader::NeoForge {
                info!("Cleaning managed mods from mods/ folder (all mods loaded via meta file from cache).");
                mod_downloader_service.clean_managed_mods(&target_mods, &profile_mods_path).await?;
            } else {
                mod_downloader_service.sync_mods_to_profile(&target_mods, &profile_mods_path).await?;
            }
        }
        Ok(())
    }).await?;

    if modloader_enum == ModLoader::Vanilla {
        mod_resolution.mark_all_undelivered();
    }
    launch_params = launch_params.with_mod_resolution(mod_resolution);

    // Download log4j configuration if available
    let mut log4j_arg = None;
    if let Some(logging) = &piston_meta.logging {
        let logging_service = MinecraftLoggingDownloadService::new();
        let config_path = summary_phase!(summary, "log4j", {
            logging_service
                .download_logging_config(&logging.client)
                .await?
        });
        log4j_arg = Some(logging_service.get_jvm_argument(&config_path));
    }

    // Add log4j configuration to JVM arguments if available
    if let Some(log4j_argument) = log4j_arg {
        info!("Adding log4j configuration: {}", log4j_argument);
        let mut jvm_args = launch_params.additional_jvm_args.clone();
        jvm_args.push(log4j_argument);
        launch_params = launch_params.with_additional_jvm_args(jvm_args);
    }

    // --- Execute pre-launch hooks ---
    let launcher_config = state.config_manager.get_config().await;
    if let Some(hook) = &launcher_config.hooks.pre_launch {
        info!("Executing pre-launch hook: {}", hook);
        let hook_event_id = emit_progress_event(
            &state,
            EventType::LaunchingMinecraft,
            profile.id,
            "Executing pre-launch hook...",
            0.0,
            None,
        )
        .await?;

        let mut cmd = hook.split(' ');
        if let Some(command) = cmd.next() {
            let result = std::process::Command::new(command)
                .args(cmd.collect::<Vec<&str>>())
                .current_dir(&game_directory)
                .spawn()
                .map_err(|e| AppError::Io(e))?
                .wait()
                .map_err(|e| AppError::Io(e))?;

            if !result.success() {
                let error_msg = format!(
                    "Pre-launch hook failed with exit code: {}",
                    result.code().unwrap_or(-1)
                );
                error!("{}", error_msg);
                return Err(AppError::Other(error_msg));
            }
        }
        info!("Pre-launch hook executed successfully");
    }

    // --- Launch Minecraft ---
    timed_step(&state, &summary, EventType::LaunchingMinecraft, profile.id, "launch", || async {
        launcher.launch(&piston_meta, launch_params, Some(profile.clone())).await
    }).await?;

    summary.log(&profile.name, version_id, modloader_str, total_start.elapsed().as_millis());

    Ok(())
}
