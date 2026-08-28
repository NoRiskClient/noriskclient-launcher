import { invoke } from "@tauri-apps/api/core";
import type { Mod } from "../types/profile";
import type { InstallContentPayload } from "../types/content";
import type {
  CreateSyncPackParams,
  DroppedSyncResult,
  DetachMode,
  SeedCandidate,
  SyncPreviewEntry,
  SyncConflict,
  SyncPack,
  SyncPackModMatrix,
  SyncPackModMatrixRow,
  SyncPackSubscriber,
  SyncReport,
  SyncTarget,
  SyncTargetKind,
  UpdateSyncPackParams,
  VersionOverride,
} from "../types/syncPacks";

export async function getSyncPacks(): Promise<SyncPack[]> {
  return invoke<SyncPack[]>("get_sync_packs");
}

export async function getSyncPack(packId: string): Promise<SyncPack | null> {
  return invoke<SyncPack | null>("get_sync_pack", { packId });
}

export async function createSyncPack(
  params: CreateSyncPackParams,
): Promise<SyncPack> {
  return invoke<SyncPack>("create_sync_pack", { params });
}

export async function updateSyncPack(
  params: UpdateSyncPackParams,
): Promise<SyncPack> {
  return invoke<SyncPack>("update_sync_pack", { params });
}

export async function importSyncPackIcon(
  packId: string,
  path: string,
): Promise<string> {
  return invoke<string>("import_sync_pack_icon", {
    params: { packId, path },
  });
}

export async function deleteSyncPack(
  packId: string,
  detachMode: DetachMode,
): Promise<void> {
  return invoke<void>("delete_sync_pack", {
    params: { pack_id: packId, detach_mode: detachMode },
  });
}

export async function addSyncPackTarget(
  packId: string,
  path: string,
  kind: SyncTargetKind,
  options?: { externalPath?: string | null; seedFrom?: string | null },
): Promise<SyncTarget> {
  return invoke<SyncTarget>("add_sync_pack_target", {
    params: {
      pack_id: packId,
      path,
      kind,
      external_path: options?.externalPath ?? null,
      seed_from: options?.seedFrom ?? null,
    },
  });
}

export async function listSyncSeedCandidates(
  relativePath: string,
): Promise<SeedCandidate[]> {
  return invoke<SeedCandidate[]>("list_sync_seed_candidates", { relativePath });
}

export async function removeSyncPackTarget(
  packId: string,
  targetId: string,
): Promise<void> {
  return invoke<void>("remove_sync_pack_target", { packId, targetId });
}

export async function addContentToSyncPack(
  packId: string,
  payload: InstallContentPayload,
  pinVersion = false,
): Promise<void> {
  return invoke<void>("add_content_to_sync_pack", {
    params: { pack_id: packId, payload, pin_version: pinVersion },
  });
}

export async function removeContentFromSyncPack(
  packId: string,
  projectId: string,
): Promise<void> {
  return invoke<void>("remove_content_from_sync_pack", { packId, projectId });
}

export async function removeModFromSyncPack(
  packId: string,
  modId: string,
): Promise<void> {
  return invoke<void>("remove_mod_from_sync_pack", { packId, modId });
}

export async function getSyncPackLocalJars(packId: string): Promise<string[]> {
  return invoke<string[]>("get_sync_pack_local_jars", { packId });
}

export async function removeSyncPackLocalJar(
  packId: string,
  fileName: string,
): Promise<void> {
  return invoke<void>("remove_sync_pack_local_jar", { packId, fileName });
}

export async function setProfileSyncPacks(
  profileId: string,
  packIds: string[],
  detachMode: DetachMode,
): Promise<SyncReport> {
  return invoke<SyncReport>("set_profile_sync_packs", {
    params: {
      profile_id: profileId,
      pack_ids: packIds,
      detach_mode: detachMode,
    },
  });
}

export async function getSyncPackSubscribers(
  packId: string,
): Promise<SyncPackSubscriber[]> {
  return invoke<SyncPackSubscriber[]>("get_sync_pack_subscribers", { packId });
}

export async function getProfileSyncConflicts(
  profileId: string,
): Promise<SyncConflict[]> {
  return invoke<SyncConflict[]>("get_profile_sync_conflicts", { profileId });
}

export async function openSyncPackFolder(
  packId: string,
  targetPath?: string,
): Promise<string> {
  return invoke<string>("open_sync_pack_folder", {
    packId,
    targetPath: targetPath ?? null,
  });
}

export async function previewProfileSync(
  profileId: string,
  packIds: string[],
): Promise<SyncPreviewEntry[]> {
  return invoke<SyncPreviewEntry[]>("preview_profile_sync", {
    profileId,
    packIds,
  });
}

export async function syncProfileNow(profileId: string): Promise<SyncReport> {
  return invoke<SyncReport>("sync_profile_now", { profileId });
}

export async function setSyncPackModEnabled(
  packId: string,
  modId: string,
  enabled: boolean,
): Promise<void> {
  return invoke<void>("set_sync_pack_mod_enabled", { packId, modId, enabled });
}

export async function setSyncPackModVersionOverride(
  packId: string,
  modId: string,
  mcVersion: string,
  value: VersionOverride | null,
): Promise<void> {
  return invoke<void>("set_sync_pack_mod_version_override", {
    params: {
      pack_id: packId,
      mod_id: modId,
      mc_version: mcVersion,
      override: value,
    },
  });
}

export async function getSyncPackModMatrix(
  packId: string,
): Promise<SyncPackModMatrix[]> {
  return invoke<SyncPackModMatrix[]>("get_sync_pack_mod_matrix", { packId });
}

export async function resolveSyncPackMod(
  packId: string,
  modId: string,
  mcVersion?: string,
  loader?: string,
): Promise<SyncPackModMatrixRow[]> {
  return invoke<SyncPackModMatrixRow[]>("resolve_sync_pack_mod", {
    packId,
    modId,
    mcVersion: mcVersion ?? null,
    loader: loader ?? null,
  });
}

export async function getOrCreateDefaultSyncPack(): Promise<SyncPack> {
  return invoke<SyncPack>("get_or_create_default_sync_pack");
}

export async function addDroppedSyncTarget(
  packId: string,
  sourcePath: string,
): Promise<DroppedSyncResult> {
  return invoke<DroppedSyncResult>("add_dropped_sync_target", {
    packId,
    sourcePath,
  });
}

export type SyncPackEntryKind = "target" | "mod" | "jar";

export interface SyncPackEntryRef {
  packId: string;
  kind: SyncPackEntryKind;
  id: string;
}

export interface SyncPackBatchResult {
  removed: number;
  failed: number;
}

export async function removeSyncPackEntries(
  entries: SyncPackEntryRef[],
): Promise<SyncPackBatchResult> {
  return invoke<SyncPackBatchResult>("remove_sync_pack_entries", { entries });
}

export async function setSyncPackModsEnabled(
  entries: SyncPackEntryRef[],
  enabled: boolean,
): Promise<number> {
  return invoke<number>("set_sync_pack_mods_enabled", { entries, enabled });
}
