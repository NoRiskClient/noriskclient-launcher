import type { ModLoader, Mod, ModPackSource } from './profile';

export enum ModPlatform {
  Modrinth = "Modrinth",
  CurseForge = "CurseForge",
}

export enum UnifiedProjectType {
  Mod = "Mod",
  Modpack = "Modpack",
  ResourcePack = "ResourcePack",
  Shader = "Shader",
  Datapack = "Datapack",
}

export enum UnifiedSortType {
  Relevance = "Relevance",
  Downloads = "Downloads",
  Follows = "Follows",
  Newest = "Newest",
  Updated = "Updated",
  Name = "Name",
  Author = "Author",
  Featured = "Featured",
  Popularity = "Popularity",
  Category = "Category",
  GameVersion = "GameVersion",
}

export interface UnifiedModSearchResult {
  project_id: string; // ID field used in UI
  source: ModPlatform;
  title: string; // Name field used in UI
  slug: string;
  description: string;
  author: string;
  categories: string[];
  display_categories: string[];
  client_side?: string;
  server_side?: string;
  downloads: number;
  follows: number | null;
  icon_url: string | null;
  project_url: string;
  project_type: string | null; // "mod", "modpack", etc.
  latest_version?: string | null;
  date_created?: string;
  date_modified?: string;
  license?: string;
  gallery: string[];
  versions?: string[] | null;
}

export interface UnifiedPagination {
  index: number;
  page_size: number;
  result_count: number;
  total_count: number;
}

export interface UnifiedModSearchResponse {
  results: UnifiedModSearchResult[];
  pagination: UnifiedPagination;
}

export interface UnifiedModSearchParams {
  query: string;
  source: ModPlatform;
  project_type: UnifiedProjectType;
  game_version?: string;
  categories?: string[];
  mod_loaders?: string[];
  limit?: number;
  offset?: number;
  sort?: UnifiedSortType;
  client_side_filter?: string;
  server_side_filter?: string;
}

export interface UnifiedVersion {
  id: string;
  project_id: string;
  source: ModPlatform;
  name: string;
  version_number: string;
  changelog?: string;
  dependencies: UnifiedDependency[];
  game_versions: string[];
  loaders: string[];
  files: UnifiedVersionFile[];
  date_published: string;
  downloads: number;
  release_type: UnifiedVersionType;
  url: string;
  isBlocked?: boolean; // Indicates if this version is blocked due to NoRisk Client compatibility
}

export interface UnifiedVersionFile {
  filename: string;
  url: string;
  size: number;
  hashes: Record<string, string>;
  primary: boolean;
  fingerprint?: number; // CurseForge fingerprint for update checking
}

export interface UnifiedDependency {
  project_id?: string;
  version_id?: string;
  file_name?: string;
  dependency_type: UnifiedDependencyType;
}

export enum UnifiedDependencyType {
  Required = "required",
  Optional = "optional",
  Incompatible = "incompatible",
  Embedded = "embedded",
}

export enum UnifiedVersionType {
  Release = "release",
  Beta = "beta",
  Alpha = "alpha",
}

export interface UnifiedVersionResponse {
  versions: UnifiedVersion[];
  total_count: number;
}

export interface UnifiedModVersionsParams {
  source: ModPlatform;
  project_id: string;
  loaders?: string[];
  game_versions?: string[];
  limit?: number;
  offset?: number;
}

export interface UnifiedUpdateCheckRequest {
  hashes: string[];
  algorithm: string;
  loaders: string[];
  game_versions: string[];
  hash_platforms?: Record<string, ModPlatform>;
  hash_fingerprints?: Record<string, number>;
}

export interface UnifiedUpdateCheckResponse {
  updates: Record<string, UnifiedVersion>;
}

/// Response structure for modpack version requests
/// Includes the specific installed version and all available versions
export interface UnifiedModpackVersionsResponse {
  /// The specific installed version (if found)
  installed_version?: UnifiedVersion | null;
  /// All available versions for this modpack
  all_versions: UnifiedVersion[];
  /// Whether updates are available for the installed version
  updates_available?: boolean;
}

/// Request structure for switching modpack versions
export interface ModpackSwitchRequest {
  /// Download URL for the modpack file
  download_url: string;
  /// Source information for the new modpack version
  modpack_source: ModPackSource;
  /// Profile ID to update with the new modpack information
  profile_id: string;
}

/// Response structure for modpack version switching
export interface ModpackSwitchResponse {
  /// The Minecraft version extracted from the modpack
  minecraft_version: string;
  /// The mod loader type (if any)
  loader?: ModLoader;
  /// The loader version (if any)
  loader_version?: string;
  /// List of mods extracted from the modpack
  mods: Mod[];
}

// --- Unified Project Details (for Mod Detail Page) ---

export interface UnifiedGalleryImage {
  url: string;
  thumbnail_url: string;
  title: string | null;
  description: string | null;
  featured: boolean;
  ordering: number;
}

export interface UnifiedProjectLinks {
  issues: string | null;
  source: string | null;
  wiki: string | null;
  discord: string | null;
  website: string | null;
}

export interface UnifiedDonationLink {
  platform: string;
  url: string;
}

export interface UnifiedLicense {
  id: string;
  name: string;
  url: string | null;
}

export interface UnifiedTeamMember {
  username: string;
  avatar_url: string | null;
  role: string;
  profile_url: string;
}

export interface UnifiedProjectDependency {
  project_id: string;
  title: string;
  slug: string;
  icon_url: string | null;
  dependency_type: UnifiedDependencyType;
  source: ModPlatform;
}

export interface UnifiedProjectDetails {
  id: string;
  source: ModPlatform;
  title: string;
  slug: string;
  description: string;      // short description
  body: string;             // full description (Markdown/HTML)
  author: string;
  author_avatar_url: string | null;
  icon_url: string | null;
  downloads: number;
  followers: number;
  categories: string[];
  gallery: UnifiedGalleryImage[];
  links: UnifiedProjectLinks;
  project_type: string;
  project_url: string;
  date_created: string;
  date_modified: string;
  // Additional details
  license: UnifiedLicense | null;
  donation_urls: UnifiedDonationLink[];
  client_side: string | null;  // "required" | "optional" | "unsupported"
  server_side: string | null;  // "required" | "optional" | "unsupported"
  team_members: UnifiedTeamMember[];  // All team members/contributors
  // Compatibility info
  game_versions: string[];  // Supported Minecraft versions
  loaders: string[];  // Supported mod loaders (Fabric, Forge, etc.)
  // Dependencies
  dependencies: UnifiedProjectDependency[];
}