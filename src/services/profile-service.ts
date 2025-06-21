import { invoke } from "@tauri-apps/api/core";
import type {
  CheckContentParams,
  ContentInstallStatus,
  CopyProfileParams,
  CreateProfileParams,
  CustomModInfo,
  ExportProfileParams,
  Profile,
  UpdateProfileParams,
  AllProfilesAndLastPlayed,
  BatchCheckContentParams,
  BatchContentInstallStatus,
  LoadItemsParams,
  LocalContentItem,
  ImageSource,
  UploadProfileIconPayload,
} from "../types/profile";
import type {
  DataPackInfo,
  ModrinthVersion,
  ResourcePackInfo,
  ShaderPackInfo,
} from "../types/modrinth";
import { NoriskVersionsConfig } from "../types/noriskVersions";
import { FileNode } from "../types/fileSystem";

export async function listProfiles(): Promise<Profile[]> {
  return invoke<Profile[]>("list_profiles");
}

export async function searchProfiles(query: string): Promise<Profile[]> {
  return invoke<Profile[]>("search_profiles", { query });
}

export async function getProfile(id: string): Promise<Profile> {
  return invoke<Profile>("get_profile", { id });
}

export async function createProfile(
  params: CreateProfileParams,
): Promise<string> {
  return invoke<string>("create_profile", { params });
}

export async function updateProfile(
  id: string,
  params: UpdateProfileParams,
): Promise<void> {
  return invoke<void>("update_profile", { id, params });
}

export async function deleteProfile(id: string): Promise<void> {
  return invoke<void>("delete_profile", { id });
}

export async function repairProfile(id: string): Promise<void> {
  return invoke<void>("repair_profile", { id });
}

export async function launchProfile(
  id: string,
  quickPlaySingleplayer?: string, 
  quickPlayMultiplayer?: string
): Promise<void> {
  return invoke<void>("launch_profile", { 
    id, 
    quickPlaySingleplayer, 
    quickPlayMultiplayer 
  });
}

export async function abortProfileLaunch(profileId: string): Promise<void> {
  return invoke<void>("abort_profile_launch", { profileId });
}

