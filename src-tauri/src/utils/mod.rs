/// Measures the execution time of a block and logs it in milliseconds.
/// Returns the result of the block transparently — works with both sync and async code.
macro_rules! measure_time {
    ($label:expr, $block:expr) => {{
        let __start = std::time::Instant::now();
        let __result = $block;
        let __elapsed = __start.elapsed().as_millis();
        log::info!("[Timing] {} took {}ms", $label, __elapsed);
        __result
    }};
}

#[cfg(desktop)]
pub mod content_copy;
#[cfg(desktop)]
pub mod datapack_utils; // DataPack-Utils für das Scannen und Verwalten von DataPacks
#[cfg(desktop)]
pub mod debug_utils;
pub mod disk_space_utils; // Disk space utility for checking available space before downloads
pub mod download_utils; // Central download utility for robust file downloads
#[cfg(desktop)]
pub mod mod_cache_cleanup; // mod_cache keep-set + debounced startup orphan cleanup (trash)
pub mod file_utils; // Utilities for file operations like reading archives
#[cfg(desktop)]
pub mod export_utils;
pub mod hash_utils;
#[cfg(desktop)]
pub mod capture_runtime;
#[cfg(desktop)]
pub mod clip_library;
#[cfg(desktop)]
pub mod clip_overlay;
#[cfg(windows)]
pub mod hotkey_hook;
#[cfg(desktop)]
pub mod window_finder;
#[cfg(desktop)]
pub mod main_window;
#[cfg(desktop)]
pub mod window_focus;
#[cfg(desktop)]
pub mod screens;
#[cfg(desktop)]
pub mod game_detect; // Recognises a game on screen so clips are not Minecraft-only
#[cfg(desktop)]
pub mod game_watch; // Follows the foreground game and keeps the engine pointed at it
pub mod screen_time;
#[cfg(windows)]
pub mod hotkey_manager;
#[cfg(target_os = "macos")]
#[path = "hotkey_manager_macos.rs"]
pub mod hotkey_manager;
#[cfg(desktop)]
pub mod import_safety; // Strips execution/path primitives out of untrusted imported packs
#[cfg(desktop)]
pub mod java_detector; // Java detector to find Java installations
#[cfg(desktop)]
pub mod log_archive; // Archives per-session game logs centrally
#[cfg(desktop)]
pub mod bounded_log_writer;
pub mod mc_utils; // Utilities for Minecraft-related operations
#[cfg(desktop)]
pub mod migration_utils; // Migration utilities for profile and config updates
pub mod perf_utils;
#[cfg(desktop)]
pub mod path_utils; // Deklariert das neue Modul und macht seinen Inhalt (wenn `pub`) nutzbar
#[cfg(desktop)]
pub mod profile_utils; // Utility-Funktionen für Profilinhalte wie das Installieren von Modrinth-Content
#[cfg(desktop)]
pub mod repair_utils; // Repair utilities for fixing profile issues
#[cfg(desktop)]
pub mod resourcepack_utils; // ResourcePack-Utils für das Scannen und Verwalten von ResourcePacks
pub mod security_utils; // Security utilities for masking sensitive data
pub mod server_ping; // Server-Ping-Modul für die Kommunikation mit Minecraft-Servern
#[cfg(desktop)]
pub mod shaderpack_utils; // ShaderPack-Utils für das Scannen und Verwalten von ShaderPacks
pub mod system_info; // <-- Hinzufügen
#[cfg(desktop)]
pub mod updater_utils;
#[cfg(desktop)]
pub mod world_utils; // <-- Hinzugefügt
#[cfg(desktop)]
pub mod trash_utils; // <-- New trash module
#[cfg(desktop)]
pub mod backup_utils; // <-- New backup module for critical files
#[cfg(desktop)]
pub mod symlink_utils; // <-- Symlink utilities for profile folder sharing
pub mod referral_utils; // Referral tracking for affiliate/friend links
pub mod serde_utils; // Serde helpers for flexible deserialization
pub mod api_utils; // API response parsing helpers with detailed logging
pub mod http_client; // NrcRequest: fluent request builder over HTTP_CLIENT

// Füge hier ggf. andere Util-Module hinzu
// pub mod network_utils;
pub mod string_utils;
#[cfg(desktop)]
pub mod deep_link_utils;

// Mache server_ping verfügbar
