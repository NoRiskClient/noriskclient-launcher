import flagsmith from 'flagsmith';
import { invoke } from '@tauri-apps/api/core';
import { log } from '../utils/logging-utils';
import { getOrCreateInstallId } from './install-id-service';

/**
 * Configuration for blocked mods that cause crashes or compatibility issues.
 */
export interface BlockedModsConfig {
  exact_filenames: string[];
  filename_patterns: string[];
  mod_ids: string[];
  modrinth_project_ids: string[];
  warning_project_ids: string[];
  description: string;
}

// Initialize flagsmith with the same configuration as in App.tsx
const FLAGSMITH_ENVIRONMENT_ID = "eNSibjDaDW2nNJQvJnjj9y";

let flagsmithInitialized = false;
let cachedBlockedModsConfig: BlockedModsConfig | null = null;
let configFetchPromise: Promise<BlockedModsConfig> | null = null;

const initializeFlagsmith = async () => {
  try {
    const installId = getOrCreateInstallId();
    log('info', `Initializing Flagsmith service with install id ${installId}...`);
    await flagsmith.init({
      environmentID: FLAGSMITH_ENVIRONMENT_ID,
      api: 'https://flagsmith-staging.norisk.gg/api/v1/',
      identity: installId,
    });
    flagsmithInitialized = true;
    log('info', 'Flagsmith service initialized successfully');
  } catch (error) {
    log('error', `Failed to initialize Flagsmith service: ${error}`);
    throw error;
  }
};

// Initialize flagsmith when the module is loaded
const initPromise = initializeFlagsmith();

export interface PackRolloutConfig {
  aliases: Record<string, string>;
  rollout_pct?: number;
}

let cachedPackRollout: PackRolloutConfig | null = null;
let packRolloutFetchPromise: Promise<PackRolloutConfig> | null = null;

export const getPackRolloutConfig = async (): Promise<PackRolloutConfig> => {
  if (cachedPackRollout) return cachedPackRollout;
  if (packRolloutFetchPromise) return packRolloutFetchPromise;

  packRolloutFetchPromise = (async () => {
    try {
      if (!flagsmithInitialized) await initPromise;

      const flagValue = flagsmith.getValue('pack_rollout_aliases');
      let config: PackRolloutConfig = { aliases: {} };

      if (flagValue) {
        try {
          const parsed = JSON.parse(flagValue as string);
          if (parsed && typeof parsed === 'object') {
            config = {
              aliases: parsed.aliases ?? parsed,
              rollout_pct: typeof parsed.rollout_pct === 'number' ? parsed.rollout_pct : undefined,
            };
          }
        } catch (e) {
          log('warn', `Failed to parse pack_rollout_aliases flag: ${e}`);
        }
      }

      log('info', `Pack rollout config: ${JSON.stringify(config)}`);
      cachedPackRollout = config;

      try {
        // Backend only cares about aliases; rollout_pct is UI-only metadata.
        await invoke('set_pack_rollout_config', { config: { aliases: config.aliases } });
      } catch (error) {
        log('error', `Failed to push pack rollout config to backend: ${error}`);
      }

      return config;
    } catch (error) {
      log('error', `Failed to fetch pack rollout config from Flagsmith: ${error}`);
      packRolloutFetchPromise = null;
      throw error;
    }
  })();

  return packRolloutFetchPromise;
};

export interface PackFallbackConfig {
  fallback_pack_id: string;
}

let cachedPackFallback: PackFallbackConfig | null = null;
let packFallbackFetchPromise: Promise<PackFallbackConfig | null> | null = null;

