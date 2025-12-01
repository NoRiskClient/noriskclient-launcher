"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import { parseMotdToHtml } from "../../../utils/motd-utils";
import { Button } from "../../ui/buttons/Button";
import { IconButton } from "../../ui/buttons/IconButton";
import { ActionButton } from "../../ui/ActionButton";
import { ActionButtons } from "../../ui/ActionButtons";
import { useThemeStore } from "../../../store/useThemeStore";
import { useProfileStore } from "../../../store/profile-store";
import { useAppDragDropStore } from "../../../store/appStore";
import { SearchWithFilters } from "../../ui/SearchWithFilters";
import { gsap } from "gsap";
import { TagBadge } from "../../ui/TagBadge";
import { CopyWorldDialog } from "../../modals/CopyWorldDialog";
import { ConfirmDeleteDialog } from "../../modals/ConfirmDeleteDialog";
import { useGlobalModal } from "../../../hooks/useGlobalModal";
import { useProfileLaunch } from "../../../hooks/useProfileLaunch.tsx";
import { toast } from "react-hot-toast";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { LaunchButton } from "../../ui/buttons/LaunchButton";
import { GenericList } from "../../ui/GenericList";
import { GenericListItem } from "../../ui/GenericListItem";
import { preloadIcons } from "../../../lib/icon-utils";
// --- Import Real Types ---
import type {
  ServerInfo,
  ServerPingInfo,
  WorldInfo,
} from "../../../types/minecraft";
import type { CopyWorldParams, Profile } from "../../../types/profile";
import { timeAgo } from "../../../utils/time-utils";
import * as WorldService from "../../../services/world-service";
import {
  getDifficultyString,
  getGameModeString,
} from "../../../services/world-service";

// --- Icons to preload for WorldsTab ---
const WORLDS_TAB_ICONS_TO_PRELOAD = [
  // Placeholders
  "solar:planet-bold",
  "solar:server-bold",
  // Tag Badges (World)
  "solar:gamepad-bold-duotone",
  "solar:tuning-square-bold-duotone",
  "solar:skull-bold",
  "solar:lock-bold",
  "solar:tag-bold", // Also used for server version
  // Tag Badges (Server)
  "solar:users-group-rounded-bold",
  "solar:wifi-bold",
  // Action Buttons (World)
  "solar:copy-bold",
  "solar:folder-open-bold-duotone",
  "solar:trash-bin-trash-bold",
  "solar:folder-with-files-bold", // Import button
  // Common / Dynamic states
  "solar:refresh-circle-bold-duotone", // For loading states in buttons
  // Note: LaunchButton icons are internal to it. GenericList preloads its own defaults.
];

