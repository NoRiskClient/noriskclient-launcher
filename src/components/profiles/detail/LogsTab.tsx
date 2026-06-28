"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { Profile } from "../../../types/profile";
import {
  getLogFileContent,
  getProfileLogFiles,
  openLogFileDirectory,
  type ParsedLogLine,
  parseLogLinesFromString,
} from "../../../services/log-service";
import { LogViewerCore } from "../../log/LogViewerCore";
import type { LogEntry, LogLevel } from "../../../store/useProcessStore";
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

function parsedLineToLogEntry(line: ParsedLogLine): LogEntry {
  let timestamp: Date | null = null;
  if (line.timestamp) {
    const [h, m, s] = line.timestamp.split(":").map(Number);
    timestamp = new Date(0, 0, 0, h, m, s);
  }
  return {
    id: `line-${line.id}`,
    processId: "static",
    timestamp,
    level: (line.level ?? "UNKNOWN") as LogLevel,
    thread: line.thread ?? null,
    message: line.text,
    raw: line.raw,
  };
}

export function LogsTab({
  profile,
  isActive = false,
  onRefresh,
}: LogsTabProps) {
  const [logFiles, setLogFiles] = useState<string[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [errorList, setErrorList] = useState<string | null>(null);

  const [selectedLogPath, setSelectedLogPath] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [errorContent, setErrorContent] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && containerRef.current) {
      gsap.fromTo(
        containerRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
      );
    }
  }, [isActive]);

  useEffect(() => {
    if (!profile?.id) return;

    const loadFiles = async () => {
      setIsLoadingList(true);
      setErrorList(null);
      setLogFiles([]);
      setSelectedLogPath(null);
      setLogEntries([]);
      setErrorContent(null);

      try {
        const paths = await getProfileLogFiles(profile.id);
        paths.sort((a, b) => {
          const aName = getFilename(a).toLowerCase();
          const bName = getFilename(b).toLowerCase();
          if (aName === "latest.log") return -1;
          if (bName === "latest.log") return 1;
          return bName.localeCompare(aName);
        });
        setLogFiles(paths);

        if (paths.length > 0) {
          setSelectedLogPath(paths[0]);
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
      setLogEntries([]);
      setErrorContent(null);
      setIsLoadingContent(false);
      return;
    }

    const loadContent = async () => {
      setIsLoadingContent(true);
      setErrorContent(null);
      setLogEntries([]);

      try {
        const rawContent = await getLogFileContent(selectedLogPath);
        const parsedLines = parseLogLinesFromString(rawContent);
        setLogEntries(parsedLines.map(parsedLineToLogEntry));
      } catch (err: any) {
        console.error("[LogsTab] Error fetching log content:", err);
        setErrorContent(err?.message ?? "Failed to load log content");
      } finally {
        setIsLoadingContent(false);
      }
    };

    loadContent();
  }, [selectedLogPath]);

  const handleLogSelect = useCallback((path: string) => {
    setSelectedLogPath(path || null);
  }, []);

  const handleOpenLogsFolder = useCallback(async () => {
    const pathToOpen =
      logFiles.find((p) => getFilename(p).toLowerCase() === "latest.log") ||
      logFiles[0];
    if (!pathToOpen) return;
    try {
      await openLogFileDirectory(pathToOpen);
    } catch (err: any) {
      console.error("[LogsTab] Error opening logs folder:", err);
    }
  }, [logFiles]);

  const isLoading = isLoadingList || isLoadingContent;
  const error = errorList || errorContent;

  return (
    <div ref={containerRef} className="h-full flex flex-col select-none">
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-white/30">
            <Icon icon="svg-spinners:pulse-3" className="w-8 h-8 mx-auto mb-2" />
            <p className="font-minecraft-ten text-xs">LOADING LOGS...</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-red-400/70">
            <Icon icon="solar:danger-triangle-bold" className="w-8 h-8 mx-auto mb-2" />
            <p className="font-minecraft-ten text-xs">{error}</p>
          </div>
        </div>
      ) : (
        <LogViewerCore
          logs={logEntries}
          showNoLogsMessage={true}
          noLogsIcon="solar:document-text-bold"
          noLogsTitle="NO LOG FILES"
          noLogsSubtitle="No log files found for this profile."
          logFiles={logFiles}
          selectedLogPath={selectedLogPath}
          onLogSelect={handleLogSelect}
          onOpenFolder={handleOpenLogsFolder}
        />
      )}
    </div>
  );
}
