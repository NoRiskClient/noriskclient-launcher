import { NoriskModIdentifier, type LocalContentItem as ProfileLocalContentItem } from "./profile";
import type { ModrinthVersion } from "./modrinth";

/**
 * Payload for uninstalling content from a profile.
 * Mirrors the Rust struct `UninstallContentPayload`.
 */
export interface UninstallContentPayload {
  profile_id: string; // UUID
  sha1_hash?: string; // Optional SHA1 hash of the content to remove
  file_path?: string; // Optional: Direct path to the file to delete
  content_type?: ContentType; // Optional: Specify the type of content being uninstalled
  // Future potential fields:
  // mod_id_to_remove?: string; // UUID of a specific mod entry
  // filename_to_remove?: string; // Specific filename for custom mods/assets
  // content_type_to_scan?: 'shader' | 'resourcepack' | 'datapack'; // To target specific asset types if filename is generic
}

/**
 * Payload for toggling the enabled state of content in a profile.
 * Mirrors the Rust struct `ToggleContentPayload`.
 */
export interface ToggleContentPayload {
  profile_id: string; // UUID
  sha1_hash?: string;  // Made optional - SHA1 hash of the content to toggle
  file_path?: string; // Optional: Direct path to the file to toggle
  enabled: boolean;   // The desired new enabled state
  norisk_mod_identifier?: NoriskModIdentifier; // Optional identifier for NoRisk Pack items
  content_type?: ContentType; // Optional: For targeted asset toggling
  // Future: content_identifier (e.g., could be sha1, mod_id, filename)
  // Future: content_type?: 'mod' | 'resourcepack' | 'shaderpack' | 'datapack';
}

// hacky fix - fix later

/**
 * Enum for content types, mirroring Rust's `profile_utils::ContentType`.
 * Used in InstallContentPayload.
 */
export enum ContentType {
  Mod = "Mod",
  ResourcePack = "ResourcePack",
  ShaderPack = "ShaderPack",
  DataPack = "DataPack",
  NoRiskMod = "NoRiskMod",
}

/**
 * Payload for installing content into a profile.
 * Mirrors the Rust struct `InstallContentPayload` in `content_command.rs`.
 */
export interface InstallContentPayload {
  profile_id: string; // UUID
  project_id: string;
  version_id: string;
  file_name: string;
  download_url: string;
  file_hash_sha1?: string;
  content_name?: string;
  version_number?: string;
  content_type: ContentType; // Using the ContentType enum
  loaders?: string[];
  game_versions?: string[];
}

/**
 * Payload for installing local content (e.g., JARs, resource packs) into a profile.
 * Mirrors the Rust struct `InstallLocalContentPayload` in `content_command.rs`.
 */
export interface InstallLocalContentPayload {
  profile_id: string;      // UUID
  file_paths: string[];    // Array of absolute string paths to the local files
  content_type: ContentType; // The type of content being installed
}

/**
 * Payload for switching the version of an installed content item.
 * Mirrors the Rust struct `SwitchContentVersionPayload` in `content_command.rs`.
 */
export interface SwitchContentVersionPayload {
  profile_id: string; // Uuid
  content_type: ContentType; // Backend ContentType enum
  current_item_details?: ProfileLocalContentItem | null; // Pass the whole item from frontend
  new_modrinth_version_details?: ModrinthVersion | null;
}

// Represents a NoriskMod item as expected by the backend for add/remove operations 