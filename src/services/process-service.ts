import { invoke } from "@tauri-apps/api/core";
// Import the actual type with corrected path
import type { ProcessMetadata, CrashlogDto } from "../types/processState";
import { getLauncherConfig } from "./launcher-config-service";
import flagsmith from "flagsmith";
import { toast } from "react-hot-toast";
import { logInfo, logWarn } from "../utils/logging-utils";

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
  quickPlayMultiplayer?: string
): Promise<void> {
  // Guard: If experimental mode is enabled in settings, require feature flag to be enabled
  try {
    const config = await getLauncherConfig();
    if (config?.is_experimental) {
      logInfo("[ProcessService] Experimental mode is enabled in settings");
      const isAllowed = flagsmith.hasFeature("show_experimental_mode", { fallback: false });
      logInfo(`[ProcessService] Feature flag check result: ${isAllowed}`);
      if (!isAllowed) {
        toast.error("Please disable experimental mode in Settings.");
        return; // Block launch
      }
    }
  } catch (e) {
    logWarn(
      `[ProcessService] Failed to check experimental mode flag: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return invoke<void>("launch_profile", { 
    id, 
    quickPlaySingleplayer, 
    quickPlayMultiplayer 
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

/**
 * Fetches the full log content for a specific process ID (Uuid).
 */
export async function getLogContentForProcess(processId: string): Promise<string> {
  console.debug(`[ProcessService] Fetching full log for process ID: ${processId}`);
  try {
    const logContent = await invoke<string>("get_full_log", { processId });
    return logContent || ""; // Return empty string if null/undefined
  } catch (error) {
    console.error(`[ProcessService] Failed to get full log for process ID ${processId}:`, error);
    // Return an empty string or re-throw based on how errors should be handled downstream
    return ""; 
    // throw error; 
  }
}

/**
 * Submits a crash log to the backend.
 */
export async function submitCrashLog(payload: CrashlogDto): Promise<void> {
  console.debug("[ProcessService] Submitting crash log:", payload);
  try {
    await invoke<void>("submit_crash_log_command", { payload });
    console.log("[ProcessService] Crash log submitted successfully.");
  } catch (error) {
    console.error("[ProcessService] Failed to submit crash log:", error);
    throw error; // Re-throw or handle as needed
  }
}