export const getPackFallbackConfig = async (): Promise<PackFallbackConfig | null> => {
  if (cachedPackFallback) return cachedPackFallback;
  if (packFallbackFetchPromise) return packFallbackFetchPromise;

  packFallbackFetchPromise = (async () => {
    try {
      if (!flagsmithInitialized) await initPromise;

      const flagValue = flagsmith.getValue('pack_fallback_id');
      // Flag unset → leave the backend default ("norisk-stable") untouched.
      if (!flagValue || typeof flagValue !== 'string' || !flagValue.trim()) {
        log('info', 'No pack_fallback_id flag set; keeping backend default');
        return null;
      }

      const config: PackFallbackConfig = { fallback_pack_id: flagValue.trim() };
      log('info', `Pack fallback config: ${JSON.stringify(config)}`);
      cachedPackFallback = config;

      try {
        await invoke('set_pack_fallback_config', { config });
      } catch (error) {
        log('error', `Failed to push pack fallback config to backend: ${error}`);
      }

      return config;
    } catch (error) {
      log('error', `Failed to fetch pack fallback config from Flagsmith: ${error}`);
      packFallbackFetchPromise = null;
      throw error;
    }
  })();

  return packFallbackFetchPromise;
};

export type LauncherNoticeSeverity = 'info' | 'warning' | 'error';

/**
 * A single remote-controlled notice banner shown in the launcher.
 * Filled via the `launcher_notice` Flagsmith flag (array of these).
 */
export interface LauncherNotice {
  id: string;
  enabled?: boolean;
  severity?: LauncherNoticeSeverity;
  title: string;
  message: string;
  link_url?: string;
  link_label?: string;
}

let cachedLauncherNotices: LauncherNotice[] | null = null;
let launcherNoticesFetchPromise: Promise<LauncherNotice[]> | null = null;

/**
 * Fetches the launcher notice banners from the `launcher_notice` Flagsmith flag.
 *
 * The flag value is a JSON array of notices; a single object is also accepted
 * and wrapped into an array for convenience. Notices with `enabled === false`
 * are filtered out. Returns an empty array when the flag is unset, empty, or
 * unparseable — the banner simply renders nothing in that case.
 */
export const getLauncherNotices = async (): Promise<LauncherNotice[]> => {
  if (cachedLauncherNotices) return cachedLauncherNotices;
  if (launcherNoticesFetchPromise) return launcherNoticesFetchPromise;

  launcherNoticesFetchPromise = (async () => {
    try {
      if (!flagsmithInitialized) await initPromise;

      const flagValue = flagsmith.getValue('launcher_notice');
      if (!flagValue || typeof flagValue !== 'string' || !flagValue.trim()) {
        log('info', 'No launcher_notice flag set');
        cachedLauncherNotices = [];
        return cachedLauncherNotices;
      }

      const parsed = JSON.parse(flagValue);
      const rawList: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

      const notices = rawList
        .filter((n): n is LauncherNotice =>
          !!n && typeof n === 'object' &&
          typeof (n as LauncherNotice).id === 'string' &&
          typeof (n as LauncherNotice).message === 'string')
        .filter((n) => n.enabled !== false);

      log('info', `Launcher notices: ${notices.length} active`);
      cachedLauncherNotices = notices;
      return notices;
    } catch (error) {
      log('error', `Failed to fetch launcher notices from Flagsmith: ${error}`);
      launcherNoticesFetchPromise = null;
      cachedLauncherNotices = [];
      return [];
    }
  })();

  return launcherNoticesFetchPromise;
};

/**
 * Fetches the blocked mods configuration from Flagsmith.
 *
 * @returns A promise that resolves to the BlockedModsConfig object.
 * @throws If the flag is not available or parsing fails.
 */
