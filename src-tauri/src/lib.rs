#![cfg_attr(mobile, allow(unused_imports, unused_macros, dead_code))]

#[macro_use]
pub mod utils;
#[cfg(desktop)]
pub mod cli;
pub mod commands;
pub mod config;
pub mod error;
pub mod friends;
#[cfg(desktop)]
pub mod integrations;
pub mod logging;
pub mod minecraft;
pub mod state;
#[cfg(desktop)]
pub mod sync;
#[cfg(desktop)]
pub mod support;

use log::{error, info, trace};
use std::sync::Arc;
use tauri::Listener;
use tauri::Manager;
#[cfg(desktop)]
use tauri_plugin_deep_link::DeepLinkExt;
#[cfg(desktop)]
use utils::updater_utils;

use crate::commands::analytics_command::track_analytics_event;
use crate::commands::font_command::list_system_fonts;
#[cfg(desktop)]
use crate::commands::process_command::{
    fetch_crash_report, focus_main_window, get_process, get_process_log_cursor,
    get_processes, get_processes_by_profile, open_minecraft_log_window, open_single_log_window,
    set_discord_state, stop_process,
};
use commands::minecraft_auth_command::{
    begin_login, cancel_login, get_accounts, get_active_account, is_flatpak, remove_account, set_active_account
};
use commands::twitch_command::{
    twitch_available_scopes, twitch_begin_device_login, twitch_cancel_login, twitch_is_linked,
    twitch_unlink,
};
use commands::minecraft_command::{
    add_skin,
    apply_skin_from_base64,
    get_active_skin,
    // Local skin database commands
    get_all_skins,
    get_fabric_loader_versions,
    get_forge_versions,
    get_minecraft_versions,
    get_neoforge_versions,
    get_quilt_loader_versions,
    get_skin_by_id,
    // Skin management commands
    get_user_skin_data,
    ping_minecraft_server,
    remove_skin,
    reset_skin,
    update_skin_properties,
    upload_log_to_mclogs_command,
    upload_skin,
};
#[cfg(desktop)]
use commands::profile_command::{
    abort_profile_launch, add_modrinth_content_to_profile, add_modrinth_mod_to_profile,
    batch_check_content_installed, check_for_group_migration_command, check_world_lock_status, copy_profile, copy_world,
    create_profile, delete_custom_mod, delete_mod_from_profile, delete_profile, delete_world,
    export_profile, get_all_profiles_and_last_played, get_custom_mods, get_local_content,
    get_local_datapacks, get_local_resourcepacks, get_local_shaderpacks, get_log_file_content,
    get_norisk_packs, get_norisk_packs_resolved, get_profile, get_profile_directory_structure,
    get_profile_log_files,
    get_servers_for_profile,
    get_default_memory_max_mb, get_standard_profiles, get_system_ram_mb, get_worlds_for_profile, import_local_mods,
    import_profile, import_world, is_content_installed, is_profile_launching,
    launch_profile, list_profile_backups, list_profile_screenshots, list_profiles, open_profile_folder,
    open_profile_latest_log, preview_import_pack, refresh_norisk_packs, refresh_standard_versions,
    repair_profile,
    get_profile_store_status, reimport_profiles_from_legacy_json,
    resolve_loader_version, restore_profile_backup, search_profiles, set_custom_mod_enabled, set_norisk_mod_status,
    set_profile_mod_enabled, update_datapack_from_modrinth, update_modrinth_mod_version,
    update_profile, update_resourcepack_from_modrinth, update_shaderpack_from_modrinth,
};

// Use statements for registered commands only
#[cfg(desktop)]
use commands::curseforge_commands::{get_curseforge_mods_by_ids, download_and_install_curseforge_modpack_command, get_curseforge_file_changelog_command, get_curseforge_mod_description_command};

#[cfg(desktop)]
use commands::modrinth_commands::{
    check_modrinth_updates, check_mod_updates_unified_command, download_and_install_modrinth_modpack,
    clear_content_cache_command, get_all_modrinth_versions_for_contexts, get_modrinth_tags_command,
    get_modrinth_mod_versions,
    get_modpack_versions_unified_command, get_modrinth_project_details, get_modrinth_project_members,
    get_modrinth_versions_by_hashes, search_modrinth_mods,
    search_modrinth_projects, search_mods_unified_command, get_mod_versions_unified_command,
    switch_modpack_version_command
};

use commands::file_command::{
    get_icons_for_archives, list_launcher_logs, open_file, open_file_directory, read_file_bytes,
    set_file_enabled,
};
#[cfg(desktop)]
use commands::file_command::{
    delete_file, get_icons_for_norisk_mods, list_all_mc_logs, list_crash_reports,
    list_process_logs,
};

// Import config commands
use commands::config_commands::{get_app_version, get_launcher_config, set_launcher_config};
use commands::legal_commands::{acknowledge_legal_documents, acknowledge_legal_notice, get_legal_status};
#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

// Import path commands
use commands::path_commands::get_launcher_directory;
#[cfg(desktop)]
use commands::path_commands::resolve_image_path;

// Import cape commands
use commands::cape_command::{
    browse_capes, check_is_moderator, delete_cape, download_template_and_open_explorer, equip_cape,
    get_player_capes, unequip_cape, upload_cape, add_favorite_cape, remove_favorite_cape,
    get_capes_by_hashes, get_owned_capes_list,
};

