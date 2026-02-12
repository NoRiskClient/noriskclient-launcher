import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";
import { LogWindowTitlebar } from "./LogWindowTitlebar";
import { InstanceSidebar } from "./InstanceSidebar";
import { LogViewerCore } from "./LogViewerCore";
import { useProcessEvents, useProcessLogs } from "../../hooks/useProcessEvents";
import { useProcessStore } from "../../store/useProcessStore";
import { getLogContentForProcess } from "../../services/process-service";
import { getProfileLatestLogContent } from "../../services/profile-service";
import type { ProcessMetadata } from "../../types/processState";

interface MinecraftLogWindowProps {
  crashedProcess?: ProcessMetadata;
}

export function MinecraftLogWindow({ crashedProcess }: MinecraftLogWindowProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  // Subscribe to process events
  const { processes } = useProcessEvents({ autoFetch: true });

  // Get logs for selected process
  const { logs: rawLogs } = useProcessLogs(selectedInstanceId);

  // Get stopped processes, launcher logs, and selectedProcessId from store for sync
  const {
    stoppedProcesses,
    launcherLogs: launcherLogsMap,
    selectedProcessId,
    selectProcess,
    clearLogs,
    clearLauncherLogs,
    loadLogsFromContent,
    hasLogsForProcess,
    markProcessStopped
  } = useProcessStore();

  // Handle crashed process passed via URL - add to store and select it
  const crashedProcessHandledRef = useRef(false);
  useEffect(() => {
    if (crashedProcess && !crashedProcessHandledRef.current) {
      crashedProcessHandledRef.current = true;
      console.log("[MinecraftLogWindow] Adding crashed process to store:", crashedProcess.id);
      markProcessStopped(crashedProcess.id, crashedProcess);
      setSelectedInstanceId(crashedProcess.id);
    }
  }, [crashedProcess, markProcessStopped]);

  // Apply theme on mount
  useEffect(() => {
    const themeStore = useThemeStore.getState();
    themeStore.applyAccentColorToDOM();
    themeStore.applyBorderRadiusToDOM();
  }, []);

  // Sync with store selection
  useEffect(() => {
    if (selectedProcessId && selectedProcessId !== selectedInstanceId) {
      setSelectedInstanceId(selectedProcessId);
    }
  }, [selectedProcessId, selectedInstanceId]);

  // Auto-select first process if none selected
  useEffect(() => {
    if (!selectedInstanceId && processes.length > 0) {
      const runningProcess = processes.find(p => p.state === "Running");
      if (runningProcess) {
        setSelectedInstanceId(runningProcess.id);
      } else {
        setSelectedInstanceId(processes[0].id);
      }
    }
  }, [processes, selectedInstanceId]);

  // Find the profile ID and start time for the selected instance
  const { selectedProfileId, selectedStartTime } = useMemo(() => {
    if (!selectedInstanceId) return { selectedProfileId: null, selectedStartTime: null };
    const runningProcess = processes.find(p => p.id === selectedInstanceId);
    if (runningProcess) {
      return {
        selectedProfileId: runningProcess.profile_id,
        selectedStartTime: new Date(runningProcess.start_time).getTime()
      };
    }
    const stoppedProcess = stoppedProcesses.get(selectedInstanceId);
    if (stoppedProcess) {
      return {
        selectedProfileId: stoppedProcess.profile_id,
        selectedStartTime: new Date(stoppedProcess.start_time).getTime()
      };
    }
    return { selectedProfileId: null, selectedStartTime: null };
  }, [selectedInstanceId, processes, stoppedProcesses]);

  // Get launcher logs for the selected profile
  const launcherLogs = useMemo(() => {
    if (!selectedProfileId) return [];
    return launcherLogsMap.get(selectedProfileId) || [];
  }, [selectedProfileId, launcherLogsMap]);

  // Track if we're currently fetching logs
  const isFetchingLogsRef = useRef<string | null>(null);

  // Fetch logs from backend if store is empty
  useEffect(() => {
    if (!selectedInstanceId || !selectedProfileId) return;
    if (hasLogsForProcess(selectedInstanceId)) return;
    if (isFetchingLogsRef.current === selectedInstanceId) return;

    const fetchLogs = async () => {
      isFetchingLogsRef.current = selectedInstanceId;

      try {
        // Always try to get current process logs first
        let logContent = await getLogContentForProcess(selectedInstanceId);

        // Only fall back to latest.log if process is older than 5 seconds
        // This prevents loading OLD logs from a previous session for newly started processes
        if (!logContent || logContent.trim() === "") {
          const isRecentProcess = selectedStartTime && (Date.now() - selectedStartTime) < 5000;
          if (!isRecentProcess) {
            logContent = await getProfileLatestLogContent(selectedProfileId);
          }
        }

        if (logContent && logContent.trim() !== "") {
          loadLogsFromContent(selectedInstanceId, logContent);
        }
      } catch (error) {
        console.error("[MinecraftLogWindow] Failed to fetch logs:", error);
      } finally {
        isFetchingLogsRef.current = null;
      }
    };

    fetchLogs();
  }, [selectedInstanceId, selectedProfileId, selectedStartTime, hasLogsForProcess, loadLogsFromContent]);

  // Combine logs: show MC logs if available, otherwise show launcher logs
  const displayLogs = useMemo(() => {
    if (rawLogs.length > 0) {
      return rawLogs;
    }
    return launcherLogs;
  }, [rawLogs, launcherLogs]);

  const handleClear = () => {
    if (!selectedInstanceId) return;
    clearLogs(selectedInstanceId);
    if (selectedProfileId) {
      clearLauncherLogs(selectedProfileId);
    }
  };

  // Handle instance selection
  const handleSelectInstance = useCallback((id: string) => {
    setSelectedInstanceId(id);
    selectProcess(id);
  }, [selectProcess]);

  return (
    <div
      className="h-screen flex flex-col"
      style={{
        background: `linear-gradient(135deg, ${accentColor.value}20 0%, ${accentColor.value}10 50%, ${accentColor.value}18 100%)`,
      }}
    >
      {/* Custom Titlebar */}
      <LogWindowTitlebar />

      {/* Main Content */}
      <div className="flex-1 flex min-h-0 p-3 gap-3">
        {/* Log Viewer (Left - 70%) */}
        <div className="flex-[7] flex flex-col min-w-0">
          {!selectedInstanceId ? (
            <div className="flex-1 flex items-center justify-center rounded-lg bg-black/60 backdrop-blur-sm text-white/30">
              <div className="text-center">
                <Icon icon="solar:monitor-smartphone-bold" className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="font-minecraft-ten">{t('logs.select_instance')}</p>
                <p className="text-xs mt-1 font-sans">{t('logs.select_instance_hint')}</p>
              </div>
            </div>
          ) : (
            <LogViewerCore
              logs={displayLogs}
              onClear={handleClear}
              noLogsIcon="solar:document-text-bold"
              noLogsTitle={t('logs.no_logs_yet')}
              noLogsSubtitle={t('logs.waiting_for_output')}
            />
          )}
        </div>

        {/* Instance Sidebar (Right - 30%) */}
        <div className="flex-[3] min-w-[280px] max-w-[350px]">
          <InstanceSidebar
            selectedInstanceId={selectedInstanceId || undefined}
            onSelectInstance={handleSelectInstance}
          />
        </div>
      </div>
    </div>
  );
}
