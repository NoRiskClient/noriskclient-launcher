export interface MinecraftAccount {
  id: string;
  username: string;
  minecraft_username: string;
  active: boolean;
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  /** If true, the UI should not show the child-protection multiplayer warning for this account */
  ignore_child_protection_warning?: boolean;
}

/**
 * Represents a Minecraft player profile as returned by Mojang's session server
 */
export interface MinecraftProfile {
    /** Player UUID (without hyphens) */
    id: string;
    /** Player username */
    name: string;
    /** Properties of the profile, including skin and cape data */
    properties: ProfileProperty[];
}

/**
 * A property of a Minecraft profile, typically containing textures
 */
export interface ProfileProperty {
    /** The name of the property (typically "textures") */
    name: string;
    /** Base64-encoded value of the property */
    value: string;
    /** Optional signature */
    signature?: string;
}

/**
 * Decoded textures data for a Minecraft profile (after base64 decoding)
 */
export interface TexturesData {
    /** Unix timestamp in milliseconds */
    timestamp: number;
    /** Profile's UUID */
    profileId: string;
    /** Profile's name */
    profileName: string;
    /** Textures dictionary containing skin and cape information */
    textures: TexturesDictionary;
}

/**
 * Dictionary of textures for a Minecraft profile
 */
export interface TexturesDictionary {
    /** Skin information */
    SKIN?: TextureInfo;
    /** Cape information */
    CAPE?: TextureInfo;
}

/**
 * Information about a texture (skin or cape)
 */
export interface TextureInfo {
    /** URL to the texture image */
    url: string;
    /** Optional metadata for the texture (used for slim skin model) */
    metadata?: TextureMetadata;
}

/**
 * Metadata for a texture
 */
export interface TextureMetadata {
    /** Skin model type ("slim" or "default") */
    model?: string;
} 

export interface MinecraftVersion {
    id: string;
    type: string;
    url: string;
    time: string;
    releaseTime: string;
}

export interface LatestVersions {
    release: string;
    snapshot: string;
}

export interface VersionManifest {
    latest: LatestVersions;
    versions: MinecraftVersion[];
}

export interface WorldInfo {
  folder_name: string;
  display_name: string | null;
  last_played: number | null; // Assuming Rust i64 maps to number (epoch milliseconds)
  icon_path: string | null; // Changed type from object to string | null
  game_mode?: number | null; // Added GameType (0: Survival, 1: Creative, 2: Adventure, 3: Spectator)
  difficulty?: number | null; // Rust i8 -> number (0: Peaceful, 1: Easy, 2: Normal, 3: Hard)
  difficulty_locked?: boolean | null; // Rust bool -> boolean
  is_hardcore?: boolean | null; // Rust bool -> boolean
  version_name?: string | null; // Rust Option<String> -> string | null
}

export interface ServerInfo {
    name: string | null;
    address: string | null; // Matches Rust struct
    icon_base64: string | null; // Base64 string for the icon
    accepts_textures: number | null; // 0=prompt, 1=enabled, 2=disabled (Rust u8)
    previews_chat: number | null; // Seems to be boolean 0/1 (Rust u8)
}

export interface ServerPingInfo {
    description: string | null;
    description_json: object | null; // Representing serde_json::Value
    version_name: string | null;
    version_protocol: number | null;
    players_online: number | null;
    players_max: number | null;
    favicon_base64: string | null;
    latency_ms: number | null;
    error: string | null; // Optional error message
}