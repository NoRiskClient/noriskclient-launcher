export interface ModrinthFileHash {
    sha512: string;
    sha1: string;
}

export interface ModrinthFile {
    hashes: ModrinthFileHash;
    url: string;
    filename: string;
    primary: boolean;
    size: number;
    file_type: string | null; // e.g., \"required-resource-pack\"
}

// Keep simple for now, adjust if needed
export enum ModrinthDependencyType {
    Required = 'required',
    Optional = 'optional',
    Incompatible = 'incompatible',
    Embedded = 'embedded',
}

export interface ModrinthDependency {
    version_id: string | null;
    project_id: string | null;
    file_name: string | null;
    dependency_type: ModrinthDependencyType;
}

// Use string literals for enums for simplicity in TS
export type ModrinthVersionType = "release" | "beta" | "alpha";
// Project types enum matching backend
export type ModrinthProjectType = "mod" | "modpack" | "resourcepack" | "shader" | "datapack";
// Sort type enum matching backend
export type ModrinthSortType = "relevance" | "downloads" | "follows" | "newest" | "updated";

// New type for client/server side support
export type ModrinthSideSupport = "required" | "optional" | "unsupported" | "unknown";

export interface ModrinthVersion {
    id: string;
    project_id: string;
    author_id: string | null;
    featured: boolean;
    name: string;
    version_number: string;
    changelog: string | null;
    dependencies: ModrinthDependency[];
    game_versions: string[];
    version_type: ModrinthVersionType;
    loaders: string[];
    files: ModrinthFile[];
    date_published: string;
    downloads: number; // u64 in Rust
    search_hit?: ModrinthSearchHit;
}

export interface ModrinthSearchResponse {
    hits: ModrinthSearchHit[];
    offset: number;
    limit: number;
    total_hits: number;
}

export interface ModrinthSearchHit {
    project_id: string;
    project_type: string;
    slug: string;
    title: string;
    description: string;
    author: string | null;
    categories: string[];
    display_categories: string[];
    client_side: ModrinthSideSupport;
    server_side: ModrinthSideSupport;
    downloads: number;
    follows: number;
    icon_url: string | null;
    latest_version: string | null;
    date_created: string;
    date_modified: string;
    license: string;
    gallery: string[];
    versions?: string[] | null;
}

// Add the context type for frontend use
export interface ModrinthProjectContext {
    project_id: string;
    loader: string;
    game_version: string;
}

// Structure for results from get_all_modrinth_versions_for_contexts
export interface ModrinthAllVersionsResult {
    context: ModrinthProjectContext;
    versions: ModrinthVersion[] | null;
    error: string | null;
}

// Data structures matching backend
export interface ResourcePackModrinthInfo {
    project_id: string;
    version_id: string;
    name: string;
    version_number: string;
    download_url: string;
}

export interface ResourcePackInfo {
    filename: string;
    path: string;
    sha1_hash: string | null;
    file_size: number;
    is_disabled: boolean;
    modrinth_info: ResourcePackModrinthInfo | null;
    curseforge_info?: import('./profile').GenericCurseForgeInfo | null;
}

export interface ShaderPackModrinthInfo {
    project_id: string;
    version_id: string;
    name: string;
    version_number: string;
    download_url: string;
}

export interface ShaderPackInfo {
    filename: string;
    path: string;
    sha1_hash: string | null;
    file_size: number;
    is_disabled: boolean;
    modrinth_info: ShaderPackModrinthInfo | null;
    curseforge_info?: import('./profile').GenericCurseForgeInfo | null;
}

export interface DataPackModrinthInfo {
    project_id: string;
    version_id: string;
    name: string;
    version_number: string;
    download_url: string;
}

export interface DataPackInfo {
    filename: string;
    path: string;
    sha1_hash: string | null;
    file_size: number;
    is_disabled: boolean;
    modrinth_info: DataPackModrinthInfo | null;
    curseforge_info?: import('./profile').GenericCurseForgeInfo | null;
}

// --- Structures for Bulk Project Lookup --- 

// Corresponds to ModrinthModeratorMessage in Rust
export interface ModrinthModeratorMessage {
    message: string;
    body: string | null;
}

// Corresponds to ModrinthDonationUrl in Rust
export interface ModrinthDonationUrl {
    id: string;
    platform: string;
    url: string;
}

// Corresponds to ModrinthLicense in Rust
export interface ModrinthLicense {
    id: string; // SPDX identifier
    name: string;
    url: string | null;
}

// Corresponds to ModrinthGalleryImage in Rust
export interface ModrinthGalleryImage {
    url: string;
    featured: boolean;
    title: string | null;
    description: string | null;
    created: string; // ISO 8601
    ordering: number;
}

// Corresponds to ModrinthProject in Rust (from bulk /projects endpoint)
// Based on https://docs.modrinth.com/api/operations/getprojects/
export interface ModrinthProject {
    id: string; 
    slug: string;
    project_type: ModrinthProjectType; // Reuse existing enum
    team: string; 
    title: string;
    description: string; // Short description
    body: string; // Long description
    published: string; // ISO 8601
    updated: string; // ISO 8601
    approved: string | null; // ISO 8601
    status: string; // e.g., "approved"
    moderator_message: ModrinthModeratorMessage | null;
    license: ModrinthLicense;
    client_side: ModrinthSideSupport; // Updated type
    server_side: ModrinthSideSupport; // Updated type
    downloads: number; // u64 in Rust
    followers: number; // u64 in Rust
    categories: string[];
    versions: string[]; // List of version IDs
    icon_url: string | null;
    color: number | null; // u32 in Rust
    issues_url: string | null;
    source_url: string | null;
    wiki_url: string | null;
    discord_url: string | null;
    donation_urls: ModrinthDonationUrl[] | null;
    gallery: ModrinthGalleryImage[];
    game_versions?: string[] | null; // Added based on Rust struct
    loaders?: string[] | null; // Added based on Rust struct
}

// Allowed hash algorithms for Modrinth API requests
export type ModrinthHashAlgorithm = "sha1" | "sha512";

// Request body for checking mod updates via the bulk API
export interface ModrinthBulkUpdateRequestBody {
    hashes: string[];      // SHA1 or SHA512 hashes of the currently installed mod files
    algorithm: ModrinthHashAlgorithm; // Use the specific type
    loaders: string[];     // List of mod loaders to filter by (e.g., ["fabric", "quilt"])
    game_versions: string[]; // List of game versions to filter by (e.g., ["1.20.1"])
}

// --- Modrinth Tag Types ---

export interface ModrinthCategory {
    icon: string;        // SVG icon content
    name: string;        // Name of the category (e.g., "adventure")
    project_type: string; // Project type this category applies to (e.g., "mod")
    header: string;      // Header for grouping (e.g., "gameplay")
}

export interface ModrinthLoader {
    icon: string;                // SVG icon content
    name: string;                // Name of the loader (e.g., "fabric")
    supported_project_types: string[]; // Project types this loader is applicable to
}

export type ModrinthGameVersionType = "release" | "snapshot" | "alpha" | "beta";

export interface ModrinthGameVersion {
    version: string;                   // The name/number of the game version (e.g., "1.18.1")
    version_type: ModrinthGameVersionType; // Type of the game version
    date: string;                      // The date of the game version release (ISO-8601)
    major: boolean;                    // Whether or not this is a major version
}

// --- Team Members ---
export interface ModrinthTeamMember {
    team_id: string;
    user: ModrinthUser;
    role: string;
    ordering: number;
}

export interface ModrinthUser {
    id: string;
    username: string;
    avatar_url: string | null;
    bio: string | null;
    role: string | null; // User's site-wide role
}