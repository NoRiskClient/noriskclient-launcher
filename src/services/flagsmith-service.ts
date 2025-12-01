import flagsmith from 'flagsmith';
import { invoke } from '@tauri-apps/api/core';
import { log } from '../utils/logging-utils';

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
    log('info', 'Initializing Flagsmith service...');
    await flagsmith.init({
      environmentID: FLAGSMITH_ENVIRONMENT_ID,
      api: 'https://flagsmith-staging.norisk.gg/api/v1/',
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