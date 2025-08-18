"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "@iconify/react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../../ui/buttons/Button";
import { IconButton } from "../../../ui/buttons/IconButton";
import { GenericDetailListItem } from "../items/GenericDetailListItem";
import { TagBadge } from "../../../ui/TagBadge";
import { useThemeStore } from "../../../../store/useThemeStore";
import { GenericContentTab } from "../../../ui/GenericContentTab";
import { preloadIcons } from "../../../../lib/icon-utils";
import type { Profile } from "../../../../types/profile";
import type { ModrinthVersion } from "../../../../types/modrinth";
import { SearchInput } from "../../../ui/SearchInput";
import { Checkbox } from "../../../ui/Checkbox";
import { ConfirmDeleteDialog } from "../../../modals/ConfirmDeleteDialog";
import { formatFileSize } from "../../../../utils/format-file-size";
import { toast } from "react-hot-toast";
import {
  type LocalContentItem,
  type LocalContentType,
  useLocalContentManager,
} from "../../../../hooks/useLocalContentManager";
import type { NoriskModpacksConfig } from "../../../../types/noriskPacks";
import * as ProfileService from "../../../../services/profile-service";
import * as ContentService from "../../../../services/content-service"; // Added import
import {
  ContentType as BackendContentType,
  type SwitchContentVersionPayload,
} from "../../../../types/content"; // Added import
import { type DialogFilter, open } from "@tauri-apps/plugin-dialog"; // Corrected: DialogFile is not exported directly
import { Select, type SelectOption } from "../../../ui/Select";
import { ThemedSurface } from "../../../ui/ThemedSurface";
import { useAppDragDropStore } from "../../../../store/appStore"; // Import the store
import { createPortal } from "react-dom";
import { ModrinthService } from "../../../../services/modrinth-service"; // Added import
import { EmptyState } from "../../../ui/EmptyState"; // Added import
import { useProfileStore } from "../../../../store/profile-store"; // Added import
import { useConfirmDialog } from "../../../../hooks/useConfirmDialog"; // Added import
import * as FlagsmithService from "../../../../services/flagsmith-service"; // Added

// Generic icons that can be used across different content types
const LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD = [
  "solar:gallery-bold-duotone", // Fallback icon, empty state (can be overridden by prop)
  "solar:settings-bold-duotone", // Placeholder for potential future settings
  "solar:info-circle-bold-duotone", // Placeholder for potential future info
  "solar:check-circle-bold", // Enabled status
  "solar:close-circle-bold", // Disabled status
  "solar:folder-open-bold-duotone",
  "solar:trash-bin-trash-bold",
  "solar:menu-dots-bold",
  "solar:sort-from_top_to_bottom-bold-duotone", // Placeholder for sort
  "solar:refresh-square-bold-duotone", // Refresh button in list item (not used yet)
  "solar:download-minimalistic-bold", // For Update Available button
  "solar:refresh-bold", // For Check for Updates loading spinner / general loading
  "solar:add-circle-bold-duotone", // For Add Content button
  "solar:refresh-outline", // For primary refresh button normal state
  "solar:download-minimalistic-bold", // For Update All button
  "solar:alt-arrow-down-bold", // For version dropdown button
  "solar:shield-cross-bold-duotone", // For NoRisk blocked badge
];

interface LocalContentTabV2Props<T extends LocalContentItem> {
  profile?: Profile;
  contentType: LocalContentType; // e.g., 'ResourcePack', 'ShaderPack'
  getDisplayFileName: (item: T) => string;
  itemTypeName: string; // Singular, e.g., "resource pack"
  itemTypeNamePlural: string; // Plural, e.g., "resource packs"
  addContentButtonText: string; // e.g., "Add Resource Packs"
  onAddContent?: () => void; // Action for the add button
  emptyStateIconOverride?: string; // Optional override for the main empty/fallback icon
  onRefreshRequired?: () => void;
  onBrowseContentRequest?: (browseContentType: string) => void; // Added new prop
}

