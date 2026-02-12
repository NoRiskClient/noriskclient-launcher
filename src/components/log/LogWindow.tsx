"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LogViewerDisplay } from "./LogViewerDisplay";
import * as ProcessService from "../../services/process-service";
import {
  getProfileLogFiles,
  LOG_LEVELS,
  type LogLevel,
  openLogFileDirectory,
  type ParsedLogLine,
  parseLogLinesFromString,
  uploadLogToMclogs,
  LogParser
} from "../../services/log-service";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useThemeStore } from "../../store/useThemeStore";
import { toast } from "react-hot-toast";
import { Card } from "../ui/Card";
import { gsap } from "gsap";
import { cn } from "../../lib/utils";

interface MinecraftOutputPayload {
  event_type: "minecraft_output";
  target_id: string;
  message: string;
}

type StateEventPayload =
  | MinecraftOutputPayload
  | { event_type: string; [key: string]: any };

const MAX_LOG_LINES = 5000;

export function LogWindow() {
  const { t } = useTranslation();
  const [processId, setProcessId] = useState<string | null>(null);
  const [parsedLogLines, setParsedLogLines] = useState<ParsedLogLine[]>([]);
  const [rawLogContentForCopy, setRawLogContentForCopy] = useState<
    string | null
  >(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isLiveLogs, setIsLiveLogs] = useState<boolean>(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [levelFilters, setLevelFilters] = useState<Record<LogLevel, boolean>>({
    ERROR: true,
    WARN: true,
    INFO: true,
    DEBUG: true,
    TRACE: false,
  });

  const [displayLines, setDisplayLines] = useState<ParsedLogLine[]>([]);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const logListenerRef = useRef<UnlistenFn | null>(null);
  const [initialLoadComplete, setInitialLoadComplete] =
    useState<boolean>(false);
  const [isAutoscrollEnabled, setIsAutoscrollEnabled] = useState<boolean>(true);
  const scrollableContainerRef = useRef<HTMLDivElement>(null);
  const initialLoadCompleteRef = useRef(initialLoadComplete);
  const containerRef = useRef<HTMLDivElement>(null);

  const accentColor = useThemeStore((state) => state.accentColor);
  const isAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);

  const logParserRef = useRef<LogParser | null>(null);

  // Ref to hold the latest value of isAutoscrollEnabled
  const isAutoscrollEnabledRef = useRef(isAutoscrollEnabled);
  useEffect(() => {
    isAutoscrollEnabledRef.current = isAutoscrollEnabled;
  }, [isAutoscrollEnabled]);

  useEffect(() => {
    if (!isAnimationEnabled) return;
    
    if (containerRef.current) {
      gsap.fromTo(
        containerRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" },
      );
    }
  }, [isAnimationEnabled]);

  const [cachedLogFilePath, setCachedLogFilePath] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("processId");
    const liveLogsUrlParam = params.get("isLiveLogs") === "true";

    if (id) {
      console.log(`[LogWindow] Detected processId: ${id}`);
      setProcessId(id);

      if (!logParserRef.current) {
        logParserRef.current = new LogParser();
      }

      if (liveLogsUrlParam) {
        console.log(
          `[LogWindow] Live logs mode detected from URL. Initializing empty log view.`,
        );
        setIsLiveLogs(true);
        setIsLoading(false);
        setParsedLogLines([]);
        setRawLogContentForCopy(null);
        setInitialLoadComplete(true);
      } else {
        setIsLiveLogs(false);
        setParsedLogLines([]);
        setRawLogContentForCopy(null);
        setInitialLoadComplete(false);
      }
    } else {
      console.error("[LogWindow] No processId found in URL parameters.");
      setError("No process ID specified.");
      setIsLoading(false);
      setInitialLoadComplete(true);
    }
  }, []);

  useEffect(() => {
    initialLoadCompleteRef.current = initialLoadComplete;
  }, [initialLoadComplete]);

  const scrollToBottom = useCallback(() => {
    // Check the ref for the most up-to-date autoscroll setting
    if (isAutoscrollEnabledRef.current && scrollableContainerRef.current) {
      const element = scrollableContainerRef.current;
      element.scrollTop = element.scrollHeight;
    }
  }, []); // Dependencies remain empty as ref.current changes don't trigger re-memoization

  useEffect(() => {
    if (!processId) {
      setParsedLogLines([]);
      setRawLogContentForCopy(null);
      setIsLoading(false);
      setInitialLoadComplete(false);
      if (logListenerRef.current) {
        logListenerRef.current();
        logListenerRef.current = null;
      }
      return;
    }

    // Cache log file path as soon as we have a process ID
    const cacheLogFilePath = async () => {
      try {
        const processes = await ProcessService.getRunningProcesses();
        const currentProcess = processes.find((p) => p.id === processId);
        
        if (currentProcess) {
          const profileId = currentProcess.profile_id;
          const logFiles = await getProfileLogFiles(profileId);
          
          if (logFiles.length > 0) {
            const logFilePath = 
              logFiles.find((p) => p.toLowerCase().endsWith("latest.log")) ||
              logFiles[0];
            
            console.log(`[LogWindow] Cached log file path: ${logFilePath}`);
            setCachedLogFilePath(logFilePath);
          }
        }
      } catch (err) {
        console.error("[LogWindow] Failed to cache log file path:", err);
        // Don't show an error to the user, just log it
      }
    };
    
    // Try to cache the log file path right away
    cacheLogFilePath();

    if (isLiveLogs) {
      console.log(
        `[LogWindow] Live mode is active for ${processId}. Clearing logs and skipping initial fetch.`,
      );
      setParsedLogLines([]);
      setRawLogContentForCopy(null);
      setIsLoading(false);
      setInitialLoadComplete(true);
      
      if (logParserRef.current) {
        logParserRef.current.reset();
      }
    } else {
      console.log(
        `[LogWindow] Non-live mode for ${processId}. Fetching initial logs.`,
      );
      const fetchNonLiveLogs = async () => {
        setIsLoading(true);
        setError(null);
        setParsedLogLines([]);
        setRawLogContentForCopy(null);

        if (logParserRef.current) {
          logParserRef.current.reset();
        }

        try {
          const rawContent =
            await ProcessService.getLogContentForProcess(processId);
          setRawLogContentForCopy(rawContent);

          let lines: ParsedLogLine[];
          if (logParserRef.current) {
            lines = logParserRef.current.parseLogContent(rawContent);
          } else {
            lines = parseLogLinesFromString(rawContent);
          }
          
          setParsedLogLines(lines);
          console.log(`[LogWindow] Loaded ${lines.length} initial log lines.`);
        } catch (err: any) {
          console.error("[LogWindow] Failed to fetch initial logs:", err);
          setError(err?.message ?? "Failed to load initial logs.");
          setParsedLogLines([]);
        } finally {
          setIsLoading(false);
          setInitialLoadComplete(true);
          // scrollToBottom will check the ref
          if (isAutoscrollEnabledRef.current) { 
            setTimeout(scrollToBottom, 0);
          }
        }
      };
      fetchNonLiveLogs();
    }

    let isSubscribed = true;
    const setupListener = async () => {
      try {
        logListenerRef.current = await listen<StateEventPayload>(
          "state_event",
          (event) => {
            if (!isSubscribed || !initialLoadCompleteRef.current) return;

            const payload = event.payload;
            if (
              payload.event_type === "minecraft_output" &&
              payload.target_id === processId
            ) {
              const rawLine = payload.message;
              
              let newParsedLines: ParsedLogLine[];
              if (logParserRef.current) {
                newParsedLines = logParserRef.current.parseLogContent(rawLine);
              } else {
                newParsedLines = parseLogLinesFromString(rawLine);
              }

              setParsedLogLines((prevLines) => {
                const updatedLines = [...prevLines, ...newParsedLines];
                if (updatedLines.length > MAX_LOG_LINES) {
                  return updatedLines.slice(
                    updatedLines.length - MAX_LOG_LINES,
                  );
                }
                return updatedLines;
              });

              setRawLogContentForCopy((prevRaw) =>
                prevRaw ? prevRaw + "\n" + rawLine : rawLine,
              );
                // scrollToBottom will check the ref
              if (isAutoscrollEnabledRef.current) { 
                setTimeout(scrollToBottom, 0);
              }
            }
          },
        );
        console.log(
          `[LogWindow] Listening for 'state_event' for processId: ${processId}`,
        );
      } catch (err) {
        console.error(
          "[LogWindow] Failed to set up state_event listener:",
          err,
        );
        setError(
          (prev) =>
            prev ||
            (err instanceof Error
              ? err.message
              : "Failed to listen for log updates."),
        );
      }
    };

    setupListener();

    return () => {
      isSubscribed = false;
      if (logListenerRef.current) {
        console.log(
          `[LogWindow] Unsubscribing from 'state_event' for processId: ${processId}`,
        );
        logListenerRef.current();
        logListenerRef.current = null;
      }
      setInitialLoadComplete(false);
      setIsLoading(true);
    };
  }, [processId, isLiveLogs, scrollToBottom]);

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

  // Effect to handle autoscrolling when displayLines changes
  useEffect(() => {
    // Preliminary check based on current state
    if (isAutoscrollEnabled && displayLines.length > 0) {
      setTimeout(scrollToBottom, 0);
    }
  }, [displayLines, isAutoscrollEnabled, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
  }, []);

  const handleOpenFolderForProcess = useCallback(async () => {
    if (!processId) return;

    // If we already have a cached path, use it directly
    if (cachedLogFilePath) {
      try {
        await revealItemInDir(cachedLogFilePath);
        return;
      } catch (err: any) {
        console.error("[LogWindow] Error opening cached logs file:", err);
        
        // Try to open the parent directory instead
        try {
          // Extract the directory path (everything before the last slash)
          const dirPath = cachedLogFilePath.split(/[\\/]/).slice(0, -1).join('/');
          if (dirPath) {
            console.log(`[LogWindow] Trying to open parent directory instead: ${dirPath}`);
            await revealItemInDir(dirPath);
            return;
          }
        } catch (dirErr: any) {
          console.error("[LogWindow] Error opening parent directory:", dirErr);
        }
        // If the cached path fails, continue with the normal path lookup
      }
    }

    console.log(`[LogWindow] Opening folder for process: ${processId}`);
    setError(null);

    try {
      const processes = await ProcessService.getRunningProcesses();
      const currentProcess = processes.find((p) => p.id === processId);

      if (!currentProcess) {
        if (cachedLogFilePath) {
          try {
            await revealItemInDir(cachedLogFilePath);
            return;
          } catch (err: any) {
            console.error("[LogWindow] Error opening cached logs file:", err);
            
            // Try to open the parent directory instead
            try {
              // Extract the directory path (everything before the last slash)
              const dirPath = cachedLogFilePath.split(/[\\/]/).slice(0, -1).join('/');
              if (dirPath) {
                console.log(`[LogWindow] Trying to open parent directory instead: ${dirPath}`);
                await revealItemInDir(dirPath);
                return;
              }
            } catch (dirErr: any) {
              console.error("[LogWindow] Error opening parent directory:", dirErr);
            }
          }
        }
        throw new Error(`Process ${processId} not found.`);
      }

      const profileId = currentProcess.profile_id;
      const logFiles = await getProfileLogFiles(profileId);

      if (logFiles.length === 0) {
        throw new Error(`No log files found for profile ${profileId}.`);
      }

      const filePathToOpen =
        logFiles.find((p) => p.toLowerCase().endsWith("latest.log")) ||
        logFiles[0];
      
      // Cache the file path for future use
      setCachedLogFilePath(filePathToOpen);
      
      await revealItemInDir(filePathToOpen);
    } catch (err: any) {
      console.error("[LogWindow] Error opening logs folder:", err);
      setError(err?.message ?? "Failed to open logs folder");
    }
  }, [processId, cachedLogFilePath]);

  const handleLevelFilterChange = useCallback(
    (level: LogLevel, checked: boolean) => {
      setLevelFilters((prev) => ({ ...prev, [level]: checked }));
    },
    [],
  );

  const handleAutoscrollChange = useCallback(
    (enabled: boolean) => {
      setIsAutoscrollEnabled(enabled);
    },
    [],
  );

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
      console.error("[LogWindow] Failed to copy log to clipboard:", err);
      toast.error(t('logs.copy_failed'));
    }
  }, [displayLines, t]);

  const handleOpenUploadUrl = useCallback(async (url: string) => {
    if (!url) return;
    try {
      await openUrl(url);
    } catch (err) {
      console.error(`[LogWindow] Failed to open URL ${url}:`, err);
      setError(err instanceof Error ? err.message : "Failed to open URL");
    }
  }, []);

  const handleUploadLogForProcess = useCallback(async (): Promise<string> => {
    if (!rawLogContentForCopy) {
      throw new Error(t('logs.no_content_upload'));
    }
    console.log(`[LogWindow] Uploading log content for process: ${processId}`);
    setError(null);
    return uploadLogToMclogs(rawLogContentForCopy);
  }, [rawLogContentForCopy, processId, t]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col h-full text-white font-minecraft p-4",
        "transition-colors duration-300",
      )}
      style={{
        backgroundImage: `linear-gradient(to bottom right, #${accentColor.value}CC, #${accentColor.value}88)`,
        boxShadow: `0 0 15px 5px #${accentColor.value}20`
      }}
    >
      <LogViewerDisplay
        isLoading={isLoading}
        error={error}
        displayLines={displayLines}
        parsedLogLinesCount={parsedLogLines.length}
        searchTerm={searchTerm}
        levelFilters={levelFilters}
        copied={copied}
        onSearchChange={handleSearchChange}
        onLevelFilterChange={handleLevelFilterChange}
        onCopyLog={handleCopyLog}
        logLevelsDefinition={LOG_LEVELS}
        onOpenFolder={handleOpenFolderForProcess}
        onUploadLog={handleUploadLogForProcess}
        onOpenUploadUrl={handleOpenUploadUrl}
        isAutoscrollEnabled={isAutoscrollEnabled}
        onAutoscrollChange={handleAutoscrollChange}
        scrollableContainerRef={scrollableContainerRef}
        isLiveLogs={isLiveLogs}
        isInsideLogWindow={true}
      />
    </div>
  );
}
