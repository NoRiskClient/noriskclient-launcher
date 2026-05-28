import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../store/useThemeStore";
import { useProcessStore } from "../../store/useProcessStore";
import { LogViewerCore } from "./LogViewerCore";
import { LogWindowTitlebar } from "./LogWindowTitlebar";
import { getProcess } from "../../services/process-service";
import { useProcessLogCursor } from "../../hooks/useProcessLogCursor";

interface SingleLogViewerProps {
  instanceId?: string;
  instanceName?: string;
  profileId?: string;
  accountName?: string;
  startTime?: number;
}

export function SingleLogViewer({ instanceId, instanceName, profileId, accountName }: SingleLogViewerProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);

  const logsMap = useProcessStore((state) => state.logs);
  const launcherLogsMap = useProcessStore((state) => state.launcherLogs);
  const clearLogs = useProcessStore((state) => state.clearLogs);
  const clearLauncherLogs = useProcessStore((state) => state.clearLauncherLogs);

  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!instanceId) return;
    let cancelled = false;
    getProcess(instanceId)
      .then((meta) => {
        if (!cancelled) setSessionId(meta?.log_session_id ?? null);
      })
      .catch(() => {
        if (!cancelled) setSessionId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  useProcessLogCursor(sessionId, instanceId);

  const mcLogs = instanceId ? (logsMap.get(instanceId) || []) : [];

  const launcherLogs = useMemo(() => {
    if (!profileId) return [];
    return launcherLogsMap.get(profileId) || [];
  }, [profileId, launcherLogsMap]);

  const logs = mcLogs.length > 0 ? mcLogs : launcherLogs;

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
      <LogWindowTitlebar title={accountName ? `${instanceName} - ${accountName}` : (instanceName || "Logs")} />

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
