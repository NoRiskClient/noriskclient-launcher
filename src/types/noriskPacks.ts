// src/lib/types/noriskPacks.ts

// Types matching backend Rust structures for Norisk Packs

// Corresponds to Rust struct CompatibilityTarget
export interface CompatibilityTarget {
    identifier: string;
    filename: string | null;
}

// Corresponds to Rust enum NoriskModSourceDefinition
export type NoriskModSourceDefinition =
    | { type: 'modrinth'; project_id: string; project_slug: string } // Renamed fields to snake_case
    | { type: 'maven'; repository_ref: string; group_id: string; artifact_id: string } // Renamed fields to snake_case
    | { type: 'url' };

// Corresponds to Rust struct NoriskModEntryDefinition (previously NoriskPackMod)
export interface NoriskModEntryDefinition { // Renamed from NoriskPackMod
    id: string;
    displayName?: string | null; // Made optional
    source: NoriskModSourceDefinition; // Updated type
    // compatibility field structure: Record<GameVersion, Record<Loader, CompatibilityTarget>>
    compatibility?: Record<string,
        Record<string, CompatibilityTarget> // Updated inner type
    >;
}

export interface PackListing {
    category?: string;
    weight?: number;
    hidden?: boolean;
}

// Corresponds to Rust struct NoriskPackDefinition
export interface NoriskPackDefinition {
    displayName: string; // Correct
    description: string; // Correct
    inheritsFrom?: string[] | null; // Added field
    excludeMods?: string[] | null; // Added field
    mods?: NoriskModEntryDefinition[]; // Updated type used
    assets?: string[]; // Added field
    isExperimental?: boolean; // Added field
    listing?: PackListing;
}

// Corresponds to Rust struct NoriskModpacksConfig
export interface NoriskModpacksConfig {
    packs: Record<string, NoriskPackDefinition>; // Maps pack ID (string) to definition
    repositories: Record<string, string>; // Maps repository reference (string) to URL (string)
} 