import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useProcessStore, ProcessMetrics } from "../store/useProcessStore";
import i18n from '../i18n/i18n';
import { EventType, ProcessMetricsPayload, MinecraftProcessExitedPayload } from "../types/events";
import { ProcessState } from "../types/processState";
import { useLogThrottle } from "./useLogThrottle";

// Launch status events that should be logged
const LAUNCH_STATUS_EVENTS = new Set([
  EventType.InstallingJava,
  EventType.DownloadingLibraries,
  EventType.ExtractingNatives,
  EventType.DownloadingAssets,
  EventType.ReusingMinecraftAssets,
  EventType.CopyingInitialData,
  EventType.CopyingNoRiskClientAssets,
  EventType.DownloadingNoRiskClientAssets,
  EventType.DownloadingClient,
  EventType.InstallingFabric,
  EventType.InstallingQuilt,
  EventType.InstallingForge,
  EventType.InstallingNeoForge,
  EventType.PatchingForge,
  EventType.DownloadingMods,
  EventType.SyncingMods,
  EventType.LaunchingMinecraft,
]);

interface StateEventPayload {
  event_type: string;
  event_id: string;
  target_id: string | null;
  message: string;
  progress: number | null;
  error: string | null;
}

/**
 * Hook to subscribe to Minecraft process events from Tauri backend.
 * Automatically updates the process store with logs and process state changes.
 *
 * @param options.autoFetch - Whether to fetch processes on mount (default: true)
 * @param options.processFilter - Optional filter to only listen to specific process IDs
 */
