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
import { getTopDialogId } from "../ui/modal-focus";

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

interface DisplayLogLine {
  id: string;
  timestamp: string | null;
  level: LogLevel;
  thread: string | null;
  message: string;
  processId: string;
}

// Convert LogEntry to DisplayLogLine
function logEntryToDisplayLine(entry: LogEntry): DisplayLogLine {
  const timestamp = entry.timestamp
    ? entry.timestamp.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return {
    id: entry.id,
    timestamp,
    level: entry.level,
    thread: entry.thread,
    message: entry.message,
    processId: entry.processId,
  };
}

function formatLogLineForCopy(log: DisplayLogLine, showThreadPrefix: boolean): string {
  if (log.timestamp) {
    if (showThreadPrefix) {
      return `[${log.timestamp}] [${log.thread || "main"}/${log.level}] ${log.message}`;
    }
    return `[${log.timestamp}] ${log.message}`;
  }
  return `    ${log.message}`;
}

function getLogIndexFromNode(node: Node | null): number | null {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const row = element?.closest("[data-log-index]");
  if (!row) return null;
  const index = Number.parseInt(row.getAttribute("data-log-index") ?? "", 10);
  return Number.isNaN(index) ? null : index;
}

function getLogIndexFromPoint(clientX: number, clientY: number): number | null {
  return getLogIndexFromNode(document.elementFromPoint(clientX, clientY));
}

