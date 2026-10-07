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

export interface BatchUpdateResult {
    applied: number[];
    failed: number[];
}

function parseCurseForgeId(value: string, label: string): number {
    // ModPackSource uses Rust u32 IDs, not the unrelated update fingerprint.
    if (!/^[1-9]\d*$/.test(value)) throw new Error(`Invalid CurseForge ${label}: ${value}`);
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id > 0xffffffff) throw new Error(`Invalid CurseForge ${label}: ${value}`);
    return id;
}

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

    static buildSwitchContentVersionPayload(
        profileId: string,
        contentType: ContentType,
        currentItem: LocalContentItem,
        newVersion: UnifiedVersion
    ): SwitchContentVersionPayload {
        return {
            profile_id: profileId,
            content_type: contentType,
            current_item_details: { ...currentItem, path_str: currentItem.path_str },
            new_version_details: newVersion,
        };
    }

    static async switchContentVersion(
        profileId: string,
        contentType: ContentType,
        currentItem: LocalContentItem,
        newVersion: UnifiedVersion
    ): Promise<void> {
        const payload = UnifiedService.buildSwitchContentVersionPayload(
            profileId,
            contentType,
            currentItem,
            newVersion
        );

        return invoke("switch_content_version", { payload });
    }

    static async switchContentVersions(
        payloads: SwitchContentVersionPayload[]
    ): Promise<BatchUpdateResult> {
        return invoke<BatchUpdateResult>("update_contents_from_profile", { payloads });
    }

    static buildModpackSwitchRequest(profileId: string, version: UnifiedVersion): ModpackSwitchRequest {
        if (!profileId.trim()) throw new Error("Missing profile ID for modpack switch");
        const file = version.files.find(f => f.primary) ?? version.files[0];
        if (!file?.url?.trim()) throw new Error("Selected modpack version has no download file");
        const url = new URL(file.url);
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid modpack download URL");

        let source: ModPackSource;
        if (version.source === ModPlatform.Modrinth) {
            if (!version.project_id.trim() || !version.id.trim()) throw new Error("Missing Modrinth project or version ID");
            source = { source: "modrinth", project_id: version.project_id, version_id: version.id };
        } else if (version.source === ModPlatform.CurseForge) {
            source = {
                source: "curse_forge",
                project_id: parseCurseForgeId(version.project_id, "project ID"),
                file_id: parseCurseForgeId(version.id, "file ID"),
            };
        } else {
            throw new Error(`Unsupported modpack source: ${version.source}`);
        }
        return { profile_id: profileId, download_url: file.url, modpack_source: source };
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