export function useProcessEvents(options: {
  autoFetch?: boolean;
  processFilter?: string[];
} = {}) {
  const { autoFetch = true, processFilter } = options;

  const {
    fetchProcesses,
    addLogEntry,
    addLogEntriesBatch,
    updateMetrics,
    markProcessStopped,
    addLauncherLog,
    clearLauncherLogs,
    clearLogs,
    processes,
    stoppedProcesses,
  } = useProcessStore();

  // Use throttled log entry to prevent UI lag during heavy log output
  const { throttledAddLog } = useLogThrottle(addLogEntry, addLogEntriesBatch);

  const stateEventListenerRef = useRef<UnlistenFn | null>(null);
  // Track which profiles have received their first MC log (to clear launcher logs)
  const firstMcLogReceived = useRef<Set<string>>(new Set());
  // Track which profiles have started a new launch (to clear old MC logs)
  const launchStartedForProfile = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Fetch initial processes
    if (autoFetch) {
      fetchProcesses();
    }

    let isSubscribed = true;

    const setupListeners = async () => {
      try {
        // Listen to state_event for minecraft output (logs)
        stateEventListenerRef.current = await listen<StateEventPayload>(
          "state_event",
          (event) => {
            if (!isSubscribed) return;

            const payload = event.payload;

            // Handle minecraft output (logs)
            if (payload.event_type === EventType.MinecraftOutput && payload.target_id) {
              // Check filter
              if (processFilter && !processFilter.includes(payload.target_id)) {
                return;
              }

              // Clear launcher logs on first MC log for this profile
              const currentProcesses = useProcessStore.getState().processes;
              const process = currentProcesses.find(p => p.id === payload.target_id);
              if (process && !firstMcLogReceived.current.has(process.profile_id)) {
                firstMcLogReceived.current.add(process.profile_id);
                clearLauncherLogs(process.profile_id);
              }

              // Use throttled version to prevent UI lag during heavy log output
              throttledAddLog(payload.target_id, payload.message);
            }

            // Handle process state updates
            if (payload.event_type === EventType.MinecraftProcessExited && payload.target_id) {
              try {
                // Parse the exit payload to get process metadata
                const exitPayload: MinecraftProcessExitedPayload = JSON.parse(payload.message);

                if (exitPayload.process_metadata) {
                  // Update the state to Stopped or Crashed before storing
                  const updatedMetadata = { ...exitPayload.process_metadata };
                  if (exitPayload.success) {
                    updatedMetadata.state = "Stopped" as ProcessState;
                  } else {
                    updatedMetadata.state = { Crashed: `Exit code: ${exitPayload.exit_code}` } as ProcessState;
                  }

                  // Store in stoppedProcesses for UI retention
                  markProcessStopped(payload.target_id, updatedMetadata);
                }
              } catch (e) {
                console.error("[useProcessEvents] Failed to parse exit payload:", e);
              }

              // Refetch processes to sync with backend
              fetchProcesses();
            }

            // Handle launch successful
            if (payload.event_type === EventType.LaunchSuccessful && payload.target_id) {
              addLauncherLog(payload.target_id, i18n.t('launch.minecraft_started'));
              // Reset tracking for this profile
              firstMcLogReceived.current.delete(payload.target_id);
              launchStartedForProfile.current.delete(payload.target_id);
              // Refetch processes to get the new running process
              fetchProcesses();
            }

            // Handle error events
            if (payload.event_type === EventType.Error && payload.target_id) {
              addLauncherLog(payload.target_id, i18n.t('launch.error', { error: payload.message || i18n.t('common.unknown_error') }));
              // Reset launch tracking on error
              launchStartedForProfile.current.delete(payload.target_id);
            }

            // Handle launch status events (downloading, installing, etc.)
            if (LAUNCH_STATUS_EVENTS.has(payload.event_type as EventType) && payload.target_id && payload.message) {
              const profileId = payload.target_id;

              // On first launch event for this profile, clear old logs
              if (!launchStartedForProfile.current.has(profileId)) {
                launchStartedForProfile.current.add(profileId);

                // Clear old launcher logs
                clearLauncherLogs(profileId);

                // Find and clear MC logs from stopped process with same profile_id
                const currentStoppedProcesses = useProcessStore.getState().stoppedProcesses;
                for (const [processId, stoppedProcess] of currentStoppedProcesses) {
                  if (stoppedProcess.profile_id === profileId) {
                    clearLogs(processId);
                  }
                }
              }

              addLauncherLog(profileId, payload.message);
            }

            // Handle process metrics update
            if (payload.event_type === EventType.ProcessMetricsUpdate && payload.target_id) {
              try {
                const metricsData: ProcessMetricsPayload = JSON.parse(payload.message);
                const metrics: ProcessMetrics = {
                  processId: metricsData.process_id,
                  memoryBytes: metricsData.memory_bytes,
                  cpuPercent: metricsData.cpu_percent,
                  timestamp: new Date(metricsData.timestamp),
                };
                updateMetrics(payload.target_id, metrics);
              } catch (e) {
                console.error("[useProcessEvents] Failed to parse metrics payload:", e);
              }
            }
          }
        );

        console.log("[useProcessEvents] Listening for state_event");
      } catch (err) {
        console.error("[useProcessEvents] Failed to set up event listeners:", err);
      }
    };

    setupListeners();

    // Cleanup
    return () => {
      isSubscribed = false;

      if (stateEventListenerRef.current) {
        stateEventListenerRef.current();
        stateEventListenerRef.current = null;
      }

      console.log("[useProcessEvents] Cleaned up event listeners");
    };
  }, [autoFetch, processFilter, fetchProcesses, throttledAddLog, updateMetrics, markProcessStopped, addLauncherLog, clearLauncherLogs, clearLogs]);

  // Return store state and actions for convenience
  return useProcessStore();
}

/**
 * Hook to get logs for a specific process from the store.
 * NOTE: This hook only READS from the store. Use useProcessEvents to subscribe to log events.
 */
export function useProcessLogs(processId: string | null) {
  const { getLogsForProcess, logs } = useProcessStore();

  return {
    logs: processId ? getLogsForProcess(processId) : [],
    allLogs: logs,
  };
}
