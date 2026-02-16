import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import { GroupTabs, type GroupTab } from "../ui/GroupTabs";
import { toast } from "react-hot-toast";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from "react-i18next";
import {
  listLauncherLogs,
  listCrashReports,
  listAllMcLogs,
  getLogFileContent,
  uploadLogToMclogs,
  type FileInfo,
} from "../../services/log-service";

type DebugTab = "launcher" | "minecraft" | "crashes";

export function DebugSection() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<DebugTab>("launcher");
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);

  // Load files when tab changes
  useEffect(() => {
    loadFiles();
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

  // Helper to extract error message from Tauri CommandError or any error
  function getErrorMessage(e: unknown): string {
    if (e && typeof e === 'object' && 'message' in e) {
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
      toast.success(t('debug.uploaded_copied'));
    } catch (e) {
      console.error("Failed to upload:", e);
      toast.error(t('debug.upload_failed', { error: getErrorMessage(e) }));
    }
    setUploadingFile(null);
  }

  async function handleCopyContent(file: FileInfo) {
    try {
      const content = await getLogFileContent(file.path);
      await writeText(content);
      toast.success(t('debug.copied'));
    } catch (e) {
      console.error("Failed to copy:", e);
      toast.error(t('debug.copy_failed', { error: getErrorMessage(e) }));
    }
  }

  const groups: GroupTab[] = [
    { id: "launcher", name: "Launcher Logs", count: 0 },
    { id: "minecraft", name: "MC Logs", count: 0 },
    { id: "crashes", name: "Crash Reports", count: 0 },
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

      {/* File List */}
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
                    title={t('debug.copy_content')}
                  >
                    <Icon icon="solar:copy-bold" className="w-4 h-4 text-white/70" />
                  </button>
                  <button
                    onClick={() => handleUpload(file)}
                    disabled={uploadingFile === file.path}
                    className="p-2 rounded-md bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
                    title={t('debug.upload_mclogs')}
                  >
                    {uploadingFile === file.path ? (
                      <Icon icon="solar:refresh-bold" className="w-4 h-4 text-white/70 animate-spin" />
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
  );
}