use commands::cosmetic_command::{
    get_equipped_cosmetics, get_equipped_cosmetics_cached, get_random_local_emote,
};
use commands::icon_command::{
    get_active_creator_code, get_selected_player_icon, get_selected_player_icon_cached,
};

// Import vanilla cape commands
use commands::vanilla_cape_command::{
    get_owned_vanilla_capes, get_currently_equipped_vanilla_cape, equip_vanilla_cape,
    get_vanilla_cape_info, refresh_vanilla_cape_data,
};

// Import Assets commands
use commands::assets_command::get_or_download_asset_model;

// Import NRC commands
use commands::nrc_commands::get_news_and_changelogs_command;
#[cfg(desktop)]
use commands::nrc_commands::{check_update_available_command, download_and_install_update_command};

// Import Content commands
#[cfg(desktop)]
use commands::content_command::{
    bulk_toggle_mod_updates, copy_contents_to_profile, install_content_to_profile, install_local_content_to_profile,
    switch_content_version, toggle_content_from_profile, toggle_contents_from_profile,
    update_contents_from_profile,
    uninstall_contents_from_profile,
    toggle_mod_updates,
    uninstall_content_from_profile,
};

// Import Java commands
#[cfg(desktop)]
use commands::java_command::{
    detect_java_installations_command, find_best_java_for_minecraft_command, get_java_info_command,
    invalidate_java_cache_command, validate_java_path_command,
};

