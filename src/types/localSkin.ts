// This file is auto-generated from the Rust sources. Do not edit manually.
// Corresponding Rust file: src-tauri/src/state/skin_state.rs

/**
 * Represents the possible variants for a Minecraft skin.
 */
export type SkinVariant = 'slim' | 'classic';

/**
 * Represents a Minecraft skin stored locally.
 * Corresponds to the Rust struct `MinecraftSkin`.
 */
export interface MinecraftSkin {
  id: string;
  name: string;
  base64_data: string;
  variant: SkinVariant; // Changed from string
  description?: string | null;
  added_at: string; // DateTime<Utc> as ISO string
}

/**
 * Container for all stored Minecraft skins.
 * Corresponds to the Rust struct `SkinDatabase`.
 */
export interface SkinDatabase {
  skins?: MinecraftSkin[] | null;
}

// --- Payload Types for add_skin_locally command ---

export interface ProfileSourceData {
  query: string; // Username or UUID
}

export interface UrlSourceData {
  url: string;
}

export interface FilePathSourceData {
  path: string;
}

export interface Base64SourceData {
  base64_content: string;
}

export type SkinSourceDetails =
  | { type: "Profile"; details: ProfileSourceData }
  | { type: "Url"; details: UrlSourceData }
  | { type: "FilePath"; details: FilePathSourceData }
  | { type: "Base64"; details: Base64SourceData };
  
export interface AddLocalSkinCommandPayload {
  source: SkinSourceDetails;
  target_skin_name: string;
  target_skin_variant: SkinVariant; // Uses existing SkinVariant type
  description?: string | null;
}

// --- End Payload Types ---

// --- Payload Type for get_starlight_skin_render command ---
export interface GetStarlightSkinRenderPayload {
  player_name: string;
  render_type: string;
  render_view: string;
  base64_skin_data?: string | null;
}
// --- End Payload Type ---

// --- Payload Type for get_crafatar_avatar command ---
export interface GetCrafatarAvatarPayload {
  uuid: string;
  size?: number | null;
  overlay?: boolean;
}
// --- End Payload Type --- 