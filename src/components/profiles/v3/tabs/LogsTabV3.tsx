"use client";

/**
 * LogsTabV3 — functional log-reader.
 *
 * Read-only (like V2) — live tailing overlaps with the Launcher console
 * window. Virtuoso for large log files, level pills + text search +
 * stack-trace-inherit filter logic.
 */

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
  uploadLogToMclogs,
  parseLogLinesFromString,
  LOG_LEVELS,
  type LogLevel,
  type ParsedLogLine,
} from "../../../../services/log-service";
import { useThemeStore } from "../../../../store/useThemeStore";
import { useDelayedTrue } from "../../../../hooks/useDelayedTrue";
import { Tooltip } from "../../../ui/Tooltip";
import { ThemedDropdown, ThemedDropdownItem } from "../shared/ThemedDropdown";
import { EmptyStateV3 } from "../shared/EmptyStateV3";
import { parseErrorMessage } from "../../../../utils/error-utils";

interface LogsTabV3Props {
  profile: Profile;
  isActive?: boolean;
  onRefresh?: () => void;
}

// ─── Level-Farb-Mapping ─────────────────────────────────────────────────────
// `text` matches V2 LogViewerCore exactly (important for consistent feel).
// `pillBg/pillBorder` are only for the toolbar filter pills — those stay in
// V3-style accent-tinted values.
const LEVEL_CONFIG: Record<LogLevel, { text: string; pillBg: string; pillBorder: string; pillHover: string }> = {
  ERROR: { text: "text-red-400",    pillBg: "bg-rose-500/10",   pillBorder: "border-rose-400/30",   pillHover: "hover:bg-rose-500/20" },
  WARN:  { text: "text-yellow-400", pillBg: "bg-amber-500/10",  pillBorder: "border-amber-400/30",  pillHover: "hover:bg-amber-500/20" },
  INFO:  { text: "text-blue-400",   pillBg: "bg-sky-500/10",    pillBorder: "border-sky-400/30",    pillHover: "hover:bg-sky-500/20" },
  DEBUG: { text: "text-cyan-400",   pillBg: "bg-cyan-500/10",   pillBorder: "border-cyan-400/30",   pillHover: "hover:bg-cyan-500/20" },
  TRACE: { text: "text-purple-400", pillBg: "bg-violet-500/10", pillBorder: "border-violet-400/30", pillHover: "hover:bg-violet-500/20" },
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
    if (!rawContent || isUploading) return;
    setIsUploading(true);
    try {
      const url = await toast.promise(
        uploadLogToMclogs(rawContent),
        {
          loading: t("profiles.v3.logs.uploading"),
          success: (u: string) => t("profiles.v3.logs.uploadSuccess", { url: u }),
          error: (err) => t("profiles.v3.logs.uploadFailed", { error: parseErrorMessage(err) }),
        },
      );
      // Copy URL to clipboard so the user can paste it straight into a chat.
      try {
        await navigator.clipboard.writeText(url);
        toast.success(t("profiles.v3.logs.urlCopied"));
      } catch { /* clipboard blocked — fine */ }
    } finally {
      if (mountedRef.current) setIsUploading(false);
    }
  }, [rawContent, isUploading, t]);

  const scrollToBottom = useCallback(() => {
    if (virtuosoRef.current && visibleLines.length > 0) {
      virtuosoRef.current.scrollToIndex({ index: visibleLines.length - 1, behavior: "auto" });
    }
  }, [visibleLines.length]);

  const selectedFilename = selectedPath ? getFilename(selectedPath) : t("profiles.v3.logs.noFile");

  return (
    <div className="flex flex-col min-h-0 flex-1 relative">
      {/* ── Sticky Toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-5 h-12 border-b border-white/5 flex-shrink-0 bg-black/20 sticky top-0 z-10">
        <div className="relative w-64 flex-shrink-0">
          <Icon icon="solar:magnifer-linear" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("profiles.v3.logs.searchPlaceholder")}
            className="w-full h-8 pl-8 pr-3 rounded-md bg-white/5 border border-white/10 focus:border-white/25 outline-none text-sm text-white placeholder:text-white/30 font-minecraft-ten"
          />
        </div>

        <div className="flex items-center gap-1">
          {LOG_LEVELS.map((lvl) => {
            const cfg = LEVEL_CONFIG[lvl];
            const active = enabledLevels[lvl];
            return (
              <button
                key={lvl}
                onClick={() => toggleLevel(lvl)}
                className={`h-8 px-2 rounded-md border text-[10px] font-minecraft-ten uppercase tracking-wider transition-colors ${
                  active
                    ? `${cfg.pillBg} ${cfg.pillBorder} ${cfg.text}`
                    : `bg-white/[0.02] border-white/10 text-white/30 ${cfg.pillHover}`
                }`}
                title={active ? t("profiles.v3.logs.hideLevel", { level: lvl }) : t("profiles.v3.logs.showLevel", { level: lvl })}
              >
                {lvl}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* File-Picker */}
        <div className="relative">
          <button
            onClick={() => setFileMenuOpen(v => !v)}
            disabled={logFiles.length === 0}
            className="h-8 px-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-minecraft-ten text-white/80 flex items-center gap-1.5 max-w-[220px] disabled:opacity-50"
          >
            <Icon icon="solar:file-text-bold" className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{selectedFilename}</span>
            <Icon icon="solar:alt-arrow-down-linear" className="w-3 h-3 opacity-60 flex-shrink-0" />
          </button>
          <ThemedDropdown open={fileMenuOpen} onClose={() => setFileMenuOpen(false)} width="w-60" scrollable>
            {logFiles.map((path) => {
              const name = getFilename(path);
              return (
                <ThemedDropdownItem
                  key={path}
                  icon={name === "latest.log" ? "solar:pin-bold" : "solar:file-text-linear"}
                  selected={selectedPath === path}
                  onClick={() => { setSelectedPath(path); setFileMenuOpen(false); }}
                >
                  {name}
                </ThemedDropdownItem>
              );
            })}
          </ThemedDropdown>
        </div>

        <Tooltip content={t("profiles.v3.logs.uploadTitle")}>
          <button
            onClick={handleUpload}
            disabled={!rawContent || isUploading}
            className="h-8 w-8 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white disabled:opacity-50 flex items-center justify-center transition-colors"
          >
            <Icon icon={isUploading ? "solar:refresh-bold" : "solar:cloud-upload-bold"} className={`w-4 h-4 ${isUploading ? "animate-spin" : ""}`} />
          </button>
        </Tooltip>
        <Tooltip content={t("profiles.v3.logs.openFolderTitle")}>
          <button
            onClick={handleOpenFolder}
            disabled={!selectedPath}
            className="h-8 w-8 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white disabled:opacity-50 flex items-center justify-center transition-colors"
          >
            <Icon icon="solar:folder-linear" className="w-4 h-4" />
          </button>
        </Tooltip>

        {/* Settings */}
        <div className="relative">
          <button
            onClick={() => setSettingsOpen(v => !v)}
            className="h-8 w-8 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white flex items-center justify-center transition-colors"
            title={t("profiles.v3.logs.settingsTitle")}
          >
            <Icon icon="solar:settings-bold" className="w-4 h-4" />
          </button>
          <ThemedDropdown open={settingsOpen} onClose={() => setSettingsOpen(false)} width="w-56">
            <SettingsToggle
              label={t("profiles.v3.logs.showThreadPrefix")}
              checked={showThreadPrefix}
              onChange={() => setShowThreadPrefix(v => !v)}
              accent={accentColor.value}
            />
            <SettingsToggle
              label={t("profiles.v3.logs.wordWrap")}
              checked={wordWrap}
              onChange={() => setWordWrap(v => !v)}
              accent={accentColor.value}
            />
          </ThemedDropdown>
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
            <div className="flex-1 min-w-0 text-xs font-minecraft-ten text-rose-100 break-words">{error}</div>
            <button
              onClick={loadFiles}
              className="flex-shrink-0 h-7 px-2 rounded-md text-[10px] font-minecraft-ten uppercase tracking-wider text-rose-100 hover:bg-rose-500/20 transition-colors"
            >
              {t("profiles.v3.content.retry")}
            </button>
          </div>
        )}

        {isLoadingList && logFiles.length === 0 && !error ? (
          <div className="flex items-center justify-center h-full text-white/40 font-minecraft-ten text-sm">
            <Icon icon="solar:refresh-bold" className="w-4 h-4 mr-2 animate-spin" />
            {t("profiles.v3.content.loading")}
          </div>
        ) : logFiles.length === 0 && !isLoadingList ? (
          <EmptyStateV3
            icon="solar:clipboard-text-bold-duotone"
            title={t("profiles.v3.logs.emptyFiles")}
            hint={t("profiles.v3.logs.emptyFilesHint")}
          />
        ) : isLoadingContent && parsedLines.length === 0 ? (
          shouldShowLoading ? (
            <div className="flex items-center justify-center h-full text-white/40 font-minecraft-ten text-sm animate-in fade-in duration-300">
              <Icon icon="solar:refresh-bold" className="w-4 h-4 mr-2 animate-spin" />
              {t("profiles.v3.content.loading")}
            </div>
          ) : null
        ) : visibleLines.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <EmptyStateV3
              icon="solar:magnifer-linear"
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
            className="font-mono text-xs select-text px-3"
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
            className="absolute bottom-4 right-4 h-9 px-3 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-100 text-xs font-minecraft-ten uppercase tracking-wider flex items-center gap-1.5 shadow-lg transition-colors animate-in fade-in duration-200"
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

// ─── Log Line ───────────────────────────────────────────────────────────────
// Format matches V2 LogViewerCore exactly:
//   `[HH:MM:SS] message`                 (default)
//   `[HH:MM:SS] [thread/LEVEL] message`  (when showThreadPrefix is on)
// The prefix takes the level colour at opacity-80; the message itself is
// white/90 except ERROR/WARN which use the level colour. Continuation lines
// (no timestamp) span the full width. Hover/padding matches V2:
// `py-0.5 hover:bg-white/5 px-2 -mx-2 rounded`.
interface LogLineProps {
  line: ParsedLogLine;
  showThreadPrefix: boolean;
  wordWrap: boolean;
}

const LogLine: React.FC<LogLineProps> = ({ line, showThreadPrefix, wordWrap }) => {
  const cfg = line.level ? LEVEL_CONFIG[line.level] : null;
  const wrapClass = wordWrap ? "break-words whitespace-pre-wrap" : "whitespace-pre overflow-x-auto";
  // Message colour: ERROR/WARN stand out; other levels stay in neutral white/90.
  const isEmphasizedLevel = line.level === "ERROR" || line.level === "WARN";
  const messageColor = isEmphasizedLevel && cfg ? cfg.text : "text-white/90";

  return (
    <div className="flex flex-nowrap items-start py-0.5 hover:bg-white/5 px-2 -mx-2 rounded">
      {line.timestamp ? (
        <>
          <span className={`pr-2 select-none ${cfg?.text ?? "text-white/70"}`}>
            <span className="opacity-80">[{line.timestamp}]</span>
            {showThreadPrefix && line.thread && (
              <span className="opacity-80 ml-1">
                [{line.thread}/{line.level ?? ""}]
              </span>
            )}
          </span>
          <span className={`flex-1 min-w-0 ${wrapClass} ${messageColor}`}>{line.text}</span>
        </>
      ) : (
        <span className={`flex-1 min-w-0 ${wrapClass} ${messageColor}`}>{line.text}</span>
      )}
    </div>
  );
};

// ─── Settings Toggle ────────────────────────────────────────────────────────
const SettingsToggle: React.FC<{ label: string; checked: boolean; onChange: () => void; accent: string }> = ({
  label, checked, onChange, accent,
}) => (
  <button
    onClick={onChange}
    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-xs font-minecraft-ten text-white/80 hover:text-white hover:bg-white/5 transition-colors"
  >
    <span>{label}</span>
    <div
      style={checked ? { backgroundColor: accent } : undefined}
      className={`relative w-8 h-4 rounded-full transition-colors ${checked ? "" : "bg-white/10"}`}
    >
      <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`} />
    </div>
  </button>
);
