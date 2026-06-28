import { invoke } from "@tauri-apps/api/core";
import type { LauncherConfig, MemorySettings } from "../types/launcherConfig";

/**
 * Fetches the current launcher configuration from the backend.
 * @returns A promise that resolves with the LauncherConfig.
 */
export async function getLauncherConfig(): Promise<LauncherConfig> {
  try {
    const config = await invoke<LauncherConfig>("get_launcher_config");
    console.log("[LauncherConfigService] Fetched config:", config);
    return config;
  } catch (error) {
    console.error("[LauncherConfigService] Failed to get launcher config:", error);
    // Consider re-throwing or returning a default/error state depending on desired error handling
    throw error; 
  }
}

/**
 * Saves the provided launcher configuration to the backend.
 * @param config The LauncherConfig object to save.
 * @returns A promise that resolves with the saved (potentially updated) LauncherConfig.
 */
export async function setLauncherConfig(config: LauncherConfig): Promise<LauncherConfig> {
   try {
    // The backend command `set_launcher_config` likely expects the payload under a specific key,
    // often `config` or `newConfig`. Let's ensure it matches the command definition.
    // Assuming the command expects ` { config: new_config_value } ` based on typical patterns.
    // If it's just `new_config`, then it would be `invoke("set_launcher_config", new_config)`
    const updatedConfig = await invoke<LauncherConfig>("set_launcher_config", {
      config: config, // Ensure this matches the argument name in the Rust command handler
    });
    console.log("[LauncherConfigService] Saved config:", updatedConfig);
    return updatedConfig;
  } catch (error) {
    console.error("[LauncherConfigService] Failed to set launcher config:", error);
    // Consider re-throwing or returning the original config depending on desired error handling
    throw error;
  }
}

/**
 * Fetches the application version from the backend.
 * @returns A promise that resolves with the application version string.
 */
export async function getAppVersion(): Promise<string> {
  try {
    const version = await invoke<string>("get_app_version");
    console.log("[LauncherConfigService] Fetched app version:", version);
    return version;
  } catch (error) {
    console.error("[LauncherConfigService] Failed to get app version:", error);
    throw error;
  }
}

/**
 * Sets the profile grouping preference in the launcher configuration.
 * Fetches the current config, updates the criterion, and saves it back.
 * @param criterion The new grouping criterion string (e.g., "none", "loader").
 * @returns A promise that resolves when the preference is successfully set.
 * @throws If fetching or setting the config fails.
 */
export async function setProfileGroupingPreference(criterion: string): Promise<void> {
  console.log(`[LauncherConfigService] Setting profile grouping preference to: ${criterion}`);
  try {
    const currentConfig = await getLauncherConfig();
    const newConfig: LauncherConfig = {
      ...currentConfig,
      profile_grouping_criterion: criterion === "none" ? null : criterion,
    };
    await setLauncherConfig(newConfig);
    console.log("[LauncherConfigService] Successfully set profile grouping preference.");
  } catch (error) {
    console.error("[LauncherConfigService] Failed to set profile grouping preference:", error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

/**
 * Gets the global memory settings from the launcher configuration.
 * @returns A promise that resolves with the global MemorySettings.
 */
export async function getGlobalMemorySettings(): Promise<MemorySettings> {
  console.log("[LauncherConfigService] Getting global memory settings");
  try {
    const config = await getLauncherConfig();
    console.log("[LauncherConfigService] Retrieved global memory settings:", config.global_memory_settings);
    return config.global_memory_settings;
  } catch (error) {
    console.error("[LauncherConfigService] Failed to get global memory settings:", error);
    throw error;
  }
}

/**
 * Sets the global memory settings in the launcher configuration.
 * Fetches the current config, updates the memory settings, and saves it back.
 * @param memorySettings The new MemorySettings to save.
 * @returns A promise that resolves when the settings are successfully set.
 * @throws If fetching or setting the config fails.
 */
export async function setGlobalMemorySettings(memorySettings: MemorySettings): Promise<void> {
  console.log(`[LauncherConfigService] Setting global memory settings:`, memorySettings);
  try {
    const currentConfig = await getLauncherConfig();
    const newConfig: LauncherConfig = {
      ...currentConfig,
      global_memory_settings: memorySettings,
    };
    await setLauncherConfig(newConfig);
    console.log("[LauncherConfigService] Successfully set global memory settings.");
  } catch (error) {
    console.error("[LauncherConfigService] Failed to set global memory settings:", error);
    throw error;
  }
}

/**
 * Gets the global custom JVM arguments from the launcher configuration.
 * @returns A promise that resolves with the global custom JVM arguments string or null.
 */
export async function getGlobalCustomJvmArgs(): Promise<string | null> {
  console.log("[LauncherConfigService] Getting global custom JVM args");
  try {
    const config = await getLauncherConfig();
    console.log("[LauncherConfigService] Retrieved global custom JVM args:", config.global_custom_jvm_args);
    return config.global_custom_jvm_args;
  } catch (error) {
    console.error("[LauncherConfigService] Failed to get global custom JVM args:", error);
    throw error;
  }
}

/**
 * Sets the global custom JVM arguments in the launcher configuration.
 * @param jvmArgs The new JVM arguments string to save, or null to clear.
 * @returns A promise that resolves when the settings are successfully set.
 * @throws If fetching or setting the config fails.
 */
export async function setGlobalCustomJvmArgs(jvmArgs: string | null): Promise<void> {
  console.log(`[LauncherConfigService] Setting global custom JVM args:`, jvmArgs);
  try {
    const currentConfig = await getLauncherConfig();
    const newConfig: LauncherConfig = {
      ...currentConfig,
      global_custom_jvm_args: jvmArgs,
    };
    await setLauncherConfig(newConfig);
    console.log("[LauncherConfigService] Successfully set global custom JVM args.");
  } catch (error) {
    console.error("[LauncherConfigService] Failed to set global custom JVM args:", error);
    throw error;
  }
}