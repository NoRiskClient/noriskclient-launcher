import { invoke } from "@tauri-apps/api/core";
import type {
  CheckContentParams,
  ContentInstallStatus,
  CopyProfileParams,
  CreateProfileParams,
  ExportProfileParams,
  Profile,
  ProfilePatch,
  AllProfilesAndLastPlayed,
  BatchCheckContentParams,
  BatchContentInstallStatus,
  LoadItemsParams,
  LocalContentItem,
  MigrationInfo,
  ImageSource,
  UploadProfileIconPayload,
} from "../types/profile";
import type { ImportPackPreview } from "../types/importPreview";
import { FileNode } from "../types/fileSystem";

export async function searchProfiles(query: string): Promise<Profile[]> {
  return invoke<Profile[]>("search_profiles", { query });
}

export interface ProfileBackupInfo {
  path: string;
  backup_time: number;
  file_size: number;
  profile_count: number;
}

export async function listProfileBackups(): Promise<ProfileBackupInfo[]> {
  return invoke<ProfileBackupInfo[]>("list_profile_backups");
}

export async function restoreProfileBackup(backupPath: string): Promise<void> {
  return invoke<void>("restore_profile_backup", { backupPath });
}

export async function listRemovedStandardProfiles(): Promise<Profile[]> {
  return invoke<Profile[]>("list_removed_standard_profiles");
}

export async function restoreStandardProfile(id: string): Promise<void> {
  return invoke<void>("restore_standard_profile", { id });
}

export async function getProfile(id: string): Promise<Profile> {
  return invoke<Profile>("get_profile", { id });
}

export async function createProfile(
  params: CreateProfileParams,
): Promise<string> {
  return invoke<string>("create_profile", { params });
}

export async function patchProfile(id: string, patch: ProfilePatch): Promise<Profile> {
  return invoke<Profile>("patch_profile", { id, patch });
}

export async function deleteProfile(id: string): Promise<void> {
  return invoke<void>("delete_profile", { id });
}

export async function repairProfile(id: string): Promise<void> {
  return invoke<void>("repair_profile", { id });
}

export async function copyProfile(params: CopyProfileParams): Promise<string> {
  return invoke<string>("copy_profile", { params });
}

export async function exportProfile(
  params: ExportProfileParams,
): Promise<string> {
  return invoke<string>("export_profile", { params });
}

export async function getSystemRamMb(): Promise<number> {
  return invoke<number>("get_system_ram_mb");
}

export async function getDefaultMemoryMaxMb(): Promise<number> {
  return invoke<number>("get_default_memory_max_mb");
}

export async function getDefaultJvmArgs(profile: Profile, heapMb: number): Promise<string> {
  return invoke<string>("get_default_jvm_args", { profile, heapMb });
}

export async function openProfileFolder(profileId: string): Promise<void> {
  return invoke<void>("open_profile_folder", { profileId });
}

export async function getProfileDirectoryStructure(
  profileId: string,
): Promise<FileNode> {
  return invoke<FileNode>("get_profile_directory_structure", { profileId });
}

export async function getProfileDirectoryLevel(
  profileId: string,
  subPath?: string,
): Promise<FileNode> {
  return invoke<FileNode>("get_profile_directory_level", { profileId, subPath });
}

export async function isContentInstalled(
  params: CheckContentParams,
): Promise<ContentInstallStatus> {
  return invoke<ContentInstallStatus>("is_content_installed", { params });
}

export async function batchCheckContentInstalled(
  params: BatchCheckContentParams,
): Promise<BatchContentInstallStatus> {
  return invoke<BatchContentInstallStatus>("batch_check_content_installed", { params });
}

export async function getNoriskPacksResolved(): Promise<any> {
  return invoke<any>("get_norisk_packs_resolved");
}

export async function refreshNoriskPacks(): Promise<void> {
  return invoke<void>("refresh_norisk_packs");
}

export async function refreshStandardVersions(): Promise<void> {
  return invoke<void>("refresh_standard_versions");
}

export async function getAllProfilesAndLastPlayed(): Promise<AllProfilesAndLastPlayed> {
  return invoke<AllProfilesAndLastPlayed>("get_all_profiles_and_last_played");
}

export async function getLocalContent(
  params: LoadItemsParams,
): Promise<LocalContentItem[]> {
  return invoke<LocalContentItem[]>("get_local_content", { params });
}

/// Checks if a group migration is needed for a profile
export async function checkForGroupMigration(profileId: string): Promise<MigrationInfo> {
  return invoke<MigrationInfo>("check_for_group_migration_command", { profileId });
}

export async function importProfileByPath(
  filePathStr: string,
  eventId?: string,
  nameOverride?: string,
  groupOverride?: string,
  noriskPackId?: string,
  clearNoriskPack?: boolean,
): Promise<string> {
  return invoke<string>("import_profile", {
    filePathStr,
    eventId,
    nameOverride,
    groupOverride,
    noriskPackId,
    clearNoriskPack,
  });
}

export async function previewImportPack(filePathStr: string): Promise<ImportPackPreview> {
  return invoke<ImportPackPreview>("preview_import_pack", { filePathStr });
}

export async function resolveImagePath(
  imageSource: ImageSource,
  profileId?: string,
): Promise<string> {
  return invoke<string>("resolve_image_path", { imageSource, profileId });
}

export async function uploadProfileImages(
  payload: UploadProfileIconPayload,
): Promise<string> {
  return invoke<string>("upload_profile_images", { payload });
}

export interface ToggleModUpdatesPayload {
  profile_id: string;
  mod_id: string;
  updates_enabled: boolean;
}

export async function toggleModUpdates(
  payload: ToggleModUpdatesPayload,
): Promise<void> {
  return invoke<void>("toggle_mod_updates", { payload });
}

// Symlink commands
export async function getProfileInstancePath(profileId: string): Promise<string> {
  return invoke<string>("get_profile_instance_path", { profileId });
}
export async function getDefaultProfilePath(): Promise<string> {
  return invoke<string>("get_default_profile_path");
}

export interface AddSymlinkParams {
  profile_id: string;
  relative_path: string;
  external_path: string;
}

export async function addProfileSymlink(params: AddSymlinkParams): Promise<void> {
  return invoke<void>("add_profile_symlink", { params });
}

export async function removeProfileSymlink(
  profileId: string,
  relativePath: string,
): Promise<void> {
  return invoke<void>("remove_profile_symlink", { 
    profileId, 
    relativePath 
  });
}

export async function getProfileSymlinks(profileId: string): Promise<import("../types/profile").SymlinkInfo[]> {
  return invoke<import("../types/profile").SymlinkInfo[]>("get_profile_symlinks", { profileId });
}