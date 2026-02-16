import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, emitTo, type UnlistenFn } from "@tauri-apps/api/event";
import { useThemeStore } from "../../store/useThemeStore";
import { useProcessStore, getProcessStatus, ProcessMetrics } from "../../store/useProcessStore";
import { useLaunchStateStore, LaunchState } from "../../store/launch-state-store";
import { ProcessMetadata, ProcessState } from "../../types/processState";
import { EventType } from "../../types/events";
import * as ProcessService from "../../services/process-service";
import { useCrafatarAvatar } from "../../hooks/useCrafatarAvatar";

type InstanceStatus = "running" | "idle" | "crashed" | "starting" | "stopping";

interface InstanceData {
  id: string;
  profileId: string;
  name: string;
  version: string;
  loader: string;
  loaderVersion?: string;
  status: InstanceStatus;
  modCount: number;
  startTime: number;
  endTime?: number; // For stopped instances - when the process ended
  memoryUsage: number;
  memoryMax: number;
  cpuUsage: number;
  profileImageUrl?: string;
  accountUuid?: string;
  accountName?: string;
}

// Format memory
const formatMemory = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)}GB`;
  }
  return `${Math.round(mb)}MB`;
};

// Convert file path to asset URL if needed
const toAssetUrl = (pathOrUrl: string | undefined): string | undefined => {
  if (!pathOrUrl) return undefined;
  // URLs and data URIs don't need conversion
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://") ||
      pathOrUrl.startsWith("data:") || pathOrUrl.startsWith("asset://")) {
    return pathOrUrl;
  }
  // File paths need to be converted
  return convertFileSrc(pathOrUrl);
};

// Format elapsed time
const formatElapsedTime = (startTime: number, currentTime: number): string => {
  const elapsed = Math.floor((currentTime - startTime) / 1000);
  if (elapsed < 0) return "0:00";

  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

// Convert ProcessMetadata to InstanceData
function processToInstance(process: ProcessMetadata, metrics?: ProcessMetrics, endTime?: number): InstanceData {
  const startTimeMs = new Date(process.start_time).getTime();
  // Convert memory_max_mb (MB) to bytes for consistency with memoryUsage
  const memoryMaxBytes = (process.memory_max_mb || 4096) * 1024 * 1024;

  return {
    id: process.id,
    profileId: process.profile_id,
    name: process.profile_name || "Unknown Profile",
    version: process.minecraft_version || "Unknown",
    loader: process.modloader?.toLowerCase() || "vanilla",
    loaderVersion: process.modloader_version || undefined,
    status: getProcessStatus(process.state),
    modCount: 0, // Will be fetched from profile if needed
    startTime: startTimeMs,
    endTime: endTime,
    memoryUsage: metrics?.memoryBytes || 0,
    memoryMax: memoryMaxBytes,
    cpuUsage: metrics?.cpuPercent || 0,
    profileImageUrl: process.profile_image_url || undefined,
    accountUuid: process.account_uuid || undefined,
    accountName: process.account_name || undefined,
  };
}

// Get loader icon path
const getLoaderIcon = (loader: string): string => {
  const loaderLower = loader.toLowerCase();
  if (loaderLower === "fabric") return "/icons/fabric.png";
  if (loaderLower === "forge") return "/icons/forge.png";
  if (loaderLower === "neoforge") return "/icons/neoforge.png";
  if (loaderLower === "quilt") return "/icons/quilt.png";
  return "/icons/minecraft.png";
};

// Get status color
const getStatusColor = (status: InstanceStatus): string => {
  switch (status) {
    case "running": return "#22c55e";
    case "starting": return "#eab308";
    case "stopping": return "#f97316";
    case "crashed": return "#ef4444";
    case "idle": return "#6b7280";
    default: return "#6b7280";
  }
};

// Instance Item Component - allows using hooks for each instance
interface InstanceItemProps {
  instance: InstanceData;
  isSelected: boolean;
  isHovered: boolean;
  currentTime: number;
  accentColor: { value: string };
  onSelect: () => void;
  onHover: (hovered: boolean) => void;
  onOpenProfile: () => void;
}

function InstanceItem({
  instance,
  isSelected,
  isHovered,
  currentTime,
  accentColor,
  onSelect,
  onHover,
  onOpenProfile,
}: InstanceItemProps) {
  const { t } = useTranslation();
  const statusColor = getStatusColor(instance.status);

  // Get avatar for the account
  const avatarUrl = useCrafatarAvatar({
    uuid: instance.accountUuid,
    size: 16,
    overlay: true,
  });

  return (
    <div
      className="relative p-3 rounded-lg bg-black/20 border border-white/10 hover:border-white/20 cursor-pointer transition-all duration-200"
      style={{
        borderColor: isSelected ? `${accentColor.value}60` : undefined,
        backgroundColor: isSelected ? `${accentColor.value}10` : undefined,
      }}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      {/* Settings Icon - top right */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpenProfile();
        }}
        className="absolute top-2 right-2 p-1 rounded text-white/30 hover:text-white/70 hover:bg-white/10 transition-colors"
        title={t('logs.open_profile')}
      >
        <Icon icon="solar:settings-bold" className="w-3.5 h-3.5" />
      </button>

      <div className="flex items-start gap-3">
        {/* Profile Icon */}
        <div
          className="relative w-11 h-11 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 border-2 transition-all duration-200"
          style={{
            backgroundColor: isHovered || isSelected ? `${accentColor.value}20` : "transparent",
            borderColor: isHovered || isSelected ? `${accentColor.value}60` : "transparent",
          }}
        >
          {instance.profileImageUrl ? (
            <img
              src={toAssetUrl(instance.profileImageUrl)}
              alt={instance.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <Icon
              icon="mdi:minecraft"
              className="w-6 h-6"
              style={{ color: accentColor.value }}
            />
          )}
        </div>

        {/* Instance Info */}
        <div className="flex-1 min-w-0">
          {/* Row 1: Name */}
          <span
            className="block font-minecraft-ten text-white text-sm whitespace-nowrap overflow-hidden text-ellipsis mb-1"
            style={{ textShadow: "0 2px 4px rgba(0,0,0,0.7)" }}
            title={instance.name}
          >
            {instance.name}
          </span>

          {/* Row 2: Account + Time */}
          <div className="flex items-center gap-2 text-[11px] font-minecraft-ten">
            {instance.accountName && (
              <div className="flex items-center gap-1.5 text-white/60">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={instance.accountName}
                    className="w-3.5 h-3.5 rounded-sm"
                    style={{ imageRendering: "pixelated" }}
                  />
                ) : (
                  <Icon icon="solar:user-bold" className="w-3 h-3" />
                )}
                <span>{instance.accountName}</span>
              </div>
            )}
            {instance.accountName && <span className="text-white/30">•</span>}
            <div
              className="flex items-center gap-1"
              style={{ color: statusColor }}
            >
              {instance.status === "running" && (
                <div
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: statusColor }}
                />
              )}
              {instance.status === "starting" && (
                <Icon icon="svg-spinners:pulse-3" className="w-3 h-3" />
              )}
              {instance.status === "crashed" && (
                <Icon icon="solar:danger-triangle-bold" className="w-3 h-3" />
              )}
              {instance.status === "idle" && (
                <Icon icon="solar:stop-circle-bold" className="w-3 h-3" />
              )}
              <span>{formatElapsedTime(instance.startTime, instance.endTime || currentTime)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface InstanceSidebarProps {
  selectedInstanceId?: string;
  onSelectInstance?: (id: string) => void;
}

export function InstanceSidebar({
  selectedInstanceId,
  onSelectInstance,
}: InstanceSidebarProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  // Track processes user has requested to stop - show START immediately
  const [stoppingProcessIds, setStoppingProcessIds] = useState<Set<string>>(new Set());

  // Get processes from store
  const { processes, stoppedProcesses, processEndTimes, metrics, fetchProcesses, stopProcess, isLoading } = useProcessStore();

  // Get launch state store for launch feedback
  const { getProfileState, initiateButtonLaunch, finalizeButtonLaunch, setButtonStatusMessage } = useLaunchStateStore();

  // Get launcher log functions
  const { addLauncherLog, clearLauncherLogs, clearLogs } = useProcessStore();

  // Fetch processes on mount
  useEffect(() => {
    fetchProcesses();

    // Refresh processes periodically
    const interval = setInterval(() => {
      fetchProcesses();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchProcesses]);

  // Update timer every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Listen for launch status events to update button UI (launcher logs are handled in useProcessEvents)
  const eventListenerRef = useRef<UnlistenFn | null>(null);
  useEffect(() => {
    let isSubscribed = true;

    const setupListener = async () => {
      eventListenerRef.current = await listen<{
        event_type: string;
        target_id: string | null;
        message: string;
      }>("state_event", (event) => {
        if (!isSubscribed) return;

        const payload = event.payload;
        const profileId = payload.target_id;

        if (!profileId) return;

        // Handle launch status events for button UI only
        if (payload.event_type === EventType.LaunchSuccessful) {
          finalizeButtonLaunch(profileId);
        } else if (payload.event_type === EventType.Error) {
          finalizeButtonLaunch(profileId, payload.message || "Error");
        } else if (payload.message && getProfileState(profileId).isButtonLaunching) {
          // Update button status message during launch
          setButtonStatusMessage(profileId, payload.message);
        }
      });
    };

    setupListener();

    return () => {
      isSubscribed = false;
      if (eventListenerRef.current) {
        eventListenerRef.current();
      }
    };
  }, [finalizeButtonLaunch, setButtonStatusMessage, getProfileState]);

  // Convert processes to instance data (merge running + stopped)
  const instances = useMemo(() => {
    // Running processes from backend
    const runningInstances = processes
      .filter((p) => {
        const status = getProcessStatus(p.state);
        return status === "running" || status === "starting" || status === "stopping";
      })
      .map((p) => processToInstance(p, metrics.get(p.id)));

    // Stopped processes (frontend-only retention) - include endTime for timer
    const stoppedInstances = Array.from(stoppedProcesses.values())
      .filter((p) => !processes.find((running) => running.id === p.id)) // Don't duplicate
      .map((p) => processToInstance(p, undefined, processEndTimes.get(p.id)));

    // Merge and sort by profileId to keep stable position
    return [...runningInstances, ...stoppedInstances].sort((a, b) =>
      a.profileId.localeCompare(b.profileId)
    );
  }, [processes, stoppedProcesses, processEndTimes, metrics]);

  // Clean up stoppingProcessIds when process is no longer running
  useEffect(() => {
    if (stoppingProcessIds.size > 0) {
      const runningIds = new Set(processes.map(p => p.id));
      const stillStopping = new Set(
        [...stoppingProcessIds].filter(id => runningIds.has(id))
      );
      if (stillStopping.size !== stoppingProcessIds.size) {
        setStoppingProcessIds(stillStopping);
      }
    }
  }, [processes, stoppingProcessIds]);

  // Auto-select first instance if none selected
  useEffect(() => {
    if (!selectedInstanceId && instances.length > 0) {
      onSelectInstance?.(instances[0].id);
    }
  }, [instances, selectedInstanceId, onSelectInstance]);

  // Get selected instance
  const selectedInstance = instances.find((i) => i.id === selectedInstanceId);

  const handleStopProcess = (processId: string) => {
    // Mark as stopping immediately - UI will show START button right away
    setStoppingProcessIds(prev => new Set(prev).add(processId));

    // Fire and forget - don't wait for process to stop
    stopProcess(processId).catch((error) => {
      console.error("Failed to stop process:", error);
    });
  };

  const handleOpenFolder = async (profileId: string) => {
    try {
      await invoke("open_profile_folder", { profileId });
    } catch (error) {
      console.error("Failed to open folder:", error);
    }
  };

  const handleLaunchProfile = async (profileId: string) => {
    // Check if already launching
    const profileState = getProfileState(profileId);
    if (profileState.isButtonLaunching) {
      return;
    }

    // Note: We allow multiple instances of the same profile to run simultaneously
    // Each will have its own process ID and can be stopped independently

    // Clear old logs before starting new launch
    clearLauncherLogs(profileId);
    // Also clear old MC logs from stopped processes with same profile
    for (const [processId, stoppedProcess] of stoppedProcesses) {
      if (stoppedProcess.profile_id === profileId) {
        clearLogs(processId);
      }
    }

    // Start launch with visual feedback
    initiateButtonLaunch(profileId);

    try {
      await ProcessService.launch(profileId);
      // Launch initiated successfully - status updates will come from events
    } catch (error) {
      console.error("Failed to launch profile:", error);
      const errorMsg = typeof error === "string" ? error : (error as Error).message || "Launch failed";
      finalizeButtonLaunch(profileId, errorMsg);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3">
        <span
          className="font-minecraft-ten text-sm tracking-wider flex items-center gap-2"
          style={{ color: accentColor.value }}
        >
          <Icon icon="solar:monitor-bold" className="w-4 h-4" />
          {t('instances.title')}
        </span>
      </div>

      {/* Instance List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
        {isLoading && instances.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-white/50 text-sm font-minecraft-ten">
            <Icon icon="svg-spinners:pulse-3" className="w-6 h-6 mr-2" />
            {t('instances.loading')}
          </div>
        ) : instances.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-white/50 text-sm font-minecraft-ten text-center">
            <Icon icon="solar:gamepad-no-charge-bold" className="w-8 h-8 mb-2 opacity-50" />
            {t('instances.no_active')}
          </div>
        ) : (
          instances.map((instance) => (
            <InstanceItem
              key={instance.id}
              instance={instance}
              isSelected={selectedInstanceId === instance.id}
              isHovered={hoveredId === instance.id}
              currentTime={currentTime}
              accentColor={accentColor}
              onSelect={() => onSelectInstance?.(instance.id)}
              onHover={(hovered) => setHoveredId(hovered ? instance.id : null)}
              onOpenProfile={async () => {
                try {
                  // Emit event to main window for navigation
                  await emitTo("main", "navigate-to-profile", { profileId: instance.profileId });
                  // Focus the main window
                  await invoke("focus_main_window");
                } catch (error) {
                  console.error("Failed to open profile in main window:", error);
                }
              }}
            />
          ))
        )}
      </div>

      {/* Actions Footer - for selected instance */}
      {selectedInstance && (
        <div className="px-3 py-3 bg-black/30 rounded-lg mx-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-minecraft-ten text-white/50 truncate">
              {selectedInstance.name}
            </span>
            <span
              className="text-xs font-minecraft-ten"
              style={{ color: getStatusColor(selectedInstance.status) }}
            >
              {formatElapsedTime(selectedInstance.startTime, selectedInstance.endTime || currentTime)}
            </span>
          </div>

          {/* Resource Bars - only for running instances with metrics */}
          {selectedInstance.status === "running" && selectedInstance.memoryUsage > 0 && (
            <div className="flex gap-4 mb-3 mt-1">
              {/* RAM */}
              <div className="flex-1">
                <div className="flex items-center justify-between text-xs font-minecraft-ten text-white/40 mb-1.5">
                  <span className="flex items-center gap-1">
                    <Icon icon="solar:sd-card-bold" className="w-3 h-3" />
                    RAM
                  </span>
                  <span className="text-white/60">{formatMemory(selectedInstance.memoryUsage)}</span>
                </div>
                <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min((selectedInstance.memoryUsage / selectedInstance.memoryMax) * 100, 100)}%`,
                      backgroundColor: selectedInstance.memoryUsage / selectedInstance.memoryMax > 0.8
                        ? "rgba(248, 113, 113, 0.7)"
                        : `${accentColor.value}90`,
                    }}
                  />
                </div>
              </div>

              {/* CPU */}
              <div className="flex-1">
                <div className="flex items-center justify-between text-xs font-minecraft-ten text-white/40 mb-1.5">
                  <span className="flex items-center gap-1">
                    <Icon icon="solar:cpu-bolt-bold" className="w-3 h-3" />
                    CPU
                  </span>
                  <span className="text-white/60">{Math.round(selectedInstance.cpuUsage)}%</span>
                </div>
                <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(selectedInstance.cpuUsage, 100)}%`,
                      backgroundColor: selectedInstance.cpuUsage > 80
                        ? "rgba(248, 113, 113, 0.7)"
                        : `${accentColor.value}90`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            {/* Stop/Restart Toggle */}
            {(selectedInstance.status === "running" || selectedInstance.status === "starting") &&
             !stoppingProcessIds.has(selectedInstance.id) ? (
              <button
                onClick={() => handleStopProcess(selectedInstance.id)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-minecraft-ten bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                <Icon icon="solar:stop-bold" className="w-3.5 h-3.5" />
                {t('instances.stop')}
              </button>
            ) : (selectedInstance.status === "crashed" || selectedInstance.status === "idle" || stoppingProcessIds.has(selectedInstance.id)) && (() => {
              const launchState = getProfileState(selectedInstance.profileId);
              const isLaunching = launchState.isButtonLaunching;

              return isLaunching ? (
                <button
                  onClick={async () => {
                    try {
                      await ProcessService.abort(selectedInstance.profileId);
                      finalizeButtonLaunch(selectedInstance.profileId, "Aborted");
                      addLauncherLog(selectedInstance.profileId, "✗ Launch aborted by user");
                    } catch (error) {
                      console.error("Failed to abort launch:", error);
                    }
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-minecraft-ten bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  <Icon icon="solar:stop-bold" className="w-3.5 h-3.5" />
                  {t('instances.stop')}
                </button>
              ) : (
                <button
                  onClick={() => handleLaunchProfile(selectedInstance.profileId)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-minecraft-ten bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                >
                  <Icon icon="solar:play-bold" className="w-3.5 h-3.5" />
                  {t('instances.start')}
                </button>
              );
            })()}

            {/* Open Folder Button */}
            <button
              onClick={() => handleOpenFolder(selectedInstance.profileId)}
              className="px-2 py-1.5 rounded text-xs font-minecraft-ten bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
              title={t('logs.open_folder')}
            >
              <Icon icon="solar:folder-bold" className="w-3.5 h-3.5" />
            </button>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Popout Log Window Button */}
            <button
              onClick={async () => {
                await invoke("open_single_log_window", {
                  instanceId: selectedInstance.id,
                  instanceName: selectedInstance.name,
                  profileId: selectedInstance.profileId,
                  accountName: selectedInstance.accountName,
                  startTime: selectedInstance.startTime
                });
              }}
              className="px-2 py-1.5 rounded text-xs font-minecraft-ten bg-white/10 hover:bg-white/20 transition-colors"
              title={t('logs.pop_out')}
              style={{ color: accentColor.value }}
            >
              <Icon icon="solar:square-arrow-right-up-bold" className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Status Footer */}
      <div className="px-4 py-2 text-xs font-minecraft-ten text-white/50">
        {instances.filter((i) => i.status === "running").length} {t('instances.running')}
      </div>
    </div>
  );
}
