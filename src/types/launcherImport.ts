import type {
  ExecutableContentReport,
  ImportSecurityReport,
  NoriskPackOffer,
  ProvenanceReport,
} from "./importPreview";
import type { ImageSource } from "./profile";

export type ExternalLauncherId =
  | "prism_launcher"
  | "multimc"
  | "atlauncher"
  | "gdlauncher"
  | "curseforge"
  | "vanilla_launcher"
  | "modrinth_app";

export type UnsupportedReason =
  | "no_game_version"
  | "unknown_loader"
  | "unreadable"
  | "no_game_directory";

export type ContentBucketKey =
  | "mods"
  | "config"
  | "options"
  | "saves"
  | "resourcepacks"
  | "shaderpacks"
  | "screenshots";

export interface DetectedLauncher {
  launcher: ExternalLauncherId;
  displayName: string;
  root: string;
  instancesDir: string;
  instanceCount: number;
  autoDetected: boolean;
}

export interface ExternalInstanceRef {
  launcher: ExternalLauncherId;
  root: string;
  instanceDir: string;
  folderName: string;
  name: string;
  gameVersion: string | null;
  loader: string;
  loaderVersion: string | null;
  lastPlayed: string | null;
  modCount: number | null;
  iconPath: string | null;
  unsupported: UnsupportedReason | null;
}

export interface ContentBucket {
  key: ContentBucketKey;
  entryCount: number;
  bytes: number;
  defaultSelected: boolean;
}

export interface ImportSelection {
  mods: boolean;
  config: boolean;
  options: boolean;
  saves: boolean;
  resourcepacks: boolean;
  shaderpacks: boolean;
  screenshots: boolean;
  allowExecutableContent: boolean;
}

export interface ExternalInstancePreview {
  launcher: ExternalLauncherId;
  launcherDisplayName: string;
  root: string;
  instanceDir: string;
  suggestedName: string;
  suggestedGroup: string | null;
  gameVersion: string | null;
  loader: string;
  loaderVersion: string | null;
  modCount: number;
  disabledModCount: number;
  buckets: ContentBucket[];
  totalBytes: number;
  selectedBytes: number;
  icon: ImageSource | null;
  security: ImportSecurityReport;
  provenance: ProvenanceReport;
  executableContent: ExecutableContentReport;
  managedPack: string | null;
  noriskPack: NoriskPackOffer;
  warnings: string[];
  alreadyImportedAt: string | null;
}

export const DEFAULT_IMPORT_SELECTION: ImportSelection = {
  mods: true,
  config: true,
  options: true,
  saves: true,
  resourcepacks: true,
  shaderpacks: true,
  screenshots: false,
  allowExecutableContent: false,
};

export function selectionFromBuckets(buckets: ContentBucket[]): ImportSelection {
  return buckets.reduce<ImportSelection>(
    (selection, bucket) => ({
      ...selection,
      [bucket.key]: bucket.defaultSelected && bucket.entryCount > 0,
    }),
    { ...DEFAULT_IMPORT_SELECTION },
  );
}

export function launcherKey(launcher: DetectedLauncher): string {
  return `${launcher.launcher}::${launcher.root}`;
}

export function isSelectable(
  instance: ExternalInstanceRef,
  imported: Record<string, string>,
): boolean {
  return !instance.unsupported && !imported[instance.instanceDir];
}
