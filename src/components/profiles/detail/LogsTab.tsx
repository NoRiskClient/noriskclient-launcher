"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Profile } from "../../../types/profile";
import {
  getLogFileContent,
  getProfileLogFiles,
  LOG_LEVELS,
  type LogLevel,
  openLogFileDirectory,
  type ParsedLogLine,
  parseLogLinesFromString,
  uploadLogToMclogs,
} from "../../../services/log-service";
import { LogViewerDisplay } from "../../log/LogViewerDisplay";
import { useThemeStore } from "../../../store/useThemeStore";
import { toast } from "react-hot-toast";
import { gsap } from "gsap";

interface LogsTabProps {
  profile: Profile;
  isActive?: boolean;
  onRefresh?: () => void;
}

function getFilename(path: string | null): string {
  if (!path) return "";
  return path.split(/[\\/]/).pop() || path;
}

export function LogsTab({
  profile,
  isActive = false,
  onRefresh,
}: LogsTabProps) {
  const { t } = useTranslation();
  const [logFiles, setLogFiles] = useState<string[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [errorList, setErrorList] = useState<string | null>(null);

  const [selectedLogPath, setSelectedLogPath] = useState<string | null>(null);
  const [parsedLogLines, setParsedLogLines] = useState<ParsedLogLine[]>([]);
  const [rawLogContentForCopy, setRawLogContentForCopy] = useState<
    string | null
  >(null);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [errorContent, setErrorContent] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [levelFilters, setLevelFilters] = useState<Record<LogLevel, boolean>>({
    ERROR: true,
    WARN: true,
    INFO: true,
    DEBUG: true,
    TRACE: true,
  });

  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [displayLines, setDisplayLines] = useState<ParsedLogLine[]>([]);
  const scrollableContainerRef = useRef<HTMLDivElement>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && containerRef.current) {
      gsap.fromTo(
        containerRef.current,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          ease: "power2.out",
        },
      );
    }
  }, [isActive]);

  useEffect(() => {
    if (!profile?.id) return;

    const loadFiles = async () => {
      console.log(`[LogsTab] Fetching logs for profile: ${profile.id}`);
      setIsLoadingList(true);
      setErrorList(null);
      setLogFiles([]);
      setSelectedLogPath(null);
      setParsedLogLines([]);
      setRawLogContentForCopy(null);
      setErrorContent(null);
      setSearchTerm("");

      try {
        const paths = await getProfileLogFiles(profile.id);
        paths.sort((a, b) => {
          const aName = getFilename(a).toLowerCase();
          const bName = getFilename(b).toLowerCase();
          if (aName === "latest.log") return -1;
          if (bName === "latest.log") return 1;
          if (typeof aName === "string" && typeof bName === "string") {
            return bName.localeCompare(aName);
          }
          return 0;
        });
        setLogFiles(paths);
        console.log(`[LogsTab] Found ${paths.length} log files.`);

        if (paths.length > 0) {
          setSelectedLogPath(paths[0]);
          console.log(`[LogsTab] Automatically selected log: ${paths[0]}`);
        } else {
          setSelectedLogPath(null);
        }

        if (onRefresh) onRefresh();
      } catch (err: any) {
        console.error("[LogsTab] Error fetching log files:", err);
        setErrorList(err?.message ?? "Failed to load log files");
      } finally {
        setIsLoadingList(false);
      }
    };

    loadFiles();
  }, [profile?.id, onRefresh]);

  useEffect(() => {
    if (!selectedLogPath) {
      setParsedLogLines([]);
      setRawLogContentForCopy(null);
      setErrorContent(null);
      setSearchTerm("");
      setIsLoadingContent(false);
      return;
    }

    const loadContent = async () => {
      console.log(`[LogsTab] Fetching content for log: ${selectedLogPath}`);
      setIsLoadingContent(true);
      setErrorContent(null);
      setParsedLogLines([]);
      setRawLogContentForCopy(null);

      try {
        const rawContent = await getLogFileContent(selectedLogPath);
        setRawLogContentForCopy(rawContent);

        const processedLines = parseLogLinesFromString(rawContent);

        setParsedLogLines(processedLines);
        console.log(
          `[LogsTab] Loaded and parsed ${processedLines.length} lines for ${selectedLogPath}`,
        );
      } catch (err: any) {
        console.error(
          `[LogsTab] Error fetching/parsing log content for ${selectedLogPath}:`,
          err,
        );
        setErrorContent(err?.message ?? "Failed to load log content");
      } finally {
        setIsLoadingContent(false);
      }
    };

    loadContent();
  }, [selectedLogPath]);

  useEffect(() => {
    const linesAfterLevelFilter = parsedLogLines.filter((line) => {
      if (!line.level) return true;
      return levelFilters[line.level];
    });

    const linesAfterSearchFilter = linesAfterLevelFilter.filter((line) => {
      if (!searchTerm) return true;
      return line.raw.toLowerCase().includes(searchTerm.toLowerCase().trim());
    });

    setDisplayLines(linesAfterSearchFilter);
  }, [parsedLogLines, searchTerm, levelFilters]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleLogSelect = useCallback((value: string) => {
    setSelectedLogPath(value || null);
  }, []);

  const handleLevelFilterChange = useCallback(
    (level: LogLevel, checked: boolean) => {
      setLevelFilters((prev) => ({ ...prev, [level]: checked }));
    },
    [],
  );

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
  }, []);

  const handleCopyLog = useCallback(async () => {
    if (displayLines.length === 0) return;

    const filteredLogContent = displayLines.map((line) => line.raw).join("\n");

    try {
      await writeText(filteredLogContent);
      toast.success(t('logs.copy_success'));
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error("[LogsTab] Failed to copy log to clipboard:", err);
      toast.error(t('logs.copy_failed'));
    }
  }, [displayLines, t]);

  const handleUploadLog = useCallback(async (): Promise<string> => {
    if (!rawLogContentForCopy || !selectedLogPath) {
      throw new Error(
        "No log content available to upload or no log file selected.",
      );
    }
    console.log(`[LogsTab] Uploading log: ${getFilename(selectedLogPath)}`);
    return uploadLogToMclogs(rawLogContentForCopy);
  }, [rawLogContentForCopy, selectedLogPath]);

  const handleOpenLogsFolder = useCallback(async () => {
    const path_to_open =
      logFiles.find((p) => getFilename(p).toLowerCase() === "latest.log") ||
      logFiles[0];
    if (!path_to_open) {
      setErrorList("No log files found to determine folder path.");
      return;
    }
    console.log(
      `[LogsTab] Requesting to open directory for file: ${path_to_open}`,
    );
    try {
      await openLogFileDirectory(path_to_open);
    } catch (err: any) {
      console.error("[LogsTab] Error opening logs folder:", err);
      setErrorList(err?.message ?? "Failed to open logs folder");
    }
  }, [logFiles]);

  const handleOpenUrl = useCallback(async (url: string) => {
    if (!url) return;
    try {
      await openUrl(url);
    } catch (err) {
      console.error(`[LogsTab] Failed to open URL ${url}:`, err);
    }
  }, []);

  return (
    <div ref={containerRef} className="h-full flex flex-col select-none">
      <div className="flex-1 min-h-0 flex flex-col">
        <LogViewerDisplay
          isLoading={isLoadingList || isLoadingContent}
          error={errorList || errorContent}
          displayLines={displayLines}
          parsedLogLinesCount={parsedLogLines.length}
          searchTerm={searchTerm}
          levelFilters={levelFilters}
          copied={copied}
          onSearchChange={handleSearchChange}
          onLevelFilterChange={handleLevelFilterChange}
          onCopyLog={handleCopyLog}
          onUploadLog={handleUploadLog}
          onOpenFolder={handleOpenLogsFolder}
          onOpenUploadUrl={handleOpenUrl}
          logFiles={logFiles}
          selectedLogPath={selectedLogPath}
          onLogSelect={handleLogSelect}
          logLevelsDefinition={LOG_LEVELS}
          scrollableContainerRef={scrollableContainerRef}
          isInsideLogWindow={false}
        />
      </div>
    </div>
  );
}