export const getBlockedModsConfig = async (): Promise<BlockedModsConfig> => {
  if (cachedBlockedModsConfig) {
    return cachedBlockedModsConfig;
  }

  if (configFetchPromise) {
    return configFetchPromise;
  }

  configFetchPromise = (async () => {
    try {
      // Wait for initialization if not done yet
      if (!flagsmithInitialized) {
        log('info', 'Waiting for Flagsmith initialization...');
        await initPromise;
      }

      log('debug', 'Attempting to get blocked_mods_config flag...');
      const flagValue = flagsmith.getValue('blocked_mods_config');
      
      log('debug', `Raw flag value: ${flagValue}`);
      
      if (!flagValue) {
        // Log all available flags for debugging
        const allFlags = flagsmith.getAllFlags();
        log('debug', `Available flags: ${JSON.stringify(allFlags)}`);
        throw new Error('blocked_mods_config flag not found');
      }

      // Parse the JSON value
      const config: BlockedModsConfig = JSON.parse(flagValue as string);
      log('info', `Parsed blocked mods config: ${JSON.stringify(config)}`);
      
      cachedBlockedModsConfig = config;

      // Send the config to Rust backend for caching
      try {
        await invoke('set_blocked_mods_config', { config });
        log('info', 'Successfully sent blocked mods config to Rust backend');
      } catch (error) {
        log('error', `Failed to send blocked mods config to Rust backend: ${error}`);
        // Don't throw here - the config is still valid for frontend use
      }
      
      return config;
    } catch (error) {
      log('error', `Failed to fetch blocked mods config from Flagsmith: ${error}`);
      configFetchPromise = null; // Allow retries
      throw error;
    }
  })();
  
  return configFetchPromise;
};

/**
 * Returns the NoRisk status of a mod based on the cached config.
 * Assumes getBlockedModsConfig() has been called at least once.
 *
 * @param filename The filename of the mod.
 * @param modrinthProjectId The Modrinth project ID, if available.
 * @param versionId The version ID (mod_id), if available.
 * @returns `'blocked'` if the mod is blocked, `'warning'` if it should trigger a warning, or `null` if neither.
 */
export const getModNoRiskStatus = (
  filename: string,
  modrinthProjectId?: string | null,
  versionId?: string | null,
): 'blocked' | 'warning' | null => {
  console.log('[getModNoRiskStatus] Called with filename:', filename, 'projectId:', modrinthProjectId, 'versionId:', versionId, 'cachedConfig:', cachedBlockedModsConfig);

  if (!cachedBlockedModsConfig) {
    console.log('[getModNoRiskStatus] Config not cached, returning null');
    // Silently return null if config is not loaded. The UI should trigger the load.
    return null;
  }

  const config = cachedBlockedModsConfig;
  console.log('[getModNoRiskStatus] Checking against config:', config);

  // 1. Check exact filename match (blocked)
  if (config.exact_filenames?.includes(filename)) {
    console.log('[getModNoRiskStatus] MATCHED exact filename - BLOCKED!');
    return 'blocked';
  }

  // 2. Check Modrinth project ID for blocking
  if (modrinthProjectId && config.modrinth_project_ids?.includes(modrinthProjectId)) {
    console.log('[getModNoRiskStatus] MATCHED Modrinth project ID - BLOCKED!');
    return 'blocked';
  }

  // 3. Check version ID (mod_ids) (blocked)
  if (versionId && config.mod_ids?.includes(versionId)) {
    console.log('[getModNoRiskStatus] MATCHED version ID (mod_id) - BLOCKED!');
    return 'blocked';
  }

  // 4. Check filename patterns (they are full regex) (blocked)
  if (config.filename_patterns) {
    for (const pattern of config.filename_patterns) {
      try {
        // The pattern from Flagsmith is already a complete regex.
        const regex = new RegExp(pattern);
        if (regex.test(filename)) {
          console.log('[getModNoRiskStatus] MATCHED filename pattern - BLOCKED!', pattern);
          return 'blocked';
        }
      } catch (e) {
        log('error', `Invalid regex pattern in blocked_mods_config: ${pattern}`);
      }
    }
  }

  // 5. Check Modrinth project ID for warnings (only if not blocked)
  if (modrinthProjectId && config.warning_project_ids?.includes(modrinthProjectId)) {
    console.log('[getModNoRiskStatus] MATCHED Modrinth project ID - WARNING!');
    return 'warning';
  }

  console.log('[getModNoRiskStatus] No match found, returning null');
  return null;
};