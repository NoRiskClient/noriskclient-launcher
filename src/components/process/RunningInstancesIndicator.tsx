"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import * as ProcessService from "../../services/process-service";
import type { ProcessMetadata } from "../../types/processState";
import { timeAgo } from "../../utils/time-utils";
import { Button } from "../ui/./buttons/Button";
import { IconButton } from "../ui/./buttons/IconButton";
import { Label } from "../ui/./Label";
import { Dropdown } from "../ui/./dropdown/Dropdown";
import { DropdownHeader } from "../ui/./dropdown/DropdownHeader";
import { DropdownFooter } from "../ui/./dropdown/DropdownFooter";
import { useThemeStore } from "../../store/useThemeStore";
import { invoke } from "@tauri-apps/api/core";

interface RunningInstancesIndicatorProps {
  className?: string;
}

export function RunningInstancesIndicator({
  className,
}: RunningInstancesIndicatorProps) {
  const { t } = useTranslation();
  const [processes, setProcesses] = useState<ProcessMetadata[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [viewingLogsId, setViewingLogsId] = useState<string | null>(null);
  const [imageLoadErrors, setImageLoadErrors] = useState<Set<string>>(
    new Set(),
  );
  const buttonRef = useRef<HTMLDivElement>(null);
  const accentColor = useThemeStore((state) => state.accentColor);

  const fetchProcesses = useCallback(async () => {
    setError(null);
    try {
      const fetchedProcesses = await ProcessService.getRunningProcesses();
      setProcesses(fetchedProcesses);
    } catch (err) {
      setError(t('instances.fetch_failed'));
      console.error(err);
      setProcesses([]);
    } finally {
      if (isLoading) setIsLoading(false);
    }
  }, [isLoading]);

  useEffect(() => {
    fetchProcesses();

    const intervalId = setInterval(fetchProcesses, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [fetchProcesses]);

  const handleToggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  const handleCloseDropdown = () => {
    setIsDropdownOpen(false);
  };

  const handleStopProcess = async (processId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStoppingId(processId);
    try {
      await ProcessService.stopProcess(processId);
      console.log(
        "[RunningInstancesIndicator] Process stop initiated successfully via service.",
      );
      setProcesses((prevProcesses) =>
        prevProcesses.filter((p) => p.id !== processId),
      );
    } catch (err) {
      console.error(
        `[RunningInstancesIndicator] Failed to stop process ${processId}:`,
        err,
      );
      await fetchProcesses();
    } finally {
      setStoppingId(null);
      setTimeout(() => fetchProcesses(), 500);
    }
  };

  const handleViewLogs = async (processId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setViewingLogsId(processId);
    try {
      await ProcessService.openLogWindow(processId);
    } catch (err) {
      console.error(
        `Failed to open log window for process ID ${processId}:`,
        err,
      );
    } finally {
      setTimeout(() => setViewingLogsId(null), 1000);
    }
  };

  const handleStopAll = async () => {
    try {
      const idsToStop = processes.map((p) => p.id);
      for (const process of processes) {
        await ProcessService.stopProcess(process.id);
      }
      console.log("[RunningInstancesIndicator] Stop all processes initiated.");
      setProcesses((prevProcesses) =>
        prevProcesses.filter((p) => !idsToStop.includes(p.id)),
      );
      handleCloseDropdown();
    } catch (err) {
      console.error(
        `[RunningInstancesIndicator] Failed to stop all processes:`,
        err,
      );
      await fetchProcesses();
    }
  };

  const handleOpenLogWindow = async () => {
    try {
      await invoke("open_minecraft_log_window", { crashedProcess: null });
    } catch (err) {
      console.error("Failed to open log window:", err);
    }
  };

  const instanceCount = processes.length;
  const hasInstances = instanceCount > 0;

  return (
    <div className={cn("relative", className)}>
      <div ref={buttonRef} className="relative">
        <Button
          variant={hasInstances ? "success" : "flat"}
          size="sm"
          onClick={handleOpenLogWindow}
          icon={<Icon icon="solar:monitor-bold" className="w-4 h-4" />}
          className="h-10"
        >
          {isLoading && instanceCount === 0
            ? t('instances.loading')
            : instanceCount === 0
              ? t('instances.no_instances')
              : `${instanceCount} ${t('common.instance', { count: instanceCount })}`}
        </Button>
      </div>

      <Dropdown
        isOpen={isDropdownOpen}
        onClose={handleCloseDropdown}
        triggerRef={buttonRef}
        width={350}
      >
        <DropdownHeader title={t('instances.running_instances')}>
          <button
            onClick={handleCloseDropdown}
            className="text-white/70 hover:text-white transition-colors"
          >
            <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
          </button>
        </DropdownHeader>

        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
          {isLoading && processes.length === 0 ? (
            <div className="p-6 text-center">
              <Icon
                icon="solar:spinner-bold"
                className="w-6 h-6 animate-spin mx-auto text-white/70 mb-2"
              />
              <p className="text-white/70 font-minecraft text-xl">
                {t('instances.loading_instances')}
              </p>
            </div>
          ) : error ? (
            <div className="p-6 text-center">
              <Icon
                icon="solar:danger-triangle-bold"
                className="w-6 h-6 mx-auto text-red-400 mb-2"
              />
              <p className="text-red-400 font-minecraft text-xl">
                Error: {error}
              </p>
            </div>
          ) : processes.length === 0 ? (
            <div className="p-6 text-center">
              <Icon
                icon="solar:monitor-slash-bold"
                className="w-8 h-8 mx-auto text-white/50 mb-3"
              />
              <p className="text-white/60 font-minecraft text-xl">
                {t('instances.no_running')}
              </p>
              <p className="text-white/40 font-minecraft text-lg mt-2">
                {t('instances.launch_to_start')}
              </p>
            </div>
          ) : (
            <div className="py-2">
              {processes.map((process) => (
                <div
                  key={process.id}
                  className="px-4 py-3 hover:bg-white/10 transition-colors duration-200"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-12 h-12 rounded-md flex items-center justify-center flex-shrink-0 overflow-hidden"
                          style={
                            {
                              // backgroundColor: `${accentColor.value}30`, // Removed background
                              // borderWidth: "2px", // Removed border
                              // borderStyle: "solid", // Removed border
                              // borderColor: `${accentColor.value}60`, // Removed border
                            }
                          }
                        >
                          {process.profile_image_url &&
                          !imageLoadErrors.has(process.id) ? (
                            <img
                              src={process.profile_image_url}
                              alt={process.profile_name || "Profile Icon"}
                              className="w-full h-full object-cover"
                              onError={() => {
                                setImageLoadErrors((prev) =>
                                  new Set(prev).add(process.id),
                                );
                              }}
                            />
                          ) : (
                            <img
                              src="/icons/minecraft.png"
                              alt="Minecraft Default Icon"
                              className="w-8 h-8"
                            />
                          )}
                        </div>
                        <div className="h-12 flex flex-col justify-center">
                          <p
                            className="text-xl font-minecraft text-white truncate mb-0 leading-none"
                            title={process.profile_name || process.profile_id}
                          >
                            {(
                              process.profile_name ||
                              `Profile ${process.profile_id.substring(0, 6)}...`
                            ).toLowerCase()}
                          </p>
                          <div className="flex items-center text-lg text-white/60 font-minecraft leading-none">
                            <Icon
                              icon="solar:clock-circle-bold"
                              className="w-3.5 h-3.5 mr-1.5"
                            />
                            <span
                              className="font-minecraft-ten"
                              style={{ fontSize: "8px" }}
                            >
                              {timeAgo(new Date(process.start_time).getTime())}
                            </span>
                            {typeof process.state === "object" &&
                              "Crashed" in process.state && (
                                <Label
                                  variant="destructive"
                                  size="xs"
                                  className="ml-2 h-5 text-base mt-0.5"
                                >
                                  {t('instances.crashed')}
                                </Label>
                              )}
                            {typeof process.state === "string" &&
                              process.state !== "Running" && (
                                <Label
                                  variant="warning"
                                  size="xs"
                                  className="ml-2 h-5 text-base mt-0.5"
                                >
                                  {process.state}
                                </Label>
                              )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {process.id && (
                        <IconButton
                          onClick={(e) => handleViewLogs(process.id, e)}
                          size="xs"
                          className="h-8 w-8 p-1.5 bg-white/10 text-sky-400 hover:bg-white/20 hover:text-sky-300 focus:ring-2 focus:ring-white/60"
                          icon={
                            viewingLogsId === process.id ? (
                              <Icon
                                icon="solar:spinner-bold"
                                className="w-4 h-4 animate-spin"
                              />
                            ) : (
                              <Icon
                                icon="solar:document-bold"
                                className="w-4 h-4"
                              />
                            )
                          }
                          aria-label={t('instances.view_logs')}
                        />
                      )}
                      <IconButton
                        onClick={(e) => handleStopProcess(process.id, e)}
                        disabled={stoppingId === process.id}
                        variant="destructive"
                        size="xs"
                        className="h-8 w-8 p-1.5 bg-white/10 hover:bg-white/20 hover:text-red-400 ring-1 ring-red-500 focus:ring-2 focus:ring-red-500/50"
                        icon={
                          stoppingId === process.id ? (
                            <Icon
                              icon="solar:spinner-bold"
                              className="w-4 h-4 animate-spin"
                            />
                          ) : (
                            <Icon icon="solar:stop-bold" className="w-4 h-4" />
                          )
                        }
                        aria-label={t('instances.stop_process')}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DropdownFooter>
          <div className="flex items-center justify-between w-full">
            {processes.length > 0 ? (
              <Label
                variant="success"
                size="xs"
                icon={
                  <Icon icon="solar:play-circle-bold" className="w-4 h-4" />
                }
              >
                {t('instances.count_running', { count: processes.length })}
              </Label>
            ) : (
              <span className="text-white/40 text-xs font-minecraft">
                {t('instances.none')}
              </span>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="flat"
                size="xs"
                onClick={handleOpenLogWindow}
                icon={
                  <Icon icon="solar:monitor-bold" className="w-4 h-4" />
                }
              >
                {t('instances.logs')}
              </Button>
              {processes.length > 0 && (
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={handleStopAll}
                  icon={
                    <Icon icon="solar:stop-circle-bold" className="w-4 h-4" />
                  }
                >
                  {t('instances.stop_all')}
                </Button>
              )}
            </div>
          </div>
        </DropdownFooter>
      </Dropdown>
    </div>
  );
}
