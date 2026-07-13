import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "react-hot-toast";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from "react-i18next";
import {
  listLauncherLogs,
  listCrashReports,
  listAllMcLogs,
  listProcessLogs,
  getLogFileContent,
  uploadLogToMclogs,
  type FileInfo,
} from "../../services/log-service";
import {
  getCachedPermissions,
  refreshPermissions,
  type PermissionCacheState,
} from "../../services/permission-service";
import {
  fetchTesterQueueCount,
  openTesterWindow,
} from "../../services/tester-service";
import {
  listProfileBackups,
  restoreProfileBackup,
  type ProfileBackupInfo,
} from "../../services/profile-service";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useProfileStore } from "../../store/profile-store";
import { SettingsSection } from "../ui/settings/SettingsSection";

export type DebugTab = "launcher" | "minecraft" | "process" | "crashes" | "permissions" | "testing";

export function getDebugTabs(t: (key: string) => string): { id: DebugTab; label: string }[] {
  return [
    { id: "launcher", label: t("debug.tabs.launcher") },
    { id: "minecraft", label: t("debug.tabs.minecraft") },
    { id: "process", label: t("debug.tabs.process") },
    { id: "crashes", label: t("debug.tabs.crashes") },
    { id: "permissions", label: t("debug.permissions.tab") },
    { id: "testing", label: t("debug.tabs.testing") },
  ];
}

function getErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return (e as { message: string }).message;
  }
  return String(e);
}

