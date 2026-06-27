import { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../store/useThemeStore";
import { useLogSettingsStore } from "../../store/useLogSettingsStore";
import { LogEntry, LogLevel } from "../../store/useProcessStore";
import { openExternalUrl } from "../../services/tauri-service";
import { uploadLogToMclogs } from "../../services/log-service";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { parseErrorMessage } from "../../utils/error-utils";

// Hex colors for filter buttons
const LEVEL_COLORS: Record<LogLevel, string> = {
  ERROR: "#f87171",
  WARN: "#fbbf24",
  INFO: "#60a5fa",
  DEBUG: "#22d3ee",
  TRACE: "#a78bfa",
  UNKNOWN: "#9ca3af",
};

// Get Tailwind color class for log level
function getLevelColorClass(level: LogLevel | undefined): string {
  switch (level) {
    case "ERROR":
      return "text-red-400";
    case "WARN":
      return "text-yellow-400";
    case "INFO":
      return "text-blue-400";
    case "DEBUG":
      return "text-cyan-400";
    case "TRACE":
      return "text-purple-400";
    default:
      return "text-white/70";
  }
}

function formatTimestamp(timestamp: Date | null): string | null {
  return timestamp
    ? timestamp.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;
}

function formatLogEntry(log: LogEntry): string {
  const timestamp = formatTimestamp(log.timestamp);
  if (timestamp) {
    return `[${timestamp}] [${log.thread || "main"}/${log.level}] ${log.message}`;
  }
  return `    ${log.message}`;
}

export interface LogViewerCoreProps {
  logs: LogEntry[];
  onClear?: () => void;
  showNoLogsMessage?: boolean;
  noLogsIcon?: string;
  noLogsTitle?: string;
  noLogsSubtitle?: string;
  logFiles?: string[];
  selectedLogPath?: string | null;
  onLogSelect?: (path: string) => void;
  onOpenFolder?: () => void;
}

export function LogViewerCore({
  logs,
  onClear,
  showNoLogsMessage = true,
  noLogsIcon = "solar:document-text-bold",
  noLogsTitle = "NO LOGS YET",
  noLogsSubtitle = "Waiting for log output...",
  logFiles,
  selectedLogPath,
  onLogSelect,
  onOpenFolder,
}: LogViewerCoreProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const { showThreadPrefix, toggleShowThreadPrefix } = useLogSettingsStore();
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [levelFilters, setLevelFilters] = useState<Record<LogLevel, boolean>>({
    ERROR: true,
    WARN: true,
    INFO: true,
    DEBUG: true,
    TRACE: false,
    UNKNOWN: true,
  });
  const [isAutoscrollEnabled, setIsAutoscrollEnabled] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPopupRef = useRef<HTMLDivElement>(null);
  const fileDropdownButtonRef = useRef<HTMLButtonElement>(null);
  const fileDropdownRef = useRef<HTMLDivElement>(null);
  const [isFileDropdownOpen, setIsFileDropdownOpen] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // State for delayed "NO LOGS YET" display
  const [showNoLogs, setShowNoLogs] = useState(false);

  // Filter logs based on search and level filters. Search uses React deferred input
  // so large log tails do not rescan synchronously on every keystroke.
  const filteredLogs = useMemo(() => {
    const searchLower = deferredSearchTerm.trim().toLowerCase();
    return logs.filter((log) => {
      if (!levelFilters[log.level]) return false;
      if (!searchLower) return true;

      return (
        log.message.toLowerCase().includes(searchLower) ||
        log.thread?.toLowerCase().includes(searchLower) ||
        log.level.toLowerCase().includes(searchLower)
      );
    });
  }, [logs, levelFilters, deferredSearchTerm]);

  // Delay showing "NO LOGS YET" by 1 second to avoid flicker
  useEffect(() => {
    setShowNoLogs(false);
    if (filteredLogs.length === 0) {
      const timer = setTimeout(() => setShowNoLogs(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [filteredLogs.length]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isSettingsOpen &&
        settingsPopupRef.current &&
        settingsButtonRef.current &&
        !settingsPopupRef.current.contains(event.target as Node) &&
        !settingsButtonRef.current.contains(event.target as Node)
      ) {
        setIsSettingsOpen(false);
      }
      if (
        isFileDropdownOpen &&
        fileDropdownRef.current &&
        fileDropdownButtonRef.current &&
        !fileDropdownRef.current.contains(event.target as Node) &&
        !fileDropdownButtonRef.current.contains(event.target as Node)
      ) {
        setIsFileDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isSettingsOpen, isFileDropdownOpen]);

  const toggleLevelFilter = (level: LogLevel) => {
    setLevelFilters((prev) => ({ ...prev, [level]: !prev[level] }));
  };

  const [isUploading, setIsUploading] = useState(false);

  const copyLogs = async (entries: LogEntry[], label: string) => {
    if (entries.length === 0) {
      toast.error(t('logs.no_logs_to_upload'));
      return;
    }

    try {
      await writeText(entries.map(formatLogEntry).join("\n"));
      toast.success(`${label} copied`);
    } catch (error) {
      console.error("Failed to copy logs:", error);
      toast.error("Failed to copy logs");
    }
  };

  const handleUpload = async () => {
    if (filteredLogs.length === 0) {
      toast.error(t('logs.no_logs_to_upload'));
      return;
    }

    setIsUploading(true);
    try {
      const logText = filteredLogs.map(formatLogEntry).join("\n");

      // Use Tauri backend command instead of direct fetch (CSP blocked in production)
      const url = await uploadLogToMclogs(logText);

      await writeText(url);
      toast.success(t('logs.uploaded_url_copied'));
      await openExternalUrl(url);
    } catch (error) {
      console.error("Failed to upload logs:", error);
      // Extract error message properly from Tauri CommandError
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as { message: string }).message
        : parseErrorMessage(error);
      toast.error(errorMessage || t('logs.upload_failed'));
    } finally {
      setIsUploading(false);
    }
  };

  const scrollToBottom = () => {
    if (virtuosoRef.current && filteredLogs.length > 0) {
      virtuosoRef.current.scrollToIndex({ index: filteredLogs.length - 1, behavior: "auto" });
    }
    setIsAutoscrollEnabled(true);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-2">
      {/* Log Header with Search & Filters */}
      <div
        className="px-4 py-3 flex items-center gap-4 rounded-lg bg-black/60 backdrop-blur-sm"
        style={{ boxShadow: `0 4px 20px ${accentColor.value}15` }}
      >
        {/* Search Input */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded flex-1 min-w-[200px] max-w-[300px]"
          style={{
            backgroundColor: `${accentColor.value}15`,
            border: `1px solid ${accentColor.value}30`,
          }}
        >
          <Icon icon="solar:magnifer-bold" className="w-4 h-4 text-white/50" />
          <input
            type="text"
            placeholder={t('placeholders.search_logs')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-transparent text-sm font-minecraft-ten text-white/90 placeholder:text-white/40 outline-none flex-1 min-w-0"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="text-white/40 hover:text-white/70 flex-shrink-0"
            >
              <Icon icon="solar:close-circle-bold" className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Level Filter Buttons */}
        <div className="flex items-center gap-1.5">
          {(["ERROR", "WARN", "INFO", "DEBUG", "TRACE"] as LogLevel[]).map((level) => (
            <button
              key={level}
              onClick={() => toggleLevelFilter(level)}
              className="px-2.5 py-1 text-xs font-minecraft-ten rounded transition-all"
              style={{
                backgroundColor: levelFilters[level]
                  ? `${LEVEL_COLORS[level]}25`
                  : "rgba(255,255,255,0.05)",
                color: levelFilters[level] ? LEVEL_COLORS[level] : "rgba(255,255,255,0.3)",
                border: `1px solid ${levelFilters[level] ? `${LEVEL_COLORS[level]}50` : "transparent"}`,
              }}
            >
              {level}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {logFiles && logFiles.length > 0 && onLogSelect && (
          <button
            ref={fileDropdownButtonRef}
            onClick={() => setIsFileDropdownOpen(!isFileDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-minecraft-ten transition-all max-w-[250px]"
            style={{
              backgroundColor: isFileDropdownOpen ? `${accentColor.value}25` : `${accentColor.value}15`,
              border: `1px solid ${accentColor.value}30`,
              color: "rgba(255,255,255,0.8)",
            }}
          >
            <Icon icon="solar:document-text-bold" className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">
              {selectedLogPath ? (selectedLogPath.split(/[\\/]/).pop() || selectedLogPath) : "Select log..."}
            </span>
            <Icon icon="solar:alt-arrow-down-bold" className="w-3 h-3 flex-shrink-0" />
          </button>
        )}

        {/* Settings Button */}
        <div className="relative">
          <button
            ref={settingsButtonRef}
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className="p-1.5 rounded transition-all hover:bg-white/10"
            style={{
              backgroundColor: isSettingsOpen ? `${accentColor.value}20` : undefined,
              color: isSettingsOpen ? accentColor.value : "rgba(255,255,255,0.5)",
            }}
          >
            <Icon icon="solar:settings-bold" className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Log Content */}
      <div
        className="flex-1 overflow-hidden p-4 font-mono text-sm rounded-lg bg-black/60 backdrop-blur-sm"
        style={{ boxShadow: `0 4px 20px ${accentColor.value}15` }}
      >
        {filteredLogs.length === 0 ? (
          showNoLogs && showNoLogsMessage && (
            <div className="flex items-center justify-center h-full text-white/30">
              <div className="text-center">
                <Icon icon={noLogsIcon} className="w-12 h-12 mx-auto mb-2" />
                <p className="font-minecraft-ten">{noLogsTitle}</p>
                <p className="text-xs mt-1">{noLogsSubtitle}</p>
              </div>
            </div>
          )
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className="custom-scrollbar"
            style={{ height: "100%" }}
            data={filteredLogs}
            followOutput={isAutoscrollEnabled ? "auto" : false}
            atBottomStateChange={setIsAutoscrollEnabled}
            initialTopMostItemIndex={filteredLogs.length > 0 ? filteredLogs.length - 1 : 0}
            itemContent={(_index, log) => {
              const timestamp = formatTimestamp(log.timestamp);
              return (
                <div className="flex flex-nowrap items-start py-0.5 hover:bg-white/5 px-2 -mx-2 rounded">
                  {timestamp ? (
                    <>
                      <span className={`pr-2 select-none ${getLevelColorClass(log.level)}`}>
                        <span className="opacity-80">[{timestamp}]</span>
                        {showThreadPrefix && (
                          <span className="opacity-80 ml-1">
                            [{log.thread}/{log.level}]
                          </span>
                        )}
                      </span>
                      <span
                        className={`flex-1 min-w-0 break-words whitespace-pre-wrap ${
                          log.level === "ERROR" || log.level === "WARN"
                            ? getLevelColorClass(log.level)
                            : "text-white/90"
                        }`}
                      >
                        {log.message}
                      </span>
                    </>
                  ) : (
                    <span
                      className={`flex-1 min-w-0 break-words whitespace-pre-wrap ${
                        log.level === "ERROR" || log.level === "WARN"
                          ? getLevelColorClass(log.level)
                          : "text-white/90"
                      }`}
                    >
                      {log.message}
                    </span>
                  )}
                </div>
              );
            }}
          />
        )}
      </div>

      {/* Status Bar */}
      <div
        className="px-4 py-2 flex items-center justify-between rounded-lg bg-black/60 backdrop-blur-sm"
        style={{ boxShadow: `0 4px 20px ${accentColor.value}15` }}
      >
        <div className="flex items-center gap-4 text-white/50 font-minecraft-ten text-xs">
          <span className="flex items-center gap-1.5">
            <Icon icon="solar:document-text-bold" className="w-4 h-4" />
            {filteredLogs.length} LINES
          </span>
          <button
            onClick={() => setIsAutoscrollEnabled(!isAutoscrollEnabled)}
            className="flex items-center gap-1.5 hover:text-white/70 transition-colors"
            style={{ color: isAutoscrollEnabled ? accentColor.value : undefined }}
          >
            <Icon
              icon={isAutoscrollEnabled ? "solar:arrow-down-bold" : "solar:pause-bold"}
              className="w-4 h-4"
            />
            {isAutoscrollEnabled ? "FOLLOWING" : "PAUSED"}
          </button>
          {!isAutoscrollEnabled && (
            <button
              onClick={scrollToBottom}
              className="flex items-center gap-1.5 hover:text-white/70 transition-colors px-2 py-0.5 rounded"
              style={{
                backgroundColor: `${accentColor.value}20`,
                color: accentColor.value
              }}
            >
              <Icon icon="solar:arrow-down-bold" className="w-4 h-4" />
              SCROLL TO BOTTOM
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => copyLogs(filteredLogs, "Visible logs")}
            disabled={filteredLogs.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-white/10 transition-colors text-white/60 hover:text-white/90 font-minecraft-ten text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon icon="solar:copy-bold" className="w-4 h-4" />
            COPY VISIBLE
          </button>
          <button
            onClick={() => copyLogs(logs, "All retained logs")}
            disabled={logs.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-white/10 transition-colors text-white/60 hover:text-white/90 font-minecraft-ten text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon icon="solar:copy-bold" className="w-4 h-4" />
            COPY ALL
          </button>
          {onClear && (
            <button
              onClick={onClear}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-white/10 transition-colors text-white/60 hover:text-white/90 font-minecraft-ten text-xs"
            >
              <Icon icon="solar:trash-bin-trash-bold" className="w-4 h-4" />
              CLEAR
            </button>
          )}
          {onOpenFolder && (
            <button
              onClick={onOpenFolder}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-white/10 transition-colors text-white/60 hover:text-white/90 font-minecraft-ten text-xs"
            >
              <Icon icon="solar:folder-open-bold" className="w-4 h-4" />
              OPEN FOLDER
            </button>
          )}
          <button
            onClick={handleUpload}
            disabled={isUploading}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors font-minecraft-ten text-xs ${
              isUploading
                ? "bg-white/5 text-white/40 cursor-wait"
                : "hover:bg-white/10 text-white/60 hover:text-white/90"
            }`}
          >
            {isUploading ? (
              <Icon icon="svg-spinners:pulse-3" className="w-4 h-4" />
            ) : (
              <Icon icon="solar:upload-bold" className="w-4 h-4" />
            )}
            {isUploading ? "UPLOADING..." : "UPLOAD"}
          </button>
        </div>
      </div>

      {/* Settings Popup */}
      {isSettingsOpen && settingsButtonRef.current && createPortal(
        <div
          ref={settingsPopupRef}
          className="fixed min-w-[240px] p-3 rounded-lg border"
          style={{
            top: settingsButtonRef.current.getBoundingClientRect().bottom + 8,
            right: window.innerWidth - settingsButtonRef.current.getBoundingClientRect().right,
            backgroundColor: "rgba(0, 0, 0, 0.95)",
            borderColor: `${accentColor.value}40`,
            boxShadow: `0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px ${accentColor.value}20`,
            zIndex: 9999,
          }}
        >
          <div className="text-xs font-minecraft-ten text-white/70 mb-3 pb-2 border-b border-white/10">
            LOG SETTINGS
          </div>

          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              className="relative w-9 h-5 rounded-full transition-all cursor-pointer"
              style={{
                backgroundColor: showThreadPrefix
                  ? `${accentColor.value}80`
                  : "rgba(255,255,255,0.15)",
              }}
              onClick={toggleShowThreadPrefix}
            >
              <div
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-all"
                style={{
                  left: showThreadPrefix ? "calc(100% - 18px)" : "2px",
                }}
              />
            </div>
            <div className="flex-1">
              <div className="text-sm text-white/90 font-minecraft-ten">
                Thread Prefix
              </div>
              <div className="text-xs text-white/50 font-sans">
                Show [Thread/LEVEL] prefix
              </div>
            </div>
          </label>
        </div>,
        document.body
      )}

      {isFileDropdownOpen && fileDropdownButtonRef.current && createPortal(
        <div
          ref={fileDropdownRef}
          className="fixed min-w-[200px] max-w-[400px] max-h-[300px] overflow-y-auto p-1 rounded-lg border custom-scrollbar"
          style={{
            top: fileDropdownButtonRef.current.getBoundingClientRect().bottom + 8,
            right: window.innerWidth - fileDropdownButtonRef.current.getBoundingClientRect().right,
            backgroundColor: "rgba(0, 0, 0, 0.95)",
            borderColor: `${accentColor.value}40`,
            boxShadow: `0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px ${accentColor.value}20`,
            zIndex: 9999,
          }}
        >
          {logFiles?.map((path) => {
            const name = path.split(/[\\/]/).pop() || path;
            const isSelected = path === selectedLogPath;
            return (
              <button
                key={path}
                onClick={() => { onLogSelect?.(path); setIsFileDropdownOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs font-minecraft-ten rounded transition-all hover:bg-white/5"
                style={{
                  backgroundColor: isSelected ? `${accentColor.value}20` : undefined,
                  color: isSelected ? accentColor.value : "rgba(255,255,255,0.7)",
                }}
              >
                {name}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
