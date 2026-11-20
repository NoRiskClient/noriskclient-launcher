/**
 * LogsTabV3 — functional log-reader.
 *
 * Read-only (like V2) — live tailing overlaps with the Launcher console
 * window. Virtuoso for large log files, level pills + text search +
 * stack-trace-inherit filter logic.
 */

import { shareLogWithToast } from "../../../share/share-toast";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import type { Profile } from "../../../../types/profile";
import {
  getLogFileContent,
  getProfileLogFiles,
  openLogFileDirectory,
  parseLogLinesFromString,
  LOG_LEVELS,
  type LogLevel,
  type ParsedLogLine,
} from "../../../../services/log-service";
import { useThemeStore } from "../../../../store/useThemeStore";
import { useDelayedTrue } from "../../../../hooks/useDelayedTrue";
import { SearchWithFilters } from "../../../ui/SearchWithFilters";
import { ContentActionButtons } from "../../../ui/ContentActionButtons";
import { ToggleSwitch } from "../../../ui/ToggleSwitch";
import { ThemedDropdown, ThemedDropdownItem } from "../shared/ThemedDropdown";
import { EmptyStateV3 } from "../shared/EmptyStateV3";
import { Chip, FILTER_CHIP_CLASS } from "../../settings/SettingsSection";
import { parseErrorMessage } from "../../../../utils/error-utils";

interface LogsTabV3Props {
  profile: Profile;
  isActive?: boolean;
  onRefresh?: () => void;
}

const LEVEL_CONFIG: Record<LogLevel, { text: string; dot: string; row?: string }> = {
  ERROR: { text: "text-red-300", dot: "bg-red-400", row: "bg-red-500/[0.07] border-red-400/70" },
  WARN: { text: "text-amber-200", dot: "bg-amber-400", row: "bg-amber-500/[0.06] border-amber-400/60" },
  INFO: { text: "text-sky-300", dot: "bg-sky-400" },
  DEBUG: { text: "text-cyan-300", dot: "bg-cyan-400" },
  TRACE: { text: "text-violet-300", dot: "bg-violet-400" },
};

const DEFAULT_LEVELS: Record<LogLevel, boolean> = {
  ERROR: true, WARN: true, INFO: true, DEBUG: true, TRACE: false,
};