const notificationStore = {
  success: (msg: string) => console.log(`[SUCCESS] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
};

interface WorldsTabProps {
  profile: Profile;
  onRefresh?: () => void;
  isActive?: boolean;
  searchQuery?: string;
  onLaunchRequest?: (params: {
    profileId: string;
    quickPlaySingleplayer?: string;
    quickPlayMultiplayer?: string;
  }) => void;
}

export type DisplayItem =
  | (WorldInfo & { type: "world" })
  | (ServerInfo & { type: "server" });

export function WorldsTab({
  profile,
  onRefresh,
  isActive = false,
  searchQuery = "",
  onLaunchRequest,
}: WorldsTabProps) {
  const allProfilesFromStore = useProfileStore((state) => state.profiles);
  const isLoadingProfilesFromStore = useProfileStore((state) => state.loading);
  const { showModal, hideModal } = useGlobalModal();
  const { 
    setActiveDropContext,
    registerWorldsRefreshCallback,
    unregisterWorldsRefreshCallback,
  } = useAppDragDropStore();

  // Profile launch hook for world/server launching
  const { isLaunching, statusMessage, handleQuickPlayLaunch } = useProfileLaunch({
    profileId: profile.id,
    onLaunchSuccess: () => {
      console.log("Profile launched successfully from WorldsTab:", profile.name);
    },
    onLaunchError: (error) => {
      console.error("Profile launch error from WorldsTab:", error);
    },
  });

  // Handler for world/server launch with QuickPlay support
  const handleWorldServerLaunch = useCallback(async (item: DisplayItem) => {
    const isWorld = item.type === "world";

    if (isWorld) {
      // Launch with specific world using QuickPlay
      console.log(`🚀 QuickPlay Singleplayer: Launching world: ${item.folder_name}`);
      toast.success(`🚀 Launching world: ${item.display_name || item.folder_name}`);
      handleQuickPlayLaunch(item.folder_name, undefined);
    } else if (item.address) {
      // Launch with specific server using QuickPlay
      console.log(`🌐 QuickPlay Multiplayer: Joining server: ${item.address}`);
      toast.success(`🌐 Joining server: ${item.name || item.address}`);
      handleQuickPlayLaunch(undefined, item.address);
    } else {
      // Regular launch as fallback
      console.log("Regular launch fallback");
      handleQuickPlayLaunch(undefined, undefined);
    }
  }, [handleQuickPlayLaunch]);

  // --- State ---
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [displayItems, setDisplayItems] = useState<DisplayItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverPings, setServerPings] = useState<
    Record<string, ServerPingInfo>
  >({});
  const [pingingServers, setPingingServers] = useState<Set<string>>(new Set());

  // --- Config ---
  // const MIN_LOADING_TIME_MS = 300; // Removed

  // --- Modal State ---
  const [worldToCopy, setWorldToCopy] = useState<WorldInfo | null>(null);
  const [isCopyingWorld, setIsCopyingWorld] = useState(false);
  const [copyWorldError, setCopyWorldError] = useState<string | null>(null);
  const [worldToDelete, setWorldToDelete] = useState<WorldInfo | null>(null);
  const [isActuallyDeleting, setIsActuallyDeleting] = useState(false);

  const [deleteLoading, setDeleteLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );

  const containerRef = useRef<HTMLDivElement>(null);

  // Preload icons when component mounts
  useEffect(() => {
    preloadIcons(WORLDS_TAB_ICONS_TO_PRELOAD);
  }, []);

  // Set drag drop context when WorldsTab is active
  useEffect(() => {
    if (profile && isActive) {
      // Set profile context for drag & drop (contentType null for worlds tab)
      setActiveDropContext(profile.id, null);
    }
    return () => {
      // Clear context when tab becomes inactive or component unmounts
      if (isActive) {
        setActiveDropContext(null, null);
      }
    };
  }, [profile, isActive, setActiveDropContext]);

  // Use parent's search query if provided
  useEffect(() => {
    if (searchQuery !== undefined) {
      setLocalSearchQuery(searchQuery);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (containerRef.current && isActive && isBackgroundAnimationEnabled) {
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
    } else if (
      containerRef.current &&
      isActive &&
      !isBackgroundAnimationEnabled
    ) {
      gsap.set(containerRef.current, { opacity: 1, y: 0 });
    }
  }, [isActive, isBackgroundAnimationEnabled]);

  const getWorldDisplayName = useCallback((world: WorldInfo): string => {
    return world.display_name || world.folder_name;
  }, []);

  const getWorldIconSrc = useCallback((world: WorldInfo): string | null => {
    if (world.icon_path) {
      try {
        return convertFileSrc(world.icon_path);
      } catch (err) {
        console.error(`Failed to convert icon path ${world.icon_path}:`, err);
        return null;
      }
    }
    return null;
  }, []);

  const getServerDisplayName = useCallback((server: ServerInfo): string => {
    return server.name || server.address || "Unnamed Server";
  }, []);

  const getServerIconSrc = useCallback(
    (server: ServerInfo): string | null => {
      const pingInfo = server.address ? serverPings[server.address] : null;
      const iconData = pingInfo?.favicon_base64 || server.icon_base64;
      if (iconData) {
        return iconData.startsWith("data:image")
          ? iconData
          : `data:image/png;base64,${iconData}`;
      }
      return null;
    },
    [serverPings],
  );


  const updateDisplayItems = useCallback(
    (currentWorlds: WorldInfo[], currentServers: ServerInfo[]) => {
      const typedWorlds: DisplayItem[] = currentWorlds.map((w) => ({
        ...w,
        type: "world",
      }));
      const typedServers: DisplayItem[] = currentServers.map((s) => ({
        ...s,
        type: "server",
      }));

      let filteredItems: DisplayItem[] = [];

      filteredItems = [...typedWorlds, ...typedServers];

      // Apply search filter
      const effectiveSearchQuery = searchQuery || localSearchQuery;
      if (effectiveSearchQuery) {
        filteredItems = filteredItems.filter((item) => {
          const name =
            item.type === "world"
              ? getWorldDisplayName(item).toLowerCase()
              : getServerDisplayName(item).toLowerCase();
          return name.includes(effectiveSearchQuery.toLowerCase());
        });
      }

      filteredItems.sort((a, b) => {
        if (a.type === "world" && b.type === "world") {
          return (b.last_played ?? 0) - (a.last_played ?? 0);
        } else if (a.type === "world" && b.type === "server") {
          return -1;
        } else if (a.type === "server" && b.type === "world") {
          return 1;
        } else if (a.type === "server" && b.type === "server") {
          const nameA_server = getServerDisplayName(a).toLowerCase();
          const nameB_server = getServerDisplayName(b).toLowerCase();
          return nameA_server.localeCompare(nameB_server);
        }

        const nameA =
          a.type === "world"
            ? getWorldDisplayName(a).toLowerCase()
            : getServerDisplayName(a).toLowerCase();
        const nameB =
          b.type === "world"
            ? getWorldDisplayName(b).toLowerCase()
            : getServerDisplayName(b).toLowerCase();
        return nameA.localeCompare(nameB);
      });

      setDisplayItems(filteredItems);
    },
    [getServerDisplayName, getWorldDisplayName, searchQuery, localSearchQuery],
  );

  const pingAllServers = useCallback(async (serversToPing: ServerInfo[]) => {
    const relevantServers = serversToPing.filter((s) => s.address);
    if (relevantServers.length === 0) return;

    console.log(`[WorldsTab] Pinging ${relevantServers.length} servers...`);
    const currentPinging = new Set<string>(
      relevantServers.map((s) => s.address!),
    );
    setPingingServers(currentPinging);
    setServerPings((prev) => {
      const next = { ...prev };
      relevantServers.forEach((s) => {
        if (s.address) delete next[s.address];
      });
      return next;
    });

    const promises = relevantServers.map(async (server) => {
      const address = server.address!;
      try {
        const pingResult = await WorldService.pingMinecraftServer(address);
        setServerPings((prev) => ({ ...prev, [address]: pingResult }));
      } catch (err) {
        console.error(`[WorldsTab] Failed to ping ${address}:`, err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errorResult: ServerPingInfo = {
          error: errorMsg,
          description: null,
          description_json: null,
          version_name: null,
          version_protocol: null,
          players_online: null,
          players_max: null,
          favicon_base64: null,
          latency_ms: null,
        };
        setServerPings((prev) => ({ ...prev, [address]: errorResult }));
      } finally {
        setPingingServers((prev) => {
          const next = new Set(prev);
          next.delete(address);
          return next;
        });
      }
    });

    await Promise.allSettled(promises);
    console.log("[WorldsTab] All server pings finished.");
  }, []);

  const loadData = useCallback(async () => {
    const currentProfileId = profile?.id;
    if (!currentProfileId) {
      setWorlds([]);
      setServers([]);
      setDisplayItems([]);
      setError(null);
      setServerPings({});
      setPingingServers(new Set());
      setLoading(false);
      return;
    }

    console.log(`[WorldsTab] Loading data for profile: ${currentProfileId}`);
    setLoading(true);
    setError(null);

    try {
      setServerPings({});
      setPingingServers(new Set());

      const [worldsResult, serversResult] = await Promise.allSettled([
        WorldService.getWorldsForProfile(currentProfileId),
        WorldService.getServersForProfile(currentProfileId),
      ]);

      let currentWorlds: WorldInfo[] = [];
      let currentServers: ServerInfo[] = [];
      let loadError = false;
      const errorMessages: string[] = [];

      if (worldsResult.status === "fulfilled") {
        currentWorlds = worldsResult.value;
        // setWorlds(currentWorlds); // Defer state update slightly
      } else {
        console.error("Worlds Error:", worldsResult.reason);
        errorMessages.push(`Worlds: ${worldsResult.reason}`);
        loadError = true;
      }

      if (serversResult.status === "fulfilled") {
        currentServers = serversResult.value;
        // setServers(currentServers); // Defer state update slightly
      } else {
        console.error("Servers Error:", serversResult.reason);
        errorMessages.push(`Servers: ${serversResult.reason}`);
        loadError = true;
      }

      if (loadError) {
        setError(errorMessages.join("; "));
        setWorlds([]); // Ensure worlds state is cleared on error
        setServers([]); // Ensure servers state is cleared on error
        // setDisplayItems([]); // updateDisplayItems will handle this based on empty worlds/servers
      } else {
        // Set raw data state first
        setWorlds(currentWorlds);
        setServers(currentServers);
        // Then ping. updateDisplayItems will be triggered by the useEffect that watches worlds/servers.
        pingAllServers(currentServers);
      }
    } catch (err) {
      console.error("Unexpected load error:", err);
      setError(`Unexpected error: ${err}`);
      setWorlds([]);
      setServers([]);
      // setDisplayItems([]);
    } finally {
      setLoading(false); // Set loading to false directly
    }
  }, [profile?.id, pingAllServers]); // Removed MIN_LOADING_TIME_MS from dependencies

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Register worlds refresh callback after loadData is defined
  useEffect(() => {
    if (profile && isActive) {
      // Register refresh callback for worlds
      const refreshWorldsData = () => loadData();
      registerWorldsRefreshCallback(refreshWorldsData);
    }
    return () => {
      // Clear callback when tab becomes inactive or component unmounts
      if (isActive) {
        unregisterWorldsRefreshCallback();
      }
    };
  }, [profile, isActive, loadData, registerWorldsRefreshCallback, unregisterWorldsRefreshCallback]);

  useEffect(() => {
    if (profile?.id) {
      updateDisplayItems(worlds, servers);
    }
  }, [
    profile?.id,
    updateDisplayItems,
    worlds,
    servers,
    searchQuery,
    localSearchQuery,
  ]);

  const handleOpenCopyDialog = useCallback(async (world: WorldInfo) => {
    showModal(
      "copy-world-dialog",
      <CopyWorldDialog
        isOpen={true}
        sourceWorldName={getWorldDisplayName(world)}
        sourceProfileId={profile.id}
        availableProfiles={allProfilesFromStore}
        isLoadingProfiles={isLoadingProfilesFromStore}
        isCopying={isCopyingWorld}
        onClose={() => {
          hideModal("copy-world-dialog");
          setWorldToCopy(null);
        }}
        onConfirm={async (params) => {
          setIsCopyingWorld(true);
          setCopyWorldError(null);

          const copyParams = {
            source_profile_id: profile.id,
            source_world_folder: world.folder_name,
            target_profile_id: params.targetProfileId,
            target_world_name: params.targetWorldName,
          };

          try {
            await WorldService.copyWorld(copyParams);
            toast.success(
              `World '${getWorldDisplayName(world)}' copied successfully as '${params.targetWorldName}'!`,
            );
            if (params.targetProfileId === profile.id) {
              await loadData();
            }
            hideModal("copy-world-dialog");
            setWorldToCopy(null);
          } catch (err) {
            console.error("Failed to copy world:", err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            setCopyWorldError(`Copy failed: ${errorMsg}`);
            toast.error(`Failed to copy world: ${errorMsg}`);
          } finally {
            setIsCopyingWorld(false);
          }
        }}
        initialError={copyWorldError}
      />
    );
    setWorldToCopy(world);
    setCopyWorldError(null);
  }, [showModal, hideModal, getWorldDisplayName, profile.id, allProfilesFromStore, isLoadingProfilesFromStore, isCopyingWorld, copyWorldError, loadData]);



  const handleDeleteRequest = useCallback((world: WorldInfo) => {
    showModal(
      "delete-world-dialog",
      <ConfirmDeleteDialog
        isOpen={true}
        itemName={getWorldDisplayName(world)}
        onClose={() => {
          hideModal("delete-world-dialog");
          setWorldToDelete(null);
        }}
        onConfirm={async () => {
          setIsActuallyDeleting(true);
          try {
            await WorldService.deleteWorld(profile.id, world.folder_name);
            toast.success(`World "${getWorldDisplayName(world)}" deleted.`);
            hideModal("delete-world-dialog");
            setWorldToDelete(null);
            await loadData();
          } catch (err) {
            console.error("Delete failed:", err);
            toast.error(
              `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          } finally {
            setIsActuallyDeleting(false);
          }
        }}
        isDeleting={isActuallyDeleting}
      />
    );
    setWorldToDelete(world);
  }, [showModal, hideModal, getWorldDisplayName, profile.id, loadData, isActuallyDeleting]);



  const handleOpenWorldFolder = useCallback(
    async (world: WorldInfo) => {
      if (!world?.icon_path) {
        toast.error("World path is not available.");
        console.error(
          "Cannot open world folder: Profile path is missing.",
          profile,
        );
        return;
      }
      // Basic path joining, consider using a library for robust path construction if complex scenarios arise
      const worldFolderPath = `${world.icon_path}`;
      try {
        console.log(`Attempting to open folder: ${worldFolderPath}`);
        await revealItemInDir(worldFolderPath);
        toast.success(`Opened folder for '${getWorldDisplayName(world)}'`);
      } catch (err) {
        console.error(`Failed to open folder ${worldFolderPath}:`, err);
        toast.error(
          `Failed to open folder: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [profile?.path, getWorldDisplayName],
  );

  const handleRefresh = () => {
    loadData();
    if (onRefresh) {
      onRefresh();
    }
  };

  const handleImportWorld = useCallback(async () => {
    try {
      const selectedPath = await openDialog({
        directory: true,
        multiple: false,
        title: 'Select Minecraft World Folder to Import',
      });

      if (!selectedPath) {
        return; // User cancelled
      }

      // Handle both string and string[] (though multiple: false should return string)
      const worldPath = typeof selectedPath === 'string' ? selectedPath : selectedPath[0];
      if (!worldPath) {
        return;
      }

      // Extract folder name from path for target name
      const pathParts = worldPath.split(/[/\\]/);
      const folderName = pathParts[pathParts.length - 1] || 'Imported World';

      const operationId = `world-import-button-${Date.now()}`;
      const loadingToastId = `loading-${operationId}`;
      toast.loading(`Importing world '${folderName}'...`, { id: loadingToastId });

      try {
        const generatedFolderName = await WorldService.importWorld(
          profile.id,
          worldPath,
          folderName
        );
        console.log(`[WorldsTab] World import SUCCESS: ${worldPath} -> ${generatedFolderName}`);
        toast.success(
          `World '${folderName}' imported successfully as '${generatedFolderName}'!`,
          { id: loadingToastId, duration: 4000 }
        );
        // Refresh the worlds list
        await loadData();
      } catch (err) {
        console.error(`[WorldsTab] World import ERROR for: ${worldPath}:`, err);
        toast.error(
          `Failed to import world: ${err instanceof Error ? err.message : String(err)}`,
          { id: loadingToastId }
        );
      }
    } catch (error) {
      console.error('[WorldsTab] Failed to open folder picker:', error);
      toast.error('Failed to open folder picker');
    }
  }, [profile.id, loadData]);

  const effectiveSearchQuery = searchQuery || localSearchQuery;

  // --- Render Item Function for GenericList ---
  const renderDisplayItem = useCallback(
    (item: DisplayItem) => {
      const isWorld = item.type === "world";
      const key = isWorld
        ? item.folder_name
        : item.address || item.name || Math.random().toString();
      const pingInfo =
        !isWorld && item.address ? serverPings[item.address] : null;
      const isPinging =
        !isWorld && item.address ? pingingServers.has(item.address) : false;
      const hasPingError = !!pingInfo?.error;
      const worldIconSrc = isWorld ? getWorldIconSrc(item) : null;
      const serverIconSrc = !isWorld ? getServerIconSrc(item) : null;
      const itemDisplayName = isWorld
        ? getWorldDisplayName(item)
        : getServerDisplayName(item);

      const iconNode = (
        <div
          className="absolute inset-0 border-2 border-b-4 overflow-hidden rounded-md"
          style={{
            backgroundColor: `${accentColor.value}15`,
            borderColor: `${accentColor.value}30`,
            borderBottomColor: `${accentColor.value}50`,
            boxShadow: `0 2px 4px rgba(0,0,0,0.2), inset 0 1px 0 ${accentColor.value}20`,
          }}
        >
          {isWorld ? (
            worldIconSrc ? (
              <img
                src={worldIconSrc || "/placeholder.svg"}
                alt={`${itemDisplayName} icon`}
                className="w-full h-full object-cover image-pixelated"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Icon
                  icon="solar:planet-bold"
                  className="w-10 h-10 text-white/50"
                />
              </div>
            )
          ) : serverIconSrc ? (
            <img
              src={serverIconSrc || "/placeholder.svg"}
              alt={`${itemDisplayName} icon`}
              className="w-full h-full object-cover image-pixelated"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Icon
                icon="solar:server-bold"
                className="w-10 h-10 text-white/50"
              />
            </div>
          )}
        </div>
      );

      const contentNode = (
        <>
          {/* Top: Title */}
          <h3
            className="font-minecraft-ten text-base tracking-wide truncate flex-shrink-0"
            title={itemDisplayName}
          >
            {itemDisplayName}
          </h3>

          {/* Middle: Subtitle (Last Played / MOTD) - vertically centered */}
          <div className="flex-grow flex items-center my-1 overflow-hidden">
            {isWorld ? (
              <p className="text-white/60 text-xs truncate font-minecraft-ten">
                {item.last_played
                  ? `Last played: ${timeAgo(item.last_played)}`
                  : "Never played"}
              </p>
            ) : (
              <div
                className="text-white/70 text-xs motd-container overflow-hidden truncate font-minecraft-ten text-center"
                title={pingInfo?.description || item.address || ""}
              >
                {isPinging ? (
                  <span className="italic text-white/50">Pinging...</span>
                ) : hasPingError ? (
                  <span className="text-red-400 italic">
                    Error: {pingInfo?.error}
                  </span>
                ) : pingInfo ? (
                  <span
                    dangerouslySetInnerHTML={{
                      __html: parseMotdToHtml(
                        pingInfo?.description_json || pingInfo?.description,
                      ),
                    }}
                  />
                ) : (
                  <span className="italic text-white/50">
                    {item.address || "Address missing"}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Bottom: Tag Badges */}
          <div className="flex flex-wrap items-center gap-1 flex-shrink-0">
            {isWorld ? (
              <>
                <TagBadge
                  size="sm"
                  variant="info"
                  iconElement={<Icon icon="solar:gamepad-bold-duotone" />}
                >
                  {getGameModeString(item.game_mode)}
                </TagBadge>
                <TagBadge
                  size="sm"
                  variant="default"
                  iconElement={<Icon icon="solar:tuning-square-bold-duotone" />}
                >
                  {getDifficultyString(item.difficulty)}
                </TagBadge>
                {item.is_hardcore && (
                  <TagBadge
                    variant="destructive"
                    size="sm"
                    iconElement={<Icon icon="solar:skull-bold" />}
                  >
                    Hardcore
                  </TagBadge>
                )}
                {item.difficulty_locked && (
                  <TagBadge
                    size="sm"
                    iconElement={<Icon icon="solar:lock-bold" />}
                  >
                    Locked
                  </TagBadge>
                )}
                {item.version_name && (
                  <TagBadge
                    size="sm"
                    iconElement={<Icon icon="solar:tag-bold" />}
                  >
                    {item.version_name}
                  </TagBadge>
                )}
              </>
            ) : (
              <>
                {isPinging ? (
                  <TagBadge size="sm" variant="default">
                    Pinging...
                  </TagBadge>
                ) : hasPingError ? (
                  <TagBadge size="sm" variant="destructive">
                    Error
                  </TagBadge>
                ) : pingInfo ? (
                  (() => {
                    let playerCountVariant:
                      | "default"
                      | "success"
                      | "info"
                      | "inactive"
                      | "destructive"
                      | "warning" = "inactive";
                    if (pingInfo.players_online != null) {
                      if (pingInfo.players_online > 0)
                        playerCountVariant = "success";
                      else playerCountVariant = "default";
                    }
                    let pingLatencyVariant:
                      | "default"
                      | "success"
                      | "info"
                      | "inactive"
                      | "destructive"
                      | "warning" = "inactive";
                    if (pingInfo.latency_ms != null) {
                      if (pingInfo.latency_ms <= 80)
                        pingLatencyVariant = "success";
                      else if (pingInfo.latency_ms <= 150)
                        pingLatencyVariant = "default";
                      else if (pingInfo.latency_ms <= 250)
                        pingLatencyVariant = "warning";
                      else pingLatencyVariant = "destructive";
                    }
                    return (
                      <>
                        <TagBadge
                          size="sm"
                          variant={playerCountVariant}
                          iconElement={
                            <Icon icon="solar:users-group-rounded-bold" />
                          }
                        >
                          {pingInfo.players_online ?? "-"}/
                          {pingInfo.players_max ?? "-"}
                        </TagBadge>
                        <TagBadge
                          size="sm"
                          variant={pingLatencyVariant}
                          iconElement={<Icon icon="solar:wifi-bold" />}
                        >
                          {pingInfo.latency_ms ?? "-"} ms
                        </TagBadge>
                        {pingInfo.version_name && (
                          <TagBadge
                            size="sm"
                            variant="default"
                            iconElement={<Icon icon="solar:tag-bold" />}
                          >
                            {pingInfo.version_name}
                          </TagBadge>
                        )}
                      </>
                    );
                  })()
                ) : (
                  <TagBadge size="sm" variant="inactive">
                    Offline / Unknown
                  </TagBadge>
                )}
              </>
            )}
          </div>
        </>
      );

      const playActions = [
        {
          id: "play",
          label: isLaunching ? "STOP" : (isWorld ? "PLAY" : "JOIN"),
          icon: isLaunching ? "solar:stop-bold" : (isWorld ? "solar:play-bold" : "solar:login-3-bold"),
          variant: isLaunching ? "destructive" : "secondary",
          tooltip: isLaunching ? "Stop Launch" : (isWorld ? "Play World" : "Join Server"),
          disabled: !isWorld && !item.address,
          onClick: () => handleWorldServerLaunch(item),
        },
      ];

      const worldActions = isWorld ? [
        {
          id: "copy",
          label: "",
          icon: "solar:copy-bold",
          tooltip: "Copy World",
          disabled: isCopyingWorld,
          onClick: () => handleOpenCopyDialog(item),
        },
        {
          id: "folder",
          label: "",
          icon: "solar:folder-open-bold-duotone",
          tooltip: "Open World Folder",
          onClick: () => handleOpenWorldFolder(item),
        },
        {
          id: "delete",
          label: "",
          icon: isActuallyDeleting &&
            worldToDelete?.folder_name === item.folder_name
            ? "solar:refresh-circle-bold-duotone"
            : "solar:trash-bin-trash-bold",
          tooltip: "Delete World",
          disabled: isActuallyDeleting &&
            worldToDelete?.folder_name === item.folder_name,
          onClick: () => handleDeleteRequest(item),
        },
      ] : [];

      const actionsNode = (
        <div className="flex items-center gap-2">
          {/* Play/Join Button */}
          <ActionButton
            icon={isLaunching ? "solar:stop-bold" : (isWorld ? "solar:play-bold" : "solar:login-3-bold")}
            label={isLaunching ? "STOP" : (isWorld ? "PLAY" : "JOIN")}
            variant={isLaunching ? "destructive" : "secondary"}
            size="sm"
            tooltip={isLaunching ? "Stop Launch" : (isWorld ? "Play World" : "Join Server")}
            disabled={!isWorld && !item.address}
            onClick={() => handleWorldServerLaunch(item)}
          />
          
          {/* World Actions */}
          {isWorld && (
            <>
              <ActionButton
                icon="solar:copy-bold"
                variant="icon-only"
                size="sm"
                tooltip="Copy World"
                disabled={isCopyingWorld}
                onClick={() => handleOpenCopyDialog(item)}
              />
              <ActionButton
                icon="solar:folder-open-bold-duotone"
                variant="icon-only"
                size="sm"
                tooltip="Open World Folder"
                onClick={() => handleOpenWorldFolder(item)}
              />
              <ActionButton
                icon={isActuallyDeleting &&
                  worldToDelete?.folder_name === item.folder_name
                  ? "solar:refresh-circle-bold-duotone"
                  : "solar:trash-bin-trash-bold"}
                variant="icon-only"
                size="sm"
                tooltip="Delete World"
                disabled={isActuallyDeleting &&
                  worldToDelete?.folder_name === item.folder_name}
                onClick={() => handleDeleteRequest(item)}
                className={isActuallyDeleting &&
                  worldToDelete?.folder_name === item.folder_name ? "animate-spin" : ""}
              />
            </>
          )}
        </div>
      );

      return (
        <div
          key={key}
          className="relative flex items-center gap-4 p-3 rounded-lg bg-black/20 border border-white/10 hover:border-white/20 transition-all duration-200"
        >
          {/* Icon */}
          <div className="relative w-16 h-16 flex-shrink-0">
            {iconNode}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {contentNode}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {actionsNode}
          </div>
        </div>
      );
    },
    [
      accentColor.value,
      getWorldDisplayName,
      getWorldIconSrc,
      getServerDisplayName,
      getServerIconSrc,
      serverPings,
      pingingServers,
      handleOpenCopyDialog,
      handleOpenWorldFolder,
      handleDeleteRequest,
      isCopyingWorld,
      isActuallyDeleting,
      worldToDelete,
      profile.id,
      getGameModeString,
      getDifficultyString,
      timeAgo,
    ],
  );

  return (
    <div ref={containerRef} className="h-full flex flex-col select-none">
      {/* Action bar without border/background */}
      <div className="flex items-center justify-between mb-4">
        {/* Only show search if parent isn't providing it */}
        {!searchQuery && (
          <SearchWithFilters
            placeholder="search worlds & servers..."
            searchValue={localSearchQuery}
            onSearchChange={setLocalSearchQuery}
            showSort={false}
            showFilter={false}
            className="flex-1"
          />
        )}

        <div className="flex items-center gap-4 ml-auto">
          <ActionButton
            icon="solar:folder-with-files-bold"
            label="IMPORT"
            variant="text"
            size="sm"
            onClick={handleImportWorld}
            disabled={loading}
            tooltip="Import world folder"
          />
          <ActionButton
            icon={loading ? "solar:refresh-circle-bold-duotone" : "solar:refresh-bold"}
            label="REFRESH"
            variant="text"
            size="sm"
            onClick={handleRefresh}
            disabled={
              loading ||
              pingingServers.size > 0 ||
              (servers.filter((s) => s.address).length === 0 &&
                displayItems.filter((item) => item.type === "server").length >
                  0)
            }
            tooltip="Refresh worlds and servers"
            className={loading ? "animate-spin" : ""}
          />
        </div>
      </div>

      <GenericList<DisplayItem>
        items={displayItems}
        renderItem={renderDisplayItem}
        isLoading={loading}
        error={error}
        searchQuery={effectiveSearchQuery}
        accentColor={accentColor.value}
        emptyStateIcon={"solar:planet-bold"}
        emptyStateMessage={
          effectiveSearchQuery
            ? `no worlds or servers match your search`
            : `no worlds or servers found`
        }
        emptyStateDescription={"Create worlds or add servers in Minecraft"}
        loadingItemCount={0}
      />


    </div>
  );
}