const formatSize = (bytes: number) => {
  if (bytes === 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (timestamp: number) => {
  if (timestamp === 0) return "-";
  return new Date(timestamp * 1000).toLocaleString();
};

interface LogFileSectionProps {
  id: DebugTab;
  title: string;
  icon: string;
  crash?: boolean;
  loader: () => Promise<FileInfo[]>;
}

function LogFileSection({ id, title, icon, crash, loader }: LogFileSectionProps) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const f = await loader();
        if (!cancelled) setFiles(f);
      } catch (e) {
        console.error("Failed to load files:", e);
        if (!cancelled) setFiles([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(file: FileInfo) {
    setUploadingFile(file.path);
    try {
      const content = await getLogFileContent(file.path);
      const url = await uploadLogToMclogs(content);
      await writeText(url);
      toast.success(t("debug.uploaded_copied"));
    } catch (e) {
      console.error("Failed to upload:", e);
      toast.error(t("debug.upload_failed", { error: getErrorMessage(e) }));
    }
    setUploadingFile(null);
  }

  async function handleCopyContent(file: FileInfo) {
    try {
      const content = await getLogFileContent(file.path);
      await writeText(content);
      toast.success(t("debug.copied"));
    } catch (e) {
      console.error("Failed to copy:", e);
      toast.error(t("debug.copy_failed", { error: getErrorMessage(e) }));
    }
  }

  return (
    <SettingsSection id={`settings-section-${id}`} title={title} icon={icon}>
      <div className="py-2">
        <div className="bg-black/20 rounded-lg border border-white/10 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-white/50">
              <Icon icon="svg-spinners:ring-resize" className="w-6 h-6 mx-auto mb-2" />
              {t("common.loading")}
            </div>
          ) : files.length === 0 ? (
            <div className="p-8 text-center text-white/50 font-minecraft">{t("debug.no_files")}</div>
          ) : (
            <div className="divide-y divide-white/10">
              {files.map((file, i) => (
                <div key={i} className="p-3 hover:bg-white/5 flex items-center gap-4">
                  <Icon
                    icon={crash ? "solar:danger-triangle-bold" : "solar:document-text-bold"}
                    className={`w-5 h-5 flex-shrink-0 ${crash ? "text-red-400" : "text-white/60"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-minecraft truncate">{file.name}</div>
                    <div className="text-xs text-white/40 font-sans truncate">{file.path}</div>
                  </div>
                  <div className="text-sm text-white/50 font-sans whitespace-nowrap">
                    {formatSize(file.size)}
                  </div>
                  <div className="text-sm text-white/50 font-sans whitespace-nowrap hidden lg:block">
                    {formatDate(file.modified)}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopyContent(file)}
                      className="p-2 rounded-md bg-white/10 hover:bg-white/20 transition-colors"
                      title={t("debug.copy_content")}
                    >
                      <Icon icon="solar:copy-bold" className="w-4 h-4 text-white/70" />
                    </button>
                    <button
                      onClick={() => handleUpload(file)}
                      disabled={uploadingFile === file.path}
                      className="p-2 rounded-md bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
                      title={t("debug.upload_mclogs")}
                    >
                      {uploadingFile === file.path ? (
                        <Icon icon="svg-spinners:ring-resize" className="w-4 h-4 text-white/70" />
                      ) : (
                        <Icon icon="solar:upload-bold" className="w-4 h-4 text-white/70" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

export function DebugSection() {
  const { t } = useTranslation();
  const [permissions, setPermissions] = useState<PermissionCacheState | null>(null);
  const [refreshingPerms, setRefreshingPerms] = useState(false);

  useEffect(() => {
    getCachedPermissions().then(setPermissions).catch(() => setPermissions(null));
  }, []);

  async function handleRefreshPermissions() {
    setRefreshingPerms(true);
    try {
      await refreshPermissions();
      const cached = await getCachedPermissions();
      setPermissions(cached);
      toast.success(t("debug.permissions.refreshed"));
    } catch (e) {
      console.error("Failed to refresh permissions:", e);
      toast.error(t("debug.permissions.refresh_failed", { error: getErrorMessage(e) }));
    }
    setRefreshingPerms(false);
  }

  return (
    <div className="space-y-6">
      <LogFileSection id="launcher" title={t("debug.tabs.launcher")} icon="solar:document-text-bold" loader={listLauncherLogs} />
      <LogFileSection id="minecraft" title={t("debug.tabs.minecraft")} icon="solar:document-text-bold" loader={listAllMcLogs} />
      <LogFileSection id="process" title={t("debug.tabs.process")} icon="solar:document-text-bold" loader={listProcessLogs} />
      <LogFileSection id="crashes" title={t("debug.tabs.crashes")} icon="solar:danger-triangle-bold" crash loader={listCrashReports} />

      <SettingsSection id="settings-section-permissions" title={t("debug.permissions.tab")} icon="solar:shield-keyhole-bold">
        <div className="py-2">
          <PermissionsList
            permissions={permissions}
            refreshing={refreshingPerms}
            onRefresh={handleRefreshPermissions}
          />
        </div>
      </SettingsSection>

      <SettingsSection id="settings-section-testing" title={t("debug.tabs.testing")} icon="solar:test-tube-bold">
        <div className="py-2">
          <TestingPanel />
        </div>
      </SettingsSection>
    </div>
  );
}

interface ModCacheCleanupStats {
  scanned: number;
  deleted: string[];
  freed_bytes: number;
  failed: string[];
  skipped_empty_keepset: boolean;
}

function TestingPanel() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [filenames, setFilenames] = useState<string[] | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanStats, setCleanStats] = useState<ModCacheCleanupStats | null>(null);
  const [backups, setBackups] = useState<ProfileBackupInfo[] | null>(null);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [restoringPath, setRestoringPath] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const fetchProfiles = useProfileStore((s) => s.fetchProfiles);

  async function loadBackups() {
    setLoadingBackups(true);
    try {
      const result = await listProfileBackups();
      setBackups(result);
    } catch (e) {
      console.error("Failed to list profile backups:", e);
      toast.error(t("settings.backups.load_failed", { error: String(e) }));
    }
    setLoadingBackups(false);
  }

  async function handleRestore(backup: ProfileBackupInfo) {
    const date = new Date(backup.backup_time * 1000).toLocaleString();
    const ok = await confirm({
      title: t("settings.backups.restore_confirm_title"),
      message: t("settings.backups.restore_confirm_message", {
        date,
        count: backup.profile_count,
      }),
      confirmText: t("settings.backups.restore"),
      cancelText: t("common.cancel"),
      type: "warning",
      fullscreen: true,
    });
    if (!ok) return;
    setRestoringPath(backup.path);
    try {
      await restoreProfileBackup(backup.path);
      await fetchProfiles();
      await loadBackups();
      toast.success(t("settings.backups.restored", { count: backup.profile_count, date }));
    } catch (e) {
      console.error("Failed to restore profile backup:", e);
      toast.error(t("settings.backups.restore_failed", { error: String(e) }));
    }
    setRestoringPath(null);
  }

  async function runExpectedCacheFilenames() {
    setLoading(true);
    try {
      const result = await invoke<string[]>("debug_list_expected_cache_filenames");
      setFilenames(result);
      toast.success(t("debug.testing.keepset_result", { count: result.length }));
    } catch (e) {
      console.error("Failed to list expected cache filenames:", e);
      toast.error(t("debug.testing.failed", { error: String(e) }));
    }
    setLoading(false);
  }

  async function runCleanModCache() {
    setCleaning(true);
    try {
      const stats = await invoke<ModCacheCleanupStats>("clean_mod_cache_command");
      setCleanStats(stats);
      if (stats.skipped_empty_keepset) {
        toast.error(t("debug.testing.clean_skipped"));
      } else {
        const mb = (stats.freed_bytes / (1024 * 1024)).toFixed(1);
        toast.success(t("debug.testing.clean_result", { count: stats.deleted.length, mb }));
      }
    } catch (e) {
      console.error("Failed to clean mod_cache:", e);
      toast.error(t("debug.testing.failed", { error: String(e) }));
    }
    setCleaning(false);
  }

  return (
    <div className="space-y-3">
      <div className="bg-black/20 rounded-lg border border-white/10 px-4 py-3 flex items-center gap-3">
        <Icon icon="solar:database-bold" className="w-5 h-5 text-amber-300 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-white font-minecraft">{t("debug.testing.keepset_title")}</div>
          <div className="text-xs text-white/40 font-sans truncate">
            {t("debug.testing.keepset_desc")}
          </div>
        </div>
        <button
          onClick={runExpectedCacheFilenames}
          disabled={loading}
          className="px-3 py-2 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-minecraft text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
          title="Run debug_list_expected_cache_filenames"
        >
          {loading ? (
            <Icon icon="svg-spinners:ring-resize" className="w-4 h-4" />
          ) : (
            <Icon icon="solar:play-bold" className="w-4 h-4" />
          )}
          {t("debug.testing.run")}
        </button>
      </div>

      {filenames !== null && (
        <div className="bg-black/20 rounded-lg border border-white/10 overflow-hidden">
          <div className="px-4 py-2 text-xs text-white/50 font-sans border-b border-white/10">
            {t("debug.testing.filenames_count", { count: filenames.length })}
          </div>
          {filenames.length === 0 ? (
            <div className="p-8 text-center text-white/50 font-minecraft">{t("debug.testing.empty")}</div>
          ) : (
            <div className="divide-y divide-white/10 max-h-96 overflow-y-auto">
              {filenames.map((name) => (
                <div key={name} className="p-2 px-4 hover:bg-white/5 text-white/80 font-mono text-xs truncate">
                  {name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-black/20 rounded-lg border border-white/10 px-4 py-3 flex items-center gap-3">
        <Icon icon="solar:trash-bin-trash-bold" className="w-5 h-5 text-red-300 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-white font-minecraft">{t("debug.testing.clean_title")}</div>
          <div className="text-xs text-white/40 font-sans truncate">
            {t("debug.testing.clean_desc")}
          </div>
        </div>
        <button
          onClick={runCleanModCache}
          disabled={cleaning}
          className="px-3 py-2 rounded-md bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 font-minecraft text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
          title="Run clean_mod_cache_command"
        >
          {cleaning ? (
            <Icon icon="svg-spinners:ring-resize" className="w-4 h-4" />
          ) : (
            <Icon icon="solar:trash-bin-trash-bold" className="w-4 h-4" />
          )}
          {t("debug.testing.clean")}
        </button>
      </div>

      {cleanStats !== null && (
        <div className="bg-black/20 rounded-lg border border-white/10 overflow-hidden">
          <div className="px-4 py-2 text-xs text-white/50 font-sans border-b border-white/10">
            {t("debug.testing.stats", {
              scanned: cleanStats.scanned,
              deleted: cleanStats.deleted.length,
              failed: cleanStats.failed.length,
              mb: (cleanStats.freed_bytes / (1024 * 1024)).toFixed(1),
            })}
            {cleanStats.skipped_empty_keepset && t("debug.testing.stats_skipped")}
          </div>
          {cleanStats.deleted.length === 0 ? (
            <div className="p-6 text-center text-white/50 font-minecraft">{t("debug.testing.no_orphans")}</div>
          ) : (
            <div className="divide-y divide-white/10 max-h-96 overflow-y-auto">
              {cleanStats.deleted.map((name) => (
                <div key={name} className="p-2 px-4 hover:bg-white/5 text-red-200/80 font-mono text-xs truncate">
                  {name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-black/20 rounded-lg border border-white/10 px-4 py-3 flex items-center gap-3">
        <Icon icon="solar:history-bold" className="w-5 h-5 text-emerald-300 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-white font-minecraft">{t("settings.backups.title")}</div>
          <div className="text-xs text-white/40 font-sans truncate">
            {t("settings.backups.description")}
          </div>
        </div>
        <button
          onClick={loadBackups}
          disabled={loadingBackups}
          className="px-3 py-2 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 font-minecraft text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
          title="Run list_profile_backups"
        >
          {loadingBackups ? (
            <Icon icon="svg-spinners:ring-resize" className="w-4 h-4" />
          ) : (
            <Icon icon="solar:list-bold" className="w-4 h-4" />
          )}
          {t("settings.backups.load")}
        </button>
      </div>

      {backups !== null && (
        <div className="bg-black/20 rounded-lg border border-white/10 overflow-hidden">
          <div className="px-4 py-2 text-xs text-white/50 font-sans border-b border-white/10">
            {t("settings.backups.count", { count: backups.length })}
          </div>
          {backups.length === 0 ? (
            <div className="p-8 text-center text-white/50 font-minecraft">
              {t("settings.backups.empty")}
            </div>
          ) : (
            <div className="divide-y divide-white/10 max-h-96 overflow-y-auto">
              {backups.map((b) => (
                <div key={b.path} className="p-3 px-4 hover:bg-white/5 flex items-center gap-4">
                  <Icon icon="solar:archive-bold" className="w-5 h-5 text-white/50 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-minecraft truncate">
                      {new Date(b.backup_time * 1000).toLocaleString()}
                    </div>
                    <div className="text-xs text-white/40 font-sans truncate">
                      {t("settings.backups.meta", {
                        count: b.profile_count,
                        size: (b.file_size / 1024).toFixed(1),
                      })}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestore(b)}
                    disabled={restoringPath !== null}
                    className="px-3 py-2 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 font-minecraft text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {restoringPath === b.path ? (
                      <Icon icon="svg-spinners:ring-resize" className="w-4 h-4" />
                    ) : (
                      <Icon icon="solar:restart-bold" className="w-4 h-4" />
                    )}
                    {t("settings.backups.restore")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {confirmDialog}
    </div>
  );
}

interface PermissionsListProps {
  permissions: PermissionCacheState | null;
  refreshing: boolean;
  onRefresh: () => void;
}

function PermissionsList({ permissions, refreshing, onRefresh }: PermissionsListProps) {
  const { t } = useTranslation();
  const nodes = permissions?.nodes ?? [];
  const lastFetched = permissions?.last_fetched
    ? new Date(permissions.last_fetched).toLocaleString()
    : null;

  const canTest = nodes.includes("norisk.tester");
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!canTest) {
      setQueueCount(null);
      return;
    }
    fetchTesterQueueCount()
      .then(({ count }) => setQueueCount(count))
      .catch(() => setQueueCount(null));
  }, [canTest, permissions]);

  const handleOpenTester = async () => {
    setOpening(true);
    try {
      await openTesterWindow();
    } catch (e) {
      console.error("Failed to open tester window:", e);
      toast.error(t("debug.testing.tester_open_failed", { error: String(e) }));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-black/20 rounded-lg border border-white/10 px-4 py-3 flex items-center gap-3">
        <Icon icon="solar:shield-keyhole-bold" className="w-5 h-5 text-white/60 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-white font-minecraft">
            {t('debug.permissions.count', { n: nodes.length })}
          </div>
          {lastFetched && (
            <div className="text-xs text-white/40 font-sans truncate">
              {t('debug.permissions.last_refreshed', { time: lastFetched })}
            </div>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="p-2 rounded-md bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
          title={t('debug.permissions.refresh')}
        >
          <Icon
            icon="solar:refresh-bold"
            className={`w-4 h-4 text-white/70 ${refreshing ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {canTest && (
        <div className="bg-black/20 rounded-lg border border-white/10 px-4 py-3 flex items-center gap-3">
          <Icon icon="solar:test-tube-bold" className="w-5 h-5 text-amber-300 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-white font-minecraft">{t("debug.testing.tester_queue")}</div>
            <div className="text-xs text-white/40 font-sans truncate">
              {queueCount === null
                ? t("debug.testing.tester_open_hint")
                : queueCount === 0
                  ? t("debug.testing.tester_caught_up")
                  : t("debug.testing.tester_waiting", { count: queueCount })}
            </div>
          </div>
          <button
            onClick={handleOpenTester}
            disabled={opening}
            className="px-3 py-2 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-minecraft text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
            title={t("debug.testing.tester_open_title")}
          >
            {opening ? (
              <Icon icon="svg-spinners:ring-resize" className="w-4 h-4" />
            ) : (
              <Icon icon="solar:test-tube-bold" className="w-4 h-4" />
            )}
            {t("debug.testing.tester_open")}
          </button>
        </div>
      )}

      <div className="bg-black/20 rounded-lg border border-white/10 overflow-hidden">
        {nodes.length === 0 ? (
          <div className="p-8 text-center text-white/50 font-minecraft">
            {t('debug.permissions.empty')}
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {nodes.map((node) => (
              <div
                key={node}
                className="p-3 hover:bg-white/5 flex items-center gap-3"
              >
                <Icon icon="solar:check-circle-bold" className="w-4 h-4 text-emerald-400/70 shrink-0" />
                <div className="text-white/80 font-mono text-sm truncate">{node}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