function getFilename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function LogsTabV3({ profile, isActive = true, onRefresh }: LogsTabV3Props) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);

  // ── Data ──────────────────────────────────────────────────────────────────
  const [logFiles, setLogFiles] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [rawContent, setRawContent] = useState<string>("");
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [enabledLevels, setEnabledLevels] = useState<Record<LogLevel, boolean>>(DEFAULT_LEVELS);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showThreadPrefix, setShowThreadPrefix] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Load file list ────────────────────────────────────────────────────────
  // `selectedPath` is NOT in the deps — we use the functional-setState
  // pattern so the callback isn't rebuilt on every file switch. On profile
  // change, if the previous path doesn't exist in the new list we fall back
  // to paths[0] (usually `latest.log`).
  const loadFiles = useCallback(async () => {
    if (!profile?.id) return;
    setIsLoadingList(true);
    setError(null);
    try {
      const paths = await getProfileLogFiles(profile.id);
      if (!mountedRef.current) return;
      // latest.log pinned to top, rest sorted by filename descending (newer first).
      paths.sort((a, b) => {
        const aName = getFilename(a).toLowerCase();
        const bName = getFilename(b).toLowerCase();
        if (aName === "latest.log") return -1;
        if (bName === "latest.log") return 1;
        return bName.localeCompare(aName);
      });
      setLogFiles(paths);
      setSelectedPath(prev => (prev && paths.includes(prev)) ? prev : (paths[0] ?? null));
      onRefresh?.();
    } catch (err) {
      console.error("[V3 Logs] Failed to list:", err);
      if (mountedRef.current) setError(parseErrorMessage(err));
    } finally {
      if (mountedRef.current) setIsLoadingList(false);
    }
  }, [profile.id, onRefresh]);

  useEffect(() => {
    if (isActive) void loadFiles();
  }, [isActive, loadFiles]);

  // ── Load content when file changes ────────────────────────────────────────
  useEffect(() => {
    if (!selectedPath) {
      setRawContent("");
      return;
    }
    setIsLoadingContent(true);
    setError(null);
    (async () => {
      try {
        const content = await getLogFileContent(selectedPath);
        if (mountedRef.current) setRawContent(content);
      } catch (err) {
        console.error("[V3 Logs] Failed to load content:", err);
        if (mountedRef.current) setError(parseErrorMessage(err));
      } finally {
        if (mountedRef.current) setIsLoadingContent(false);
      }
    })();
  }, [selectedPath]);

  // Parse — memoized so we don't re-parse the full string on every render.
  const parsedLines = useMemo<ParsedLogLine[]>(() => {
    if (!rawContent) return [];
    return parseLogLinesFromString(rawContent);
  }, [rawContent]);

  // ── Filter (mit Stack-Trace-Inherit) ──────────────────────────────────────
  const visibleLines = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const result: ParsedLogLine[] = [];
    let inheritedLevel: LogLevel | null = null;
    for (const line of parsedLines) {
      const effective = line.level ?? inheritedLevel;
      if (line.level) inheritedLevel = line.level;
      if (effective && !enabledLevels[effective]) continue;
      if (!effective && !Object.values(enabledLevels).some(Boolean)) continue;
      if (q) {
        const hay = `${line.text} ${line.thread ?? ""} ${line.level ?? ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      result.push(line);
    }
    return result;
  }, [parsedLines, searchQuery, enabledLevels]);

  const shouldShowLoading = useDelayedTrue(isLoadingContent && parsedLines.length === 0, 500);

  // ── Actions ───────────────────────────────────────────────────────────────
  const toggleLevel = (lvl: LogLevel) => setEnabledLevels(prev => ({ ...prev, [lvl]: !prev[lvl] }));

  const handleOpenFolder = useCallback(async () => {
    if (!selectedPath) return;
    try {
      await openLogFileDirectory(selectedPath);
    } catch (err) {
      toast.error(parseErrorMessage(err));
    }
  }, [selectedPath]);

  const handleUpload = useCallback(async () => {
    if (!rawContent || !selectedPath || isUploading) return;
    setIsUploading(true);
    try {
      await shareLogWithToast(rawContent, getFilename(selectedPath));
    } finally {
      if (mountedRef.current) setIsUploading(false);
    }
  }, [rawContent, selectedPath, isUploading, t]);

  const scrollToBottom = useCallback(() => {
    if (virtuosoRef.current && visibleLines.length > 0) {
      virtuosoRef.current.scrollToIndex({ index: visibleLines.length - 1, behavior: "auto" });
    }
  }, [visibleLines.length]);

  return (
    <div className="flex flex-col min-h-0 flex-1 relative">
      {/* ── Sticky Toolbar ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5 px-5 py-2.5 border-b border-white/10 flex-shrink-0 bg-black/20 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <SearchWithFilters
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            placeholder={t("profiles.v3.logs.searchPlaceholder")}
            showSort={false}
            showFilter={false}
            compact
            className="flex-1 min-w-0"
          />
          <div className="relative">
            <button
              onClick={() => setFileMenuOpen((v) => !v)}
              disabled={logFiles.length === 0}
              className="h-9 w-52 px-3 rounded-lg bg-black/50 border border-white/10 hover:border-white/20 flex items-center gap-2 text-sm font-minecraft text-white/80 disabled:opacity-50 transition-colors"
            >
              <Icon icon="solar:file-text-bold" className="w-4 h-4 shrink-0 text-white/50" />
              <span className="flex-1 truncate text-left">{selectedPath ? getFilename(selectedPath) : t("profiles.v3.logs.noFile")}</span>
              <Icon icon="solar:alt-arrow-down-bold" className="w-3.5 h-3.5 opacity-60 shrink-0" />
            </button>
            <ThemedDropdown open={fileMenuOpen} onClose={() => setFileMenuOpen(false)} width="w-60" scrollable>
              {logFiles.map((path) => {
                const name = getFilename(path);
                return (
                  <ThemedDropdownItem
                    key={path}
                    icon={name === "latest.log" ? "solar:pin-bold" : "solar:file-text-bold"}
                    selected={selectedPath === path}
                    onClick={() => { setSelectedPath(path); setFileMenuOpen(false); }}
                  >
                    {name}
                  </ThemedDropdownItem>
                );
              })}
            </ThemedDropdown>
          </div>
          <div className="relative">
            <ContentActionButtons
              size="sm"
              actions={[
                {
                  id: "upload",
                  icon: "solar:cloud-upload-bold",
                  variant: "text",
                  tooltip: t("profiles.v3.logs.uploadTitle"),
                  disabled: !rawContent,
                  loading: isUploading,
                  onClick: handleUpload,
                },
                {
                  id: "folder",
                  icon: "solar:folder-open-bold",
                  variant: "text",
                  tooltip: t("profiles.v3.logs.openFolderTitle"),
                  disabled: !selectedPath,
                  onClick: handleOpenFolder,
                },
                {
                  id: "settings",
                  icon: "solar:settings-bold",
                  variant: "text",
                  tooltip: t("profiles.v3.logs.settingsTitle"),
                  onClick: () => setSettingsOpen((v) => !v),
                },
              ]}
            />
            <ThemedDropdown open={settingsOpen} onClose={() => setSettingsOpen(false)} width="w-56">
              <SettingsToggle
                label={t("profiles.v3.logs.showThreadPrefix")}
                checked={showThreadPrefix}
                onChange={() => setShowThreadPrefix(v => !v)}
              />
              <SettingsToggle
                label={t("profiles.v3.logs.wordWrap")}
                checked={wordWrap}
                onChange={() => setWordWrap(v => !v)}
              />
            </ThemedDropdown>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {LOG_LEVELS.map((lvl) => (
            <Chip key={lvl} active={enabledLevels[lvl]} accent={accentColor.value} onClick={() => toggleLevel(lvl)} dot={LEVEL_CONFIG[lvl].dot} className={FILTER_CHIP_CLASS}>{lvl}</Chip>
          ))}
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      {/* py-3 gives the first/last line breathing room from the toolbar and
          jump-to-bottom button. Virtuoso needs `flex: 1 + minHeight: 0`, the
          default would clamp it to ~400px. */}
      <div className="flex-1 min-h-0 relative flex flex-col py-3">
        {error && (
          <div className="absolute top-3 left-3 right-3 z-20 flex items-start gap-3 p-3 rounded-lg border border-rose-400/30 bg-rose-500/10">
            <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-xs font-minecraft text-rose-100 break-words">{error}</div>
            <button
              onClick={loadFiles}
              className="flex-shrink-0 h-7 px-2 rounded-md text-[10px] font-minecraft uppercase tracking-wider text-rose-100 hover:bg-rose-500/20 transition-colors"
            >
              {t("profiles.v3.content.retry")}
            </button>
          </div>
        )}

        {isLoadingList && logFiles.length === 0 && !error ? (
          <div className="flex items-center justify-center h-full text-white/40 font-minecraft text-sm">
            <Icon icon="svg-spinners:ring-resize" className="w-4 h-4 mr-2" />
            {t("profiles.v3.content.loading")}
          </div>
        ) : logFiles.length === 0 && !isLoadingList ? (
          <EmptyStateV3
            icon="solar:clipboard-text-bold"
            title={t("profiles.v3.logs.emptyFiles")}
            hint={t("profiles.v3.logs.emptyFilesHint")}
          />
        ) : isLoadingContent && parsedLines.length === 0 ? (
          shouldShowLoading ? (
            <div className="flex items-center justify-center h-full text-white/40 font-minecraft text-sm animate-in fade-in duration-300">
              <Icon icon="svg-spinners:ring-resize" className="w-4 h-4 mr-2" />
              {t("profiles.v3.content.loading")}
            </div>
          ) : null
        ) : visibleLines.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <EmptyStateV3
              icon="solar:magnifer-bold"
              title={searchQuery
                ? t("profiles.v3.logs.noMatchSearch", { query: searchQuery })
                : t("profiles.v3.logs.noMatchFilter")}
              hint={searchQuery ? undefined : t("profiles.v3.logs.noMatchFilterHint")}
            />
          </div>
        ) : (
          <Virtuoso
            // Remount on file switch so the scroll position resets and
            // `followOutput="auto"` lands on the newest line.
            key={selectedPath ?? "none"}
            ref={virtuosoRef}
            data={visibleLines}
            atBottomStateChange={setAtBottom}
            className={`font-mono text-xs select-text px-3 ${wordWrap ? "overflow-x-hidden" : ""}`}
            style={{ flex: 1, minHeight: 0 }}
            itemContent={(_idx, line) => (
              <LogLine line={line} showThreadPrefix={showThreadPrefix} wordWrap={wordWrap} />
            )}
            followOutput="auto"
            increaseViewportBy={400}
          />
        )}

        {/* Jump-to-bottom */}
        {!atBottom && visibleLines.length > 10 && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-5 h-8 px-3 rounded-md border text-white text-[11px] font-minecraft uppercase tracking-wider flex items-center gap-1.5 shadow-lg shadow-black/50 backdrop-blur-md transition-colors animate-in fade-in duration-200"
            style={{ backgroundColor: `${accentColor.value}40`, borderColor: `${accentColor.value}80` }}
            title={t("profiles.v3.logs.jumpToBottom")}
          >
            <Icon icon="solar:alt-arrow-down-bold" className="w-4 h-4" />
            {t("profiles.v3.logs.jumpToBottom")}
          </button>
        )}
      </div>
    </div>
  );
}

interface LogLineProps {
  line: ParsedLogLine;
  showThreadPrefix: boolean;
  wordWrap: boolean;
}

const LogLine: React.FC<LogLineProps> = ({ line, showThreadPrefix, wordWrap }) => {
  const cfg = line.level ? LEVEL_CONFIG[line.level] : null;
  const wrapClass = wordWrap ? "break-words whitespace-pre-wrap" : "whitespace-pre";
  const messageColor = cfg?.row ? cfg.text : "text-white/85";

  return (
    <div className={`flex flex-nowrap items-start py-0.5 pl-2 pr-2 border-l-2 hover:bg-white/5 ${cfg?.row ?? "border-transparent"}`}>
      {line.timestamp && (
        <span className="pr-3 select-none text-white/30 tabular-nums">
          {line.timestamp}
          {showThreadPrefix && line.thread && (
            <span className={`ml-2 ${cfg?.text ?? "text-white/50"} opacity-70`}>
              {line.thread}/{line.level ?? ""}
            </span>
          )}
        </span>
      )}
      <span className={`flex-1 min-w-0 ${wrapClass} ${messageColor}`}>{line.text}</span>
    </div>
  );
};

const SettingsToggle: React.FC<{ label: string; checked: boolean; onChange: () => void }> = ({ label, checked, onChange }) => (
  <div className="w-full flex items-center justify-between gap-3 px-3 py-2 text-xs font-minecraft text-white/80">
    <span>{label}</span>
    <ToggleSwitch checked={checked} onChange={onChange} size="sm" />
  </div>
);
