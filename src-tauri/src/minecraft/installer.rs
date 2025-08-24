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
use crate::minecraft::{MinecraftLaunchParameters, MinecraftLauncher};
use crate::state::event_state::{EventPayload, EventType};
use crate::state::profile_state::{ModLoader, Profile};
use crate::state::state_manager::State;
use log::{error, info, warn};
use rand::Rng;
use uuid::Uuid;

use super::minecraft_auth::Credentials;
use super::modloader::ModloaderFactory;
use crate::minecraft::downloads::MinecraftLoggingDownloadService;
use crate::utils::mc_utils;
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

pub async fn install_minecraft_version(
    version_id: &str,
    modloader_str: &str,
    profile: &Profile,
    credentials: Option<Credentials>,
    quick_play_singleplayer: Option<String>,
    quick_play_multiplayer: Option<String>,
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

    info!(
        "[Launch] Setting experimental mode: {}",
        is_experimental_mode
    );
    info!(
        "[Launch] Using concurrent downloads: {}",
        launcher_config.concurrent_downloads
    );

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
    info!("\nChecking Java {} for Minecraft...", java_version);

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
                        "Verified custom Java: Version {}, Major version {}, 64-bit: {}",
                        java_info.version, java_info.major_version, java_info.is_64bit
                    );

                    // Check if the Java version is compatible with the required one
                    if java_info.major_version >= java_version {
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
            "Using custom Java installation!",
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
            &format!("Java {} installation completed!", java_version),
            1.0,
            None,
        )
        .await?;

        downloaded_path
    };

    // Create game directory
    let game_directory = state
        .profile_manager
        .calculate_instance_path_for_profile(profile)?;
    std::fs::create_dir_all(&game_directory)?;

    // --- NEW: Copy initial data from default Minecraft installation ---
    info!("\nChecking for user data to import...");
    if let Err(e) =
        mc_utils::copy_initial_data_from_default_minecraft(profile, &game_directory).await
    {
        // We will only log a warning because this is not a critical step for launching the game.
        // The installation can proceed even if this fails.
        warn!("Failed to import user data (non-critical error): {}", e);
    }
    info!("User data import check complete.");
    // --- END NEW ---

    // Emit libraries download event
    let libraries_event_id = emit_progress_event(
        &state,
        EventType::DownloadingLibraries,
        profile.id,
        "Downloading libraries...",
        0.0,
        None,
    )
    .await?;

    // Download all required files
    info!("\nDownloading libraries...");
    let libraries_service = MinecraftLibrariesDownloadService::new()
        .with_concurrent_downloads(launcher_config.concurrent_downloads);
    libraries_service
        .download_libraries(&piston_meta.libraries)
        .await?;
    info!("Library download completed!");

    emit_progress_event(
        &state,
        EventType::DownloadingLibraries,
        profile.id,
        "Libraries download completed!",
        1.0,
        None,
    )
    .await?;

    // Emit natives extraction event
    let natives_event_id = emit_progress_event(
        &state,
        EventType::ExtractingNatives,
        profile.id,
        "Extracting natives...",
        0.0,
        None,
    )
    .await?;

    info!("\nExtracting natives...");
    let natives_service = MinecraftNativesDownloadService::new();
    natives_service
        .extract_natives(&piston_meta.libraries, version_id)
        .await?;
    info!("Native extraction completed!");

    emit_progress_event(
        &state,
        EventType::ExtractingNatives,
        profile.id,
        "Natives extraction completed!",
        1.0,
        None,
    )
    .await?;

    info!("\nDownloading assets...");
    let assets_service = MinecraftAssetsDownloadService::new()
        .with_concurrent_downloads(launcher_config.concurrent_downloads);
    assets_service
        .download_assets_with_progress(&piston_meta.asset_index, profile.id)
        .await?;
    info!("Asset download completed!");

    // Download NoRiskClient assets if profile has a selected pack
    info!("\nDownloading NoRiskClient assets...");

    let norisk_assets_service = NoriskClientAssetsDownloadService::new()
        .with_concurrent_downloads(launcher_config.concurrent_downloads);

    // Download assets for this profile - progress events are now handled internally
    norisk_assets_service
        .download_nrc_assets_for_profile(&profile, credentials.as_ref(), is_experimental_mode)
        .await?;

    info!("NoRiskClient Asset download completed!");

    // Emit client download event
    let client_event_id = emit_progress_event(
        &state,
        EventType::DownloadingClient,
        profile.id,
        "Downloading Minecraft client...",
        0.0,
        None,
    )
    .await?;

    info!("\nDownloading Minecraft client...");
    let client_service = MinecraftClientDownloadService::new();
    client_service
        .download_client(&piston_meta.downloads.client, &piston_meta.id)
        .await?;
    info!("Client download completed!");

    emit_progress_event(
        &state,
        EventType::DownloadingClient,
        profile.id,
        "Minecraft client download completed!",
        1.0,
        None,
    )
    .await?;

    // Create and use Minecraft launcher
    let launcher = MinecraftLauncher::new(
        java_path.clone(),
        game_directory.clone(),
        credentials.clone(),
    );

    info!("\nPreparing launch parameters...");

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
        // Resolve loader version from Norisk pack policy if available
        let mut install_profile = profile.clone();
        if let Some(selected_pack_id) = &profile.selected_norisk_pack_id {
            let config_now: NoriskModpacksConfig = state.norisk_pack_manager.get_config().await;
            if let Ok(resolved_pack) = config_now.get_resolved_pack_definition(selected_pack_id) {
                if let Some(policy) = &resolved_pack.loader_policy {
                        let loader_key = modloader_enum.as_str();
                        let mut resolved_version: Option<String> = None;
                        // Helper to read version from a loader map
                        let get_ver = |m: &std::collections::HashMap<String, crate::integrations::norisk_packs::LoaderSpec>| {
                            m.get(loader_key).and_then(|s| s.version.clone())
                        };
                        // 1) Exact MC version match
                        if let Some(loader_map) = policy.by_minecraft.get(version_id) {
                            resolved_version = get_ver(loader_map);
                        }
                        // 2) Wildcard pattern like "1.21.*"
                        if resolved_version.is_none() {
                            for (pat, loader_map) in &policy.by_minecraft {
                                if pat.ends_with(".*") {
                                    let prefix = &pat[..pat.len() - 2];
                                    if version_id.starts_with(prefix) {
                                        resolved_version = get_ver(loader_map);
                                        if resolved_version.is_some() { break; }
                                    }
                                }
                            }
                        }
                        // 3) Prefix match (e.g., "1.21")
                        if resolved_version.is_none() {
                            for (pat, loader_map) in &policy.by_minecraft {
                                if !pat.ends_with(".*") && version_id.starts_with(pat) {
                                    resolved_version = get_ver(loader_map);
                                    if resolved_version.is_some() { break; }
                                }
                            }
                        }
                        // 4) Default fallback
                        if resolved_version.is_none() {
                            resolved_version = policy
                                .default
                                .get(loader_key)
                                .and_then(|s| s.version.clone());
                        }

                        if let Some(ver) = resolved_version {
                            info!(
                                "Applying loader version '{}' from pack policy '{}' for MC {} ({:?})",
                                ver,
                                selected_pack_id,
                                version_id,
                                modloader_enum
                            );
                            install_profile.loader_version = Some(ver);
                        }
                    }
                }
            }

        let modloader_installer = ModloaderFactory::create_installer_with_config(
            &modloader_enum,
            java_path.clone(),
            launcher_config.concurrent_downloads,
        );
        let modloader_result = modloader_installer.install(version_id, &install_profile).await?;

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

        if modloader_result.force_include_minecraft_jar {
            launch_params = launch_params.with_force_include_minecraft_jar(true);
        }
    } else {
        // Vanilla main class
        launch_params = launch_params.with_main_class(&piston_meta.main_class);
    }

    // Add custom JVM arguments from profile settings string
    if let Some(jvm_args_str) = &profile.settings.custom_jvm_args {
        if !jvm_args_str.trim().is_empty() {
            let mut current_jvm_args = launch_params.additional_jvm_args.clone();
            let custom_args: Vec<String> =
                jvm_args_str.split_whitespace().map(String::from).collect();
            info!(
                "Adding custom JVM arguments from profile: {:?}",
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
    let mods_event_id = emit_progress_event(
        &state,
        EventType::DownloadingMods,
        profile.id,
        "Downloading/Checking Profile Mods... (Phase 1)",
        0.0,
        None,
    )
    .await?;

    info!(
        "Ensuring profile-defined mods for profile '{}' are downloaded to cache...",
        profile.name
    );
    let mod_downloader_service =
        ModDownloadService::with_concurrency(launcher_config.concurrent_downloads);
    mod_downloader_service
        .download_mods_to_cache(&profile)
        .await?;
    info!(
        "Profile mod cache check/download completed successfully for profile '{}'",
        profile.name
    );

    emit_progress_event(
        &state,
        EventType::DownloadingMods,
        profile.id,
        "Profile Mods downloaded successfully! (Phase 1)",
        1.0,
        None,
    )
    .await?;

    // --- Step: Download mods from selected Norisk Pack (if any) ---
    if let Some(selected_pack_id) = &profile.selected_norisk_pack_id {
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
                NoriskPackDownloadService::with_concurrency(launcher_config.concurrent_downloads);
            let loader_str = modloader_enum.as_str();

            match norisk_downloader_service
                .download_pack_mods_to_cache(
                    config, // Pass the reference to the loaded config
                    selected_pack_id,
                    version_id,
                    loader_str,
                )
                .await
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
                            "Norisk Pack '{}' Mods downloaded successfully! (Phase 2)",
                            selected_pack_id
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
    let custom_mod_infos = state.profile_manager.list_custom_mods(&profile).await?;
    info!(
        "Found {} custom mods for profile '{}'",
        custom_mod_infos.len(),
        profile.name
    );
    // ---> END NEW <---

    // Call the resolver function using the already loaded config (or None)
    let target_mods = crate::minecraft::downloads::mod_resolver::resolve_target_mods(
        profile,
        loaded_norisk_config.as_ref(), // Pass the reference directly
        Some(&custom_mod_infos),       // ---> NEW: Pass custom mods <---
        version_id,
        modloader_enum.as_str(),
        &mod_cache_dir,
    )
    .await?;

    emit_progress_event(
        &state,
        EventType::SyncingMods,
        profile.id,
        &format!("Resolved {} mods for sync.", target_mods.len()),
        1.0,
        None,
    )
    .await?;

    // --- Prototype: Provide managed mods via Fabric addMods meta file (Fabric only) ---
    if modloader_enum == ModLoader::Fabric {
        let add_mods_arg = crate::minecraft::downloads::mod_resolver::build_fabric_add_mods_arg(
            profile.id,
            version_id,
            &target_mods,
        )
        .await?;
        let mut current_jvm_args = launch_params.additional_jvm_args.clone();
        current_jvm_args.push(add_mods_arg);
        launch_params = launch_params.with_additional_jvm_args(current_jvm_args);
        info!("Configured Fabric addMods meta file for profile '{}'", profile.name);
    }

    // --- Step: Sync mods from cache to profile directory ---
    let sync_event_id = emit_progress_event(
        &state,
        EventType::SyncingMods,
        profile.id,
        "Syncing mods to profile directory... (Phase 3)",
        0.0,
        None,
    )
    .await?;

    info!(
        "Syncing mods from cache to profile directory for '{}'...",
        profile.name
    );

    // Get the correct mods directory path for the profile
    let profile_mods_path = state.profile_manager.get_profile_mods_path(profile)?;

    // Ensure mods folder exists for all loaders before launch/sync
    async_fs::create_dir_all(&profile_mods_path).await?;

    // Pass the resolved target_mods list and the specific mods path to the sync function
    if modloader_enum == ModLoader::Fabric {
        info!(
            "Skipping mods folder sync for Fabric (using addMods meta file instead)."
        );
    } else {
        mod_downloader_service
            .sync_mods_to_profile(&target_mods, &profile_mods_path)
            .await?;
    }

    info!("Mod sync completed for profile '{}'", profile.name);
    emit_progress_event(
        &state,
        EventType::SyncingMods,
        profile.id,
        "Mod sync complete! (Phase 3)",
        1.0,
        None,
    )
    .await?;

    // Download log4j configuration if available
    let mut log4j_arg = None;
    if let Some(logging) = &piston_meta.logging {
        info!("\nDownloading log4j configuration...");
        let logging_service = MinecraftLoggingDownloadService::new();
        let config_path = logging_service
            .download_logging_config(&logging.client)
            .await?;
        log4j_arg = Some(logging_service.get_jvm_argument(&config_path));
        info!("Log4j configuration download completed!");
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
    // Emit launch event
    let launch_event_id = emit_progress_event(
        &state,
        EventType::LaunchingMinecraft,
        profile.id,
        "Starting Minecraft...",
        0.0,
        None,
    )
    .await?;

    launcher
        .launch(&piston_meta, launch_params, Some(profile.clone()))
        .await?;

    emit_progress_event(
        &state,
        EventType::LaunchingMinecraft,
        profile.id,
        "Minecraft launched successfully!",
        1.0,
        None,
    )
    .await?;

    Ok(())
}
