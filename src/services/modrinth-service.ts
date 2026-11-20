import type {
  ModrinthProject,
  ModrinthProjectType,
  ModrinthSearchResponse,
  ModrinthSortType,
  ModrinthVersion,
  ModrinthTags,
  ModrinthTeamMember,
} from "../types/modrinth";
import type { CacheBehaviour } from "../types/profile";
import { invoke } from "@tauri-apps/api/core";

let inFlightTags: Promise<ModrinthTags> | null = null;

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

  static async getModVersions(
    projectIdOrSlug: string,
    loaders?: string[],
    gameVersions?: string[],
    cacheBehaviour?: CacheBehaviour,
  ): Promise<ModrinthVersion[]> {
    return invoke<ModrinthVersion[]>("get_modrinth_mod_versions", {
      projectIdOrSlug,
      loaders,
      gameVersions,
      cacheBehaviour,
    });
  }

  static async getProjectDetails(
    ids: string[],
    cacheBehaviour?: CacheBehaviour,
  ): Promise<ModrinthProject[]> {
    return invoke<ModrinthProject[]>("get_modrinth_project_details", {
      ids,
      cacheBehaviour,
    });
  }

  static async getProjectMembers(
    projectIdOrSlug: string,
    cacheBehaviour?: CacheBehaviour,
  ): Promise<ModrinthTeamMember[]> {
    return invoke<ModrinthTeamMember[]>("get_modrinth_project_members", {
      projectIdOrSlug,
      cacheBehaviour,
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

  static async getModrinthTags(
    cacheBehaviour?: CacheBehaviour,
  ): Promise<ModrinthTags> {
    if (cacheBehaviour) {
      return invoke<ModrinthTags>("get_modrinth_tags_command", { cacheBehaviour });
    }

    if (!inFlightTags) {
      inFlightTags = invoke<ModrinthTags>("get_modrinth_tags_command", {}).finally(
        () => {
          inFlightTags = null;
        },
      );
    }
    return inFlightTags;
  }
}
