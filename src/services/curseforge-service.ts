import type {
  CurseForgeModsResponse,
  GetModsByIdsRequestBody,
} from "../types/curseforge";
import { invoke } from "@tauri-apps/api/core";

export class CurseForgeService {
  /**
   * Get multiple CurseForge mods by their IDs
   * @param modIds Array of CurseForge mod IDs
   * @param filterPcOnly Optional filter for PC-only mods
   * @returns Promise with CurseForgeModsResponse containing the requested mods
   */
  static async getModsByIds(
    modIds: number[],
    filterPcOnly?: boolean,
  ): Promise<CurseForgeModsResponse> {
    return invoke<CurseForgeModsResponse>("get_curseforge_mods_by_ids", {
      modIds,
      filterPcOnly,
    });
  }


  /**
   * Import a local CurseForge modpack file as a new profile
   * @param packPath Path to the CurseForge modpack file (.zip)
   * @returns Promise with the new profile ID as string
   */
  static async importCurseForgePack(packPath: string): Promise<string> {
    return invoke<string>("import_curseforge_pack", {
      packPath,
    });
  }

  /**
   * Download and install a CurseForge modpack from its URL
   * @param projectId CurseForge project ID (number)
   * @param fileId CurseForge file ID (number)
   * @param fileName Name of the modpack file
   * @param downloadUrl Direct download URL for the modpack
   * @param iconUrl Optional URL for the modpack icon
   * @param fileSize Optional file size for disk space check
   * @param eventId Optional event ID for progress tracking
   * @returns Promise with the new profile ID as string
   */
  static async downloadAndInstallCurseForgeModpack(
    projectId: number,
    fileId: number,
    fileName: string,
    downloadUrl: string,
    iconUrl?: string,
    fileSize?: number,
    eventId?: string,
  ): Promise<string> {
    return invoke<string>("download_and_install_curseforge_modpack_command", {
      projectId,
      fileId,
      fileName,
      downloadUrl,
      iconUrl,
      fileSize,
      eventId,
    });
  }

  /**
   * Get the full HTML description for a CurseForge mod
   * @param modId CurseForge mod ID
   * @returns Promise with the HTML description string
   */
  static async getModDescription(modId: number): Promise<string> {
    return invoke<string>("get_curseforge_mod_description_command", {
      modId,
    });
  }
}