use commands::friends_command::{
    get_friends, get_pending_requests, get_friends_user, send_friend_request,
    accept_friend_request, deny_friend_request, remove_friend, set_online_status,
    toggle_friend_ping, update_privacy_setting, connect_friends_websocket,
    disconnect_friends_websocket, is_friends_websocket_connected, get_or_create_chat,
    get_private_chats, get_chat_messages, send_chat_message, edit_chat_message,
    delete_chat_message, send_typing_indicator, add_message_reaction,
    remove_message_reaction,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");

    #[cfg(target_os = "android")]
    {
        let base = "/data/data/gg.norisk.NoRiskClientLauncherV3";
        std::env::set_var("HOME", base);
        std::env::set_var("XDG_DATA_HOME", format!("{base}/data"));
        std::env::set_var("XDG_CONFIG_HOME", format!("{base}/config"));
        std::env::set_var("XDG_CACHE_HOME", format!("{base}/cache"));
    }

    let runtime = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
    tauri::async_runtime::set(runtime.handle().clone());
    let _runtime_guard = runtime.enter();

    runtime.block_on(async {
        if let Err(e) = logging::setup_logging().await {
            eprintln!("FEHLER: Logging konnte nicht initialisiert werden: {}", e);
        }
    });

    info!("Starting NoRiskClient Launcher...");

    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let logged_args: Vec<String> = argv
                .iter()
                .map(|a| match url::Url::parse(a) {
                    Ok(u) if u.scheme() == "norisk" => {
                        format!("norisk://{}{} (query hidden)", u.host_str().unwrap_or_default(), u.path())
                    }
                    _ => a.clone(),
                })
                .collect();
            info!("SingleInstance plugin: Second instance triggered with args: {:?}", logged_args);

            // If the second invocation carried a CLI subcommand we recognize,
            // service it instead of bringing the window to the front.
            if cli::dispatch_hot_start(app, argv.clone()) {
                return;
            }

            utils::main_window::show(app);
        }));
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_cli::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                utils::main_window::close_requested(window, api);
            }
        });
    let builder = builder.plugin(tauri_plugin_dialog::init());
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_haptics::init());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_deep_link::init());
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            #[cfg(desktop)]
            {
            // CLI cold-start: handle subcommands (version short-circuits GUI;
            // launch fires asynchronously after State::init completes).
            if cli::dispatch_cold_start(&app_handle) {
                return Ok(());
            }

            // --- Initialize System Tray (Tauri 2.0) ---
            let show_item = MenuItem::with_id(app, "show", "Show NoRisk Launcher", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("NoRisk Client Launcher")
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => utils::main_window::show(app),
                    "quit" => utils::main_window::quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => utils::main_window::toggle(tray.app_handle()),
                    TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => utils::main_window::show(tray.app_handle()),
                    _ => {}
                })
                .build(app)?;

            // --- Deep Link Setup ---
            // Register deep link schemes (needed for dev mode on Windows/Linux)
            if let Err(e) = app.deep_link().register_all() {
                error!("Failed to register deep link schemes: {}", e);
            } else {
                info!("Deep link schemes registered successfully.");
            }

            app.manage(utils::deep_link_utils::PendingDeepLinks::default());

            let deep_link_app_handle = app_handle.clone();
            app.deep_link().on_open_url(move |event| {
                let handle = deep_link_app_handle.clone();
                let urls = event.urls();
                info!("Deep link received ({} URL(s))", urls.len());
                tauri::async_runtime::spawn(async move {
                    utils::deep_link_utils::handle_deep_link(&handle, urls).await;
                });
            });

            if let Ok(Some(urls)) = app.deep_link().get_current() {
                info!("Cold-start deep link detected ({} URL(s))", urls.len());
                let cold_start_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    utils::deep_link_utils::handle_deep_link(&cold_start_handle, urls).await;
                });
            }
            // --- End Deep Link Setup ---
            }

            // --- Handle .noriskpack file opening on initial startup (all platforms) ---
            // The single-instance plugin does not handle the *very first* launch with arguments.
            // We still need to check std::env::args() here for that first launch.
            /*info!("Checking for startup file arguments...");
            let startup_args: Vec<String> = std::env::args().collect();
            if startup_args.len() > 1 { // args[0] is exe path, check if there are more
                let handle_clone = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    // Pass all startup_args; handle_noriskpack_file_paths will skip the exe path if needed
                    norisk_packs::handle_noriskpack_file_paths(&handle_clone, startup_args).await;
                });
            }*/
            // --- End .noriskpack handling on startup ---

            // Task for State Init and Updater Window
            let state_init_app_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                // --- Create Updater Window (but keep hidden initially) ---
                #[cfg(desktop)]
                let updater_window = match updater_utils::create_updater_window(&state_init_app_handle).await {
                    Ok(win) => {
                        trace!("Updater window created successfully (initially hidden).");
                        Some(win)
                    }
                    Err(e) => {
                        error!("Failed to create updater window: {}", e);
                        None
                    }
                };

                // --- State Initialization ---
                info!("Initiating state initialization...");
                if let Err(e) = state::state_manager::State::init(Arc::new(state_init_app_handle.clone())).await {
                    error!("CRITICAL: Failed to initialize state: {}", e);
                    #[cfg(desktop)]
                    if let Some(win) = updater_window {
                        updater_utils::emit_status(&state_init_app_handle, "close", "Closing due to state init error.".to_string(), None);
                        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                        if let Err(close_err) = win.close() {
                            error!("Failed to close updater window after state init error: {}", close_err);
                        }
                    }
                    {
                        use tauri_plugin_dialog::{
                            DialogExt, MessageDialogButtons, MessageDialogKind,
                        };

                        let reset = state_init_app_handle
                            .dialog()
                            .message(
                                [
                                    "The NoRisk Launcher could not start.".to_string(),
                                    String::new(),
                                    e.to_string(),
                                    String::new(),
                                    "If that does not help:".to_string(),
                                    concat!(
                                        "\"Reset database and restart\" keeps the old ",
                                        "database as app.db.broken.<time> and restores ",
                                        "your profiles from profiles.json.migrated."
                                    )
                                    .to_string(),
                                    String::new(),
                                    "Support: https://discord.norisk.gg".to_string(),
                                ]
                                .join("\n"),
                            )
                            .kind(MessageDialogKind::Error)
                            .title("NoRisk Launcher - Startup Failed")
                            .buttons(MessageDialogButtons::OkCancelCustom(
                                "Reset database and restart".to_string(),
                                "Quit".to_string(),
                            ))
                            .blocking_show();

                        if reset {
                            match state::db::quarantine_database().await {
                                Ok(moved) => {
                                    info!("Database moved aside to {:?}, restarting", moved);
                                    state_init_app_handle.restart();
                                }
                                Err(err) => {
                                    error!("Could not move the database aside: {}", err);
                                    let _ = state_init_app_handle
                                        .dialog()
                                        .message(format!("{}", err))
                                        .kind(MessageDialogKind::Error)
                                        .title("NoRisk Launcher - Reset Failed")
                                        .blocking_show();
                                }
                            }
                        }
                    }
                    std::process::exit(1);
                }
                info!("State initialization finished successfully.");

                // Sweep last session's throwaway temp profiles into the trash
                // (non-blocking, best-effort). The trash's purge_expired retention
                // then deletes them for good. See utils::trash_utils.
                #[cfg(desktop)]
                tauri::async_runtime::spawn(async {
                    utils::trash_utils::reap_temp_profiles().await;
                });

                tauri::async_runtime::spawn(async {
                    if let Err(e) =
                        commands::skin_render_command::prune_skin_renders(30).await
                    {
                        log::warn!("Failed to prune skin renders: {}", e);
                    }
                });

                // Issue #130: recover disk from pre-fix runaway logs.
                #[cfg(desktop)]
                tauri::async_runtime::spawn(async {
                    utils::log_archive::cleanup_oversized_logs().await;
                });

                // Issue #242: drop stale/orphan cached jars (debounced, best-effort).
                #[cfg(desktop)]
                tauri::async_runtime::spawn(async {
                    utils::mod_cache_cleanup::run_startup_cleanup().await;
                });

                #[cfg(any(windows, target_os = "macos"))]
                commands::clip_commands::start_on_launch(state_init_app_handle.clone());

                #[cfg(desktop)]
                {
                trace!("Attempting to retrieve launcher configuration for update check...");
                match state::state_manager::State::get().await {
                    Ok(state_manager_instance) => {
                        let config = state_manager_instance.config_manager.get_config().await;
                        let check_beta_channel = config.check_beta_channel;
                        let mut auto_check_updates_enabled = config.auto_check_updates;

                        // Disable auto-updates when running in Flatpak
                        if updater_utils::is_flatpak() {
                            info!("Running in Flatpak environment - disabling automatic updates (Flatpak handles updates through its own mechanism).");
                            auto_check_updates_enabled = false;
                        }

                        if auto_check_updates_enabled {
                            trace!("Initiating application update check (Channel determined by config: Beta={})...", check_beta_channel);
                            updater_utils::check_for_updates(state_init_app_handle.clone(), check_beta_channel, updater_window.clone()).await;
                            trace!("Update check process has finished.");
                        } else {
                            info!("Auto-check for updates is disabled in settings. Skipping update check.");
                            // Ensure the updater window (if created) is closed if we skip the check.
                            if let Some(win) = updater_window {
                                updater_utils::emit_status(&state_init_app_handle, "close", "Auto-update disabled.".to_string(), None);
                                tokio::time::sleep(tokio::time::Duration::from_millis(200)).await; // Give time for emit to process
                                if let Err(close_err) = win.close() {
                                    error!("Failed to close updater window when skipping updates: {}", close_err);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!("Failed to get global state for update check: {}.", e);
                        if let Some(win) = updater_window {
                            updater_utils::emit_status(&state_init_app_handle, "close", "Closing due to state fetch error.".to_string(), None);
                            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                            if let Err(close_err) = win.close() {
                                error!("Failed to close updater window after state fetch error: {}", close_err);
                            }
                        }
                    }
                }

                info!("Updater process finished. Attempting to show main window...");
                if let Some(main_window) = state_init_app_handle.get_webview_window("main") {
                    match main_window.show() {
                        Ok(_) => {
                            info!("Main window shown successfully.");
                            if let Err(e) = main_window.set_focus() {
                                error!("Failed to focus main window (non-critical): {}", e);
                            }
                        }
                        Err(e) => {
                            error!("CRITICAL: Failed to show main window: {}", e);

                            #[cfg(target_os = "windows")]
                            {
                                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                                let _ = state_init_app_handle
                                    .dialog()
                                    .message("The NoRisk Launcher encountered a critical error.\n\n\
                                        Please join our Discord for support:\n\
                                        https://discord.norisk.gg")
                                    .kind(MessageDialogKind::Error)
                                    .title("NoRisk Launcher - Critical Error")
                                    .blocking_show();
                            }

                            std::process::exit(1);
                        }
                    }
                } else {
                    error!("CRITICAL: Could not get main window handle!");

                    #[cfg(target_os = "windows")]
                    {
                        use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                        let _ = state_init_app_handle
                            .dialog()
                            .message("The NoRisk Launcher encountered a critical error.\n\n\
                                Please join our Discord for support:\n\
                                https://discord.norisk.gg")
                            .kind(MessageDialogKind::Error)
                            .title("NoRisk Launcher - Critical Error")
                            .blocking_show();
                    }

                    std::process::exit(1);
                }
                }

                // --- Test Unified Mod Search ---
                //debug_utils::debug_unified_mod_search().await;

                // --- Test Unified Mod Versions ---
                //debug_utils::debug_unified_mod_versions().await;
            });

            utils::screen_time::spawn(app_handle.clone());

            // --- Register Focus Event Listener for Discord RPC ---
            #[cfg(desktop)]
            if let Some(main_window) = app.get_webview_window("main") {
                let focus_app_handle = app_handle.clone();
                main_window.listen("tauri://focus", move |_event| {
                    let _listener_app_handle = focus_app_handle.clone();
                    tokio::spawn(async move {
                        trace!("Main window focus event received. Triggering DiscordManager handler.");
                        match state::state_manager::State::get().await {
                            Ok(state_manager_instance) => {
                                if let Err(e) = state_manager_instance.discord_manager.handle_focus_event().await {
                                    error!("Error during DiscordManager focus handling: {}", e);
                                }
                            }
                            Err(e) => {
                                error!("Focus event listener: Failed to get global state using State::get(): {}", e);
                            }
                        }
                    });
                });
            } else {
                error!("Could not get main window handle to attach focus listener!");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(desktop)]
            utils::mod_cache_cleanup::debug_list_expected_cache_filenames,
            #[cfg(desktop)]
            utils::mod_cache_cleanup::clean_mod_cache_command,
            list_system_fonts,
            #[cfg(desktop)]
            create_profile,
            #[cfg(desktop)]
            get_profile,
            #[cfg(desktop)]
            update_profile,
            #[cfg(desktop)]
            delete_profile,
            #[cfg(desktop)]
            repair_profile,
            #[cfg(desktop)]
            resolve_loader_version,
            #[cfg(desktop)]
            list_profiles,
            #[cfg(desktop)]
            list_profile_backups,
            #[cfg(desktop)]
            restore_profile_backup,
            #[cfg(desktop)]
            commands::profile_command::list_removed_standard_profiles,
            #[cfg(desktop)]
            commands::profile_command::restore_standard_profile,
            #[cfg(desktop)]
            get_profile_store_status,
            #[cfg(desktop)]
            reimport_profiles_from_legacy_json,
            #[cfg(desktop)]
            search_profiles,
            get_minecraft_versions,
            #[cfg(desktop)]
            launch_profile,
            #[cfg(desktop)]
            abort_profile_launch,
            #[cfg(desktop)]
            is_profile_launching,
            #[cfg(desktop)]
            get_processes,
            #[cfg(desktop)]
            get_process,
            #[cfg(desktop)]
            get_processes_by_profile,
            #[cfg(desktop)]
            stop_process,
            #[cfg(desktop)]
            open_minecraft_log_window,
            #[cfg(desktop)]
            open_single_log_window,
            #[cfg(desktop)]
            focus_main_window,
            begin_login,
            cancel_login,
            is_flatpak,
            remove_account,
            get_active_account,
            set_active_account,
            get_accounts,
            twitch_available_scopes,
            twitch_begin_device_login,
            twitch_cancel_login,
            twitch_unlink,
            twitch_is_linked,
            #[cfg(desktop)]
            search_modrinth_mods,
            #[cfg(desktop)]
            search_modrinth_projects,
            #[cfg(desktop)]
            search_mods_unified_command,
            #[cfg(desktop)]
            get_mod_versions_unified_command,
            #[cfg(desktop)]
            get_modpack_versions_unified_command,
            #[cfg(desktop)]
            get_curseforge_mods_by_ids,
            #[cfg(desktop)]
            download_and_install_curseforge_modpack_command,
            #[cfg(desktop)]
            get_curseforge_file_changelog_command,
            #[cfg(desktop)]
            get_curseforge_mod_description_command,
            #[cfg(desktop)]
            get_modrinth_mod_versions,
            #[cfg(desktop)]
            add_modrinth_mod_to_profile,
            #[cfg(desktop)]
            add_modrinth_content_to_profile,
            #[cfg(desktop)]
            get_modrinth_project_details,
            #[cfg(desktop)]
            get_modrinth_project_members,
            #[cfg(desktop)]
            check_modrinth_updates,
            #[cfg(desktop)]
            check_mod_updates_unified_command,
            get_icons_for_archives,
            #[cfg(desktop)]
            set_profile_mod_enabled,
            #[cfg(desktop)]
            delete_mod_from_profile,
            #[cfg(desktop)]
            get_norisk_packs,
            #[cfg(desktop)]
            get_norisk_packs_resolved,
            #[cfg(desktop)]
            set_norisk_mod_status,
            #[cfg(desktop)]
            update_modrinth_mod_version,
            #[cfg(desktop)]
            get_all_modrinth_versions_for_contexts,
            #[cfg(desktop)]
            get_process_log_cursor,
            #[cfg(desktop)]
            fetch_crash_report,
            #[cfg(desktop)]
            get_custom_mods,
            #[cfg(desktop)]
            get_local_resourcepacks,
            #[cfg(desktop)]
            get_local_shaderpacks,
            #[cfg(desktop)]
            get_local_datapacks,
            #[cfg(desktop)]
            set_custom_mod_enabled,
            #[cfg(desktop)]
            import_local_mods,
            #[cfg(desktop)]
            get_system_ram_mb,
            #[cfg(desktop)]
            get_default_memory_max_mb,
            #[cfg(desktop)]
            delete_custom_mod,
            #[cfg(desktop)]
            open_profile_folder,
            #[cfg(desktop)]
            import_profile,
            #[cfg(desktop)]
            preview_import_pack,
            upload_log_to_mclogs_command,
            get_fabric_loader_versions,
            get_forge_versions,
            get_neoforge_versions,
            get_quilt_loader_versions,
            set_file_enabled,
            #[cfg(desktop)]
            delete_file,
            #[cfg(desktop)]
            get_icons_for_norisk_mods,
            open_file_directory,
            #[cfg(desktop)]
            download_and_install_modrinth_modpack,
            #[cfg(desktop)]
            get_standard_profiles,
            #[cfg(desktop)]
            get_profile_directory_structure,
            #[cfg(desktop)]
            copy_profile,
            #[cfg(desktop)]
            export_profile,
            get_launcher_config,
            get_legal_status,
            acknowledge_legal_documents,
            acknowledge_legal_notice,
            set_launcher_config,
            get_launcher_directory,
            #[cfg(desktop)]
            resolve_image_path,
            #[cfg(desktop)]
            commands::path_commands::upload_profile_images,
            #[cfg(desktop)]
            update_resourcepack_from_modrinth,
            #[cfg(desktop)]
            update_shaderpack_from_modrinth,
            #[cfg(desktop)]
            update_datapack_from_modrinth,
            get_user_skin_data,
            upload_skin,
            reset_skin,
            apply_skin_from_base64,
            get_active_skin,
            get_all_skins,
            get_skin_by_id,
            add_skin,
            remove_skin,
            update_skin_properties,
            #[cfg(desktop)]
            set_discord_state,
            browse_capes,
            get_player_capes,
            get_active_creator_code,
            get_selected_player_icon,
            get_selected_player_icon_cached,
            get_equipped_cosmetics,
            get_equipped_cosmetics_cached,
            get_random_local_emote,
            get_owned_capes_list,
            equip_cape,
            delete_cape,
            check_is_moderator,
            upload_cape,
            unequip_cape,
            add_favorite_cape,
            remove_favorite_cape,
            #[cfg(desktop)]
            refresh_norisk_packs,
            #[cfg(desktop)]
            refresh_standard_versions,
            #[cfg(desktop)]
            is_content_installed,
            #[cfg(desktop)]
            batch_check_content_installed,
            #[cfg(desktop)]
            check_for_group_migration_command,
            #[cfg(desktop)]
            open_profile_latest_log,
            #[cfg(desktop)]
            detect_java_installations_command,
            #[cfg(desktop)]
            get_java_info_command,
            #[cfg(desktop)]
            find_best_java_for_minecraft_command,
            #[cfg(desktop)]
            invalidate_java_cache_command,
            #[cfg(desktop)]
            validate_java_path_command,
            #[cfg(desktop)]
            get_worlds_for_profile,
            #[cfg(desktop)]
            get_servers_for_profile,
            #[cfg(desktop)]
            copy_world,
            #[cfg(desktop)]
            import_world,
            #[cfg(desktop)]
            check_world_lock_status,
            ping_minecraft_server,
            #[cfg(desktop)]
            delete_world,
            #[cfg(desktop)]
            get_profile_log_files,
            #[cfg(desktop)]
            get_log_file_content,
            #[cfg(desktop)]
            list_profile_screenshots,
            list_launcher_logs,
            #[cfg(desktop)]
            list_crash_reports,
            #[cfg(desktop)]
            list_all_mc_logs,
            #[cfg(desktop)]
            list_process_logs,
            open_file,
            read_file_bytes,
            get_app_version,
            get_news_and_changelogs_command,
            #[cfg(desktop)]
            check_update_available_command,
            #[cfg(desktop)]
            download_and_install_update_command,
            #[cfg(desktop)]
            get_modrinth_tags_command,
            #[cfg(desktop)]
            clear_content_cache_command,
            #[cfg(desktop)]
            get_modrinth_versions_by_hashes,
            #[cfg(desktop)]
            switch_modpack_version_command,
            #[cfg(desktop)]
            uninstall_content_from_profile,
            #[cfg(desktop)]
            toggle_content_from_profile,
            #[cfg(desktop)]
            toggle_contents_from_profile,
            #[cfg(desktop)]
            update_contents_from_profile,
            #[cfg(desktop)]
            uninstall_contents_from_profile,
            #[cfg(desktop)]
            toggle_mod_updates,
            #[cfg(desktop)]
            bulk_toggle_mod_updates,
            #[cfg(desktop)]
            install_content_to_profile,
            commands::minecraft_command::get_profile_by_name_or_uuid,
            commands::minecraft_command::add_skin_locally,
            commands::minecraft_command::get_base64_from_skin_source_command,
            commands::file_command::get_image_preview,
            download_template_and_open_explorer,
            #[cfg(desktop)]
            get_all_profiles_and_last_played,
            #[cfg(desktop)]
            get_local_content,
            #[cfg(desktop)]
            install_local_content_to_profile,
            #[cfg(desktop)]
            copy_contents_to_profile,
            #[cfg(desktop)]
            switch_content_version,
            commands::minecraft_command::get_face_avatar,
            commands::skin_render_command::get_cached_skin_render,
            commands::skin_render_command::store_skin_render,
            #[cfg(desktop)]
            commands::applixir_command::applixir_show_ad,
            commands::applixir_command::applixir_mint_session,
            commands::applixir_command::get_afkpoints_balance,
            commands::applixir_command::afk_shop_catalog,
            commands::applixir_command::afk_shop_purchase,
            commands::applixir_command::afk_daily_state,
            commands::applixir_command::afk_daily_claim,
            #[cfg(desktop)]
            commands::nrc_commands::discord_auth_link,
            commands::nrc_commands::discord_auth_status,
            commands::nrc_commands::discord_auth_unlink,
            #[cfg(desktop)]
            commands::nrc_commands::github_auth_link,
            commands::nrc_commands::github_auth_status,
            commands::nrc_commands::github_auth_unlink,
            #[cfg(desktop)]
            commands::nrc_commands::check_crash_log_command,
            #[cfg(desktop)]
            commands::crash_fix_command::apply_crash_fix,
            #[cfg(desktop)]
            commands::crash_fix_command::revert_crash_fix,
            commands::nrc_commands::log_message_command,
            #[cfg(desktop)]
            commands::flagsmith_commands::set_blocked_mods_config,
            #[cfg(desktop)]
            commands::flagsmith_commands::get_blocked_mods_config,
            #[cfg(desktop)]
            commands::flagsmith_commands::is_filename_blocked,
            #[cfg(desktop)]
            commands::flagsmith_commands::is_mod_id_blocked,
            #[cfg(desktop)]
            commands::flagsmith_commands::is_modrinth_project_id_blocked,
            #[cfg(desktop)]
            commands::flagsmith_commands::refresh_blocked_mods_config,
            #[cfg(desktop)]
            commands::pack_rollout_commands::set_pack_rollout_config,
            #[cfg(desktop)]
            commands::pack_rollout_commands::get_pack_rollout_config,
            #[cfg(desktop)]
            commands::pack_rollout_commands::get_pack_rollout_status,
            #[cfg(desktop)]
            commands::pack_rollout_commands::get_effective_pack_id,
            #[cfg(desktop)]
            commands::pack_rollout_commands::is_pack_rollout_active,
            #[cfg(desktop)]
            commands::pack_rollout_commands::is_pack_aliased,
            #[cfg(desktop)]
            commands::pack_fallback_commands::set_pack_fallback_config,
            #[cfg(desktop)]
            commands::pack_fallback_commands::get_pack_fallback_config,
            commands::permission_commands::refresh_permissions,
            commands::permission_commands::get_cached_permissions,
            commands::permission_commands::has_permission,
            commands::permission_commands::get_granted_permissions,
            commands::nrc_commands::get_mobile_app_token,
            commands::nrc_commands::reset_mobile_app_token,
            commands::nrc_commands::get_advent_calendar_command,
            commands::nrc_commands::claim_advent_calendar_day_command,
            commands::nrc_commands::get_unique_players_24h_command,
            commands::nrc_commands::get_referral_info,
            commands::nrc_commands::get_notifications,
            commands::nrc_commands::mark_all_notifications_read,
            commands::nrc_commands::mark_notification_read,
            get_capes_by_hashes,
            get_owned_vanilla_capes,
            get_currently_equipped_vanilla_cape,
            equip_vanilla_cape,
            get_vanilla_cape_info,
            refresh_vanilla_cape_data,
            track_analytics_event,
            commands::analytics_command::get_system_os_info,
            commands::analytics_command::set_screen_time_tab,
            #[cfg(desktop)]
            commands::profile_command::launch_profile_with_overrides,
            #[cfg(desktop)]
            commands::profile_command::launch_temp_profile,
            #[cfg(desktop)]
            commands::profile_command::add_profile_symlink,
            #[cfg(desktop)]
            commands::profile_command::remove_profile_symlink,
            #[cfg(desktop)]
            commands::profile_command::get_profile_symlinks,
            #[cfg(desktop)]
            commands::sync_pack_command::get_or_create_default_sync_pack,
            #[cfg(desktop)]
            commands::sync_pack_command::add_dropped_sync_target,
            #[cfg(desktop)]
            commands::sync_pack_command::list_sync_seed_candidates,
            #[cfg(desktop)]
            commands::sync_pack_command::preview_profile_sync,
            #[cfg(desktop)]
            commands::sync_pack_command::get_sync_packs,
            #[cfg(desktop)]
            commands::sync_pack_command::get_sync_pack,
            #[cfg(desktop)]
            commands::sync_pack_command::create_sync_pack,
            #[cfg(desktop)]
            commands::sync_pack_command::update_sync_pack,
            #[cfg(desktop)]
            commands::sync_pack_command::import_sync_pack_icon,
            #[cfg(desktop)]
            commands::sync_pack_command::add_sync_pack_target,
            #[cfg(desktop)]
            commands::sync_pack_command::count_sync_pack_target_users,
            #[cfg(desktop)]
            commands::sync_pack_command::remove_sync_pack_target,
            #[cfg(desktop)]
            commands::sync_pack_command::add_content_to_sync_pack,
            #[cfg(desktop)]
            commands::sync_pack_command::remove_content_from_sync_pack,
            #[cfg(desktop)]
            commands::sync_pack_command::remove_mod_from_sync_pack,
            #[cfg(desktop)]
            commands::sync_pack_command::get_sync_pack_local_jars,
            #[cfg(desktop)]
            commands::sync_pack_command::remove_sync_pack_local_jar,
            #[cfg(desktop)]
            commands::sync_pack_command::get_sync_pack_subscribers,
            #[cfg(desktop)]
            commands::sync_pack_command::open_sync_pack_folder,
            #[cfg(desktop)]
            commands::sync_pack_command::delete_sync_pack,
            #[cfg(desktop)]
            commands::sync_pack_command::set_profile_sync_packs,
            #[cfg(desktop)]
            commands::sync_pack_command::get_profile_sync_conflicts,
            #[cfg(desktop)]
            commands::sync_pack_command::get_profile_sync_pack_mods,
            #[cfg(desktop)]
            commands::sync_pack_command::set_profile_sync_mods_excluded,
            #[cfg(desktop)]
            commands::sync_pack_command::sync_profile_now,
            #[cfg(desktop)]
            commands::sync_pack_command::set_sync_pack_mod_enabled,
            #[cfg(desktop)]
            commands::sync_pack_command::remove_sync_pack_entries,
            #[cfg(desktop)]
            commands::sync_pack_command::set_sync_pack_mods_enabled,
            #[cfg(desktop)]
            commands::sync_pack_command::set_sync_pack_mod_version_override,
            #[cfg(desktop)]
            commands::sync_pack_command::get_sync_pack_mod_matrix,
            #[cfg(desktop)]
            commands::sync_pack_command::resolve_sync_pack_mod,
            #[cfg(desktop)]
            commands::launcher_import_command::scan_external_launchers,
            #[cfg(desktop)]
            commands::launcher_import_command::add_external_launcher_root,
            #[cfg(desktop)]
            commands::launcher_import_command::list_external_instances,
            #[cfg(desktop)]
            commands::launcher_import_command::preview_external_instance,
            #[cfg(desktop)]
            commands::launcher_import_command::import_external_instance,
            #[cfg(desktop)]
            commands::launcher_import_command::cancel_external_import,
            #[cfg(desktop)]
            commands::profile_command::get_profile_instance_path,
            #[cfg(desktop)]
            commands::profile_command::get_default_profile_path,
            #[cfg(desktop)]
            commands::profile_command::get_profile_disk_size,
            get_or_download_asset_model,
            get_friends,
            get_pending_requests,
            get_friends_user,
            send_friend_request,
            accept_friend_request,
            deny_friend_request,
            remove_friend,
            set_online_status,
            toggle_friend_ping,
            update_privacy_setting,
            connect_friends_websocket,
            disconnect_friends_websocket,
            is_friends_websocket_connected,
            get_or_create_chat,
            get_private_chats,
            get_chat_messages,
            send_chat_message,
            edit_chat_message,
            delete_chat_message,
            send_typing_indicator,
            add_message_reaction,
            remove_message_reaction,
            commands::mcreal_commands::get_mcreal_feed,
            commands::mcreal_commands::get_mcreal_today_post,
            commands::mcreal_commands::get_mcreal_post,
            commands::mcreal_commands::delete_mcreal_post,
            commands::mcreal_commands::get_mcreal_post_image,
            commands::mcreal_commands::rate_mcreal_post,
            commands::mcreal_commands::unrate_mcreal_post,
            commands::mcreal_commands::get_mcreal_comments,
            commands::mcreal_commands::add_mcreal_comment,
            commands::mcreal_commands::delete_mcreal_comment,
            commands::mcreal_commands::rate_mcreal_comment,
            commands::mcreal_commands::unrate_mcreal_comment,
            commands::mcreal_commands::get_mcreal_user,
            commands::mcreal_commands::get_mcreal_profile,
            commands::mcreal_commands::follow_mcreal_user,
            commands::mcreal_commands::unfollow_mcreal_user,
            commands::mcreal_commands::upload_mcreal_post,
            #[cfg(desktop)]
            commands::deep_link_handler::confirm_auth_bridge,
            #[cfg(desktop)]
            commands::deep_link_handler::take_pending_deep_links,
            #[cfg(desktop)]
            commands::support_command::support_request_fetch,
            #[cfg(desktop)]
            commands::support_command::support_request_prepare,
            #[cfg(desktop)]
            commands::support_command::support_request_execute_action,
            #[cfg(desktop)]
            commands::support_command::support_request_submit,
            #[cfg(desktop)]
            commands::support_command::support_request_decline,
            #[cfg(desktop)]
            commands::support_command::support_request_close,
            #[cfg(desktop)]
            commands::clip_commands::capture_apply_settings,
            #[cfg(desktop)]
            commands::clip_commands::capture_release_hotkeys,
            #[cfg(desktop)]
            commands::clip_commands::capture_status,
            #[cfg(desktop)]
            commands::clip_commands::capture_supported,
            #[cfg(desktop)]
            commands::capture_permissions::capture_permissions,
            #[cfg(desktop)]
            commands::capture_permissions::capture_open_permission_settings,
            #[cfg(desktop)]
            commands::capture_permissions::capture_reset_permissions,
            #[cfg(desktop)]
            commands::clip_commands::capture_encoder_capabilities,
            #[cfg(desktop)]
            commands::clip_commands::capture_show_overlay,
            #[cfg(desktop)]
            commands::clip_commands::capture_hide_overlay,
            #[cfg(desktop)]
            commands::clip_commands::clip_list,
            #[cfg(desktop)]
            commands::clip_commands::clip_storage_usage,
            #[cfg(desktop)]
            commands::clip_commands::clip_delete,
            #[cfg(desktop)]
            commands::clip_commands::clip_reveal,
            #[cfg(desktop)]
            commands::clip_commands::clip_trim,
            #[cfg(desktop)]
            commands::clip_commands::clip_details,
            #[cfg(desktop)]
            commands::clip_commands::clip_set_favourite,
            #[cfg(desktop)]
            commands::clip_commands::clip_open_apps,
            #[cfg(desktop)]
            commands::clip_commands::clip_list_screens,
            #[cfg(desktop)]
            commands::clip_commands::clip_save_thumbnail,
            #[cfg(desktop)]
            commands::clip_commands::clip_export_vertical,
            #[cfg(desktop)]
            commands::clip_commands::clip_export_gif,
            #[cfg(desktop)]
            commands::clip_commands::clip_prepare_preview,
            #[cfg(desktop)]
            commands::clip_commands::clip_rename,
            #[cfg(desktop)]
            commands::clip_commands::clip_open_folder,
            #[cfg(desktop)]
            commands::clip_commands::clip_open_editor,
            #[cfg(desktop)]
            commands::clip_commands::clip_editor_current,
            #[cfg(desktop)]
            commands::clip_commands::clip_editor_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(
            #[allow(unused_variables)]
            |app_handle, event| {
                if matches!(event, tauri::RunEvent::Exit) {
                    utils::screen_time::report_before_exit();
                }

                #[cfg(target_os = "macos")]
                if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = event {
                    utils::main_window::show(app_handle);
                }

                #[cfg(target_os = "macos")]
                if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                    use std::sync::atomic::{AtomicBool, Ordering};
                    static EXIT_READY: AtomicBool = AtomicBool::new(false);
                    static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
                    if !EXIT_READY.load(Ordering::SeqCst) {
                        api.prevent_exit();
                        if !SHUTTING_DOWN.swap(true, Ordering::SeqCst) {
                            let app = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Ok(state) = state::State::get().await {
                                    state.capture_supervisor.finish_shutdown().await;
                                }
                                EXIT_READY.store(true, Ordering::SeqCst);
                                app.exit(code.unwrap_or(0));
                            });
                        }
                    }
                }
            },
        );
}
