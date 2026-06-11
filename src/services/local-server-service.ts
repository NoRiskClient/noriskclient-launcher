import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  BedrockContentKind,
  BedrockInstance,
  BedrockCatalogResult,
  BedrockProfile,
  CreateLocalServerInput,
  CreateBedrockProfileInput,
  InstallBedrockSkinPackInput,
  ImportLocalServerInput,
  LocalServer,
  LocalServerContentKind,
  LocalServerFileEntry,
  LocalServerLogEvent,
  LoaderVersionEntry,
  MinecraftVersionEntry,
  ServerBackup,
  ServerCatalogResult,
  ServerCatalogSearchInput,
  UpdateBedrockProfileInput,
  UpdateLocalServerSettingsInput,
} from "../types/localServer";

export class LocalServerService {
  static listServers(): Promise<LocalServer[]> {
    return invoke("list_local_servers");
  }

  static listMinecraftVersions(): Promise<MinecraftVersionEntry[]> {
    return invoke("list_local_server_minecraft_versions");
  }

  static listFabricLoaderVersions(): Promise<LoaderVersionEntry[]> {
    return invoke("list_local_server_fabric_loader_versions");
  }

  static async listForgeVersions(minecraftVersion: string): Promise<LoaderVersionEntry[]> {
    const versions = await invoke<string[]>("get_forge_versions", { minecraftVersion });
    return versions.map((version) => ({ version, stable: true }));
  }

  static async listNeoForgeVersions(minecraftVersion: string): Promise<LoaderVersionEntry[]> {
    const versions = await invoke<string[]>("get_neoforge_versions", { minecraftVersion });
    return versions.map((version) => ({ version, stable: true }));
  }

  static createServer(input: CreateLocalServerInput): Promise<LocalServer> {
    return invoke("create_local_server", { input });
  }

  static createServerFromProfile(profileId: string): Promise<LocalServer> {
    return invoke("create_local_server_from_profile", { profileId });
  }

  static importServer(input: ImportLocalServerInput): Promise<LocalServer> {
    return invoke("import_local_server", { input });
  }

  static duplicateServer(serverId: string): Promise<LocalServer> {
    return invoke("duplicate_local_server", { serverId });
  }

  static deleteServer(serverId: string): Promise<void> {
    return invoke("delete_local_server", { serverId });
  }

  static isBedrockInstalled(): Promise<boolean> {
    return invoke("is_minecraft_bedrock_installed");
  }

  static openBedrock(): Promise<void> {
    return invoke("open_minecraft_bedrock");
  }

  static openBedrockPreview(): Promise<void> {
    return invoke("open_minecraft_bedrock_preview");
  }

  static listBedrockProfiles(): Promise<BedrockProfile[]> {
    return invoke("list_bedrock_profiles");
  }

  static createBedrockProfile(input: CreateBedrockProfileInput): Promise<BedrockProfile> {
    return invoke("create_bedrock_profile", { input });
  }

  static updateBedrockProfile(
    profileId: string,
    input: UpdateBedrockProfileInput,
  ): Promise<BedrockProfile> {
    return invoke("update_bedrock_profile", { profileId, input });
  }

  static deleteBedrockProfile(profileId: string): Promise<void> {
    return invoke("delete_bedrock_profile", { profileId });
  }

  static launchBedrockProfile(profileId: string): Promise<BedrockProfile> {
    return invoke("launch_bedrock_profile", { profileId });
  }

  static listBedrockInstances(): Promise<BedrockInstance[]> {
    return invoke("list_bedrock_instances");
  }

  static stopBedrockInstance(pid: number): Promise<void> {
    return invoke("stop_bedrock_instance", { pid });
  }

  static importBedrockProfileContent(
    profileId: string,
    sourcePath: string,
    kind: BedrockContentKind,
  ): Promise<BedrockProfile> {
    return invoke("import_bedrock_profile_content", { profileId, sourcePath, kind });
  }

  static installBedrockSkinPack(input: InstallBedrockSkinPackInput): Promise<string> {
    return invoke("install_bedrock_skin_pack", { input });
  }

  static searchBedrockCatalog(query: string, kind: BedrockContentKind): Promise<BedrockCatalogResult[]> {
    return invoke("search_bedrock_catalog", { query, kind });
  }

  static installBedrockCatalogProject(profileId: string, projectId: string, kind: BedrockContentKind): Promise<BedrockProfile> {
    return invoke("install_bedrock_catalog_project", { profileId, projectId, kind });
  }

  static updateSettings(
    serverId: string,
    settings: UpdateLocalServerSettingsInput,
  ): Promise<LocalServer> {
    return invoke("update_local_server_settings", { serverId, settings });
  }

  static startServer(serverId: string): Promise<LocalServer> {
    return invoke("start_local_server", { serverId });
  }

