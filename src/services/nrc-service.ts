import { invoke } from '@tauri-apps/api/core';
import type { BlogPost } from '../types/wordPress';
import { useProfileStore } from '../store/profile-store';
import { getBlockedModsConfig } from './flagsmith-service';

/**
 * Fetches the latest news and changelog posts from the backend.
 *
 * @returns A promise that resolves to an array of BlogPost objects.
 * @throws If the backend command fails.
 */
export const fetchNewsAndChangelogs = (): Promise<BlogPost[]> => {
  // Directly invoke and return the promise. Errors will propagate to the caller.
  return invoke('get_news_and_changelogs_command');
};

/**
 * Triggers a refresh of the Norisk packs configuration from the backend.
 *
 * @returns A promise that resolves when the refresh is complete.
 * @throws If the backend command fails.
 */
export const refreshNoriskPacks = (): Promise<void> => {
  return invoke('refresh_norisk_packs');
};

/**
 * Triggers a refresh of the standard versions configuration from the backend.
 *
 * @returns A promise that resolves when the refresh is complete.
 * @throws If the backend command fails.
 */
export const refreshStandardVersions = (): Promise<void> => {
  return invoke('refresh_standard_versions');
};

/**
 * Refreshes both Norisk packs and standard versions configurations.
 * Logs success or errors to the console.
 */
export const refreshNrcDataOnMount = async (): Promise<void> => {
  // Direkt setState verwenden, um den Ladezustand zu Beginn zu setzen
  useProfileStore.setState({ loading: true, error: null });

  // Introduce a 5-second delay for testing
  //console.log("[TEST] Starting 5-second delay in refreshNrcDataOnMount...");
  //await new Promise(resolve => setTimeout(resolve, 5000));
  //console.log("[TEST] 5-second delay finished.");

  try {
    let nrcPacksSuccess = false;
    let standardVersionsSuccess = false;

    // Fire and forget: Load blocked mods config from Flagsmith
    getBlockedModsConfig()
      .then((config) => {
        console.log("Blocked mods config loaded successfully:", config);
      })
      .catch((error) => {
        console.error("Failed to load blocked mods config:", error);
      });

    try {
      await refreshNoriskPacks();
      console.log("Norisk Packs updated successfully on mount!");
      nrcPacksSuccess = true;
    } catch (error) {
      console.error("Failed to refresh Norisk Packs on mount:", error);
    }

    try {
      await refreshStandardVersions();
      console.log("Standard Versions updated successfully on mount!");
      standardVersionsSuccess = true;
    } catch (error) {
      console.error("Failed to refresh Standard Versions on mount:", error);
    }

    // Fetch profiles from the store after NRC data is refreshed
    // This ensures the profile list (including standard versions) and last played are up-to-date.
    if (nrcPacksSuccess || standardVersionsSuccess) { // Or simply always call it if appropriate
      try {
        console.log("Refreshing profiles state after NRC data update...");
        await useProfileStore.getState().fetchProfiles();
        console.log("Profiles state refreshed successfully.");
        // fetchProfiles setzt loading: false bei Erfolg oder Fehler
      } catch (error) {
        console.error("Failed to refresh profiles state after NRC data update:", error);
        // fetchProfiles sollte seinen eigenen Ladezustand und Fehler behandeln.
        // Wenn fetchProfiles hier einen Fehler wirft, wird er vom äußeren Catch behandelt.
      }
    }
  } catch (error) {
    // Dieser Catch fängt Fehler von refreshNoriskPacks, refreshStandardVersions
    // oder wenn fetchProfiles selbst einen Fehler wirft, der nicht intern zu loading:false führt.
    console.error("Error during NRC data refresh or profile fetching process:", error);
    useProfileStore.setState({
      error: "Failed to initialize or refresh app data.",
      loading: false, // Sicherstellen, dass der Ladezustand beendet wird
    });
  }
  // Kein expliziter finally-Block hier nötig, um loading auf false zu setzen,
  // da dies entweder durch fetchProfiles() oder den catch-Block oben abgedeckt wird.
};

/**
 * Initiates the Discord account linking process.
 *
 * @returns A promise that resolves when the command is successfully sent.
 * @throws If the backend command fails.
 */
export const discordAuthLink = (): Promise<void> => {
  return invoke('discord_auth_link');
};

/**
 * Checks the Discord account linking status.
 *
 * @returns A promise that resolves to a boolean indicating if a Discord account is linked.
 * @throws If the backend command fails.
 */
export const discordAuthStatus = (): Promise<boolean> => {
  return invoke('discord_auth_status');
};

/**
 * Unlinks the currently linked Discord account.
 *
 * @returns A promise that resolves when the unlinking process is successful.
 * @throws If the backend command fails.
 */
export const discordAuthUnlink = (): Promise<void> => {
  return invoke('discord_auth_unlink');
};

/**
 * Gets the mobile app token for NoRisk mobile app linking.
 *
 * @returns A promise that resolves to the mobile app token string.
 * @throws If the backend command fails.
 */
export const getMobileAppToken = (): Promise<string> => {
  return invoke('get_mobile_app_token');
};

/**
 * Resets the mobile app token for NoRisk mobile app linking.
 *
 * @returns A promise that resolves to the new mobile app token string.
 * @throws If the backend command fails.
 */
export const resetMobileAppToken = (): Promise<string> => {
  return invoke('reset_mobile_app_token');
};

// Re-export logging utilities for backward compatibility
export { log as logMessage, logDebug as logMessageDebug, logInfo as logMessageInfo, logWarn as logMessageWarn, logError as logMessageError } from '../utils/logging-utils';