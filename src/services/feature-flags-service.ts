import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { log } from "../utils/logging-utils";

export interface FlagState {
  enabled: boolean;
  value?: unknown;
}

export interface FeatureFlags {
  flags: Record<string, FlagState>;
}

export const getFeatureFlags = (): Promise<FeatureFlags> =>
  invoke("get_feature_flags");

export const onFeatureFlagsUpdated = (handler: (flags: FeatureFlags) => void) =>
  listen<FeatureFlags>("feature_flags_updated", (event) => handler(event.payload));

const isFlagOn = (flags: FeatureFlags, key: string): boolean =>
  flags.flags[key]?.enabled === true;

const flagValue = <T>(flags: FeatureFlags, key: string): T | null => {
  const flag = flags.flags[key];
  return flag?.enabled && flag.value != null ? (flag.value as T) : null;
};

const readFlagValue = async <T>(key: string): Promise<T | null> =>
  flagValue<T>(await getFeatureFlags(), key);

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export interface BlockedModsConfig {
  exact_filenames: string[];
  filename_patterns: string[];
  mod_ids: string[];
  modrinth_project_ids: string[];
  warning_project_ids: string[];
  description: string;
}

export interface PackRolloutConfig {
  aliases: Record<string, string>;
  rollout_pct?: number;
}

export interface PackFallbackConfig {
  fallback_pack_id: string;
}

export type LauncherNoticeSeverity = "info" | "warning" | "error";

export interface LauncherNotice {
  id: string;
  enabled?: boolean;
  severity?: LauncherNoticeSeverity;
  title: string;
  message: string;
  link_url?: string;
  link_label?: string;
}

let cachedPackRollout: PackRolloutConfig | null = null;
let packRolloutFetchPromise: Promise<PackRolloutConfig> | null = null;

export const getPackRolloutConfig = async (): Promise<PackRolloutConfig> => {
  if (cachedPackRollout) return cachedPackRollout;
  if (packRolloutFetchPromise) return packRolloutFetchPromise;

  packRolloutFetchPromise = (async () => {
    try {
      const value = await readFlagValue<unknown>("launcher.pack-rollout");
      const config: PackRolloutConfig = isObject(value)
        ? {
            aliases: (value.aliases ?? value) as Record<string, string>,
            rollout_pct: typeof value.rollout_pct === "number" ? value.rollout_pct : undefined,
          }
        : { aliases: {} };

      log("info", `Pack rollout config: ${JSON.stringify(config)}`);
      cachedPackRollout = config;

      try {
        await invoke("set_pack_rollout_config", { config: { aliases: config.aliases } });
      } catch (error) {
        log("error", `Failed to push pack rollout config to backend: ${error}`);
      }

      return config;
    } catch (error) {
      log("error", `Failed to fetch pack rollout config: ${error}`);
      packRolloutFetchPromise = null;
      throw error;
    }
  })();

  return packRolloutFetchPromise;
};

let cachedPackFallback: PackFallbackConfig | null = null;
let packFallbackFetchPromise: Promise<PackFallbackConfig | null> | null = null;

export const getPackFallbackConfig = async (): Promise<PackFallbackConfig | null> => {
  if (cachedPackFallback) return cachedPackFallback;
  if (packFallbackFetchPromise) return packFallbackFetchPromise;

  packFallbackFetchPromise = (async () => {
    try {
      const value = await readFlagValue<unknown>("launcher.pack-fallback");
      if (typeof value !== "string" || !value.trim()) {
        log("info", "No launcher.pack-fallback flag set; keeping backend default");
        return null;
      }

      const config: PackFallbackConfig = { fallback_pack_id: value.trim() };
      log("info", `Pack fallback config: ${JSON.stringify(config)}`);
      cachedPackFallback = config;

      try {
        await invoke("set_pack_fallback_config", { config });
      } catch (error) {
        log("error", `Failed to push pack fallback config to backend: ${error}`);
      }

      return config;
    } catch (error) {
      log("error", `Failed to fetch pack fallback config: ${error}`);
      packFallbackFetchPromise = null;
      throw error;
    }
  })();

  return packFallbackFetchPromise;
};

let cachedLauncherNotices: LauncherNotice[] | null = null;
let launcherNoticesFetchPromise: Promise<LauncherNotice[]> | null = null;

export const getLauncherNotices = async (): Promise<LauncherNotice[]> => {
  if (cachedLauncherNotices) return cachedLauncherNotices;
  if (launcherNoticesFetchPromise) return launcherNoticesFetchPromise;

  launcherNoticesFetchPromise = (async () => {
    try {
      const value = await readFlagValue<unknown>("launcher.notice");
      const rawList: unknown[] = value == null ? [] : Array.isArray(value) ? value : [value];

      const notices = rawList
        .filter((n): n is LauncherNotice =>
          isObject(n) &&
          typeof n.id === "string" &&
          typeof n.message === "string")
        .filter((n) => n.enabled !== false);

      log("info", `Launcher notices: ${notices.length} active`);
      cachedLauncherNotices = notices;
      return notices;
    } catch (error) {
      log("error", `Failed to fetch launcher notices: ${error}`);
      launcherNoticesFetchPromise = null;
      cachedLauncherNotices = [];
      return [];
    }
  })();

  return launcherNoticesFetchPromise;
};

let cachedBlockedModsConfig: BlockedModsConfig | null = null;
let configFetchPromise: Promise<BlockedModsConfig> | null = null;

export const getBlockedModsConfig = async (): Promise<BlockedModsConfig> => {
  if (cachedBlockedModsConfig) return cachedBlockedModsConfig;
  if (configFetchPromise) return configFetchPromise;

  configFetchPromise = (async () => {
    try {
      const config = await readFlagValue<BlockedModsConfig>("launcher.blocked-mods");
      if (!isObject(config)) {
        throw new Error("launcher.blocked-mods flag not found");
      }

      log("info", `Parsed blocked mods config: ${JSON.stringify(config)}`);
      cachedBlockedModsConfig = config;

      try {
        await invoke("set_blocked_mods_config", { config });
        log("info", "Successfully sent blocked mods config to Rust backend");
      } catch (error) {
        log("error", `Failed to send blocked mods config to Rust backend: ${error}`);
      }

      return config;
    } catch (error) {
      log("error", `Failed to fetch blocked mods config: ${error}`);
      configFetchPromise = null;
      throw error;
    }
  })();

  return configFetchPromise;
};

export const getModNoRiskStatus = (
  filename: string,
  modrinthProjectId?: string | null,
  versionId?: string | null,
): "blocked" | "warning" | null => {
  const config = cachedBlockedModsConfig;
  if (!config) return null;

  if (config.exact_filenames?.includes(filename)) return "blocked";
  if (modrinthProjectId && config.modrinth_project_ids?.includes(modrinthProjectId)) return "blocked";
  if (versionId && config.mod_ids?.includes(versionId)) return "blocked";

  for (const pattern of config.filename_patterns ?? []) {
    try {
      if (new RegExp(pattern).test(filename)) return "blocked";
    } catch {
      log("error", `Invalid regex pattern in launcher.blocked-mods: ${pattern}`);
    }
  }

  if (modrinthProjectId && config.warning_project_ids?.includes(modrinthProjectId)) return "warning";
  return null;
};
