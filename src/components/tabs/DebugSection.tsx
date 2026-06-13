import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { GroupTabs, type GroupTab } from "../ui/GroupTabs";
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

type DebugTab =
  | "launcher"
  | "minecraft"
  | "process"
  | "crashes"
  | "permissions"
  | "testing";

export function DebugSection() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<DebugTab>("launcher");
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermissionCacheState | null>(
    null,
  );
  const [refreshingPerms, setRefreshingPerms] = useState(false);

  // Load files when tab changes
  useEffect(() => {
    if (activeTab === "permissions") {
      getCachedPermissions()
        .then(setPermissions)
        .catch(() => setPermissions(null));
    } else if (activeTab === "testing") {
      // no auto-load; user triggers actions manually
    } else {
      loadFiles();
    }
  }, [activeTab]);

  async function loadFiles() {
    setLoading(true);
    try {
      if (activeTab === "launcher") {
        const logs = await listLauncherLogs();
        setFiles(logs);
      } else if (activeTab === "minecraft") {
        const logs = await listAllMcLogs();
        setFiles(logs);
      } else if (activeTab === "process") {
        const logs = await listProcessLogs();
        setFiles(logs);
      } else if (activeTab === "crashes") {
        const crashes = await listCrashReports();
        setFiles(crashes);
      }
    } catch (e) {
      console.error("Failed to load files:", e);
      setFiles([]);
    }
    setLoading(false);
  }

  async function handleRefreshPermissions() {
    setRefreshingPerms(true);
    try {
      await refreshPermissions();
      const cached = await getCachedPermissions();
      setPermissions(cached);
      toast.success(t("debug.permissions.refreshed"));
    } catch (e) {
      console.error("Failed to refresh permissions:", e);
      toast.error(
        t("debug.permissions.refresh_failed", { error: getErrorMessage(e) }),
      );
    }
    setRefreshingPerms(false);
  }

  // Helper to extract error message from Tauri CommandError or any error
  function getErrorMessage(e: unknown): string {
    if (e && typeof e === "object" && "message" in e) {
      return (e as { message: string }).message;
    }
    return String(e);
  }

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

  const groups: GroupTab[] = [
    { id: "launcher", name: "Launcher Logs", count: 0 },
    { id: "minecraft", name: "MC Logs", count: 0 },
    { id: "process", name: "Process Logs", count: 0 },
    { id: "crashes", name: "Crash Reports", count: 0 },
    {
      id: "permissions",
      name: t("debug.permissions.tab"),
      count: permissions?.nodes.length ?? 0,
    },
    { id: "testing", name: "TESTING", count: 0 },
  ];

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

  return (
    <div className="space-y-4">
      <GroupTabs
        groups={groups}
        activeGroup={activeTab}
        onGroupChange={(id) => setActiveTab(id as DebugTab)}
        showAddButton={false}
      />

      {activeTab === "testing" ? (
        <TestingPanel />
      ) : activeTab === "permissions" ? (
        <PermissionsList
          permissions={permissions}
          refreshing={refreshingPerms}
          onRefresh={handleRefreshPermissions}
        />
      ) : (
        /* File List */
        <div className="bg-black/20 rounded-lg border border-white/10 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-white/50">
              <Icon
                icon="solar:refresh-bold"
                className="w-6 h-6 animate-spin mx-auto mb-2"
              />
              Loading...
            </div>
          ) : files.length === 0 ? (
            <div className="p-8 text-center text-white/50 font-minecraft-ten">
              No files found
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {files.map((file, i) => (
                <div
                  key={i}
                  className="p-3 hover:bg-white/5 flex items-center gap-4"
                >
                  <Icon
                    icon={
                      activeTab === "crashes"
                        ? "solar:danger-triangle-bold"
                        : "solar:document-text-bold"
                    }
                    className={`w-5 h-5 flex-shrink-0 ${activeTab === "crashes" ? "text-red-400" : "text-white/60"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-minecraft-ten truncate">
                      {file.name}
                    </div>
                    <div className="text-xs text-white/40 font-sans truncate">
                      {file.path}
                    </div>
                  </div>
                  <div className="text-sm text-white/50 font-sans whitespace-nowrap">
                    {formatSize(file.size)}
                  </div>
                  <div className="text-sm text-white/50 font-sans whitespace-nowrap hidden lg:block">
                    {formatDate(file.modified)}
                  </div>
                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopyContent(file)}
                      className="p-2 rounded-md bg-white/10 hover:bg-white/20 transition-colors"
                      title={t("debug.copy_content")}
                    >
                      <Icon
                        icon="solar:copy-bold"
                        className="w-4 h-4 text-white/70"
                      />
                    </button>
                    <button
                      onClick={() => handleUpload(file)}
                      disabled={uploadingFile === file.path}
                      className="p-2 rounded-md bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
                      title={t("debug.upload_mclogs")}
                    >
                      {uploadingFile === file.path ? (
                        <Icon
                          icon="solar:refresh-bold"
                          className="w-4 h-4 text-white/70 animate-spin"
                        />
                      ) : (
                        <Icon
                          icon="solar:upload-bold"
                          className="w-4 h-4 text-white/70"
                        />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
  const [loading, setLoading] = useState(false);
  const [filenames, setFilenames] = useState<string[] | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanStats, setCleanStats] = useState<ModCacheCleanupStats | null>(
    null,
  );

  async function runExpectedCacheFilenames() {
    setLoading(true);
    try {
      const result = await invoke<string[]>(
        "debug_list_expected_cache_filenames",
      );
      setFilenames(result);
      toast.success(
        `Keep-set: ${result.length} filenames (also dumped to launcher log)`,
      );
    } catch (e) {
      console.error("Failed to list expected cache filenames:", e);
      toast.error(`Failed: ${String(e)}`);
    }
    setLoading(false);
  }

  async function runCleanModCache() {
    setCleaning(true);
    try {
      const stats = await invoke<ModCacheCleanupStats>(
        "clean_mod_cache_command",
      );
      setCleanStats(stats);
      if (stats.skipped_empty_keepset) {
        toast.error(
          "Skipped: keep-set empty (config not loaded) — nothing deleted",
        );
      } else {
        const mb = (stats.freed_bytes / (1024 * 1024)).toFixed(1);
        toast.success(
          `Removed ${stats.deleted.length} orphans, freed ${mb} MB`,
        );
      }
    } catch (e) {
      console.error("Failed to clean mod_cache:", e);
      toast.error(`Failed: ${String(e)}`);
    }
    setCleaning(false);
  }

  return (
    <div className="space-y-3">
      <div className="bg-black/20 rounded-lg border border-white/10 px-4 py-3 flex items-center gap-3">
        <Icon
          icon="solar:database-bold"
          className="w-5 h-5 text-amber-300 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="text-white font-minecraft-ten">
            mod_cache keep-set
          </div>
          <div className="text-xs text-white/40 font-sans truncate">
            Every filename any profile/pack could place in mod_cache (step 1 of
            cache cleanup)
          </div>
        </div>
        <button
          onClick={runExpectedCacheFilenames}
          disabled={loading}
          className="px-3 py-2 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-minecraft-ten text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
          title="Run debug_list_expected_cache_filenames"
        >
          {loading ? (
            <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
          ) : (
            <Icon icon="solar:play-bold" className="w-4 h-4" />
          )}
          Run
        </button>
      </div>

      {filenames !== null && (
        <div className="bg-black/20 rounded-lg border border-white/10 overflow-hidden">
          <div className="px-4 py-2 text-xs text-white/50 font-sans border-b border-white/10">
            {filenames.length} filenames
          </div>
          {filenames.length === 0 ? (
            <div className="p-8 text-center text-white/50 font-minecraft-ten">
              Empty
            </div>
          ) : (
            <div className="divide-y divide-white/10 max-h-96 overflow-y-auto">
              {filenames.map((name) => (
                <div
                  key={name}
                  className="p-2 px-4 hover:bg-white/5 text-white/80 font-mono text-xs truncate"
                >
                  {name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-black/20 rounded-lg border border-white/10 px-4 py-3 flex items-center gap-3">
        <Icon
          icon="solar:trash-bin-trash-bold"
          className="w-5 h-5 text-red-300 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="text-white font-minecraft-ten">Clean mod_cache</div>
          <div className="text-xs text-white/40 font-sans truncate">
            Delete cached jars not in the keep-set (orphans = stale/unused
            versions)
          </div>
        </div>
        <button
          onClick={runCleanModCache}
          disabled={cleaning}
          className="px-3 py-2 rounded-md bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 font-minecraft-ten text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
          title="Run clean_mod_cache_command"
        >
          {cleaning ? (
            <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
          ) : (
            <Icon icon="solar:trash-bin-trash-bold" className="w-4 h-4" />
          )}
          Clean
        </button>
      </div>

      {cleanStats !== null && (
        <div className="bg-black/20 rounded-lg border border-white/10 overflow-hidden">
          <div className="px-4 py-2 text-xs text-white/50 font-sans border-b border-white/10">
            scanned {cleanStats.scanned} · deleted {cleanStats.deleted.length} ·
            failed {cleanStats.failed.length} · freed{" "}
            {(cleanStats.freed_bytes / (1024 * 1024)).toFixed(1)} MB
            {cleanStats.skipped_empty_keepset && " · SKIPPED (empty keep-set)"}
          </div>
          {cleanStats.deleted.length === 0 ? (
            <div className="p-6 text-center text-white/50 font-minecraft-ten">
              No orphans
            </div>
          ) : (
            <div className="divide-y divide-white/10 max-h-96 overflow-y-auto">
              {cleanStats.deleted.map((name) => (
                <div
                  key={name}
                  className="p-2 px-4 hover:bg-white/5 text-red-200/80 font-mono text-xs truncate"
                >
                  {name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PermissionsListProps {
  permissions: PermissionCacheState | null;
  refreshing: boolean;
  onRefresh: () => void;
}

function PermissionsList({
  permissions,
  refreshing,
  onRefresh,
}: PermissionsListProps) {
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
      toast.error(`Failed to open tester window: ${String(e)}`);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-black/20 rounded-lg border border-white/10 px-4 py-3 flex items-center gap-3">
        <Icon
          icon="solar:shield-keyhole-bold"
          className="w-5 h-5 text-white/60 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="text-white font-minecraft-ten">
            {t("debug.permissions.count", { n: nodes.length })}
          </div>
          {lastFetched && (
            <div className="text-xs text-white/40 font-sans truncate">
              {t("debug.permissions.last_refreshed", { time: lastFetched })}
            </div>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="p-2 rounded-md bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
          title={t("debug.permissions.refresh")}
        >
          <Icon
            icon="solar:refresh-bold"
            className={`w-4 h-4 text-white/70 ${refreshing ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {canTest && (
        <div className="bg-black/20 rounded-lg border border-white/10 px-4 py-3 flex items-center gap-3">
          <Icon
            icon="solar:test-tube-bold"
            className="w-5 h-5 text-amber-300 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="text-white font-minecraft-ten">Tester Queue</div>
            <div className="text-xs text-white/40 font-sans truncate">
              {queueCount === null
                ? "Click to open the tester window"
                : queueCount === 0
                  ? "All caught up — open anyway"
                  : `${queueCount} issue${queueCount === 1 ? "" : "s"} waiting on you`}
            </div>
          </div>
          <button
            onClick={handleOpenTester}
            disabled={opening}
            className="px-3 py-2 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-minecraft-ten text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
            title="Open tester window"
          >
            {opening ? (
              <Icon
                icon="solar:refresh-bold"
                className="w-4 h-4 animate-spin"
              />
            ) : (
              <Icon icon="solar:test-tube-bold" className="w-4 h-4" />
            )}
            Open
          </button>
        </div>
      )}

      <div className="bg-black/20 rounded-lg border border-white/10 overflow-hidden">
        {nodes.length === 0 ? (
          <div className="p-8 text-center text-white/50 font-minecraft-ten">
            {t("debug.permissions.empty")}
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {nodes.map((node) => (
              <div
                key={node}
                className="p-3 hover:bg-white/5 flex items-center gap-3"
              >
                <Icon
                  icon="solar:check-circle-bold"
                  className="w-4 h-4 text-emerald-400/70 shrink-0"
                />
                <div className="text-white/80 font-mono text-sm truncate">
                  {node}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