export async function isProfileLaunching(profileId: string): Promise<boolean> {
  return invoke<boolean>("is_profile_launching", { profileId });
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

export async function setProfileModEnabled(
  profileId: string,
  modId: string,
  enabled: boolean,
): Promise<void> {
  return invoke<void>("set_profile_mod_enabled", { profileId, modId, enabled });
}

export async function deleteModFromProfile(
  profileId: string,
  modId: string,
): Promise<void> {
  return invoke<void>("delete_mod_from_profile", { profileId, modId });
}

export async function addModrinthModToProfile(
  profileId: string,
  projectId: string,
  versionId: string,
  fileName: string,
  downloadUrl: string,
  fileHashSha1?: string,
  modName?: string,
  versionNumber?: string,
  loaders?: string[],
  gameVersions?: string[],
): Promise<void> {
  return invoke<void>("add_modrinth_mod_to_profile", {
    profileId,
    projectId,
    versionId,
    fileName,
    downloadUrl,
    fileHashSha1,
    modName,
    versionNumber,
    loaders,
    gameVersions,
  });
}

export async function updateModrinthModVersion(
  profileId: string,
  modInstanceId: string,
  newVersionDetails: ModrinthVersion,
): Promise<void> {
  return invoke<void>("update_modrinth_mod_version", {
    profileId,
    modInstanceId,
    newVersionDetails,
  });
}

export async function getLocalResourcepacks(
  profileId: string,
): Promise<ResourcePackInfo[]> {
  return invoke<ResourcePackInfo[]>("get_local_resourcepacks", { profileId });
}

export async function getLocalShaderpacks(
  profileId: string,
): Promise<ShaderPackInfo[]> {
  return invoke<ShaderPackInfo[]>("get_local_shaderpacks", { profileId });
}

export async function getLocalDatapacks(
  profileId: string,
): Promise<DataPackInfo[]> {
  return invoke<DataPackInfo[]>("get_local_datapacks", { profileId });
}

export async function getCustomMods(
  profileId: string,
): Promise<CustomModInfo[]> {
  return invoke<CustomModInfo[]>("get_custom_mods", { profileId });
}

export async function setCustomModEnabled(
  profileId: string,
  filename: string,
  enabled: boolean,
): Promise<void> {
  return invoke<void>("set_custom_mod_enabled", {
    profileId,
    filename,
    enabled,
  });
}

export async function deleteCustomMod(
  profileId: string,
  filename: string,
): Promise<void> {
  return invoke<void>("delete_custom_mod", { profileId, filename });
}

export async function importLocalMods(profileId: string): Promise<void> {
  return invoke<void>("import_local_mods", { profileId });
}

export async function importProfileFromFile(): Promise<void> {
  return invoke<void>("import_profile_from_file");
}

export async function openProfileFolder(profileId: string): Promise<void> {
  return invoke<void>("open_profile_folder", { profileId });
}

export async function getProfileDirectoryStructure(
  profileId: string,
): Promise<FileNode> {
  return invoke<FileNode>("get_profile_directory_structure", { profileId });
}

export async function setNoriskModStatus(
  profileId: string,
  packId: string,
  modId: string,
  gameVersion: string,
  loader: string,
  disabled: boolean,
): Promise<void> {
  return invoke<void>("set_norisk_mod_status", {
    profileId,
    packId,
    modId,
    gameVersion,
    loader,
    disabled,
  });
}

export async function addModrinthContentToProfile(
  profileId: string,
  projectId: string,
  versionId: string,
  fileName: string,
  downloadUrl: string,
  fileHashSha1: string | null,
  contentName: string | null,
  versionNumber: string | null,
  projectType: string,
): Promise<void> {
  return invoke<void>("add_modrinth_content_to_profile", {
    profileId,
    projectId,
    versionId,
    fileName,
    downloadUrl,
    fileHashSha1,
    contentName,
    versionNumber,
    projectType,
  });
}

export async function updateResourcepackFromModrinth(
  profileId: string,
  resourcepack: ResourcePackInfo,
  newVersionDetails: ModrinthVersion,
): Promise<void> {
  return invoke<void>("update_resourcepack_from_modrinth", {
    profileId,
    resourcepack,
    newVersionDetails,
  });
}

export async function updateShaderpackFromModrinth(
  profileId: string,
  shaderpack: ShaderPackInfo,
  newVersionDetails: ModrinthVersion,
): Promise<void> {
  return invoke<void>("update_shaderpack_from_modrinth", {
    profileId,
    shaderpack,
    newVersionDetails,
  });
}

export async function updateDatapackFromModrinth(
  profileId: string,
  datapack: DataPackInfo,
  newVersionDetails: ModrinthVersion,
): Promise<void> {
  return invoke<void>("update_datapack_from_modrinth", {
    profileId,
    datapack,
    newVersionDetails,
  });
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

export async function getNoriskPacks(): Promise<any> {
  return invoke<any>("get_norisk_packs");
}

export async function getNoriskPacksResolved(): Promise<any> {
  return invoke<any>("get_norisk_packs_resolved");
}

export async function getStandardProfiles(): Promise<NoriskVersionsConfig> {
  return invoke<NoriskVersionsConfig>("get_standard_profiles");
}

export async function refreshNoriskPacks(): Promise<void> {
  return invoke<void>("refresh_norisk_packs");
}

export async function refreshStandardVersions(): Promise<void> {
  return invoke<void>("refresh_standard_versions");
}

export async function getProfileLatestLogContent(profileId: string): Promise<string> {
  return invoke<string>("get_profile_latest_log_content", { profileId });
}

export async function getAllProfilesAndLastPlayed(): Promise<AllProfilesAndLastPlayed> {
  return invoke<AllProfilesAndLastPlayed>("get_all_profiles_and_last_played");
}

export async function getLocalContent(
  params: LoadItemsParams,
): Promise<LocalContentItem[]> {
  return invoke<LocalContentItem[]>("get_local_content", { params });
}

export async function importProfileByPath(filePathStr: string): Promise<string> {
  return invoke<string>("import_profile", { filePathStr });
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
