"use client";

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { LogLevel, ParsedLogLine } from "../../services/log-service";
import { IconButton } from "../ui/buttons/IconButton";
import { SearchInput } from "../ui/SearchInput";
import { Select } from "../ui/Select";
import { useThemeStore } from "../../store/useThemeStore";
import { toast } from "react-hot-toast";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Checkbox } from "../ui/Checkbox";
import { cn } from "../../lib/utils";
import { gsap } from "gsap";
import { TagBadge, type TagBadgeProps } from "../ui/TagBadge";
import { Virtuoso } from "react-virtuoso";

interface LogViewerDisplayProps {
  isLoading: boolean;
  error: string | null;
  displayLines: ParsedLogLine[];
  parsedLogLinesCount: number;
  searchTerm: string;
  levelFilters: Record<LogLevel, boolean>;
  copied: boolean;
  onSearchChange: (value: string) => void;
  onLevelFilterChange: (level: LogLevel, checked: boolean) => void;
  onCopyLog: () => void;
  logLevelsDefinition: readonly LogLevel[];
  scrollableContainerRef?: React.RefObject<HTMLDivElement>;
  isLiveLogs?: boolean;
  showPadding?: boolean;

  isAutoscrollEnabled?: boolean;
  onAutoscrollChange?: (enabled: boolean) => void;
  onOpenFolder?: () => void;
  onUploadLog?: () => Promise<string>;
  uploadUrl?: string | null;
  uploadError?: string | null;
  onOpenUploadUrl?: (url: string) => void;
  logFiles?: string[];
  selectedLogPath?: string | null;
  onLogSelect?: (value: string) => void;
  isInsideLogWindow?: boolean;
  isWordWrapEnabled?: boolean;
  onWordWrapChange?: (enabled: boolean) => void;
  scrollToTop?: () => void;
  scrollToBottom?: () => void;
}

function getFilename(path: string | null): string {
  if (!path) return "";
  return path.split(/[\\/]/).pop() || path;
}

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