  static stopServer(serverId: string): Promise<LocalServer> {
    return invoke("stop_local_server", { serverId });
  }

  static restartServer(serverId: string): Promise<LocalServer> {
    return invoke("restart_local_server", { serverId });
  }

  static sendCommand(serverId: string, command: string): Promise<void> {
    return invoke("send_local_server_command", { serverId, command });
  }

  static readLog(serverId: string): Promise<string> {
    return invoke("read_local_server_log", { serverId });
  }

  static getServerPath(serverId: string, relativePath = ""): Promise<string> {
    return invoke("get_local_server_path", { serverId, relativePath });
  }

  static listFiles(serverId: string, relativePath = ""): Promise<LocalServerFileEntry[]> {
    return invoke("list_local_server_files", { serverId, relativePath });
  }

  static readFile(serverId: string, relativePath: string): Promise<string> {
    return invoke("read_local_server_file", { serverId, relativePath });
  }

  static writeFile(serverId: string, relativePath: string, contents: string): Promise<LocalServer> {
    return invoke("write_local_server_file", { serverId, relativePath, contents });
  }

  static readProperties(serverId: string): Promise<Record<string, string>> {
    return invoke("read_local_server_properties", { serverId });
  }

  static writeProperties(serverId: string, properties: Record<string, string>): Promise<LocalServer> {
    return invoke("write_local_server_properties", { serverId, properties });
  }

  static listBackups(serverId: string): Promise<ServerBackup[]> {
    return invoke("list_local_server_backups", { serverId });
  }

  static createBackup(serverId: string): Promise<ServerBackup> {
    return invoke("create_local_server_backup", { serverId });
  }

  static inviteUser(serverId: string, name: string): Promise<LocalServer> {
    return invoke("invite_local_server_user", { serverId, name });
  }

  static createDatabase(serverId: string, name?: string): Promise<LocalServer> {
    return invoke("create_local_server_database", { serverId, name });
  }

  static installLocalFile(
    serverId: string,
    sourcePath: string,
    kind: LocalServerContentKind,
  ): Promise<LocalServer> {
    return invoke("install_local_server_file", { serverId, sourcePath, kind });
  }

  static searchCatalog(input: ServerCatalogSearchInput): Promise<ServerCatalogResult[]> {
    return invoke("search_local_server_catalog", { input });
  }

  static installCatalogProject(serverId: string, projectId: string): Promise<LocalServer> {
    return invoke("install_local_server_catalog_project", { serverId, projectId });
  }

  static setContentEnabled(
    serverId: string,
    fileName: string,
    kind: LocalServerContentKind,
    enabled: boolean,
  ): Promise<LocalServer> {
    return invoke("set_local_server_content_enabled", { serverId, fileName, kind, enabled });
  }

  static deleteContent(
    serverId: string,
    fileName: string,
    kind: LocalServerContentKind,
  ): Promise<LocalServer> {
    return invoke("delete_local_server_content", { serverId, fileName, kind });
  }

  static listenForLogs(callback: (event: LocalServerLogEvent) => void): Promise<() => void> {
    return listen<LocalServerLogEvent>("nrc_server_log", (event) => callback(event.payload));
  }

  static async pickContentFile(kind: LocalServerContentKind): Promise<string | null> {
    const selected = await open({
      multiple: false,
      filters: [
        kind === "resourcepack"
          ? { name: "Resourcepack ZIP", extensions: ["zip"] }
          : kind === "shaderpack"
            ? { name: "Shaderpack ZIP", extensions: ["zip"] }
            : kind === "datapack"
              ? { name: "Datapack ZIP", extensions: ["zip"] }
          : kind === "modpack"
            ? { name: "Modpack", extensions: ["mrpack", "zip"] }
          : { name: "Java Archive", extensions: ["jar"] },
      ],
    });

    return typeof selected === "string" ? selected : null;
  }

  static async pickBedrockContentFile(kind: BedrockContentKind): Promise<string | null> {
    const selected = await open({
      multiple: false,
      filters: [
        kind === "addon"
          ? { name: "Bedrock Add-on", extensions: ["mcaddon", "mcpack", "zip"] }
          : kind === "resourcepack"
            ? { name: "Bedrock Resource Pack", extensions: ["mcpack", "zip"] }
            : kind === "world"
              ? { name: "Bedrock World", extensions: ["mcworld", "zip"] }
              : { name: "Bedrock Skin Pack", extensions: ["mcpack"] },
      ],
    });

    return typeof selected === "string" ? selected : null;
  }

  static async pickIconFile(): Promise<string | null> {
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Serverbild", extensions: ["png", "jpg", "jpeg", "webp"] },
      ],
    });

    return typeof selected === "string" ? selected : null;
  }

  static async pickServerFolder(): Promise<string | null> {
    const selected = await open({
      directory: true,
      multiple: false,
    });

    return typeof selected === "string" ? selected : null;
  }
}
