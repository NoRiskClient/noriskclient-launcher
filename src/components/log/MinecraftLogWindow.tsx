import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";
import { LogWindowTitlebar } from "./LogWindowTitlebar";
import { InstanceSidebar } from "./InstanceSidebar";
import { LogViewerCore } from "./LogViewerCore";
import { useProcessEvents, useProcessLogs } from "../../hooks/useProcessEvents";
import { useProcessLogCursor } from "../../hooks/useProcessLogCursor";
import { useProcessStore } from "../../store/useProcessStore";
import type { ProcessMetadata } from "../../types/processState";

interface MinecraftLogWindowProps {
  crashedProcess?: ProcessMetadata;
}

export function MinecraftLogWindow({ crashedProcess }: MinecraftLogWindowProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  const { processes } = useProcessEvents({ autoFetch: true });
  const { logs: rawLogs } = useProcessLogs(selectedInstanceId);

  const {
    stoppedProcesses,
    launcherLogs: launcherLogsMap,
    selectedProcessId,
    selectProcess,
    clearLogs,
    clearLauncherLogs,
    markProcessStopped,
  } = useProcessStore();

  const crashedProcessHandledRef = useRef(false);
  useEffect(() => {
    if (crashedProcess && !crashedProcessHandledRef.current) {
      crashedProcessHandledRef.current = true;
      markProcessStopped(crashedProcess.id, crashedProcess);
      setSelectedInstanceId(crashedProcess.id);
    }
  }, [crashedProcess, markProcessStopped]);

  useEffect(() => {
    const themeStore = useThemeStore.getState();
    themeStore.applyAccentColorToDOM();
    themeStore.applyBorderRadiusToDOM();
  }, []);

  useEffect(() => {
    if (selectedProcessId && selectedProcessId !== selectedInstanceId) {
      setSelectedInstanceId(selectedProcessId);
    }
  }, [selectedProcessId, selectedInstanceId]);

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

  const { selectedProfileId, selectedSessionId } = useMemo(() => {
    if (!selectedInstanceId) return { selectedProfileId: null, selectedSessionId: null };
    const runningProcess = processes.find(p => p.id === selectedInstanceId);
    if (runningProcess) {
      return {
        selectedProfileId: runningProcess.profile_id,
        selectedSessionId: runningProcess.log_session_id ?? null,
      };
    }
    const stoppedProcess = stoppedProcesses.get(selectedInstanceId);
    if (stoppedProcess) {
      return {
        selectedProfileId: stoppedProcess.profile_id,
        selectedSessionId: stoppedProcess.log_session_id ?? null,
      };
    }
    return { selectedProfileId: null, selectedSessionId: null };
  }, [selectedInstanceId, processes, stoppedProcesses]);

  useProcessLogCursor(selectedSessionId, selectedInstanceId);

  const launcherLogs = useMemo(() => {
    if (!selectedProfileId) return [];
    return launcherLogsMap.get(selectedProfileId) || [];
  }, [selectedProfileId, launcherLogsMap]);

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
      <LogWindowTitlebar />

      <div className="flex-1 flex min-h-0 p-3 gap-3">
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