function buildLogCopyText(
  logs: DisplayLogLine[],
  range: { start: number; end: number },
  showThreadPrefix: boolean,
): string {
  return logs
    .slice(range.start, range.end + 1)
    .map((log) => formatLogLineForCopy(log, showThreadPrefix))
    .join("\n");
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
  selectionIdentity?: string | null;
  onLogSelect?: (path: string) => void;
  onOpenFolder?: () => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
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
  selectionIdentity,
  onLogSelect,
  onOpenFolder,
  isLoading = false,
  error,
  onRetry,
}: LogViewerCoreProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const { showThreadPrefix, toggleShowThreadPrefix } = useLogSettingsStore();
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const handleClearSearch = () => {
    searchInputRef.current?.focus({ preventScroll: true });
    setSearchTerm("");
  };
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
  const logContainerRef = useRef<HTMLDivElement>(null);
  const handleResetFilters = (event: { currentTarget: HTMLButtonElement }) => {
    const trigger = event.currentTarget;
    const owner = logContainerRef.current;
    // Reserve only this active Reset's steady owner before the no-match branch disappears.
    const topDialogId = getTopDialogId();
    const ownerScope = owner?.closest<HTMLElement>("[data-modal-owner], [data-modal-id]");
    const triggerScope = trigger.closest<HTMLElement>("[data-modal-owner], [data-modal-id]");
    const ownerDialogId = ownerScope?.dataset.modalOwner ?? ownerScope?.dataset.modalId;
    const triggerDialogId = triggerScope?.dataset.modalOwner ?? triggerScope?.dataset.modalId;
    if (document.activeElement === trigger && trigger.isConnected && !trigger.disabled &&
      owner?.isConnected && owner.contains(trigger) &&
      !trigger.closest('[inert], [hidden], [aria-hidden="true"]') &&
      !owner.closest('[inert], [hidden], [aria-hidden="true"]') &&
      owner.getClientRects().length > 0 && getComputedStyle(owner).visibility !== "hidden" &&
      getComputedStyle(owner).visibility !== "collapse" &&
      (!topDialogId || (ownerDialogId === topDialogId && triggerDialogId === topDialogId))) {
      owner.focus({ preventScroll: true });
    }
    setSearchTerm("");
    setLevelFilters({ ERROR: true, WARN: true, INFO: true, DEBUG: true, TRACE: true, UNKNOWN: true });
  };
  const handleRetry = (event: { currentTarget: HTMLButtonElement }) => {
    if (isLoading || !onRetry) return;
    const trigger = event.currentTarget;
    const owner = logContainerRef.current;
    // Reserve our steady owner before native disable/removal, never on read completion.
    const topDialogId = getTopDialogId();
    const ownerScope = owner?.closest<HTMLElement>("[data-modal-owner], [data-modal-id]");
    const triggerScope = trigger.closest<HTMLElement>("[data-modal-owner], [data-modal-id]");
    const ownerDialogId = ownerScope?.dataset.modalOwner ?? ownerScope?.dataset.modalId;
    const triggerDialogId = triggerScope?.dataset.modalOwner ?? triggerScope?.dataset.modalId;
    if (document.activeElement === trigger && trigger.isConnected && !trigger.disabled &&
      owner?.isConnected && owner.parentElement?.contains(trigger) &&
      !trigger.closest('[inert], [hidden], [aria-hidden="true"]') &&
      !owner.closest('[inert], [hidden], [aria-hidden="true"]') &&
      owner.getClientRects().length > 0 && getComputedStyle(owner).visibility !== "hidden" &&
      getComputedStyle(owner).visibility !== "collapse" &&
      (!topDialogId || (ownerDialogId === topDialogId && triggerDialogId === topDialogId))) {
      owner.focus({ preventScroll: true });
    }
    onRetry();
  };
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [isPointerSelecting, setIsPointerSelecting] = useState(false);
  const selectionAnchorIndexRef = useRef<number | null>(null);
  const isMouseSelectingRef = useRef(false);
  const isAutoscrollEnabledRef = useRef(isAutoscrollEnabled);
  isAutoscrollEnabledRef.current = isAutoscrollEnabled;
  // State for delayed "NO LOGS YET" display
  const [showNoLogs, setShowNoLogs] = useState(false);

  // Convert log entries to display format
  const displayLogs = useMemo(() => {
    return logs.map(logEntryToDisplayLine);
  }, [logs]);

  // Filter logs based on search and level filters. Search uses React deferred input
  // so large log tails do not rescan synchronously on every keystroke.
  const filteredLogs = useMemo(() => {
    const searchLower = deferredSearchTerm.trim().toLowerCase();
    return displayLogs.filter((log) => {
      if (!levelFilters[log.level]) return false;
      if (!searchLower) return true;

      return (
        log.message.toLowerCase().includes(searchLower) ||
        log.thread?.toLowerCase().includes(searchLower) ||
        log.level.toLowerCase().includes(searchLower)
      );
    });
  }, [displayLogs, levelFilters, deferredSearchTerm]);

  const filteredLogsRef = useRef(filteredLogs);
  filteredLogsRef.current = filteredLogs;
  const selectionRangeRef = useRef(selectionRange);
  selectionRangeRef.current = selectionRange;

  useEffect(() => {
    if (isMouseSelectingRef.current) return;
    if (!isAutoscrollEnabled || filteredLogs.length === 0) return;
    const lastIndex = filteredLogs.length - 1;
    const jumpToBottom = () =>
      virtuosoRef.current?.scrollToIndex({
        index: lastIndex,
        align: "end",
        behavior: "auto",
      });
    jumpToBottom();
    const raf = requestAnimationFrame(jumpToBottom);
    return () => cancelAnimationFrame(raf);
  }, [filteredLogs.length, isAutoscrollEnabled]);

  const userScrollRef = useRef(false);
  const userScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markUserScroll = useCallback(() => {
    userScrollRef.current = true;
    if (userScrollTimer.current) clearTimeout(userScrollTimer.current);
    userScrollTimer.current = setTimeout(() => {
      userScrollRef.current = false;
    }, 400);
  }, []);
  useEffect(() => () => {
    if (userScrollTimer.current) clearTimeout(userScrollTimer.current);
  }, []);

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    if (isMouseSelectingRef.current) return;
    if (atBottom) {
      setIsAutoscrollEnabled(true);
      return;
    }
    if (userScrollRef.current) setIsAutoscrollEnabled(false);
  }, []);

  // Delay showing "NO LOGS YET" by 1 second to avoid flicker
  useEffect(() => {
    setShowNoLogs(false);
    if (logs.length === 0 && !isLoading && !error) {
      const timer = setTimeout(() => setShowNoLogs(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [logs.length, isLoading, error]);

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

  const commitSelectionIndices = useCallback((anchorIndex: number, focusIndex: number) => {
    setSelectionRange({
      start: Math.min(anchorIndex, focusIndex),
      end: Math.max(anchorIndex, focusIndex),
    });
  }, []);

  const copySelectedLogs = useCallback(() => {
    const range = selectionRangeRef.current;
    if (!range) return false;

    const text = buildLogCopyText(filteredLogsRef.current, range, showThreadPrefix);
    if (!text) return false;

    void writeText(text).catch((error) => {
      console.error("Failed to copy selected logs:", error);
      toast.error(t("logs.copy_failed", { defaultValue: "Failed to copy logs" }));
    });
    return true;
  }, [showThreadPrefix, t]);

  useEffect(() => {
    selectionAnchorIndexRef.current = null;
    setSelectionRange(null);
    isMouseSelectingRef.current = false;
    setIsPointerSelecting(false);
    window.getSelection()?.removeAllRanges();
  }, [searchTerm, levelFilters, selectedLogPath, selectionIdentity]);

  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) return;

    const lastPointer = { x: 0, y: 0 };
    let edgeScrollRaf: number | null = null;

    const getScroller = () =>
      container.querySelector("[data-virtuoso-scroller]") as HTMLElement | null;

    const getEdgeScrollDelta = (clientY: number) => {
      const rect = container.getBoundingClientRect();
      const edgeThreshold = 56;
      const maxSpeed = 9;

      if (clientY >= rect.bottom - edgeThreshold) {
        const intensity = Math.min(1, (clientY - (rect.bottom - edgeThreshold)) / edgeThreshold);
        return maxSpeed * (0.2 + intensity * 0.8);
      }
      if (clientY <= rect.top + edgeThreshold) {
        const intensity = Math.min(1, (rect.top + edgeThreshold - clientY) / edgeThreshold);
        return -maxSpeed * (0.2 + intensity * 0.8);
      }
      return 0;
    };

    const getVisibleBoundaryIndex = (direction: "up" | "down"): number | null => {
      const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-log-index]"));
      if (rows.length === 0) return null;

      const boundaryRow = direction === "up" ? rows[0] : rows[rows.length - 1];
      const index = Number.parseInt(boundaryRow.getAttribute("data-log-index") ?? "", 10);
      return Number.isNaN(index) ? null : index;
    };

    const updateSelectionFromPointer = (
      clientX: number,
      clientY: number,
      fallbackDirection?: "up" | "down",
    ) => {
      const anchorIndex = selectionAnchorIndexRef.current;
      if (anchorIndex === null) return;

      let hitIndex = getLogIndexFromPoint(clientX, clientY);
      if (hitIndex === null && fallbackDirection) {
        hitIndex = getVisibleBoundaryIndex(fallbackDirection);
      }

      if (hitIndex !== null) {
        commitSelectionIndices(anchorIndex, hitIndex);
      }
    };

    const stopEdgeScroll = () => {
      if (edgeScrollRaf !== null) {
        cancelAnimationFrame(edgeScrollRaf);
        edgeScrollRaf = null;
      }
    };

    const tickEdgeScroll = () => {
      if (!isMouseSelectingRef.current) {
        stopEdgeScroll();
        return;
      }

      const scrollDelta = getEdgeScrollDelta(lastPointer.y);
      if (scrollDelta !== 0) {
        const scroller = getScroller();
        if (scroller) {
          scroller.scrollTop += scrollDelta;
        }
        updateSelectionFromPointer(
          lastPointer.x,
          lastPointer.y,
          scrollDelta < 0 ? "up" : "down",
        );
      }

      if (getEdgeScrollDelta(lastPointer.y) !== 0) {
        edgeScrollRaf = requestAnimationFrame(tickEdgeScroll);
      } else {
        edgeScrollRaf = null;
      }
    };

    const syncEdgeScroll = (clientY: number) => {
      if (getEdgeScrollDelta(clientY) === 0) {
        stopEdgeScroll();
        return;
      }
      if (edgeScrollRaf === null) {
        edgeScrollRaf = requestAnimationFrame(tickEdgeScroll);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;

      const anchorIndex = getLogIndexFromNode(event.target as Node);
      if (anchorIndex === null) return;

      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      container.focus({ preventScroll: true });

      isMouseSelectingRef.current = true;
      setIsPointerSelecting(true);
      selectionAnchorIndexRef.current = anchorIndex;
      commitSelectionIndices(anchorIndex, anchorIndex);

      container.setPointerCapture(event.pointerId);

      if (isAutoscrollEnabledRef.current) {
        setIsAutoscrollEnabled(false);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!isMouseSelectingRef.current) return;
      lastPointer.x = event.clientX;
      lastPointer.y = event.clientY;
      updateSelectionFromPointer(event.clientX, event.clientY);
      syncEdgeScroll(event.clientY);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!isMouseSelectingRef.current) return;

      stopEdgeScroll();
      lastPointer.x = event.clientX;
      lastPointer.y = event.clientY;
      updateSelectionFromPointer(event.clientX, event.clientY);
      isMouseSelectingRef.current = false;
      setIsPointerSelecting(false);

      if (container.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (key === "escape") {
        selectionAnchorIndexRef.current = null;
        setSelectionRange(null);
        window.getSelection()?.removeAllRanges();
        return;
      }

      if (mod && key === "c") {
        if (!selectionRangeRef.current) return;
        event.preventDefault();
        copySelectedLogs();
      }
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);
    container.addEventListener("keydown", onKeyDown);

    return () => {
      stopEdgeScroll();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("keydown", onKeyDown);
    };
  }, [commitSelectionIndices, copySelectedLogs]);

  const toggleLevelFilter = (level: LogLevel) => {
    setLevelFilters((prev) => ({ ...prev, [level]: !prev[level] }));
  };

  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async () => {
    if (filteredLogs.length === 0) {
      toast.error(t('logs.no_logs_to_upload'));
      return;
    }

    setIsUploading(true);
    try {
      const logText = filteredLogs
        .map((log) => formatLogLineForCopy(log, true))
        .join("\n");

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
      virtuosoRef.current.scrollToIndex({ index: filteredLogs.length - 1, align: "end", behavior: "auto" });
    }
    setIsAutoscrollEnabled(true);
  };

  const renderLogLine = (index: number, log: DisplayLogLine) => {
    const isSelected =
      selectionRange !== null && index >= selectionRange.start && index <= selectionRange.end;
    const isLast = index === filteredLogs.length - 1;

    return (
      <div
        key={log.id}
        data-log-id={log.id}
        data-log-index={index}
        className={`flex flex-nowrap items-start py-0.5 px-2 -mx-2 rounded ${isLast ? "pb-2" : ""} ${
          isSelected ? "" : "hover:bg-white/5"
        }`}
        style={isSelected ? { backgroundColor: `${accentColor.value}33` } : undefined}
      >
        {log.timestamp ? (
          <>
            <span className={`pr-2 select-none min-w-0 max-w-[50%] whitespace-pre-wrap [overflow-wrap:anywhere] ${getLevelColorClass(log.level)}`}>
              <span className="opacity-80">[{log.timestamp}]</span>
              {showThreadPrefix && (
                <span className="opacity-80 ml-1">
                  [{log.thread}/{log.level}]
                </span>
              )}
            </span>
            <span
              className={`flex-1 min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap ${
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
            className={`flex-1 min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap ${
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
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 gap-2">
      {/* Log Header with Search & Filters */}
      <div
        className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-black/60 backdrop-blur-sm shrink-0"
        style={{ boxShadow: `0 4px 20px ${accentColor.value}15` }}
      >
        {/* Search Input */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded flex-[1_1_200px] min-w-0 max-w-full focus-within:outline focus-within:outline-2 focus-within:[outline-style:solid] focus-within:-outline-offset-2 focus-within:outline-white/70"
          style={{
            backgroundColor: `${accentColor.value}15`,
            border: `1px solid ${accentColor.value}30`,
          }}
        >
          <Icon icon="solar:magnifer-bold" className="w-4 h-4 text-white/50" />
          <input
            ref={searchInputRef}
            type="text"
            role="searchbox"
            placeholder={t('placeholders.search_logs')}
            aria-label={t('placeholders.search_logs')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-transparent text-sm font-minecraft text-white/90 placeholder:text-white/40 outline-none flex-1 min-w-0"
          />
          {searchTerm && (
            <button
              type="button"
              aria-label={t("common.clear_search")}
              onClick={handleClearSearch}
              className="text-white/40 hover:text-white/70 flex-shrink-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-white/70"
            >
              <Icon icon="solar:close-circle-bold" className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Level Filter Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(["ERROR", "WARN", "INFO", "DEBUG", "TRACE"] as LogLevel[]).map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={levelFilters[level]}
              onClick={() => toggleLevelFilter(level)}
              className="px-2.5 py-1 text-xs font-minecraft rounded transition-all"
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

        {logFiles && logFiles.length > 0 && onLogSelect && (
          <button
            ref={fileDropdownButtonRef}
            onClick={() => setIsFileDropdownOpen(!isFileDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-minecraft transition-all min-w-0 max-w-full"
            style={{
              backgroundColor: isFileDropdownOpen ? `${accentColor.value}25` : `${accentColor.value}15`,
              border: `1px solid ${accentColor.value}30`,
              color: "rgba(255,255,255,0.8)",
            }}
          >
            <Icon icon="solar:document-text-bold" className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">
              {selectedLogPath ? (selectedLogPath.split(/[\\/]/).pop() || selectedLogPath) : t('logs.select_log_placeholder')}
            </span>
            <Icon icon="solar:alt-arrow-down-bold" className="w-3 h-3 flex-shrink-0" />
          </button>
        )}

        {/* Settings Button */}
        <div className="relative ml-auto shrink-0">
          <button
            ref={settingsButtonRef}
            type="button"
            aria-label={t("logs.settings")}
            aria-expanded={isSettingsOpen}
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

      {error && (
        <div role="alert" className="shrink-0 max-h-32 overflow-y-auto flex flex-wrap items-start gap-2 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-100">
          <span className="flex-[1_1_160px] min-w-0 [overflow-wrap:anywhere]">{error}</span>
          {onRetry && <button type="button" onClick={handleRetry} disabled={isLoading} className="shrink-0 rounded px-2 py-1 hover:bg-white/10 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-white/70">{t("common.retry")}</button>}
        </div>
      )}

      {/* Log Content */}
      <div
        ref={logContainerRef}
        tabIndex={0}
        role="region"
        aria-label={t("logs.viewer_region")}
        onMouseDown={() => logContainerRef.current?.focus({ preventScroll: true })}
        onWheel={markUserScroll}
        onTouchMove={markUserScroll}
        onPointerDown={markUserScroll}
        className="flex-1 min-h-0 min-w-0 flex flex-col p-4 font-mono text-sm rounded-lg bg-black/60 backdrop-blur-sm focus-visible:outline focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-white/70"
        style={{ boxShadow: `0 4px 20px ${accentColor.value}15` }}
      >
        {logs.length > 0 && filteredLogs.length === 0 ? (
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center gap-3 text-center text-white/50">
            <p className="[overflow-wrap:anywhere]">{t("logs.no_matching_lines")}</p>
            <button type="button" className="rounded px-3 py-2 hover:bg-white/10 font-minecraft text-xs focus-visible:outline focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-white/70" onClick={handleResetFilters}>{t("logs.reset_filters")}</button>
          </div>
        ) : logs.length === 0 && isLoading && !error ? (
          <div role="status" className="flex items-center justify-center h-full text-white/50 font-minecraft text-sm">{t("logs.loading")}</div>
        ) : filteredLogs.length === 0 ? (
          !error && !isLoading && showNoLogs && showNoLogsMessage && (
            <div className="flex items-center justify-center h-full text-white/30">
              <div className="text-center">
                <Icon icon={noLogsIcon} className="w-12 h-12 mx-auto mb-2" />
                <p className="font-minecraft">{noLogsTitle}</p>
                <p className="text-xs mt-1">{noLogsSubtitle}</p>
              </div>
            </div>
          )
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className={`custom-scrollbar overflow-x-hidden ${isPointerSelecting ? "select-none" : "select-text"}`}
            style={{ flex: 1, minHeight: 0, minWidth: 0, width: "100%" }}
            data={filteredLogs}
            computeItemKey={(_index, log) => log.id}
            increaseViewportBy={{ top: 400, bottom: 400 }}
            atBottomStateChange={handleAtBottomChange}
            initialTopMostItemIndex={filteredLogs.length > 0 ? filteredLogs.length - 1 : 0}
            itemContent={(index, log) => renderLogLine(index, log)}
          />
        )}
      </div>

      {/* Status Bar */}
      <div
        className="px-4 py-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 shrink-0 rounded-lg bg-black/60 backdrop-blur-sm"
        style={{ boxShadow: `0 4px 20px ${accentColor.value}15` }}
      >
        <div className="flex flex-wrap min-w-0 items-center gap-x-4 gap-y-2 text-white/50 font-minecraft text-xs">
          <span className="flex items-center gap-1.5">
            <Icon icon="solar:document-text-bold" className="w-4 h-4" />
            {t('logs.lines_matching', { count: logs.length, shown: filteredLogs.length, total: logs.length })}
          </span>
          <button
            onClick={() =>
              isAutoscrollEnabled ? setIsAutoscrollEnabled(false) : scrollToBottom()
            }
            className="flex items-center gap-1.5 hover:text-white/70 transition-colors"
            style={{ color: isAutoscrollEnabled ? accentColor.value : undefined }}
          >
            <Icon
              icon={isAutoscrollEnabled ? "solar:arrow-down-bold" : "solar:pause-bold"}
              className="w-4 h-4"
            />
            {isAutoscrollEnabled ? t('logs.following') : t('logs.paused')}
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
              {t('logs.scroll_to_bottom')}
            </button>
          )}
        </div>

        <div className="flex flex-wrap min-w-0 items-center gap-2">
          {onClear && (
            <button
              onClick={onClear}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-white/10 transition-colors text-white/60 hover:text-white/90 font-minecraft text-xs"
            >
              <Icon icon="solar:trash-bin-trash-bold" className="w-4 h-4" />
              {t('logs.clear')}
            </button>
          )}
          {onOpenFolder && (
            <button
              onClick={onOpenFolder}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-white/10 transition-colors text-white/60 hover:text-white/90 font-minecraft text-xs"
            >
              <Icon icon="solar:folder-open-bold" className="w-4 h-4" />
              OPEN FOLDER
            </button>
          )}
          <button
            onClick={handleUpload}
            disabled={isUploading || filteredLogs.length === 0}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors font-minecraft text-xs ${
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
            {isUploading ? t('logs.uploading') : t('logs.upload')}
          </button>
        </div>
      </div>

      {/* Settings Popup */}
      {isSettingsOpen && settingsButtonRef.current && createPortal(
        <div
          ref={settingsPopupRef}
          className="fixed w-60 max-w-[calc(100vw-16px)] p-3 rounded-lg border"
          style={{
            top: settingsButtonRef.current.getBoundingClientRect().bottom + 8,
            right: Math.max(8, window.innerWidth - settingsButtonRef.current.getBoundingClientRect().right),
            backgroundColor: "rgba(0, 0, 0, 0.95)",
            borderColor: `${accentColor.value}40`,
            boxShadow: `0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px ${accentColor.value}20`,
            zIndex: 9999,
          }}
        >
          <div className="text-xs font-minecraft text-white/70 mb-3 pb-2 border-b border-white/10">
            {t('logs.settings')}
          </div>

          <button type="button" role="switch" aria-checked={showThreadPrefix} aria-label={t("logs.thread_prefix")} onClick={toggleShowThreadPrefix} className="w-full text-left flex items-center gap-3 cursor-pointer group">
            <div
              className="relative w-9 h-5 rounded-full transition-all cursor-pointer"
              style={{
                backgroundColor: showThreadPrefix
                  ? `${accentColor.value}80`
                  : "rgba(255,255,255,0.15)",
              }}
            >
              <div
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-all"
                style={{
                  left: showThreadPrefix ? "calc(100% - 18px)" : "2px",
                }}
              />
            </div>
            <div className="flex-1">
              <div className="text-sm text-white/90 font-minecraft">
                {t('logs.thread_prefix')}
              </div>
              <div className="text-xs text-white/50 font-sans">
                {t('logs.thread_prefix_desc')}
              </div>
            </div>
          </button>
        </div>,
        document.body
      )}

      {isFileDropdownOpen && fileDropdownButtonRef.current && createPortal(
        <div
          ref={fileDropdownRef}
          className="fixed w-80 max-w-[calc(100vw-16px)] max-h-[300px] overflow-y-auto p-1 rounded-lg border custom-scrollbar"
          style={{
            top: fileDropdownButtonRef.current.getBoundingClientRect().bottom + 8,
            right: Math.max(8, window.innerWidth - fileDropdownButtonRef.current.getBoundingClientRect().right),
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
                className="w-full text-left px-3 py-2 text-xs font-minecraft rounded transition-all hover:bg-white/5 [overflow-wrap:anywhere]"
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
