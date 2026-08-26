import type { Mod } from "./profile";

export type AdoptStrategy =
  | "backup_local"
  | "prefer_newer"
  | "prefer_master"
  | "prefer_instance";

export type MergeFormat = "minecraft_options" | "plain_key_value";

export type DetachMode = "keep_copy" | "drop" | "leave_link";

export type SyncTargetKindType = "dir_link" | "file_merge" | "file_copy" | "mods";

export interface SyncTargetKindDirLink {
  type: "dir_link";
  adopt: AdoptStrategy;
}

export interface SyncTargetKindFileMerge {
  type: "file_merge";
  format: MergeFormat;
  local_keys: string[];
}

export interface SyncTargetKindFileCopy {
  type: "file_copy";
}

export interface SyncTargetKindMods {
  type: "mods";
}

export type SyncTargetKind =
  | SyncTargetKindDirLink
  | SyncTargetKindFileMerge
  | SyncTargetKindFileCopy
  | SyncTargetKindMods;

export interface SyncTarget {
  id: string;
  path: string;
  enabled: boolean;
  kind: SyncTargetKind;
  external_path: string | null;
}

export interface DroppedSyncResult {
  target: SyncTarget | null;
  identified_mods: string[];
  local_jars: string[];
}

export interface SeedCandidate {
  profile_id: string;
  profile_name: string;
  path: string;
  exists: boolean;
  entries: number;
  last_played: string | null;
}

export type PreviewAction =
  | "link"
  | "relink"
  | "adopt"
  | "source"
  | "merge"
  | "copy"
  | "replace";

export interface SyncPreviewEntry {
  pack_id: string;
  pack_name: string;
  target_path: string;
  kind: string;
  action: PreviewAction;
  moves: number;
  collisions: number;
  backup_hint: string | null;
}

export function needsAdoptConfirm(entry: SyncPreviewEntry): boolean {
  return entry.action === "adopt" && entry.moves + entry.collisions > 0;
}

export function needsDetachConfirm(entry: SyncPreviewEntry): boolean {
  return entry.action === "relink";
}

export type VersionOverride =
  | { type: "pin"; version_id: string }
  | { type: "disabled" };

export interface SyncPackModEntry extends Mod {
  version_overrides: Record<string, VersionOverride>;
}

export type MatrixStatus =
  | "auto_resolved"
  | "override_pinned"
  | "disabled"
  | "unresolved";

export interface SyncPackModMatrixRow {
  mc_version: string;
  loader: string;
  status: MatrixStatus;
  resolved_version_id: string | null;
  resolved_version_name: string | null;
  resolved_filename: string | null;
}

export interface SyncPackModMatrix {
  mod_id: string;
  display_name: string;
  project_key: string | null;
  resolvable: boolean;
  rows: SyncPackModMatrixRow[];
}

export interface SyncPack {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  created: string;
  updated: string;
  enabled: boolean;
  sort_order: number;
  targets: SyncTarget[];
  mods: SyncPackModEntry[];
}

export interface SyncPackSubscriber {
  profile_id: string;
  profile_name: string;
  instance_path: string;
}

export interface SyncConflict {
  path: string;
  winner_pack_id: string;
  winner_pack_name: string;
  winner_kind: string;
  loser_pack_id: string;
  loser_pack_name: string;
  loser_kind: string;
}

export interface SyncTargetResult {
  target_path: string;
  kind: string;
  changed: boolean;
  messages: string[];
  warnings: string[];
  error: string | null;
}

export interface SyncPackResult {
  pack_id: string;
  pack_name: string;
  skipped: boolean;
  targets: SyncTargetResult[];
}

export interface SyncReport {
  profile_id: string | null;
  packs: SyncPackResult[];
  conflicts: SyncConflict[];
  warnings: string[];
}

export interface CreateSyncPackParams {
  name: string;
  description?: string | null;
  icon?: string | null;
}

export interface UpdateSyncPackParams {
  pack_id: string;
  name?: string;
  description?: string;
  icon?: string;
  enabled?: boolean;
  sort_order?: number;
  clear_description?: boolean;
  clear_icon?: boolean;
}

export function changedTargetCount(report: SyncReport | null | undefined): number {
  if (!report) return 0;
  return report.packs.reduce(
    (total, pack) => total + pack.targets.filter((target) => target.changed).length,
    0,
  );
}

export function collectReportWarnings(
  report: SyncReport | null | undefined,
): string[] {
  if (!report) return [];
  const out = [...report.warnings];
  for (const pack of report.packs) {
    for (const target of pack.targets) {
      out.push(...target.warnings);
      if (target.error) out.push(`${target.target_path}: ${target.error}`);
    }
  }
  return out;
}

export const DEFAULT_LOCAL_MERGE_KEYS: string[] = [
  "resourcePacks",
  "incompatibleResourcePacks",
];

export function defaultKindFor(type: SyncTargetKindType): SyncTargetKind {
  switch (type) {
    case "dir_link":
      return { type: "dir_link", adopt: "backup_local" };
    case "file_merge":
      return {
        type: "file_merge",
        format: "minecraft_options",
        local_keys: [...DEFAULT_LOCAL_MERGE_KEYS],
      };
    case "file_copy":
      return { type: "file_copy" };
    case "mods":
      return { type: "mods" };
  }
}

export interface SyncTargetPreset {
  path: string;
  kindType: SyncTargetKindType;
  icon: string;
  warn?: boolean;
}

export const SYNC_TARGET_PRESETS: SyncTargetPreset[] = [
  { path: "saves", kindType: "dir_link", icon: "solar:planet-bold", warn: true },
  { path: "config", kindType: "dir_link", icon: "solar:settings-bold" },
  { path: "screenshots", kindType: "dir_link", icon: "solar:camera-bold" },
  { path: "shaderpacks", kindType: "dir_link", icon: "solar:sun-bold" },
  { path: "resourcepacks", kindType: "dir_link", icon: "solar:gallery-bold" },
  { path: "replay_recordings", kindType: "dir_link", icon: "solar:videocamera-bold" },
  { path: "options.txt", kindType: "file_merge", icon: "solar:tuning-bold" },
  { path: "optionsof.txt", kindType: "file_copy", icon: "solar:document-bold" },
  { path: "servers.dat", kindType: "file_copy", icon: "solar:server-bold" },
  { path: "command_history.txt", kindType: "file_copy", icon: "solar:command-bold" },
  { path: "mods", kindType: "mods", icon: "solar:box-bold" },
];
