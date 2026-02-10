import type {
  ModrinthAllVersionsResult,
  ModrinthBulkUpdateRequestBody,
  ModrinthProject,
  ModrinthProjectContext,
  ModrinthProjectType,
  ModrinthSearchHit,
  ModrinthSearchResponse,
  ModrinthSortType,
  ModrinthVersion,
  ModrinthCategory,
  ModrinthLoader,
  ModrinthGameVersion,
  ModrinthTeamMember,
} from "../types/modrinth";
import type {
  UnifiedModVersionsParams,
  UnifiedVersionResponse,
} from "../types/unified";
import { invoke } from "@tauri-apps/api/core";

export class ModrinthService {
  static async searchProjects(
    query: string,
    projectType: ModrinthProjectType,
    gameVersion?: string,
    loader?: string,
    limit = 20,
    offset = 0,
    sort?: ModrinthSortType,
    categoriesFilter?: string[],
    clientSideFilter?: string,
    serverSideFilter?: string,
  ): Promise<ModrinthSearchResponse> {
    return invoke<ModrinthSearchResponse>("search_modrinth_projects", {
      query,
      projectType,
      gameVersion,
      loader,
      limit,
      offset,
      sort,
      categoriesFilter,
      clientSideFilter,
      serverSideFilter,
    });
  }

  static async searchMods(
    query: string,
    gameVersion?: string,
    loader?: string,
    limit = 20,
  ): Promise<ModrinthSearchHit[]> {
    return invoke<ModrinthSearchHit[]>("search_modrinth_mods", {
      query,
      gameVersion,
      loader,
      limit,
    });
  }

  static async getModVersions(
    projectIdOrSlug: string,
    loaders?: string[],
    gameVersions?: string[],
  ): Promise<ModrinthVersion[]> {
    return invoke<ModrinthVersion[]>("get_modrinth_mod_versions", {
      projectIdOrSlug,
      loaders,
      gameVersions,
    });
  }

  static async getAllVersionsForContexts(
    contexts: ModrinthProjectContext[],
  ): Promise<ModrinthAllVersionsResult[]> {
    return invoke<ModrinthAllVersionsResult[]>(
      "get_all_modrinth_versions_for_contexts",
      {
        contexts,
      },
    );
  }

  static async getProjectDetails(ids: string[]): Promise<ModrinthProject[]> {
    return invoke<ModrinthProject[]>("get_modrinth_project_details", {
      ids,
    });
  }

  static async getProjectMembers(projectIdOrSlug: string): Promise<ModrinthTeamMember[]> {
    return invoke<ModrinthTeamMember[]>("get_modrinth_project_members", {
      projectIdOrSlug,
    });
  }

  static async checkUpdates(
    request: ModrinthBulkUpdateRequestBody,
  ): Promise<Record<string, ModrinthVersion>> {
    return invoke<Record<string, ModrinthVersion>>("check_modrinth_updates", {
      request,
    });
  }

  static async downloadAndInstallModpack(
    projectId: string,
    versionId: string,
    fileName: string,
    downloadUrl: string,
    iconUrl?: string,
    fileSize?: number,
    eventId?: string,
  ): Promise<string> {
    return invoke<string>("download_and_install_modrinth_modpack", {
      projectId,
      versionId,
      fileName,
      downloadUrl,
      iconUrl,
      fileSize,
      eventId,
    });
  }

  static async getModrinthCategories(): Promise<ModrinthCategory[]> {
    return invoke<ModrinthCategory[]>("get_modrinth_categories_command");
  }

  static async getModrinthLoaders(): Promise<ModrinthLoader[]> {
    return invoke<ModrinthLoader[]>("get_modrinth_loaders_command");
  }

  static async getModrinthGameVersions(): Promise<ModrinthGameVersion[]> {
    return invoke<ModrinthGameVersion[]>("get_modrinth_game_versions_command");
  }

  static async getVersionsByHashes(
    hashes: string[],
  ): Promise<Record<string, ModrinthVersion>> {
    // The backend command `get_modrinth_versions_by_hashes` implicitly uses "sha1"
    return invoke<Record<string, ModrinthVersion>>(
      "get_modrinth_versions_by_hashes",
      {
        hashes,
        // hashAlgorithm: "sha1", // Not needed as backend command defaults/is specific to sha1
      },
    );
  }

  static async getModVersionsUnified(
    params: UnifiedModVersionsParams,
  ): Promise<UnifiedVersionResponse> {
    return invoke<UnifiedVersionResponse>("get_mod_versions_unified_command", {
      params,
    });
  }
}
