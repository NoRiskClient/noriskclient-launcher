import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../store/useThemeStore";
import { useFontStore } from "../../store/font-store";
import { useProcessStore } from "../../store/useProcessStore";
import { LogViewerCore } from "./LogViewerCore";
import { LogWindowTitlebar } from "./LogWindowTitlebar";
import { getProcess } from "../../services/process-service";
import { useProcessLogCursor } from "../../hooks/useProcessLogCursor";
import { parseErrorMessage } from "../../utils/error-utils";

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

  const [metadata, setMetadata] = useState<{ instanceId?: string; sessionId: string | null; error: string | null; loading: boolean }>({ sessionId: null, error: null, loading: false });
  const [retryGeneration, setRetryGeneration] = useState(0);

  useEffect(() => {
    if (!instanceId) return;
    let cancelled = false;
    setMetadata(previous => ({ instanceId, sessionId: previous.instanceId === instanceId ? previous.sessionId : null, error: null, loading: true }));
    getProcess(instanceId)
      .then((meta) => {
        if (!cancelled) setMetadata({ instanceId, sessionId: meta?.log_session_id ?? null,
          error: meta ? null : t("logs.instance_not_found"), loading: false });
      })
      .catch(error => {
        if (!cancelled) setMetadata(previous => ({ ...previous, error: t("logs.read_failed", { error: parseErrorMessage(error) }), loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId, retryGeneration, t]);

  const currentMetadata = metadata.instanceId === instanceId ? metadata : null;
  const cursor = useProcessLogCursor(currentMetadata?.sessionId, instanceId);
  const readError = currentMetadata?.error || (cursor.error ? t("logs.read_failed", { error: cursor.error }) : null);

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
    useFontStore.getState().applyFontToDOM();
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
      <LogWindowTitlebar title={[instanceName, accountName].filter(value => value?.trim()).join(" - ") || t("logs.window_title")} />

      <div className="flex-1 flex flex-col min-h-0 p-3">
        <LogViewerCore
          logs={logs}
          selectionIdentity={instanceId}
          onClear={handleClear}
          isLoading={Boolean(instanceId) && (!currentMetadata || currentMetadata.loading || cursor.isLoading)}
          error={readError}
          onRetry={() => currentMetadata?.error ? setRetryGeneration(value => value + 1) : cursor.retry()}
          noLogsIcon="solar:document-text-bold"
          noLogsTitle={t('logs.no_logs_yet')}
          noLogsSubtitle={t('logs.waiting_for_output')}
        />
      </div>
    </div>
  );
}
