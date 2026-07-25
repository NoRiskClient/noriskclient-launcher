import {
  ModPlatform,
  type UnifiedModSearchParams,
  type UnifiedModSearchResponse,
  type UnifiedModVersionsParams,
  type UnifiedModpackVersionsResponse,
  type UnifiedVersionResponse,
  type UnifiedProjectType,
  type UnifiedSortType,
  type UnifiedUpdateCheckRequest,
  type UnifiedUpdateCheckResponse,
  type UnifiedVersion,
  type ModpackSwitchRequest,
  type ModpackSwitchResponse,
} from "../types/unified";
import type { CacheBehaviour, ModPackSource } from "../types/profile";
import type { SwitchContentVersionPayload, ContentType } from "../types/content";
import type { LocalContentItem } from "../types/profile";
import { invoke } from "@tauri-apps/api/core";

class UnifiedService {
    static async searchMods(params: UnifiedModSearchParams): Promise<UnifiedModSearchResponse> {
        return invoke<UnifiedModSearchResponse>("search_mods_unified_command", { params });
    }

    static async getModVersions(params: UnifiedModVersionsParams): Promise<UnifiedVersionResponse> {
        return invoke<UnifiedVersionResponse>("get_mod_versions_unified_command", { params });
    }

    static async checkModUpdates(request: UnifiedUpdateCheckRequest, cacheBehaviour?: CacheBehaviour): Promise<UnifiedUpdateCheckResponse> {
        return invoke<UnifiedUpdateCheckResponse>("check_mod_updates_unified_command", { request, cacheBehaviour });
    }

    static async getModpackVersions(modpackSource: ModPackSource, cacheBehaviour?: CacheBehaviour): Promise<UnifiedModpackVersionsResponse> {
        return invoke<UnifiedModpackVersionsResponse>("get_modpack_versions_unified_command", {
            modpackSource,
            cacheBehaviour
        });
    }

    static async switchContentVersion(
        profileId: string,
        contentType: ContentType,
        currentItem: LocalContentItem,
        newVersion: UnifiedVersion
    ): Promise<void> {
        const payload: SwitchContentVersionPayload = {
            profile_id: profileId,
            content_type: contentType,
            current_item_details: { ...currentItem, path_str: currentItem.path_str },
            new_version_details: newVersion,
        };

        return invoke("switch_content_version", { payload });
    }

    static async switchModpackVersion(request: ModpackSwitchRequest): Promise<ModpackSwitchResponse> {
        console.log("Switching modpack version", request);

        return invoke("switch_modpack_version_command", { request });
    }

    static async getCurseForgeFileChangelog(modId: number, fileId: number): Promise<string> {
        console.log("Getting CurseForge file changelog:", { modId, fileId });

        return invoke("get_curseforge_file_changelog_command", { modId, fileId });
    }
}

export default UnifiedService;
