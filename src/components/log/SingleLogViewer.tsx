import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useThemeStore } from "../../store/useThemeStore";
import { useProcessStore } from "../../store/useProcessStore";
import { LogViewerCore } from "./LogViewerCore";
import { LogWindowTitlebar } from "./LogWindowTitlebar";
import { EventType } from "../../types/events";
import { getLogContentForProcess } from "../../services/process-service";
import { getProfileLatestLogContent } from "../../services/profile-service";

interface SingleLogViewerProps {
  instanceId?: string;
  instanceName?: string;
  profileId?: string;
  accountName?: string;
  startTime?: number;
}

export function SingleLogViewer({ instanceId, instanceName, profileId, accountName, startTime }: SingleLogViewerProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);

  // Get data from store
  const logsMap = useProcessStore((state) => state.logs);
  const launcherLogsMap = useProcessStore((state) => state.launcherLogs);
  const clearLogs = useProcessStore((state) => state.clearLogs);
  const clearLauncherLogs = useProcessStore((state) => state.clearLauncherLogs);
  const loadLogsFromContent = useProcessStore((state) => state.loadLogsFromContent);
  const hasLogsForProcess = useProcessStore((state) => state.hasLogsForProcess);

  // Get MC logs for this instance
  const mcLogs = instanceId ? (logsMap.get(instanceId) || []) : [];

  // Get launcher logs for the profile
  const launcherLogs = useMemo(() => {
    if (!profileId) return [];
    return launcherLogsMap.get(profileId) || [];
  }, [profileId, launcherLogsMap]);

  // Combined logs: MC logs if available, otherwise launcher logs
  const logs = mcLogs.length > 0 ? mcLogs : launcherLogs;

  // Track if we're currently fetching logs
  const isFetchingLogsRef = useRef<string | null>(null);

  // Fetch logs from backend if store is empty
  useEffect(() => {
    if (!instanceId || !profileId) return;
    if (hasLogsForProcess(instanceId)) return;
    if (isFetchingLogsRef.current === instanceId) return;

    const fetchLogs = async () => {
      isFetchingLogsRef.current = instanceId;

      try {
        // Always try to get current process logs first
        let logContent = await getLogContentForProcess(instanceId);

        // Only fall back to latest.log if process is older than 5 seconds
        // This prevents loading OLD logs from a previous session for newly started processes
        if (!logContent || logContent.trim() === "") {
          const isRecentProcess = startTime && (Date.now() - startTime) < 5000;
          if (!isRecentProcess) {
            logContent = await getProfileLatestLogContent(profileId);
          }
        }

        if (logContent && logContent.trim() !== "") {
          loadLogsFromContent(instanceId, logContent);
        }
      } catch (error) {
        console.error("[SingleLogViewer] Failed to fetch logs:", error);
      } finally {
        isFetchingLogsRef.current = null;
      }
    };

    fetchLogs();
  }, [instanceId, profileId, startTime, hasLogsForProcess, loadLogsFromContent]);

  // Get addLogEntry from store for live updates
  const addLogEntry = useProcessStore((state) => state.addLogEntry);

  // Listen for live log events for this instance
  useEffect(() => {
    if (!instanceId) return;

    let unlisten: UnlistenFn | null = null;
    let isCancelled = false;

    const setupListener = async () => {
      const unlistenFn = await listen<{
        event_type: string;
        target_id: string | null;
        message: string;
      }>("state_event", (event) => {
        // Don't process if effect was cleaned up
        if (isCancelled) return;

        const payload = event.payload;

        // Only handle MinecraftOutput events for this instance
        if (
          payload.event_type === EventType.MinecraftOutput &&
          payload.target_id === instanceId
        ) {
          addLogEntry(instanceId, payload.message);
        }
      });

      // If effect was cleaned up before listener was ready, clean up immediately
      if (isCancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    };

    setupListener();

    return () => {
      isCancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [instanceId, addLogEntry]);

  // Apply theme on mount
  useEffect(() => {
    const themeStore = useThemeStore.getState();
    themeStore.applyAccentColorToDOM();
    themeStore.applyBorderRadiusToDOM();
  }, []);

  const handleClear = () => {
    if (instanceId) {
      clearLogs(instanceId);
    }
    if (profileId) {
      clearLauncherLogs(profileId);
    }
  };

  return (
    <div
      className="h-screen flex flex-col"
      style={{
        background: `linear-gradient(135deg, ${accentColor.value}20 0%, ${accentColor.value}10 50%, ${accentColor.value}18 100%)`,
      }}
    >
      {/* Titlebar - shared component */}
      <LogWindowTitlebar title={accountName ? `${instanceName} - ${accountName}` : (instanceName || "Logs")} />

      {/* Main Content - shared LogViewerCore */}
      <div className="flex-1 flex flex-col min-h-0 p-3">
        <LogViewerCore
          logs={logs}
          onClear={handleClear}
          noLogsIcon="solar:document-text-bold"
          noLogsTitle={t('logs.no_logs_yet')}
          noLogsSubtitle={t('logs.waiting_for_output')}
        />
      </div>
    </div>
  );
}