export function LogViewerDisplay({
  isLoading,
  error,
  displayLines,
  parsedLogLinesCount,
  searchTerm,
  levelFilters,
  copied,
  onSearchChange,
  onLevelFilterChange,
  onCopyLog,
  logLevelsDefinition,
  isLiveLogs,
  isAutoscrollEnabled = true,
  onAutoscrollChange,
  scrollableContainerRef,
  onOpenFolder,
  onUploadLog,
  onOpenUploadUrl,
  logFiles = [],
  selectedLogPath = null,
  onLogSelect,
  isInsideLogWindow = false,
  isWordWrapEnabled,
  onWordWrapChange,
  scrollToTop,
  scrollToBottom,
}: LogViewerDisplayProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const isAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const [isSubmittingUpload, setIsSubmittingUpload] = useState(false);
  const [frozenLogLines, setFrozenLogLines] = useState<ParsedLogLine[] | null>(
    null,
  );
  const controlsRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAutoscrollEnabled) {
      setFrozenLogLines(null);
    } else {
      if (frozenLogLines === null) {
        setFrozenLogLines([...displayLines]);
      }
    }
  }, [isAutoscrollEnabled, displayLines, frozenLogLines]);

  const headerBgColor = isInsideLogWindow
    ? `${accentColor.value}1A`
    : `${accentColor.value}10`;
  const headerBorderColor = isInsideLogWindow
    ? `${accentColor.value}3A`
    : `${accentColor.value}30`;
  const contentBgColor = isInsideLogWindow
    ? `${accentColor.value}12`
    : `${accentColor.value}08`;
  const contentBorderColor = isInsideLogWindow
    ? `${accentColor.value}2A`
    : `${accentColor.value}20`;
  const footerBgColor = headerBgColor;
  const footerBorderColor = headerBorderColor;

  useEffect(() => {
    if (!isAnimationEnabled) return;

    if (controlsRef.current) {
      gsap.fromTo(
        controlsRef.current,
        { opacity: 0, y: -10 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
      );
    }

    if (contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.5, ease: "power2.out", delay: 0.2 },
      );
    }
  }, [isAnimationEnabled]);

  const getLogLevelTagBadgeVariant = (
    level: LogLevel,
  ): TagBadgeProps["variant"] => {
    if (!levelFilters[level]) {
      return "inactive";
    }
    switch (level) {
      case "ERROR":
        return "destructive";
      case "WARN":
        return "warning";
      case "INFO":
        return "info";
      case "DEBUG":
        return "success";
      case "TRACE":
        return "default";
      default:
        return "inactive";
    }
  };

  const linesForVirtuoso =
    frozenLogLines !== null ? frozenLogLines : displayLines;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-black/30 backdrop-awd-sm">
        <div className="flex flex-col items-center">
          <div className="relative w-12 h-12 mb-3">
            <div className="absolute inset-0 border-3 border-white/10 rounded-full"></div>
            <div
              className="absolute inset-0 border-3 border-t-white/80 rounded-full animate-spin"
              style={{ borderTopColor: accentColor.value }}
            ></div>
          </div>
          <div className="font-minecraft text-xl text-white/80 tracking-wide lowercase">
            {t('logs.loading')}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-4 bg-red-900/30 border-2 border-red-700/50 text-red-300 text-xl max-w-2xl rounded-lg">
          <div className="flex items-center gap-2">
            <Icon
              icon="solar:danger-triangle-bold"
              className="w-6 h-6 text-red-400 flex-shrink-0"
            />
            <span>{error}</span>
          </div>
        </div>
      </div>
    );
  }

  if (
    !(isLiveLogs && parsedLogLinesCount === 0) &&
    linesForVirtuoso.length === 0 &&
    searchTerm === "" &&
    Object.values(levelFilters).every((v) => v)
  ) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Icon
            icon="solar:file-text-bold"
            className="w-12 h-12 text-white/30 mx-auto mb-3"
          />
          <p className="text-white/60 font-minecraft text-xl tracking-wide lowercase select-none">
            {t('logs.no_content_title')}
          </p>
          <p className="text-white/40 font-minecraft text-sm mt-2 tracking-wide lowercase select-none">
            {t('logs.no_content_desc')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div
        ref={controlsRef}
        className="p-3 rounded-lg border backdrop-blur-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-3 flex-shrink-0"
        style={{
          borderColor: headerBorderColor,
          backgroundColor: headerBgColor,
        }}
      >
        <div className="flex items-center py-1 gap-1 overflow-x-auto scrollbar-hide">
          {logLevelsDefinition
            .filter((level) => level !== "TRACE")
            .map((level) => (
              <TagBadge
                key={level}
                onClick={() => onLevelFilterChange(level, !levelFilters[level])}
                disabled={isLoading}
                variant={getLogLevelTagBadgeVariant(level)}
                size="sm"
              >
                {level.toLowerCase()}
              </TagBadge>
            ))}
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <SearchInput
            value={searchTerm}
            onChange={onSearchChange}
            placeholder={t('logs.filter_placeholder')}
            size="sm"
          />

          <div className="flex items-center gap-2">
            <IconButton
              onClick={onCopyLog}
              disabled={displayLines.length === 0 || isLoading || copied}
              variant={copied ? "success" : "secondary"}
              size="sm"
              icon={
                <Icon
                  icon={copied ? "solar:check-circle-bold" : "solar:copy-bold"}
                />
              }
            />

            {onUploadLog && (
              <IconButton
                onClick={async () => {
                  if (isSubmittingUpload) return;
                  if (onUploadLog) {
                    setIsSubmittingUpload(true);
                    try {
                      const url = await onUploadLog();
                      let clipboardSuccess = false;
                      try {
                        await writeText(url);
                        clipboardSuccess = true;
                      } catch (copyError) {
                        console.error(
                          "Failed to copy URL to clipboard:",
                          copyError,
                        );
                      }

                      const successMessage = clipboardSuccess
                        ? t('logs.upload_success_copied')
                        : t('logs.upload_success_no_copy');

                      toast.success(
                        (toastInstance) => (
                          <span
                            onClick={() => {
                              if (url && onOpenUploadUrl) onOpenUploadUrl(url);
                              toast.dismiss(toastInstance.id);
                            }}
                            className="cursor-pointer hover:underline"
                          >
                            {successMessage}
                          </span>
                        ),
                        { duration: 5000 },
                      );
                    } catch (err: any) {
                      toast.error(t('logs.upload_failed', { error: err.toString() }));
                    } finally {
                      setIsSubmittingUpload(false);
                    }
                  }
                }}
                disabled={
                  isLoading || parsedLogLinesCount === 0 || isSubmittingUpload
                }
                variant="secondary"
                size="sm"
                icon={
                  <Icon
                    icon={
                      isSubmittingUpload
                        ? "solar:refresh-circle-bold"
                        : "solar:upload-bold"
                    }
                    className={isSubmittingUpload ? "animate-spin" : ""}
                  />
                }
              />
            )}

            {onOpenFolder && (
              <IconButton
                onClick={onOpenFolder}
                disabled={isLoading}
                variant="secondary"
                size="sm"
                icon={<Icon icon="solar:folder-bold" />}
              />
            )}
          </div>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 rounded-lg border backdrop-blur-sm overflow-hidden mb-3"
        style={{
          backgroundColor: contentBgColor,
          borderColor: contentBorderColor,
        }}
      >
        <div
          className="h-full overflow-y-auto custom-scrollbar"
          ref={scrollableContainerRef}
        >
          <div ref={contentRef} className="h-full">
            {linesForVirtuoso.length === 0 ? (
              <div className="p-4 h-full flex items-center justify-center">
                <div className="text-center">
                  <Icon
                    icon="solar:filter-bold"
                    className="w-12 h-12 text-white/30 mx-auto mb-3"
                  />
                  <p className="text-white/60 font-minecraft text-xl tracking-wide lowercase select-none">
                    {t('logs.no_matching_lines')}
                  </p>
                </div>
              </div>
            ) : (
              <Virtuoso
                style={{ height: "100%" }}
                data={linesForVirtuoso}
                followOutput={isAutoscrollEnabled ? "smooth" : false}
                className={cn(
                  "custom-scrollbar",
                  "min-h-full bg-black/60 font-mono text-sm whitespace-pre-wrap",
                  "p-2",
                  "overflow-x-hidden",
                )}
                itemContent={(index, line) => (
                  <div
                    key={`${line.id}-${index}`}
                    className="flex flex-nowrap items-start"
                  >
                    {line.timestamp ? (
                      <>
                        <span
                          className={`pr-2 select-none ${getLevelColorClass(line.level)}`}
                        >
                          <span className="opacity-80">[{line.timestamp}]</span>
                          <span className="opacity-80 ml-1">
                            [{line.thread}/{line.level ?? "-"}]
                          </span>
                        </span>
                        <span
                          className={`flex-1 min-w-0 break-words ${
                            line.level === "ERROR" || line.level === "WARN"
                              ? getLevelColorClass(line.level)
                              : "text-white/90"
                          }`}
                        >
                          {line.text}
                        </span>
                      </>
                    ) : (
                      <span
                        className={`flex-1 min-w-0 pl-1 break-words ${
                          line.level === "ERROR" || line.level === "WARN"
                            ? getLevelColorClass(line.level)
                            : "text-white/90"
                        }`}
                      >
                        {line.text}
                      </span>
                    )}
                  </div>
                )}
              />
            )}
          </div>
        </div>
      </div>

      <div
        className="p-3 rounded-lg border backdrop-blur-sm flex justify-between items-center"
        style={{
          borderColor: footerBorderColor,
          backgroundColor: footerBgColor,
        }}
      >
        <div className="text-white/70 font-minecraft-ten text-xs">
          {searchTerm || Object.values(levelFilters).some((v) => !v)
            ? t('logs.lines_matching', { shown: linesForVirtuoso.length, total: parsedLogLinesCount })
            : t('logs.lines_count', { count: parsedLogLinesCount })}
        </div>

        <div className="flex items-center gap-3">
          {isAutoscrollEnabled !== undefined && onAutoscrollChange && (
            <Checkbox
              id="autoscroll-checkbox"
              checked={isAutoscrollEnabled}
              onChange={(e) => onAutoscrollChange(e.target.checked)}
              label={t('logs.autoscroll')}
              customSize="sm"
            />
          )}

          {logFiles.length > 0 && onLogSelect && (
            <div className="flex items-center gap-2 relative">
              <Select
                value={selectedLogPath || ""}
                onChange={onLogSelect}
                options={[
                  {
                    value: "",
                    label: t('logs.select_log'),
                    // @ts-ignore
                    disabled: !!selectedLogPath,
                  },
                  ...logFiles.map((path) => ({
                    value: path,
                    label: getFilename(path),
                  })),
                ]}
                className="w-64"
                disabled={isLoading}
              />
            </div>
          )}

          {onWordWrapChange && (
            <IconButton
              onClick={() => onWordWrapChange(!isWordWrapEnabled)}
              disabled={isLoading}
              variant={isWordWrapEnabled ? "default" : "secondary"}
              size="sm"
              icon={
                isWordWrapEnabled ? (
                  <Icon icon="solar:text-bold" className="w-4 h-4" />
                ) : (
                  <Icon icon="solar:text-bold" className="w-4 h-4" />
                )
              }
            />
          )}

          {scrollToTop && (
            <IconButton
              onClick={scrollToTop}
              disabled={isLoading}
              variant="secondary"
              size="sm"
              icon={
                <Icon
                  icon="solar:double-alt-arrow-up-bold-duotone"
                  className="w-4 h-4"
                />
              }
            />
          )}

          {scrollToBottom && (
            <IconButton
              onClick={scrollToBottom}
              disabled={isLoading}
              variant="secondary"
              size="sm"
              icon={
                <Icon
                  icon="solar:double-alt-arrow-down-bold-duotone"
                  className="w-4 h-4"
                />
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
