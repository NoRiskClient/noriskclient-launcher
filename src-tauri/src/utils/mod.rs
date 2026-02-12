pub mod datapack_utils; // DataPack-Utils für das Scannen und Verwalten von DataPacks
pub mod debug_utils;
pub mod disk_space_utils; // Disk space utility for checking available space before downloads
pub mod download_utils; // Central download utility for robust file downloads
pub mod file_utils; // Utilities for file operations like reading archives
pub mod hash_utils;
pub mod java_detector; // Java detector to find Java installations
pub mod mc_utils; // Utilities for Minecraft-related operations
pub mod migration_utils; // Migration utilities for profile and config updates
pub mod path_utils; // Deklariert das neue Modul und macht seinen Inhalt (wenn `pub`) nutzbar
pub mod profile_utils; // Utility-Funktionen für Profilinhalte wie das Installieren von Modrinth-Content
pub mod repair_utils; // Repair utilities for fixing profile issues
pub mod resourcepack_utils; // ResourcePack-Utils für das Scannen und Verwalten von ResourcePacks
pub mod security_utils; // Security utilities for masking sensitive data
pub mod server_ping; // Server-Ping-Modul für die Kommunikation mit Minecraft-Servern
pub mod shaderpack_utils; // ShaderPack-Utils für das Scannen und Verwalten von ShaderPacks
pub mod system_info; // <-- Hinzufügen
pub mod updater_utils;
pub mod world_utils; // <-- Hinzugefügt
pub mod trash_utils; // <-- New trash module
pub mod backup_utils; // <-- New backup module for critical files
pub mod symlink_utils; // <-- Symlink utilities for profile folder sharing
pub mod referral_utils; // Referral tracking for affiliate/friend links
pub mod serde_utils; // Serde helpers for flexible deserialization
pub mod api_utils; // API response parsing helpers with detailed logging

// Füge hier ggf. andere Util-Module hinzu
// pub mod network_utils;
pub mod string_utils;

// Mache server_ping verfügbar
