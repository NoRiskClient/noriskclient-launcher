import { invoke } from "@tauri-apps/api/core";
// Import the actual type with corrected path
import type { ProcessMetadata, CrashlogDto } from "../types/processState";
import type { CrashCheckResult } from "../types/crash-analysis";
import { getLauncherConfig } from "./launcher-config-service";
import { hasPermission } from "./permission-service";
import { PERMISSION } from "../constants/permissions";
import { toast } from "react-hot-toast";
import { logInfo, logWarn } from "../utils/logging-utils";
import i18n from '../i18n/i18n';
import { parseErrorMessage } from "../utils/error-utils";

export async function isMinecraftRunning(profileId: string): Promise<boolean> {
  try {
    const runningProcesses = await getRunningProcesses();
    // Assuming ProcessMetadata has a field like 'profile_id' or 'profileId'
    // Adjust 'proc.profile_id' if the actual field name is different
    const processesForProfile = runningProcesses.filter(proc => proc.profile_id === profileId);
    return processesForProfile.length > 0;
  } catch (error) {
    console.error(`[ProcessService] Error in isMinecraftRunning for profile ${profileId}:`, error);
    return false; // Assume not running on error
  }
}

export async function killMinecraft(profileId: string): Promise<void> {
  return invoke<void>("kill_minecraft", { profileId });
}

export async function launch(
  id: string,
  quickPlaySingleplayer?: string,
  quickPlayMultiplayer?: string,
  migrationInfo?: any,
  skipLastPlayedUpdate?: boolean
): Promise<void> {
  // Guard: If experimental mode is enabled in settings, require backend permission
  try {
    const config = await getLauncherConfig();
    if (config?.is_experimental) {
      logInfo("[ProcessService] Experimental mode is enabled in settings");
      const isAllowed = await hasPermission(PERMISSION.EXPERIMENTAL_MODE);
      logInfo(`[ProcessService] Permission check result: ${isAllowed}`);
      if (!isAllowed) {
        toast.error(i18n.t('settings.disable_experimental'));
        return; // Block launch
      }
    }
  } catch (e) {
    logWarn(
      `[ProcessService] Failed to check experimental permission: ${parseErrorMessage(e)}`,
    );
  }

  return invoke<void>("launch_profile", {
    id,
    quickPlaySingleplayer,
    quickPlayMultiplayer,
    migrationInfo,
    skipLastPlayedUpdate
  });
}

export async function abort(profileId: string): Promise<void> {
  return invoke<void>("abort_profile_launch", { profileId });
}

/**
 * Fetches metadata for all currently tracked processes.
 */
export async function getRunningProcesses(): Promise<ProcessMetadata[]> {
  console.debug("[ProcessService] Fetching running processes");
  try {
    // Assuming the Rust command returns Vec<ProcessMetadata>
    const processes = await invoke<ProcessMetadata[]>("get_processes");
    return processes || []; // Return empty array if null/undefined
  } catch (error) {
    console.error("[ProcessService] Failed to get running processes:", error);
    return []; // Return empty on error
  }
}

/**
 * Stops a specific running process by its ID.
 */
export async function stopProcess(processId: string): Promise<void> {
  console.debug(`[ProcessService] Stopping process: ${processId}`);
  try {
    await invoke<void>("stop_process", { processId });
  } catch (error) {
    console.error(`[ProcessService] Failed to stop process ${processId}:`, error);
    // Re-throw or handle as needed
    throw error; 
  }
}

/**
 * Opens a dedicated log viewer window for the specified process ID.
 */
export async function openLogWindow(processId: string): Promise<void> {
  console.debug(`[ProcessService] Requesting log window for process ID: ${processId}`);
  try {
    // Pass processId (Uuid as string) to the Rust command
    await invoke<void>("open_log_window", { processId });
  } catch (error) {
    console.error(`[ProcessService] Failed to open log window for process ID ${processId}:`, error);
    // Handle or re-throw as appropriate
    throw error; 
  }
}

export async function getProcess(processId: string): Promise<ProcessMetadata | null> {
  try {
    return await invoke<ProcessMetadata | null>("get_process", { processId });
  } catch (error) {
    console.error(`[ProcessService] Failed to get process ${processId}:`, error);
    return null;
  }
}

export interface ProcessLogCursor {
  cursor: number;
  output: string;
  new_file: boolean;
}

export async function getProcessLogCursor(
  sessionId: string,
  cursor: number,
): Promise<ProcessLogCursor> {
  return invoke<ProcessLogCursor>("get_process_log_cursor", { sessionId, cursor });
}

/**
 * Manually fetches the latest crash report for a specific profile and process.
 * @param profileId - The profile UUID (to locate crash-reports folder)
 * @param processId - The process UUID (for event emission, optional)
 * @param processStartTime - The process start time as ISO 8601 string (optional, filters out older crash reports)
 */
export async function fetchCrashReport(profileId: string, processId?: string, processStartTime?: string): Promise<string | null> {
  console.debug(`[ProcessService] Fetching crash report for profile ${profileId}, process ${processId || 'none'}, startTime ${processStartTime || 'none'}`);
  try {
    const crashContent = await invoke<string | null>("fetch_crash_report", {
      profileId,
      processId: processId || null,
      processStartTime: processStartTime || null
    });
    return crashContent || null;
  } catch (error) {
    console.error(`[ProcessService] Failed to fetch crash report:`, error);
    return null;
  }
}

/**
 * Analyzes a crash log via the backend and returns the launcher-facing verdict.
 * The backend reports the crash to staff and returns a CrashCheckResult (see types/crash-analysis).
 */
export async function checkCrashLog(payload: CrashlogDto): Promise<CrashCheckResult> {
  logInfo(`[ProcessService] Checking crash log: ${payload.mcLogsUrl}`);
  return invoke<CrashCheckResult>("check_crash_log_command", { payload });
}