export function LocalContentTabV2<T extends LocalContentItem>({
  profile,
  contentType,
  getDisplayFileName,
  itemTypeName,
  itemTypeNamePlural,
  addContentButtonText,
  onAddContent: onAddContentProp,
  emptyStateIconOverride,
  onRefreshRequired,
  onBrowseContentRequest, // Destructure new prop
}: LocalContentTabV2Props<T>) {
  const navigate = useNavigate();
  const accentColor = useThemeStore((state) => state.accentColor);
  const { confirm, confirmDialog } = useConfirmDialog(); // Added hook
  const { copyProfile, fetchProfiles, updateProfile } = useProfileStore(); // Added updateProfile
  const {
    setActiveDropContext,
    registerRefreshCallback,
    unregisterRefreshCallback,
  } = useAppDragDropStore();

  const [isBlockedConfigLoaded, setIsBlockedConfigLoaded] = useState(false);

  const [noriskPacksConfig, setNoriskPacksConfig] =
    useState<NoriskModpacksConfig | null>(null);
  const [isFetchingPacksConfig, setIsFetchingPacksConfig] = useState(false);
  const [isRefreshingPacksList, setIsRefreshingPacksList] = useState(false);
  const [openVersionDropdownId, setOpenVersionDropdownId] = useState<
    string | null
  >(null);
  const versionDropdownRef = useRef<HTMLDivElement>(null);
  const versionButtonRef = useRef<HTMLButtonElement | null>(null); // Allow null

  // State for version dropdown content
  const [availableVersions, setAvailableVersions] = useState<
    ModrinthVersion[] | null
  >(null);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  // Fetch Flagsmith config when a NoRisk pack is selected
  useEffect(() => {
    // Only fetch if a pack is selected, as blocking rules only apply in that context.
    if (profile?.selected_norisk_pack_id) {
      FlagsmithService.getBlockedModsConfig()
        .then(() => {
          setIsBlockedConfigLoaded(true);
        })
        .catch((err) => {
          console.error("Failed to load NoRisk blocked mods config:", err);
          // Optionally show a toast, but might be too noisy.
          // toast.error("Could not load mod compatibility rules.");
        });
    } else {
      // If no pack is selected, the config is not relevant/loaded.
      setIsBlockedConfigLoaded(false);
    }
  }, [profile?.selected_norisk_pack_id]);

  const {
    items,
    isLoading,
    isFetchingHashes,
    isFetchingModrinthDetails,
    isAnyTaskRunning,
    error,
    searchQuery,
    setSearchQuery,
    selectedItemIds,
    handleItemSelectionChange,
    handleSelectAllToggle,
    areAllFilteredSelected,
    filteredItems,
    itemBeingToggled,
    itemBeingDeleted,
    isBatchToggling,
    isBatchDeleting,
    activeDropdownId,
    setActiveDropdownId,
    dropdownRef,
    isConfirmDeleteDialogOpen,
    isDialogActionLoading,
    handleConfirmDeletion,
    handleCloseDeleteDialog,
    itemToDeleteForDialog,
    modrinthIcons,
    localArchiveIcons,
    fetchData,
    handleToggleItemEnabled,
    handleDeleteItem,
    handleBatchToggleSelected,
    handleBatchDeleteSelected,
    handleOpenItemFolder,
    contentUpdates,
    isCheckingUpdates,
    itemsBeingUpdated,
    contentUpdateError,
    isUpdatingAll,
    checkForContentUpdates,
    handleUpdateContentItem,
    handleUpdateAllAvailableContent,
    handleSwitchContentVersion,
  } = useLocalContentManager<T>({
    // Hook uses the generic type T
    profile,
    contentType,
    getDisplayFileName,
    onRefreshRequired,
  });

  // Map UI contentType to BackendContentType for the store
  const backendContentTypeForStore = useMemo(() => {
    return contentType as BackendContentType;
  }, [contentType]);

  useEffect(() => {
    if (profile && backendContentTypeForStore) {
      setActiveDropContext(profile.id, backendContentTypeForStore);

      // Register refresh callback for this specific content type instance
      const refreshThisTabData = () => fetchData(true);
      registerRefreshCallback(backendContentTypeForStore, refreshThisTabData);
    }
    return () => {
      // Clear context when this specific tab instance is no longer focused or unmounted
      // Only clear if this was the one setting it (or manage this more globally)
      // For simplicity, we clear based on this instance.
      // A more robust solution might involve checking if the current global context matches this instance before clearing.
      setActiveDropContext(null, null);
      unregisterRefreshCallback(backendContentTypeForStore);
    };
  }, [
    profile,
    backendContentTypeForStore,
    setActiveDropContext,
    registerRefreshCallback,
    unregisterRefreshCallback,
  ]);

  // Helper to convert LocalContentType to URL-friendly string for BrowseTab
  const getBrowseTabContentType = (
    currentTabContentType: LocalContentType,
  ): string => {
    switch (currentTabContentType) {
      case "Mod":
        return "mods";
      case "ResourcePack":
        return "resourcepacks";
      case "ShaderPack":
        return "shaderpacks";
      case "DataPack":
        return "datapacks";
      default:
        return "mods"; // Fallback
    }
  };

  // Fetch NoRiskPacksConfig if content type is NoRiskMod
  useEffect(() => {
    if (contentType === "NoRiskMod" && profile) {
      const fetchPacks = async () => {
        setIsFetchingPacksConfig(true);
        try {
          const config = await ProfileService.getNoriskPacksResolved();
          setNoriskPacksConfig(config);
        } catch (err) {
          console.error("Failed to fetch NoRisk packs config:", err);
          toast.error("Failed to load NoRisk pack list.");
          setNoriskPacksConfig(null);
        } finally {
          setIsFetchingPacksConfig(false);
        }
      };
      fetchPacks();
    } else {
      setNoriskPacksConfig(null); // Clear if not NoRiskMod or no profile
    }
  }, [contentType, profile]);

  const handleRefreshPacksList = useCallback(async () => {
    if (contentType !== "NoRiskMod") return;
    setIsRefreshingPacksList(true);
    try {
      await ProfileService.refreshNoriskPacks();
      const config = await ProfileService.getNoriskPacksResolved();
      setNoriskPacksConfig(config);
      toast.success("NoRisk Pack list refreshed.");
    } catch (err) {
      console.error("Failed to refresh NoRisk packs list:", err);
      toast.error("Failed to refresh NoRisk pack list.");
    } finally {
      setIsRefreshingPacksList(false);
    }
  }, [contentType]);

  const noriskPackOptions = useMemo((): SelectOption[] => {
    if (contentType !== "NoRiskMod" || !noriskPacksConfig) {
      return [{ value: "", label: "- No Pack Selected -" }];
    }
    const options = Object.entries(noriskPacksConfig.packs).map(
      ([id, packDef]) => ({
        value: id,
        label: packDef.displayName || id,
      }),
    );
    options.sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: "", label: "- No Pack Selected -" }, ...options];
  }, [contentType, noriskPacksConfig]);

  const handleSelectedPackChange = useCallback(
    async (newPackId: string | null) => {
      if (!profile || newPackId === profile.selected_norisk_pack_id) return;
      try {
        await ProfileService.updateProfile(profile.id, {
          selected_norisk_pack_id: newPackId,
          clear_selected_norisk_pack: newPackId === null,
        });
        if (onRefreshRequired) {
          onRefreshRequired();
        }
      } catch (err) {
        console.error("Failed to update selected NoRisk pack:", err);
        toast.error(
          `Failed to switch NoRisk pack: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [profile, onRefreshRequired],
  );

  // Update default onAddContent to use the new dialog and service call
  const defaultOnAddContent = async () => {
    if (!profile) {
      toast.error("Profile data is not available to add content.");
      return;
    }

    let dialogFilters: DialogFilter[] = [];
    const currentContentType = contentType; // from component props

    switch (currentContentType) {
      case "Mod":
        dialogFilters = [
          { name: "Java Archives", extensions: ["jar", "jar.disabled"] },
        ];
        break;
      case "ResourcePack":
        dialogFilters = [
          {
            name: "Resource Pack Archives",
            extensions: ["zip", "zip.disabled"],
          },
        ];
        break;
      case "ShaderPack":
        dialogFilters = [
          { name: "Shader Pack Archives", extensions: ["zip", "zip.disabled"] },
        ];
        break;
      case "DataPack":
        dialogFilters = [
          { name: "Data Pack Archives", extensions: ["zip", "zip.disabled"] },
        ];
        break;
      default:
        toast.error(
          `Local import is not configured for content type: ${currentContentType}`,
        );
        return;
    }

    try {
      // `open` with `multiple: true` and `directory: false` returns `Promise<string[] | null>`
      // representing absolute paths if no `baseDir` is specified.
      const selectedPathsArray = await open({
        multiple: true,
        directory: false,
        filters: dialogFilters,
        title: `Select ${itemTypeNamePlural} to Import for profile: ${profile.name}`,
      });

      if (selectedPathsArray && selectedPathsArray.length > 0) {
        // selectedPathsArray is already string[]
        const filePaths = selectedPathsArray;

        const toastId = toast.loading(
          `Importing ${filePaths.length} ${itemTypeNamePlural.toLowerCase()}...`,
        );
        try {
          await ContentService.installLocalContentToProfile({
            profile_id: profile.id,
            file_paths: filePaths,
            content_type: currentContentType as BackendContentType,
          });
          toast.success(
            `${filePaths.length} ${itemTypeNamePlural.toLowerCase()} import process initiated. List will refresh.`,
            { id: toastId },
          );
          fetchData(true);
          if (onRefreshRequired) {
            onRefreshRequired();
          }
        } catch (importError) {
          console.error(
            `Error importing local ${itemTypeNamePlural.toLowerCase()}:`,
            importError,
          );
          toast.error(
            `Failed to import ${itemTypeNamePlural.toLowerCase()}: ${importError instanceof Error ? importError.message : String(importError)}`,
            { id: toastId },
          );
        }
      } else {
        // User cancelled or selected no files
      }
    } catch (dialogError) {
      console.error("Error opening file dialog:", dialogError);
      toast.error(
        `Could not open file dialog: ${dialogError instanceof Error ? dialogError.message : String(dialogError)}`,
      );
    }
  };

  // Use the provided onAddContent prop if available, otherwise use the new default implementation.
  const effectiveOnAddContent = onAddContentProp || defaultOnAddContent;

  console.log(
    `LocalContentTabV2 (${contentType}): Render. isLoading: ${isLoading}, hook items: ${items.length}, filteredItems: ${filteredItems.length}, error: ${error}, searchQuery: '${searchQuery}'`,
  );

  useEffect(() => {
    preloadIcons(LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD);
  }, []);

  // Update dropdown position and fetch versions
  useEffect(() => {
    const updatePosition = () => {
      if (
        openVersionDropdownId &&
        versionDropdownRef.current &&
        versionButtonRef.current
      ) {
        if (!versionButtonRef.current.isConnected) {
          setOpenVersionDropdownId(null); // Close if button is detached
          return;
        }
        const buttonRect = versionButtonRef.current.getBoundingClientRect();
        const dropdownElement = versionDropdownRef.current;

        if (
          buttonRect.width === 0 &&
          buttonRect.height === 0 &&
          buttonRect.x === 0 &&
          buttonRect.y === 0
        ) {
          // Button likely not properly laid out yet, or invisible
          // Hide dropdown until next frame attempts to position it
          dropdownElement.style.visibility = "hidden";
          requestAnimationFrame(updatePosition); // Retry positioning on next frame
          return;
        }

        dropdownElement.style.top = `${buttonRect.bottom + 2}px`;
        dropdownElement.style.left = `${buttonRect.left}px`;
        dropdownElement.style.visibility = "visible";
      } else if (versionDropdownRef.current) {
        versionDropdownRef.current.style.visibility = "hidden";
      }
    };

    const fetchVersionsForDropdown = async () => {
      if (openVersionDropdownId) {
        const currentItem = items.find(
          (it) => it.filename === openVersionDropdownId,
        );
        if (currentItem && currentItem.modrinth_info?.project_id) {
          setIsLoadingVersions(true);
          setAvailableVersions(null);
          setVersionsError(null);
          try {
            let loadersArg: string[] | undefined = undefined;
            if (contentType === "Mod") {
              loadersArg = profile?.loader ? [profile.loader] : undefined;
            }

            const versions = await ModrinthService.getModVersions(
              currentItem.modrinth_info.project_id,
              loadersArg,
              profile?.game_version ? [profile.game_version] : undefined,
            );
            setAvailableVersions(versions);
          } catch (error) {
            console.error("Failed to fetch Modrinth versions:", error);
            setVersionsError(
              error instanceof Error
                ? error.message
                : "Failed to load versions.",
            );
          }
          setIsLoadingVersions(false);
        } else {
          // Item is not from Modrinth or no project_id, or no item found
          setAvailableVersions(null);
          setIsLoadingVersions(false);
          setVersionsError(
            currentItem?.modrinth_info?.project_id
              ? null
              : "Version history not available.",
          );
        }
      }
    };

    if (openVersionDropdownId) {
      requestAnimationFrame(updatePosition);
      fetchVersionsForDropdown();
    } else {
      if (versionDropdownRef.current) {
        versionDropdownRef.current.style.visibility = "hidden";
      }
      versionButtonRef.current = null;
      // Reset version states when dropdown closes
      setAvailableVersions(null);
      setIsLoadingVersions(false);
      setVersionsError(null);
    }

    // Event listeners for keeping position updated and closing
    const scrollableParents = document.querySelectorAll(".custom-scrollbar");
    const handleScrollOrResize = () => requestAnimationFrame(updatePosition);

    scrollableParents.forEach((el) =>
      el.addEventListener("scroll", handleScrollOrResize),
    );
    window.addEventListener("scroll", handleScrollOrResize);
    window.addEventListener("resize", handleScrollOrResize);
    document.addEventListener("wheel", handleScrollOrResize, { passive: true });

    const handleClickOutside = (event: MouseEvent) => {
      if (
        versionDropdownRef.current &&
        !versionDropdownRef.current.contains(event.target as Node) &&
        versionButtonRef.current &&
        !versionButtonRef.current.contains(event.target as Node)
      ) {
        setOpenVersionDropdownId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      scrollableParents.forEach((el) =>
        el.removeEventListener("scroll", handleScrollOrResize),
      );
      window.removeEventListener("scroll", handleScrollOrResize);
      window.removeEventListener("resize", handleScrollOrResize);
      document.removeEventListener("wheel", handleScrollOrResize);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [openVersionDropdownId]); // Effect runs when dropdown open state changes

  const renderListItem = useCallback(
    (item: T) => {
      const itemTitle = getDisplayFileName(item);
      const isToggling = itemBeingToggled === item.filename;
      const isDeleting = itemBeingDeleted === item.filename;
      const isCurrentlyUpdating = itemsBeingUpdated.has(item.filename);

      const updateAvailableVersion = item.sha1_hash
        ? contentUpdates[item.sha1_hash]
        : null;

      const isItemOpen = openVersionDropdownId === item.filename;

      const isBlockedByNoRisk =
        !!profile?.selected_norisk_pack_id &&
        isBlockedConfigLoaded &&
        FlagsmithService.isModBlockedByNoRisk(
          item.filename,
          item.modrinth_info?.project_id,
        );

      let iconToShow: React.ReactNode;
      const modrinthProjectId = item.modrinth_info?.project_id;
      const modrinthIconUrl = modrinthProjectId
        ? modrinthIcons[modrinthProjectId]
        : null;
      const localIconDataUrl = item.path ? localArchiveIcons[item.path] : null;

      if (modrinthIconUrl) {
        iconToShow = (
          <img
            src={modrinthIconUrl}
            alt={`${itemTitle} Modrinth icon`}
            className="w-full h-full object-contain image-pixelated"
            onError={(e) => {
              (e.target as HTMLImageElement).style.visibility = "hidden";
            }}
          />
        );
      } else if (localIconDataUrl) {
        iconToShow = (
          <img
            src={localIconDataUrl}
            alt={`${itemTitle} local icon`}
            className="w-full h-full object-contain image-pixelated"
          />
        );
      } else {
        iconToShow = (
          <Icon
            icon={
              emptyStateIconOverride || LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[0]
            }
            className="w-8 h-8 sm:w-10 sm:h-10 text-white/40"
          />
        );
      }

      const itemIconNode = (
        <div className="absolute inset-0 w-full h-full flex items-center justify-center">
          {iconToShow}
        </div>
      );

      const itemDescriptionNode = (() => {
        let descriptionText: string;
        let titleText: string;
        let versionText: string | null = null;

        const isItemWaitingForHash =
          item.sha1_hash === null && isFetchingHashes;
        const isItemStillLoadingDetails =
          isItemWaitingForHash ||
          (item.sha1_hash !== null &&
            !item.modrinth_info &&
            isFetchingModrinthDetails);

        if (item.fallback_version) {
          versionText = item.fallback_version;
          descriptionText = `Version: ${item.fallback_version}`;
          titleText = `Version: ${item.fallback_version}`;
        } else if (item.modrinth_info?.version_number) {
          versionText = item.modrinth_info.version_number;
          descriptionText = `Version: ${item.modrinth_info.version_number}`;
          titleText = `Modrinth Version: ${item.modrinth_info.version_number}`;
        } else if (isItemStillLoadingDetails) {
          descriptionText = "Loading...";
          titleText = "Loading details...";
        } else {
          descriptionText = formatFileSize(item.file_size || 0);
          titleText = `Size: ${formatFileSize(item.file_size || 0)}`;
        }

        return (
          <span title={titleText} className="flex items-center">
            {versionText ? (
              <>
                <span>Version: {versionText}</span>
                {contentType !== "NoRiskMod" && (
                  <div className="relative">
                    <button
                      ref={(el) => {
                        if (isItemOpen && el) {
                          versionButtonRef.current = el;
                        }
                      }}
                      className="ml-1 px-1 text-xs hover:bg-white/10 flex items-center border border-transparent hover:border-white/20"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isItemOpen) {
                          setOpenVersionDropdownId(null);
                        } else {
                          versionButtonRef.current = e.currentTarget;
                          setIsLoadingVersions(true);
                          setAvailableVersions(null);
                          setVersionsError(null);
                          setOpenVersionDropdownId(item.filename);
                        }
                      }}
                      title="View version options"
                    >
                      <span
                        className={`font-minecraft-ten transition-transform duration-200 ${isItemOpen ? "rotate-90" : ""}`}
                      >
                        &gt;
                      </span>
                    </button>
                    {isItemOpen &&
                      createPortal(
                        <div
                          ref={versionDropdownRef}
                          className="fixed z-[100] font-minecraft-ten"
                          style={{
                            backgroundColor: "rgb(20, 20, 20)",
                            border: `2px solid rgba(${parseInt(accentColor.value.substring(1, 3), 16)}, ${parseInt(accentColor.value.substring(3, 5), 16)}, ${parseInt(accentColor.value.substring(5, 7), 16)}, 0.6)`,
                            boxShadow: `0 6px 16px rgba(0, 0, 0, 0.7)`,
                            padding: "12px",
                            minWidth: "170px",
                            visibility: "hidden",
                          }}
                        >
                          {isLoadingVersions ? (
                            <div className="text-white/70 text-sm tracking-wider">
                              Loading versions...
                            </div>
                          ) : versionsError ? (
                            <div className="text-red-400 text-sm tracking-wider">
                              {versionsError}
                            </div>
                          ) : availableVersions &&
                            availableVersions.length > 0 ? (
                            <>
                              <div className="font-bold mb-2 text-sm tracking-wider">
                                Available Versions:
                              </div>
                              <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                {availableVersions.map((version) => {
                                  const localModrinthInfo = item.modrinth_info;
                                  let isCurrent = false;

                                  if (localModrinthInfo) {
                                    // Prioritize version_id if it exists on localModrinthInfo (typical for GenericModrinthInfo)
                                    if (
                                      typeof localModrinthInfo === "object" &&
                                      localModrinthInfo !== null &&
                                      "version_id" in localModrinthInfo &&
                                      localModrinthInfo.version_id ===
                                        version.id
                                    ) {
                                      isCurrent = true;
                                    }
                                    // Fallback to id if version_id didn't match or doesn't exist (typical for full ModrinthVersion object)
                                    else if (
                                      typeof localModrinthInfo === "object" &&
                                      localModrinthInfo !== null &&
                                      "id" in localModrinthInfo &&
                                      localModrinthInfo.id === version.id
                                    ) {
                                      isCurrent = true;
                                    }
                                    // Optional: secondary check by version_number if no ID match - can be less reliable if IDs truly differ for same version string
                                    // else if (typeof localModrinthInfo === 'object' && localModrinthInfo !== null && 'version_number' in localModrinthInfo && localModrinthInfo.version_number === version.version_number) {
                                    //   isCurrent = true;
                                    // }
                                  }

                                  // DEBUGGING LOGS START
                                  if (
                                    item.filename === openVersionDropdownId &&
                                    localModrinthInfo
                                  ) {
                                    const installedVersionStr =
                                      "version_number" in localModrinthInfo &&
                                      localModrinthInfo.version_number
                                        ? String(
                                            localModrinthInfo.version_number,
                                          )
                                        : "N/A";
                                    const installedIdToCompare =
                                      "version_id" in localModrinthInfo &&
                                      localModrinthInfo.version_id
                                        ? localModrinthInfo.version_id
                                        : "id" in localModrinthInfo &&
                                            localModrinthInfo.id
                                          ? localModrinthInfo.id
                                          : "N/A";

                                    console.log(
                                      `[${item.filename}] Checking: List ver: ${version.version_number} (ID: ${version.id}) vs Installed: ${installedVersionStr} (Stored ID for compare: ${installedIdToCompare}) -> isCurrent: ${isCurrent}`,
                                    );
                                    if (
                                      !isCurrent &&
                                      installedVersionStr ===
                                        version.version_number
                                    ) {
                                      console.warn(
                                        `[${item.filename}] MISMATCH OR NO ID MATCH DETAIL FOR VERSION ${version.version_number}:
                                           Installed Info (item.modrinth_info): ${JSON.stringify(localModrinthInfo, null, 2)}
                                           Current Version in List (version): ${JSON.stringify(version, null, 2)}
                                           Comparing (Stored ID for compare: ${installedIdToCompare}) === (List version.id: ${version.id})`,
                                      );
                                    }
                                  }
                                  // DEBUGGING LOGS END

                                  return (
                                    <div
                                      key={version.id}
                                      className={`p-1.5 text-xs hover:bg-white/10 cursor-pointer rounded-sm ${isCurrent ? "font-bold text-white" : "text-white/80"}`}
                                      style={
                                        {
                                          // No specific background for individual items unless it's the current one, which is handled by font-bold
                                        }
                                      }
                                      onClick={() => {
                                        handleSwitchContentVersion(
                                          item,
                                          version,
                                        );
                                        setOpenVersionDropdownId(null);
                                      }}
                                    >
                                      {version.name} ({version.version_number})
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          ) : availableVersions &&
                            availableVersions.length === 0 ? (
                            <div className="text-white/70 text-sm tracking-wider">
                              No other compatible versions found.
                            </div>
                          ) : (
                            <div className="text-white/70 text-sm tracking-wider">
                              Version history not available.
                            </div> // Fallback for non-Modrinth items or if project_id missing
                          )}
                        </div>,
                        document.body,
                      )}
                  </div>
                )}
              </>
            ) : (
              <span>{descriptionText}</span>
            )}
            {item.is_directory && (
              <span className="ml-1 text-xs text-white/60">(Folder)</span>
            )}
          </span>
        );
      })();

      const itemBadgesNode = (
        <>
          {isBlockedByNoRisk && (
            <TagBadge
              size="sm"
              variant="destructive"
              iconElement={
                <Icon
                  icon="solar:shield-cross-bold-duotone"
                  className="w-3 h-3"
                />
              }
            >
              CRASHES WITH NRC
            </TagBadge>
          )}
          <TagBadge
            size="sm"
            variant={!item.is_disabled ? "success" : "destructive"}
            iconElement={
              !item.is_disabled ? (
                <Icon
                  icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[3]}
                  className="w-3 h-3"
                />
              ) : (
                <Icon
                  icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[4]}
                  className="w-3 h-3"
                />
              )
            }
          >
            {!item.is_disabled ? "Enabled" : "Disabled"}
          </TagBadge>
          {item.modrinth_info && (
            <TagBadge size="sm" variant="info">
              Modrinth
            </TagBadge>
          )}
          {item.source_type && (
            <TagBadge size="sm" variant="warning">
              {item.source_type.charAt(0).toUpperCase() +
                item.source_type.slice(1)}
            </TagBadge>
          )}
        </>
      );

      let itemUpdateActionNode: React.ReactNode = null;
      // Prevent update action for NoRisk mods
      if (updateAvailableVersion && !isCurrentlyUpdating && !item.norisk_info) {
        if (
          !item.modrinth_info ||
          item.modrinth_info.version_id !== updateAvailableVersion.id
        ) {
          itemUpdateActionNode = (
            <IconButton
              size="sm"
              variant="success"
              onClick={() =>
                handleUpdateContentItem(item, updateAvailableVersion)
              }
              icon={
                <Icon
                  icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[10]}
                  className="w-3.5 h-3.5"
                />
              }
              title={`Update to ${updateAvailableVersion.version_number}`}
            />
          );
        }
      } else if (isCurrentlyUpdating && !item.norisk_info) {
        // Also ensure no update indicator for NoRisk mods
        itemUpdateActionNode = (
          <IconButton
            size="sm"
            variant="secondary"
            icon={
              <Icon
                icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[11]}
                className="animate-spin w-3.5 h-3.5"
              />
            }
            title={`Updating...`}
          />
        );
      }

      const itemMainActionNode = (
        <Button
          size="sm"
          variant={!item.is_disabled ? "secondary" : "default"}
          onClick={() => handleToggleItemEnabled(item)}
        >
          {isToggling ? "..." : !item.is_disabled ? "Disable" : "Enable"}
        </Button>
      );

      // Prevent delete action for NoRisk mods
      const itemDeleteActionNode: React.ReactNode = item.norisk_info ? null : (
        <IconButton
          title={`Delete ${itemTypeName}`}
          icon={
            isDeleting ? (
              <Icon
                icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[11]}
                className="animate-spin w-3.5 h-3.5"
              />
            ) : (
              <Icon
                icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[6]}
                className="w-3.5 h-3.5"
              />
            )
          }
          variant="destructive"
          size="sm"
          onClick={() => handleDeleteItem(item)}
        />
      );

      const itemMoreActionsTriggerNode = (
        <IconButton
          title="More Actions"
          icon={
            <Icon
              icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[7]}
              className="w-3.5 h-3.5"
            />
          }
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setActiveDropdownId(
              activeDropdownId === item.filename ? null : item.filename,
            );
          }}
          data-item-id={item.filename}
        />
      );

      const itemDropdownNode = (
        <ThemedSurface className="absolute top-full right-0 mt-1 w-44 z-20">
          <div
            ref={dropdownRef}
            className="flex flex-col gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                if (item.path) handleOpenItemFolder(item);
                setActiveDropdownId(null);
              }}
              className="w-full text-left px-2 py-1.5 text-[11px] font-minecraft-ten hover:bg-[var(--accent-color-soft)] rounded-sm text-white/80 hover:text-white transition-colors duration-100 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Icon
                icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[5]}
                className="w-3 h-3 flex-shrink-0"
              />
              Open Folder
            </button>
            {/* Add other generic actions here if needed */}
          </div>
        </ThemedSurface>
      );

      return (
        <GenericDetailListItem
          key={item.filename}
          id={item.filename}
          isSelected={selectedItemIds.has(item.filename)}
          onSelectionChange={(checked) =>
            handleItemSelectionChange(item.filename, checked)
          }
          iconNode={itemIconNode}
          title={itemTitle}
          descriptionNode={itemDescriptionNode}
          badgesNode={itemBadgesNode}
          updateActionNode={itemUpdateActionNode}
          mainActionNode={itemMainActionNode}
          deleteActionNode={itemDeleteActionNode}
          moreActionsTriggerNode={itemMoreActionsTriggerNode}
          dropdownNode={itemDropdownNode}
          isDropdownVisible={activeDropdownId === item.filename}
          accentColor={accentColor.value}
        />
      );
    },
    [
      accentColor.value,
      getDisplayFileName,
      handleToggleItemEnabled,
      itemBeingToggled,
      itemBeingDeleted,
      handleDeleteItem,
      handleOpenItemFolder,
      profile,
      selectedItemIds,
      handleItemSelectionChange,
      isBatchToggling,
      isBatchDeleting,
      isCheckingUpdates,
      itemsBeingUpdated,
      contentUpdates,
      activeDropdownId,
      setActiveDropdownId,
      dropdownRef,
      handleUpdateContentItem,
      modrinthIcons,
      localArchiveIcons,
      isUpdatingAll,
      isAnyTaskRunning,
      isLoading, // Added for item-specific loading states
      isFetchingHashes,
      isFetchingModrinthDetails,
      itemTypeName,
      emptyStateIconOverride,
      openVersionDropdownId,
      setOpenVersionDropdownId,
      versionButtonRef,
      availableVersions,
      isLoadingVersions,
      versionsError,
      handleSwitchContentVersion,
      isBlockedConfigLoaded,
    ],
  );

  const isBusyWithEssentialLoad =
    isLoading ||
    (contentType === "NoRiskMod" &&
      (isFetchingPacksConfig || isRefreshingPacksList));
  const isAnyBatchActionInProgress =
    isBatchToggling || isBatchDeleting || isUpdatingAll;

  const primaryLeftActionsContent = (
    <div className="flex flex-col gap-2 flex-grow min-w-0">
      <div className="flex items-center gap-2">
        <SearchInput
          value={searchQuery}
          onChange={(val) => setSearchQuery(val)}
          placeholder={`Search ${itemTypeNamePlural}...`}
          className="flex-grow !h-9"
        />
        {effectiveOnAddContent && contentType !== "NoRiskMod" && profile && (
          <div className="flex flex-shrink-0">
            <Button
              onClick={() => {
                if (profile && onBrowseContentRequest) {
                  // Check if onBrowseContentRequest is available
                  const browseContentType =
                    getBrowseTabContentType(contentType);
                  onBrowseContentRequest(browseContentType); // Call the new prop
                } else if (profile) {
                  // Fallback or original navigation logic if prop not provided (though it should be)
                  const browseContentType =
                    getBrowseTabContentType(contentType);
                  navigate(
                    `/profiles/${profile.id}/browse/${browseContentType}`,
                  );
                }
              }}
              variant="secondary"
              size="sm"
              className="!h-9 rounded-r-none border-r-transparent focus:z-10"
              title="Browse for content online"
            >
              Browse
            </Button>
            <IconButton
              icon={<Icon icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[12]} />}
              onClick={effectiveOnAddContent}
              variant="secondary"
              size="xs"
              className="!h-9 !w-9 rounded-l-none focus:z-10"
              title={addContentButtonText}
            />
          </div>
        )}
        <IconButton
          icon={<Icon icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[13]} />}
          onClick={() => fetchData(true)}
          variant="secondary"
          size="sm"
          title="Refresh List"
          className="!h-9 !w-9 flex-shrink-0"
        />
      </div>
      {contentUpdateError && (
        <div className="text-xs text-red-400 p-1 bg-red-900/30 border border-red-700/50 rounded">
          Update Check Error: {contentUpdateError}
        </div>
      )}
      <>
        <div
          className="h-px w-full my-1"
          style={{ backgroundColor: `${accentColor.value}30` }}
        />
        <div className="flex items-center justify-between w-full min-h-14">
          {/* Left side: Select All Checkbox */}
          <Checkbox
            customSize="md"
            checked={areAllFilteredSelected}
            onChange={(e) => handleSelectAllToggle(e.target.checked)}
            label={
              selectedItemIds.size > 0
                ? `${selectedItemIds.size} selected`
                : "Select All"
            }
            title={
              areAllFilteredSelected
                ? "Deselect all visible"
                : "Select all visible"
            }
          />

          {/* Right side: Action Buttons and NoRiskPack Dropdown */}
          <div className="flex items-center gap-2">
            {/* Batch Toggle Button - Common for all types if items are selected */}
            {selectedItemIds.size > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleBatchToggleSelected}
                icon={
                  isBatchToggling ? (
                    <Icon
                      icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[11]}
                      className="animate-spin mr-1.5"
                    />
                  ) : undefined
                }
              >
                {isBatchToggling
                  ? "Toggling..."
                  : `Toggle (${selectedItemIds.size})`}
              </Button>
            )}

            {/* NoRisk Pack Selector - Only for NoRiskMod type */}
            {contentType === "NoRiskMod" &&
              noriskPacksConfig &&
              noriskPackOptions.length > 0 && (
                <div className="flex items-center gap-2">
                  <Select
                    value={profile?.selected_norisk_pack_id || ""}
                    onChange={(value) =>
                      handleSelectedPackChange(value === "" ? null : value)
                    }
                    options={noriskPackOptions}
                    placeholder="Select Pack..."
                    className="!h-9 text-sm min-w-[180px] max-w-[250px] truncate"
                    size="sm"
                  />
                  {profile?.selected_norisk_pack_id &&
                    noriskPacksConfig?.packs[profile.selected_norisk_pack_id]
                      ?.isExperimental && (
                      <div className="text-xs text-yellow-500/80 font-minecraft">
                        (Experimental)
                      </div>
                    )}
                </div>
              )}

            {/* Delete and Update All buttons - Only for non-NoRiskMod types */}
            {contentType !== "NoRiskMod" && (
              <>
                {selectedItemIds.size > 0 && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleBatchDeleteSelected}
                    icon={
                      isBatchDeleting ? (
                        <Icon
                          icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[11]}
                          className="animate-spin mr-1.5"
                        />
                      ) : undefined
                    }
                  >
                    {isBatchDeleting
                      ? "Deleting..."
                      : `Delete (${selectedItemIds.size})`}
                  </Button>
                )}
                {Object.keys(contentUpdates).length > 0 && (
                  <Button
                    size="sm"
                    variant="success"
                    onClick={handleUpdateAllAvailableContent}
                    icon={
                      isUpdatingAll ? (
                        <Icon
                          icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[11]}
                          className="animate-spin mr-1.5"
                        />
                      ) : (
                        <Icon
                          icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[14]}
                          className="mr-1.5"
                        />
                      )
                    }
                    className={selectedItemIds.size > 0 ? "ml-2" : ""}
                  >
                    {isUpdatingAll
                      ? "Updating All..."
                      : `Update All (${Object.keys(contentUpdates).length})`}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </>
    </div>
  );

  const primaryRightActionsContent = null;

  if (!profile) {
    return (
      <div className="p-4 font-minecraft text-center text-white/70">
        Profile data is not available. Cannot display{" "}
        {itemTypeNamePlural.toLowerCase()}.
      </div>
    );
  }

  // Determine if the special empty state for standard profiles should be shown
  const shouldShowStandardProfileEmptyState = false;

  if (shouldShowStandardProfileEmptyState) {
    const handleCloneProfile = async () => {
      if (!profile) return;

      try {
        const newName = await confirm({
          title: "Clone Profile",
          inputLabel: "New profile name",
          inputPlaceholder: "Enter a name for the cloned profile",
          inputInitialValue: `${profile.name} (Copy)`,
          inputRequired: true,
          confirmText: "CLONE",
          type: "input",
          fullscreen: true, // Or false, depending on desired dialog style
        });

        if (newName && typeof newName === "string") {
          const clonePromise = copyProfile(
            profile.id,
            newName,
            undefined,
            true,
          );

          toast.promise(clonePromise, {
            loading: `Cloning profile '${profile.name}' as '${newName}'...`,
            success: (newProfileId) => {
              // Immediately attempt to update the group after cloning is successful
              updateProfile(newProfileId, { group: "CUSTOM" })
                .then(() => {
                  //toast.success(`Profile '${newName}' set to group CUSTOM.`);
                  // Refresh data after group update as well if needed, or rely on fetchProfiles below
                })
                .catch((updateError) => {
                  console.error(
                    "Failed to update group for cloned profile:",
                    updateError,
                  );
                  //toast.error(`Failed to set group for '${newName}'.`);
                });

              fetchProfiles(); // Refresh profiles list in the store
              if (onRefreshRequired) onRefreshRequired(); // Refresh parent view if callback provided
              navigate(`/profiles/${newProfileId}`); // Navigate to the new profile's detail view
              return `Profile '${newName}' cloned successfully!`; // Toast for cloning success
            },
            error: (err) =>
              `Failed to clone profile: ${err instanceof Error ? err.message : String(err.message)}`,
          });
        }
      } catch (err) {
        // This catch block is for errors from the confirm dialog itself (e.g., user cancelled)
        // If it's a cancel, we don't need to show an error toast.
        if (err !== "cancel") {
          // Check if it's not a cancellation
          console.error("Error in clone setup or dialog: ", err);
          toast.error("Could not initiate cloning process.");
        }
      }
    };

    const cloneButton = (
      <Button
        variant="default"
        size="md"
        onClick={handleCloneProfile} // Updated onClick
        icon={<Icon icon="solar:copy-bold-duotone" className="mr-2" />}
      >
        CLONE PROFILE
      </Button>
    );

    return (
      <>
        <EmptyState
          icon="solar:shield-warning-bold-duotone"
          message="Standard profiles are read-only."
          description="Clone to make changes and manage content."
          action={cloneButton}
          fullHeight={true}
          className="justify-center"
        />
        {confirmDialog} {/* Added confirm dialog to render */}
      </>
    );
  }

  const hasSelectedItems = selectedItemIds.size > 0;
  const showNoRiskPackSelector = contentType === "NoRiskMod";
  const isNoRiskPackSelected =
    showNoRiskPackSelector && profile?.selected_norisk_pack_id;

  // Dynamic empty state messages
  const getEmptyStateMessage = () => {
    if (contentType === "NoRiskMod" && !profile?.selected_norisk_pack_id) {
      return "No NoRisk Pack Selected";
    } else if (error) {
      return `Error loading ${itemTypeNamePlural}`;
    } else if ((isLoading || isFetchingPacksConfig) && items.length === 0) {
      return `Loading ${itemTypeNamePlural}...`;
    } else if (
      !searchQuery &&
      items.length === 0 &&
      selectedItemIds.size === 0
    ) {
      return `No ${itemTypeNamePlural} found in this profile.`;
    } else if (
      searchQuery &&
      filteredItems.length === 0 &&
      selectedItemIds.size === 0
    ) {
      return `No ${itemTypeNamePlural} match your search.`;
    } else {
      return `Manage your ${itemTypeNamePlural}`;
    }
  };

  const getEmptyStateDescription = () => {
    if (contentType === "NoRiskMod" && !profile?.selected_norisk_pack_id) {
      return "Please select a NoRisk Modpack from the dropdown to manage its mods.";
    } else if (error) {
      return "Please try refreshing or check the console.";
    } else if ((isLoading || isFetchingPacksConfig) && items.length === 0) {
      return "Please wait while content is being loaded.";
    } else if (
      !searchQuery &&
      items.length === 0 &&
      selectedItemIds.size === 0
    ) {
      return `Drag & drop ${itemTypeNamePlural} here to add them, or click Browse to discover and install content online.`;
    } else if (
      searchQuery &&
      filteredItems.length === 0 &&
      selectedItemIds.size === 0
    ) {
      return "Try a different search term or clear the search filter.";
    } else {
      return `Select ${itemTypeNamePlural} to perform batch actions or manage them individually.`;
    }
  };

  const isTrulyEmptyState =
    !error && !searchQuery && items.length === 0 && selectedItemIds.size === 0;

  const handleEmptyStateBrowse = useCallback(() => {
    if (!profile) return;
    const browseType = ((ct: typeof contentType) => {
      switch (ct) {
        case "Mod":
          return "mods";
        case "ResourcePack":
          return "resourcepacks";
        case "ShaderPack":
          return "shaderpacks";
        case "DataPack":
          return "datapacks";
        default:
          return "mods";
      }
    })(contentType);
    if (onBrowseContentRequest) onBrowseContentRequest(browseType);
    else navigate(`/profiles/${profile.id}/browse/${browseType}`);
  }, [onBrowseContentRequest, navigate, profile, contentType]);

  return (
    <>
      <GenericContentTab<T>
        items={
          contentType === "NoRiskMod" && !profile?.selected_norisk_pack_id
            ? []
            : filteredItems
        }
        renderListItem={renderListItem}
        isLoading={isBusyWithEssentialLoad}
        error={error}
        searchQuery={searchQuery}
        primaryLeftActions={primaryLeftActionsContent}
        primaryRightActions={primaryRightActionsContent}
        emptyStateIcon={
          emptyStateIconOverride || LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[0]
        }
        emptyStateMessage={getEmptyStateMessage()}
        emptyStateDescription={getEmptyStateDescription()}
        emptyStateAction={isTrulyEmptyState ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleEmptyStateBrowse}
            icon={<Icon icon="solar:magnifer-bold" />}
          >
            Browse {itemTypeNamePlural}
          </Button>
        ) : undefined}
        loadingItemCount={Math.min(items.length > 0 ? items.length : 5, 10)}
        showSkeletons={false}
        accentColorOverride={accentColor.value}
      />

      <ConfirmDeleteDialog
        isOpen={isConfirmDeleteDialogOpen}
        itemName={
          itemToDeleteForDialog
            ? getDisplayFileName(itemToDeleteForDialog)
            : `${selectedItemIds.size} ${itemTypeName}${selectedItemIds.size === 1 ? "" : "s"}`
        }
        onClose={handleCloseDeleteDialog}
        onConfirm={handleConfirmDeletion}
        isDeleting={isDialogActionLoading}
        title={
          itemToDeleteForDialog
            ? `Delete ${getDisplayFileName(itemToDeleteForDialog)}?`
            : `Delete Selected ${itemTypeNamePlural}?`
        }
      />
    </>
  );
}
