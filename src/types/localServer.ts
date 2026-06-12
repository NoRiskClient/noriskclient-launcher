export type LocalServerType = "paper" | "spigot" | "bukkit" | "fabric" | "forge" | "neoforge" | "vanilla" | "bedrock";
export type LocalServerStatus = "stopped" | "running";
export type LocalServerContentKind = "plugin" | "mod" | "resourcepack" | "modpack" | "shaderpack" | "datapack";
export type BedrockProfileTarget = "release" | "preview";
export type BedrockContentKind = "addon" | "resourcepack" | "world" | "skinpack";
export type LocalServerKind = "plugins" | "modpack" | "vanilla" | "bedrock";
export type MinecraftVersionType = "release" | "snapshot" | "old_beta" | "old_alpha";

export interface InstalledServerContent {
  name: string;
  source: string;
  projectId?: string | null;
  fileName: string;
  kind: LocalServerContentKind;
  version?: string | null;
  enabled?: boolean;
}

export interface ServerUser {
  name: string;
  role: string;
  invitedAt: string;
}

export interface ServerDatabase {
  enabled: boolean;
  databaseType: string;
  name: string;
  path?: string | null;
  createdAt: string;
}

export interface MinecraftVersionEntry {
  id: string;
  versionType: MinecraftVersionType | string;
}

export interface LoaderVersionEntry {
  version: string;
  stable: boolean;
}

export interface LocalServerFileEntry {
  name: string;
  relativePath: string;
  absolutePath: string;
  isDir: boolean;
  sizeBytes: number;
  modifiedAt?: string | null;
}

export interface ServerBackup {
  name: string;
  path: string;
  createdAt: string;
}

export interface LocalServer {
  id: string;
  name: string;
  serverType: LocalServerType;
  minecraftVersion: string;
  loaderVersion?: string | null;
  serverIp?: string | null;
  port: number;
  ramMb: number;
  javaPath?: string | null;
  serverKind?: LocalServerKind;
  description?: string | null;
  iconPath?: string | null;
  codexEnabled?: boolean;
  codexMcpPort?: number | null;
  autoUpdateContent?: boolean;
  status: LocalServerStatus;
  createdAt: string;
  lastStartedAt?: string | null;
  installedContent: InstalledServerContent[];
  invitedUsers?: ServerUser[];
  database?: ServerDatabase | null;
}

export interface CreateLocalServerInput {
  name: string;
  serverType: LocalServerType;
  minecraftVersion: string;
  loaderVersion?: string | null;
  serverIp?: string | null;
  port: number;
  ramMb: number;
  javaPath?: string | null;
  serverKind?: LocalServerKind;
  description?: string | null;
  iconPath?: string | null;
  codexEnabled?: boolean;
  codexMcpPort?: number | null;
  autoUpdateContent?: boolean;
  sourceProfileId?: string | null;
}

export interface ImportLocalServerInput extends CreateLocalServerInput {
  sourcePath: string;
}

export interface UpdateLocalServerSettingsInput {
  name?: string;
  serverType?: LocalServerType;
  minecraftVersion?: string;
  loaderVersion?: string | null;
  serverIp?: string | null;
  port?: number;
  ramMb?: number;
  javaPath?: string | null;
  serverKind?: LocalServerKind;
  description?: string | null;
  iconPath?: string | null;
  codexEnabled?: boolean;
  codexMcpPort?: number | null;
  autoUpdateContent?: boolean;
}

export interface ServerCatalogSearchInput {
  query: string;
  kind: LocalServerContentKind;
  minecraftVersion: string;
  loader: string;
}

export interface ServerCatalogResult {
  projectId: string;
  title: string;
  description: string;
  iconUrl?: string | null;
  downloads: number;
  projectType: string;
}

export interface LocalServerLogEvent {
  serverId: string;
  stream: "stdout" | "stderr";
  line: string;
}

export interface BedrockInstalledContent {
  name: string;
  source: string;
  fileName: string;
  kind: BedrockContentKind;
  path: string;
  importedAt: string;
}

export interface BedrockProfile {
  id: string;
  name: string;
  iconPath?: string | null;
  target: BedrockProfileTarget;
  createdAt: string;
  lastLaunchedAt?: string | null;
  installedContent: BedrockInstalledContent[];
}

export interface BedrockInstance {
  id: string;
  name: string;
  target: BedrockProfileTarget;
  pid: number;
  startedAt: number;
}

export interface BedrockCatalogResult {
  projectId: string;
  title: string;
  description: string;
  iconUrl?: string | null;
  downloads: number;
  author?: string | null;
  projectUrl: string;
  downloadAvailable: boolean;
}

export interface CreateBedrockProfileInput {
  name: string;
  iconPath?: string | null;
  target?: BedrockProfileTarget;
}

export interface UpdateBedrockProfileInput {
  name?: string;
  iconPath?: string | null;
  target?: BedrockProfileTarget;
}

export interface InstallBedrockSkinPackInput {
  name: string;
  base64Data: string;
  variant: "classic" | "slim";
}
