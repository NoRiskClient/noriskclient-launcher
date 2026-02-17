import { invoke } from '@tauri-apps/api/core';
import type { BlogPost } from '../types/wordPress';
import type { UpdateInfo } from '../types/updater';
import type { Profile } from '../types/profile';
import type { AdventCalendarDay, Reward } from '../types/advent';
import type { UserNotification } from '../types/notification';
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
 * @returns A promise that resolves with the standard profiles.
 * @throws If the backend command fails.
 */
export const refreshStandardVersions = (): Promise<Profile[]> => {
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
      const standardProfiles = await refreshStandardVersions();
      console.log("Standard Versions updated successfully on mount!");
      // Store the standard profiles in the profile store
      useProfileStore.setState({ standardProfiles });
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
 * Initiates the GitHub account linking process.
 *
 * @returns A promise that resolves when the command is successfully sent.
 * @throws If the backend command fails.
 */
export const githubAuthLink = (): Promise<void> => {
  return invoke('github_auth_link');
};

/**
 * Checks the GitHub account linking status.
 *
 * @returns A promise that resolves to a boolean indicating if a GitHub account is linked.
 * @throws If the backend command fails.
 */
export const githubAuthStatus = (): Promise<boolean> => {
  return invoke('github_auth_status');
};

/**
 * Unlinks the currently linked GitHub account.
 *
 * @returns A promise that resolves when the unlinking process is successful.
 * @throws If the backend command fails.
 */
export const githubAuthUnlink = (): Promise<void> => {
  return invoke('github_auth_unlink');
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

/**
 * Checks if an application update is available.
 * Uses the beta channel setting from the launcher configuration.
 *
 * @returns A promise that resolves to UpdateInfo if an update is available, or null if up to date.
 * @throws If the backend command fails.
 */
export const checkUpdateAvailable = (): Promise<UpdateInfo | null> => {
  return invoke('check_update_available_command');
};

/**
 * Downloads and installs an available application update.
 * Uses the beta channel setting from the launcher configuration.
 * The application will restart automatically after successful installation.
 *
 * @returns A promise that resolves when the update process is complete.
 * @throws If the backend command fails or no update is available.
 */
export const downloadAndInstallUpdate = (): Promise<void> => {
  return invoke('download_and_install_update_command');
};

/**
 * Fetches the advent calendar data from the backend.
 *
 * @returns A promise that resolves to an array of AdventCalendarDay objects.
 * @throws If the backend command fails.
 */
export const getAdventCalendar = (): Promise<AdventCalendarDay[]> => {
  return invoke('get_advent_calendar_command');
};

/**
 * Claims a reward for a specific day in the advent calendar.
 *
 * @param tag The day number (1-24) to claim.
 * @returns A promise that resolves to the claimed AdventCalendarDay.
 * @throws If the backend command fails.
 */
export const claimAdventCalendarDay = (tag: number): Promise<AdventCalendarDay> => {
  return invoke('claim_advent_calendar_day_command', { tag });
};

/**
 * Fetches all notifications for the current user.
 *
 * @returns A promise that resolves to an array of UserNotification objects.
 * @throws If the backend command fails.
 */
export const getNotifications = (): Promise<UserNotification[]> => {
  return invoke('get_notifications');
};

/**
 * Marks all notifications as read.
 *
 * @returns A promise that resolves when all notifications are marked as read.
 * @throws If the backend command fails.
 */
export const markAllNotificationsRead = (): Promise<void> => {
  return invoke('mark_all_notifications_read');
};

/**
 * Marks a specific notification as read.
 *
 * @param notificationId The ID of the notification to mark as read.
 * @returns A promise that resolves when the notification is marked as read.
 * @throws If the backend command fails.
 */
export const markNotificationRead = (notificationId: string): Promise<void> => {
  return invoke('mark_notification_read', { notificationId });
};

/**
 * Dumps the in-memory debug log ring buffer to a debug file and returns the file path.
 */
export const dumpDebugLogs = (reason?: string): Promise<string> => {
  return invoke('dump_debug_logs_command', { reason });
};


// Re-export logging utilities for backward compatibility
export { log as logMessage, logDebug as logMessageDebug, logInfo as logMessageInfo, logWarn as logMessageWarn, logError as logMessageError } from '../utils/logging-utils';