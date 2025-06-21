// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod config;
mod error;
pub mod integrations;
mod logging;
mod minecraft;
mod state;
mod utils;
use crate::integrations::norisk_packs;
use crate::integrations::norisk_versions;
use log::{debug, error, info};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Listener;
use tauri::Manager;
use utils::debug_utils;
use utils::updater_utils;

use crate::commands::process_command::{
    get_full_log, get_process, get_processes, get_processes_by_profile, open_log_window,
    set_discord_state, stop_process,
};
use commands::minecraft_auth_command::{
    begin_login, get_accounts, get_active_account, remove_account, set_active_account,
};
use commands::minecraft_command::{
    add_skin,
    apply_skin_from_base64,
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
use commands::profile_command::{
    abort_profile_launch, add_modrinth_content_to_profile, add_modrinth_mod_to_profile,
    batch_check_content_installed, check_world_lock_status, copy_profile, copy_world,
    create_profile, delete_custom_mod, delete_mod_from_profile, delete_profile, delete_world,
    export_profile, get_all_profiles_and_last_played, get_custom_mods, get_local_content,
    get_local_datapacks, get_local_resourcepacks, get_local_shaderpacks, get_log_file_content,
    get_norisk_packs, get_norisk_packs_resolved, get_profile, get_profile_directory_structure,
    get_profile_latest_log_content, get_profile_log_files, get_servers_for_profile,
    get_standard_profiles, get_system_ram_mb, get_worlds_for_profile, import_local_mods,
    import_profile, import_profile_from_file, is_content_installed, is_profile_launching,
    launch_profile, list_profile_screenshots, list_profiles, open_profile_folder,
    open_profile_latest_log, refresh_norisk_packs, refresh_standard_versions, repair_profile,
    search_profiles, set_custom_mod_enabled, set_norisk_mod_status, set_profile_mod_enabled,
    update_datapack_from_modrinth, update_modrinth_mod_version, update_profile,
    update_resourcepack_from_modrinth, update_shaderpack_from_modrinth,
};

// Use statements for registered commands only
use commands::modrinth_commands::{
    check_modrinth_updates, download_and_install_modrinth_modpack,
    get_all_modrinth_versions_for_contexts, get_modrinth_categories_command,
    get_modrinth_game_versions_command, get_modrinth_loaders_command, get_modrinth_mod_versions,
    get_modrinth_project_details, get_modrinth_versions_by_hashes, search_modrinth_mods,
    search_modrinth_projects,
};

use commands::file_command::{
    delete_file, get_icons_for_archives, get_icons_for_norisk_mods, open_file, open_file_directory,
    read_file_bytes, set_file_enabled,
};

// Import config commands
use commands::config_commands::{get_app_version, get_launcher_config, set_launcher_config};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

// Import path commands
use commands::path_commands::{get_launcher_directory, resolve_image_path};

// Import cape commands
use commands::cape_command::{
    browse_capes, delete_cape, download_template_and_open_explorer, equip_cape, get_player_capes,
    unequip_cape, upload_cape,
};

// Import NRC commands
use commands::nrc_commands::get_news_and_changelogs_command;

// Import Content commands
use commands::content_command::{
    install_content_to_profile, install_local_content_to_profile, switch_content_version,
    toggle_content_from_profile, uninstall_content_from_profile,
};

// Import Java commands
use commands::java_command::{
    detect_java_installations_command, find_best_java_for_minecraft_command, get_java_info_command,
    invalidate_java_cache_command, validate_java_path_command,
};

#[tokio::main]
async fn main() {
    if let Err(e) = logging::setup_logging().await {
        eprintln!("FEHLER: Logging konnte nicht initialisiert werden: {}", e);
    }

    info!("Starting NoRiskClient Launcher...");

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            info!("SingleInstance plugin: Second instance triggered with args: {:?}", argv);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            // Focus the main window on second instance
            /*if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize(); // Ensure it's not minimized
                let _ = window.set_focus();   // Bring to front and focus
            }
            // Call the handler for .noriskpack files
            let app_handle_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                norisk_packs::handle_noriskpack_file_paths(&app_handle_clone, argv).await;
            });*/
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

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
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        // Beim Klick auf das Tray-Icon das Fenster anzeigen/verstecken
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            let is_minimized = window.is_minimized().unwrap_or(false);
                            
                            if is_visible && !is_minimized {
                                // Fenster ist sichtbar und nicht minimiert -> verstecken
                                let _ = window.hide();
                            } else {
                                // Fenster ist versteckt oder minimiert -> anzeigen
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => {
                        // Doppelklick zeigt immer das Fenster
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

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
                let updater_window = match updater_utils::create_updater_window(&state_init_app_handle).await {
                    Ok(win) => {
                        info!("Updater window created successfully (initially hidden).");
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
                    error!("CRITICAL: Failed to initialize state: {}. Update check and main window might not proceed correctly.", e);
                    if let Some(win) = updater_window {
                        updater_utils::emit_status(&state_init_app_handle, "close", "Closing due to state init error.".to_string(), None);
                        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                        if let Err(close_err) = win.close() {
                            error!("Failed to close updater window after state init error: {}", close_err);
                        }
                    }
                    return;
                }
                info!("State initialization finished successfully.");

                info!("Attempting to retrieve launcher configuration for update check...");
                match state::state_manager::State::get().await {
                    Ok(state_manager_instance) => { 
                        let config = state_manager_instance.config_manager.get_config().await;
                        let check_beta_channel = config.check_beta_channel;
                        let auto_check_updates_enabled = config.auto_check_updates;

                        if auto_check_updates_enabled {
                            info!("Initiating application update check (Channel determined by config: Beta={})...", check_beta_channel);
                            updater_utils::check_for_updates(state_init_app_handle.clone(), check_beta_channel, updater_window.clone()).await;
                            info!("Update check process has finished.");
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
                    if let Err(e) = main_window.show() {
                        error!("Failed to show main window: {}", e);
                    } else {
                        info!("Main window shown successfully.");
                        if let Err(e) = main_window.set_focus() {
                            error!("Failed to focus main window: {}", e);
                        }
                    }
                } else {
                    error!("Could not get main window handle to show it after update check!");
                }
            });

            // --- Register Focus Event Listener for Discord RPC --- 
            if let Some(main_window) = app.get_webview_window("main") { 
                let focus_app_handle = app_handle.clone(); 
                main_window.listen("tauri://focus", move |_event| {
                    let listener_app_handle = focus_app_handle.clone(); 
                    tokio::spawn(async move {
                        debug!("Main window focus event received. Triggering DiscordManager handler.");
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

                // --- Handle window close request (from taskbar, etc.) ---
                main_window.listen("tauri://close-requested", move |_event| {
                    info!("Window close requested via system (taskbar, etc.). Exiting application.");
                    std::process::exit(0);
                });
            } else {
                error!("Could not get main window handle to attach focus listener!");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_profile,
            get_profile,
            update_profile,
            delete_profile,
            repair_profile,
            list_profiles,
            search_profiles,
            get_minecraft_versions,
            launch_profile,
            abort_profile_launch,
            is_profile_launching,
            get_processes,
            get_process,
            get_processes_by_profile,
            stop_process,
            open_log_window,
            begin_login,
            remove_account,
            get_active_account,
            set_active_account,
            get_accounts,
            search_modrinth_mods,
            search_modrinth_projects,
            get_modrinth_mod_versions,
            add_modrinth_mod_to_profile,
            add_modrinth_content_to_profile,
            get_modrinth_project_details,
            check_modrinth_updates,
            get_icons_for_archives,
            set_profile_mod_enabled,
            delete_mod_from_profile,
            get_norisk_packs,
            get_norisk_packs_resolved,
            set_norisk_mod_status,
            update_modrinth_mod_version,
            get_all_modrinth_versions_for_contexts,
            get_full_log,
            get_custom_mods,
            get_local_resourcepacks,
            get_local_shaderpacks,
            get_local_datapacks,
            set_custom_mod_enabled,
            import_local_mods,
            get_system_ram_mb,
            delete_custom_mod,
            open_profile_folder,
            import_profile_from_file,
            import_profile, 
            upload_log_to_mclogs_command,
            get_fabric_loader_versions,
            get_forge_versions,
            get_neoforge_versions,
            get_quilt_loader_versions,
            set_file_enabled,
            delete_file,
            get_icons_for_norisk_mods,
            open_file_directory,
            download_and_install_modrinth_modpack,
            get_standard_profiles,
            get_profile_directory_structure,
            copy_profile,
            export_profile,
            get_launcher_config,
            set_launcher_config,
            get_launcher_directory,
            resolve_image_path,
            commands::path_commands::upload_profile_images,
            update_resourcepack_from_modrinth,
            update_shaderpack_from_modrinth,
            update_datapack_from_modrinth,
            get_user_skin_data,
            upload_skin,
            reset_skin,
            apply_skin_from_base64,
            get_all_skins,
            get_skin_by_id,
            add_skin,
            remove_skin,
            update_skin_properties,
            set_discord_state,
            browse_capes,
            get_player_capes,
            equip_cape,
            delete_cape,
            upload_cape,
            unequip_cape,
            refresh_norisk_packs,
            refresh_standard_versions,
            is_content_installed,
            batch_check_content_installed,
            open_profile_latest_log,
            get_profile_latest_log_content,
            detect_java_installations_command,
            get_java_info_command,
            find_best_java_for_minecraft_command,
            invalidate_java_cache_command,
            validate_java_path_command,
            get_worlds_for_profile,
            get_servers_for_profile,
            copy_world,
            check_world_lock_status,
            ping_minecraft_server,
            delete_world,
            get_profile_log_files,
            get_log_file_content,
            list_profile_screenshots,
            open_file,
            read_file_bytes,
            get_app_version,
            get_news_and_changelogs_command,
            get_modrinth_categories_command,
            get_modrinth_loaders_command,
            get_modrinth_game_versions_command,
            get_modrinth_versions_by_hashes,
            uninstall_content_from_profile,
            toggle_content_from_profile,
            install_content_to_profile,
            commands::minecraft_command::get_profile_by_name_or_uuid,
            commands::minecraft_command::add_skin_locally,
            commands::file_command::get_image_preview,
            download_template_and_open_explorer,
            get_all_profiles_and_last_played,
            get_local_content,
            install_local_content_to_profile,
            switch_content_version,
            commands::minecraft_command::get_starlight_skin_render,
            commands::nrc_commands::discord_auth_link,
            commands::nrc_commands::discord_auth_status,
            commands::nrc_commands::discord_auth_unlink,
            commands::nrc_commands::submit_crash_log_command
        ])
        .build(tauri::generate_context!()) 
        .expect("error while building tauri application") 
        .run(
            #[allow(unused_variables)]
            |app_handle, event| {
                // Removed macOS/iOS specific Opened event handling as single-instance handles args now
                // Keep other run event handling if needed, e.g., for window events, exit requested, etc.
                if let tauri::RunEvent::ExitRequested { api, .. } = event {
                    info!("Exit requested, preventing default to allow async tasks to finish if any.");
                    // api.prevent_exit(); // Example: if you need to do cleanup before exit
                }
            },
        );
}
