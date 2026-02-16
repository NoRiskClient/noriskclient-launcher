"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../../ui/buttons/Button";
import { ContentActionButtons, type ContentActionButton } from "../../../ui/ContentActionButtons";
import { GenericDetailListItem } from "../items/GenericDetailListItem";
import { TagBadge } from "../../../ui/TagBadge";
import { useThemeStore } from "../../../../store/useThemeStore";
import { GenericContentTab } from "../../../ui/GenericContentTab";
import { preloadIcons } from "../../../../lib/icon-utils";
import type { Profile } from "../../../../types/profile";
import { SearchInput } from "../../../ui/SearchInput";
import { SearchWithFilters } from "../../../ui/SearchWithFilters";
import { CheckboxV2 } from "../../../ui/CheckboxV2";
import { ConfirmDeleteDialog } from "../../../modals/ConfirmDeleteDialog";
import { formatFileSize } from "../../../../utils/format-file-size";
import { toast } from "react-hot-toast";
import {
  type LocalContentItem,
  type LocalContentType,
  useLocalContentManager,
} from "../../../../hooks/useLocalContentManager";
import type { UnifiedVersion } from "../../../../types/unified";
import { ModPlatform, UnifiedVersionType, UnifiedDependencyType } from "../../../../types/unified";
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
import UnifiedService from "../../../../services/unified-service"; // Added import
import { EmptyState } from "../../../ui/EmptyState"; // Added import
import { useProfileStore } from "../../../../store/profile-store"; // Added import
import { useConfirmDialog } from "../../../../hooks/useConfirmDialog"; // Added import
import * as FlagsmithService from "../../../../services/flagsmith-service"; // Added
import { Tooltip } from "../../../ui/Tooltip"; // Added for custom tooltips
import { ActionButton } from "../../../ui/ActionButton"; // Added for custom update button
import { ModUpdateText, useModUpdateText } from "../../../ui/ModUpdateText"; // Added for formatted update text
import { getUpdateIdentifier } from "../../../../utils/update-identifier-utils";
import { parseMotdToHtml } from "../../../../utils/motd-utils";

/**
 * Determines if a given version is the currently installed version for an item
 * Handles different info structures (modrinth_info, curseforge_info) and version matching logic
 */
function isCurrentInstalledVersion(
  version: UnifiedVersion,
  item: LocalContentItem,
  debugMode: boolean = false
): boolean {
  // Check Modrinth info first (most common)
  const localModrinthInfo = item.modrinth_info;
  if (localModrinthInfo) {
    // Prioritize version_id if it exists on localModrinthInfo (typical for GenericModrinthInfo)
    if (
      typeof localModrinthInfo === "object" &&
      localModrinthInfo !== null &&
      "version_id" in localModrinthInfo &&
      localModrinthInfo.version_id === version.id
    ) {
      if (debugMode) {
        console.log(`[${item.filename}] Version match by version_id: ${localModrinthInfo.version_id}`);
      }
      return true;
    }

    // Fallback to id if version_id didn't match or doesn't exist (typical for full ModrinthVersion object)
    if (
      typeof localModrinthInfo === "object" &&
      localModrinthInfo !== null &&
      "id" in localModrinthInfo &&
      (localModrinthInfo as any).id === version.id
    ) {
      if (debugMode) {
        console.log(`[${item.filename}] Version match by id fallback: ${(localModrinthInfo as any).id}`);
      }
      return true;
    }
  }

  // Check CurseForge info
  const localCurseForgeInfo = item.curseforge_info;
  if (localCurseForgeInfo) {
    // For CurseForge, we primarily check file_id
    if (
      typeof localCurseForgeInfo === "object" &&
      localCurseForgeInfo !== null &&
      "file_id" in localCurseForgeInfo &&
      localCurseForgeInfo.file_id === version.id
    ) {
      if (debugMode) {
        console.log(`[${item.filename}] CurseForge version match by file_id: ${localCurseForgeInfo.file_id}`);
      }
      return true;
    }
  }

  // Optional: secondary check by version_number if no ID match - can be less reliable if IDs truly differ for same version string
  // This is commented out as it's less reliable, but could be useful in some edge cases
  /*
  if (localModrinthInfo?.version_number === version.version_number) {
    if (debugMode) {
      console.log(`[${item.filename}] Version match by version_number fallback: ${version.version_number}`);
    }
    return true;
  }
  */

  if (debugMode) {
    const installedVersionStr = localModrinthInfo?.version_number ||
                               localCurseForgeInfo?.version_number ||
                               "N/A";
    const installedIdToCompare = localModrinthInfo?.version_id ||
                                (localModrinthInfo && 'id' in localModrinthInfo ? localModrinthInfo.id : undefined) ||
                                localCurseForgeInfo?.file_id ||
                                "N/A";

    console.log(
      `[${item.filename}] Checking: List ver: ${version.version_number} (ID: ${version.id}) vs Installed: ${installedVersionStr} (Stored ID: ${installedIdToCompare}) -> NO MATCH`
    );
  }

  return false;
}

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

// Hook for formatted update text
const { getUpdateText } = useModUpdateText();

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
  const { t } = useTranslation();
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
    UnifiedVersion[] | null
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
    curseforgeIcons,
    localArchiveIcons,
    getItemIcon,
    getItemPlatformDisplayName,
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
    updatableContentCount,
    checkForContentUpdates,
    handleUpdateContentItem,
    handleUpdateAllAvailableContent,
    handleSwitchContentVersion,
    handleToggleItemUpdatesEnabled,
    handleBatchToggleSelectedUpdatesEnabled,
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
          toast.error(t('content.errors.load_norisk_packs'));
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
      toast.success(t('content.toast.pack_list_refreshed'));
    } catch (err) {
      console.error("Failed to refresh NoRisk packs list:", err);
      toast.error(t('content.toast.pack_list_refresh_failed'));
    } finally {
      setIsRefreshingPacksList(false);
    }
  }, [contentType, t]);

  const noriskPackOptions = useMemo((): SelectOption[] => {
    if (contentType !== "NoRiskMod" || !noriskPacksConfig) {
      return [{ value: "", label: t('content.no_pack_selected_option') }];
    }
    const options = Object.entries(noriskPacksConfig.packs).map(
      ([id, packDef]) => ({
        value: id,
        label: packDef.displayName || id,
      }),
    );
    options.sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: "", label: t('content.no_pack_selected_option') }, ...options];
  }, [contentType, noriskPacksConfig, t]);

  const handleSelectedPackChange = useCallback(
    async (newPackId: string | null) => {
      if (!profile || newPackId === profile.selected_norisk_pack_id) return;
      try {
        // Update the profile on backend
        await ProfileService.updateProfile(profile.id, {
          selected_norisk_pack_id: newPackId,
          clear_selected_norisk_pack: newPackId === null,
        });

        // Refresh the profile data to get the updated profile
        if (fetchProfiles) {
          await fetchProfiles();
        }

        // Refresh the local content manager
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
    [profile, onRefreshRequired, fetchProfiles],
  );

  // Update default onAddContent to use the new dialog and service call
  const defaultOnAddContent = async () => {
    if (!profile) {
      toast.error(t('content.toast.profile_unavailable'));
      return;
    }

    let dialogFilters: DialogFilter[] = [];
    const currentContentType = contentType; // from component props

    switch (currentContentType) {
      case "Mod":
        dialogFilters = [
          { name: t('content.filter.java_archives'), extensions: ["jar", "jar.disabled"] },
        ];
        break;
      case "ResourcePack":
        dialogFilters = [
          {
            name: t('content.filter.resource_pack_archives'),
            extensions: ["zip", "zip.disabled"],
          },
        ];
        break;
      case "ShaderPack":
        dialogFilters = [
          { name: t('content.filter.shader_pack_archives'), extensions: ["zip", "zip.disabled"] },
        ];
        break;
      case "DataPack":
        dialogFilters = [
          { name: t('content.filter.data_pack_archives'), extensions: ["zip", "zip.disabled"] },
        ];
        break;
      default:
        toast.error(
          t('content.toast.import_not_configured', { contentType: currentContentType }),
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
        title: t('content.dialog.select_to_import', { itemType: itemTypeNamePlural, profileName: profile.name }),
      });

      if (selectedPathsArray && selectedPathsArray.length > 0) {
        // selectedPathsArray is already string[]
        const filePaths = selectedPathsArray;

        const toastId = toast.loading(
          t('content.toast.importing', { count: filePaths.length, itemType: itemTypeNamePlural.toLowerCase() }),
        );
        try {
          await ContentService.installLocalContentToProfile({
            profile_id: profile.id,
            file_paths: filePaths,
            content_type: currentContentType as BackendContentType,
          });
          toast.success(
            t('content.toast.import_success', { count: filePaths.length, itemType: itemTypeNamePlural.toLowerCase() }),
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
            t('content.toast.import_failed', { itemType: itemTypeNamePlural.toLowerCase(), error: importError instanceof Error ? importError.message : String(importError) }),
            { id: toastId },
          );
        }
      } else {
        // User cancelled or selected no files
      }
    } catch (dialogError) {
      console.error("Error opening file dialog:", dialogError);
      toast.error(
        t('content.toast.dialog_error', { error: dialogError instanceof Error ? dialogError.message : String(dialogError) }),
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

        // Determine platform and project ID from the item
        let platform: ModPlatform | null = null;
        let projectId: string | null = null;
        let platformName = "Unknown";

        if (currentItem) {
          if (currentItem.platform) {
            platform = currentItem.platform;
            if (platform === ModPlatform.Modrinth) {
              projectId = currentItem.modrinth_info?.project_id || null;
              platformName = "Modrinth";
            } else if (platform === ModPlatform.CurseForge) {
              projectId = currentItem.curseforge_info?.project_id || null;
              platformName = "CurseForge";
            }
          } else {
            // Fallback: determine platform from available info
            if (currentItem.modrinth_info?.project_id) {
              platform = ModPlatform.Modrinth;
              projectId = currentItem.modrinth_info.project_id;
              platformName = "Modrinth";
            } else if (currentItem.curseforge_info?.project_id) {
              platform = ModPlatform.CurseForge;
              projectId = currentItem.curseforge_info.project_id;
              platformName = "CurseForge";
            }
          }
        }

        if (platform && projectId) {
          setIsLoadingVersions(true);
          setAvailableVersions(null);
          setVersionsError(null);
          try {
            let loadersArg: string[] | undefined = undefined;
            if (contentType === "Mod") {
              loadersArg = profile?.loader ? [profile.loader] : undefined;
            }

            const versions = await UnifiedService.getModVersions({
              source: platform,
              project_id: projectId,
              loaders: loadersArg,
              game_versions: profile?.game_version ? [profile.game_version] : undefined,
            });
            setAvailableVersions(versions.versions);
          } catch (error) {
            console.error(`Failed to fetch ${platformName} versions:`, error);
            setVersionsError(
              error instanceof Error
                ? t('content.version_load_failed_details', { platform: platformName, error: error.message })
                : t('content.version_load_failed', { platform: platformName }),
            );
          }
          setIsLoadingVersions(false);
        } else {
          // Item is not from a supported platform or no project_id available
          setAvailableVersions(null);
          setIsLoadingVersions(false);
          setVersionsError(
            currentItem
              ? t('content.version_history_unavailable', { platform: getItemPlatformDisplayName(currentItem) })
              : t('content.item_not_found'),
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
      const itemTitleRaw = getDisplayFileName(item);
      const itemTitle = (
        <span dangerouslySetInnerHTML={{ __html: parseMotdToHtml(itemTitleRaw) }} />
      );
      const isToggling = itemBeingToggled === item.filename;
      const isDeleting = itemBeingDeleted === item.filename;
      const isCurrentlyUpdating = itemsBeingUpdated.has(item.filename);

      // Get update using the centralized identifier logic
      const updateIdentifier = getUpdateIdentifier(item);

      const updateAvailableVersion = updateIdentifier
        ? contentUpdates[updateIdentifier]
        : null;

      const isItemOpen = openVersionDropdownId === item.filename;

      const noRiskStatus = isBlockedConfigLoaded
        ? FlagsmithService.getModNoRiskStatus(
            item.filename,
            item.modrinth_info?.project_id || item.curseforge_info?.project_id,
            item.modrinth_info?.version_id || item.curseforge_info?.file_id,
          )
        : null;
      const isBlockedByNoRisk = noRiskStatus === 'blocked';
      const isWarningByNoRisk = noRiskStatus === 'warning';
      
      // Debug logging
      if (noRiskStatus) {
        console.log('[LocalContentTabV2] Item:', item.filename, 'noRiskStatus:', noRiskStatus, 'isBlocked:', isBlockedByNoRisk, 'isWarning:', isWarningByNoRisk);
      }

      // Get the appropriate icon using the platform-aware helper function
      const itemIconUrl = getItemIcon(item);

      let iconToShow: React.ReactNode;
      if (itemIconUrl) {
        iconToShow = (
          <img
            src={itemIconUrl}
            alt={`${itemTitle} ${getItemPlatformDisplayName(item)} icon`}
            className="w-full h-full object-contain image-pixelated"
            style={item.is_disabled ? {
              filter: "grayscale(100%) brightness(0.7)"
            } : undefined}
            onError={(e) => {
              (e.target as HTMLImageElement).style.visibility = "hidden";
            }}
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
          {isBlockedByNoRisk && (
            <div className="absolute top-0.5 left-0.5 z-10 pointer-events-auto">
              <Tooltip content={t('modrinth.blocked_mod_tooltip')}>
                <div>
                  <Icon
                    icon="solar:danger-triangle-bold"
                    className="w-4 h-4 text-red-500 drop-shadow-lg"
                  />
                </div>
              </Tooltip>
            </div>
          )}
          {!isBlockedByNoRisk && isWarningByNoRisk && (
            <div className="absolute top-0.5 left-0.5 z-10 pointer-events-auto">
              <Tooltip content={t('modrinth.warning_mod_tooltip')}>
                <div>
                  <Icon
                    icon="solar:danger-triangle-bold"
                    className="w-4 h-4 text-yellow-500 drop-shadow-lg"
                  />
                </div>
              </Tooltip>
            </div>
          )}
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
          descriptionText = `${t('content.version_label')} ${item.fallback_version}`;
          titleText = `${t('content.version_label')} ${item.fallback_version}`;
        } else if (item.modrinth_info?.version_number) {
          versionText = item.modrinth_info.version_number;
          descriptionText = `${t('content.version_label')} ${item.modrinth_info.version_number}`;
          titleText = `Modrinth ${t('content.version_label')} ${item.modrinth_info.version_number}`;
        } else if (isItemStillLoadingDetails) {
          descriptionText = t('common.loading');
          titleText = t('content.loading_details');
        } else {
          descriptionText = formatFileSize(item.file_size || 0);
          titleText = `Size: ${formatFileSize(item.file_size || 0)}`;
        }

        return (
          <span title={titleText} className="flex items-center">
            {versionText ? (
              <>
                <span>{t('content.version_label')} {versionText}</span>
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
                      title={t('content.view_version_options')}
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
                              {t('content.loading_versions')}
                            </div>
                          ) : versionsError ? (
                            <div className="text-red-400 text-sm tracking-wider">
                              {versionsError}
                            </div>
                          ) : availableVersions &&
                            availableVersions.length > 0 ? (
                            <>
                              <div className="font-bold mb-2 text-sm tracking-wider">
                                {t('content.available_versions_on', { platform: getItemPlatformDisplayName(item) })}
                              </div>
                              <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                {availableVersions.map((version) => {
                                  // Use the centralized function to determine if this version is currently installed
                                  const isCurrent = isCurrentInstalledVersion(
                                    version,
                                    item,
                                    item.filename === openVersionDropdownId // Enable debug mode for the currently open dropdown
                                  );

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
                                      {version.name}
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          ) : availableVersions &&
                            availableVersions.length === 0 ? (
                            <div className="text-white/70 text-sm tracking-wider">
                              {t('content.no_compatible_versions', { platform: getItemPlatformDisplayName(item) })}
                            </div>
                          ) : (
                            <div className="text-white/70 text-sm tracking-wider">
                              {t('content.version_history_unavailable', { platform: getItemPlatformDisplayName(item) })}
                            </div> // Fallback for items without version history
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
              <span className="ml-1 text-xs text-white/60">{t('content.folder_label')}</span>
            )}
          </span>
        );
      })();

      // Determine the primary platform for this item
      const itemPlatform = getItemPlatformDisplayName(item);
      const isDisabled = item.is_disabled;

      const itemBadgesNode = [
        // NoRisk crash warning (highest priority)
        ...(isBlockedByNoRisk ? [{
          text: t('content.badge.crashes_with_nrc'),
          color: "#ef4444"
        }] : []),

        // Platform badge - only show the primary platform
        ...(itemPlatform !== 'Local' ? [{
          icon: itemPlatform === 'Modrinth'
            ? "https://cdn.modrinth.com/modrinth-new.png"
            : "https://cdn.norisk.gg/misc/curseforge.webp",
          text: itemPlatform,
          color: isDisabled ? "#6b7280" : (itemPlatform === 'Modrinth' ? "#22c55e" : "#f97316"),
          iconFilter: isDisabled ? "grayscale(100%) brightness(0.7)" : undefined
        }] : []),

        // Source type badge (for local/custom mods)
        ...(item.source_type && item.source_type !== 'custom' ? [{
          text: item.source_type.charAt(0).toUpperCase() + item.source_type.slice(1),
          color: isDisabled ? "#6b7280" : "#f59e0b"
        }] : []),

        // Updates status badge - removed for cleaner look
      ];

      // Build action buttons array for this item
      const itemActions: ContentActionButton[] = [];

      // Check if update is available (used for custom tooltip rendering)
      // Note: NoRisk mods can also have updates available, but they won't be auto-updatable
      const hasUpdateAvailable = updateAvailableVersion && !isCurrentlyUpdating;
      let shouldShowUpdateButton = false;
      let isUpdateButtonDimmed = false;
      let updateButtonTooltip = "";

      // Check if this mod comes from a modpack (defined outside if block for broader scope)
      const isFromModPack = item.modpack_origin !== null && item.modpack_origin !== undefined;

      if (hasUpdateAvailable) {
        console.log(`Update available for ${item.filename}:`, updateAvailableVersion);
        // Check if current version differs from available update
        const currentVersionId = item.modrinth_info?.version_id || item.curseforge_info?.file_id || item.id;
        if (currentVersionId !== updateAvailableVersion.id) {

          const currentVersion = item.modrinth_info?.version_number || item.curseforge_info?.version_number;

          if (isFromModPack && item.updates_enabled !== true) {
            // Show disabled update button for modpack mods (only if updates are not explicitly enabled)
            shouldShowUpdateButton = true;
            isUpdateButtonDimmed = true; // Show dimmed styling and actually disable
            updateButtonTooltip = `This mod comes from a modpack and cannot be updated individually. Updates should be handled through the modpack.`;
            console.log(`Update button shown and disabled for ${item.filename} - modpack mod`);
          } else {
            // Check if updates are enabled for this mod (consistent with updatableContentCount logic)
            // Default to enabled if null/undefined, only disabled if explicitly false
            const updatesEnabledDefault = item.updates_enabled ?? true;
            const hasUpdatesEnabled = contentType === 'Mod' && updatesEnabledDefault !== false;

            if (hasUpdatesEnabled) {
              // Normal update button for mods with updates enabled
              shouldShowUpdateButton = true;
              isUpdateButtonDimmed = false;
              updateButtonTooltip = getUpdateText(isFromModPack, updateAvailableVersion, currentVersion, item.modpack_origin, item.updates_enabled);
            } else {
              // Show dimmed update button for mods with updates disabled
              shouldShowUpdateButton = true;
              isUpdateButtonDimmed = true;
              updateButtonTooltip = `Update checks are disabled for this mod. Enable update checks first to allow automatic updates.`;
              console.log(`Update button will be shown (dimmed) for ${item.filename} - updates disabled`);
            }
          }
        }
      }

      // Debug logging only for items that have updates available
      if (updateAvailableVersion) {
        console.log(`Item "${item.filename}": modrinth_info=${!!item.modrinth_info}, curseforge_info=${!!item.curseforge_info}, sha1_hash="${item.sha1_hash}", fingerprint=${item.curseforge_info?.fingerprint}, updateIdentifier="${updateIdentifier}", hasUpdate=${!!updateAvailableVersion}, updateVersion="${updateAvailableVersion.version_number}", modpack_origin="${item.modpack_origin}", updates_enabled=${item.updates_enabled}, isFromModPack=${item.modpack_origin !== null && item.modpack_origin !== undefined}, buttonDisabled=${isUpdateButtonDimmed}`);
      }

      // Update action is handled separately with custom tooltip below
      // Only add update action if no update available
      if (isCurrentlyUpdating && !item.norisk_info) {
        itemActions.push({
          id: "updating",
          icon: LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[11],
          variant: "secondary",
          tooltip: t('content.actions.updating'),
          disabled: true,
          loading: true,
          onClick: () => {},
        });
      }

      // Main toggle action
      itemActions.push({
        id: "toggle",
        label: isToggling ? "..." : !item.is_disabled ? t('common.disable') : t('common.enable'),
        icon: !item.is_disabled ? "solar:close-circle-bold" : "solar:check-circle-bold",
        variant: !item.is_disabled ? "secondary" : "primary",
        tooltip: !item.is_disabled ? t('content.actions.disable_item') : t('content.actions.enable_item'),
        disabled: isToggling,
        onClick: () => handleToggleItemEnabled(item),
      });

      // Delete action (if not NoRisk mod) - icon-only
      if (!item.norisk_info) {
        itemActions.push({
          id: "delete",
          icon: isDeleting ? LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[11] : LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[6],
          variant: "destructive",
          tooltip: t('content.actions.delete_item', { itemType: itemTypeName }),
          disabled: isDeleting,
          loading: isDeleting,
          onClick: () => handleDeleteItem(item),
        });
      }

      // More actions - icon-only
      itemActions.push({
        id: "more",
        icon: LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[7],
        variant: "secondary",
        tooltip: t('content.actions.more'),
        onClick: (e) => {
          e.stopPropagation();
          e.preventDefault();
          setActiveDropdownId(
            activeDropdownId === item.filename ? null : item.filename,
          );
        },
      });

      // Render update button separately with custom tooltip if available
      const updateButtonNode = shouldShowUpdateButton ? (
        <Tooltip
          content={
            <div className="max-w-xs">
              {/* Use the formatted text component for rich tooltips */}
              <ModUpdateText
                isFromModPack={isFromModPack}
                updateVersion={updateAvailableVersion}
                currentVersion={item.modrinth_info?.version_number || item.curseforge_info?.version_number}
                className="text-left"
                modpackOrigin={item.modpack_origin}
                updatesEnabled={item.updates_enabled}
              />
            </div>
          }
        >
          <ActionButton
            id="update"
            label="" // Force icon-only but keep highlight variant
            icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[10]}
            variant={isUpdateButtonDimmed ? "secondary" : "highlight"}
            disabled={isUpdateButtonDimmed}
            onClick={() => handleUpdateContentItem(item, updateAvailableVersion)}
            className={isUpdateButtonDimmed ? "opacity-50 cursor-not-allowed grayscale" : ""}
          />
        </Tooltip>
      ) : null;

      const itemActionsNode = (
        <div className="flex items-center gap-2">
          {updateButtonNode}
          <ContentActionButtons
            actions={itemActions}
          />
        </div>
      );



      const itemDropdownNode = (
        <div
          ref={dropdownRef}
          className="absolute top-full right-0 mt-1 bg-black/90 backdrop-blur-sm border border-white/20 rounded-lg shadow-xl z-50 overflow-hidden"
          style={{
            minWidth: "200px",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="py-2">
            <button
              onClick={() => {
                if (item.path) handleOpenItemFolder(item);
                setActiveDropdownId(null);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left font-minecraft-ten text-sm text-white/80 hover:text-white transition-colors duration-150"
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = `${accentColor.value}15`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <Icon
                icon={LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[5]}
                className="w-4 h-4 flex-shrink-0 text-white/70"
              />
              <span className="flex-1">{t('content.actions.open_folder')}</span>
            </button>
            {item.id && (
              <button
                onClick={() => {
                  handleToggleItemUpdatesEnabled(item);
                  setActiveDropdownId(null);
                }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left font-minecraft-ten text-sm text-white/80 hover:text-white transition-colors duration-150"
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = `${accentColor.value}15`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <Icon
                icon={(item.updates_enabled ?? true) ? "solar:close-circle-bold" : "solar:check-circle-bold"}
                className="w-4 h-4 flex-shrink-0 text-white/70"
              />
              <span className="flex-1">
                {(item.updates_enabled ?? true) ? t('content.actions.disable_check') : t('content.actions.enable_check')}
              </span>
            </button>
            )}
          </div>
        </div>
      );

      // Determine if we can navigate to mod detail page
      const canNavigateToDetail = item.modrinth_info?.project_id || item.curseforge_info?.project_id;
      const handleTitleClick = canNavigateToDetail ? () => {
        if (item.modrinth_info?.project_id) {
          navigate(`/mods/modrinth/${item.modrinth_info.project_id}`);
        } else if (item.curseforge_info?.project_id) {
          navigate(`/mods/curseforge/${item.curseforge_info.project_id}`);
        }
      } : undefined;

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
          onTitleClick={handleTitleClick}
          descriptionNode={itemDescriptionNode}
          infoItems={itemBadgesNode}
          isDisabled={item.is_disabled}
          actionsNode={itemActionsNode}
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
      getItemIcon,
      getItemPlatformDisplayName,
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
      navigate,
    ],
  );

  const isBusyWithEssentialLoad =
    isLoading ||
    (contentType === "NoRiskMod" &&
      (isFetchingPacksConfig || isRefreshingPacksList));
  const isAnyBatchActionInProgress =
    isBatchToggling || isBatchDeleting || isUpdatingAll;

  // Helper function to determine the appropriate updates toggle action
  const getUpdatesToggleConfig = useCallback(() => {
    if (selectedItemIds.size === 0) return null;

    const selectedItems = items.filter(item => selectedItemIds.has(item.filename));
    const validItems = selectedItems.filter(item => item.id);

    if (validItems.length === 0) return null;

    // Count how many items have updates enabled vs disabled
    const enabledCount = validItems.filter(item => item.updates_enabled ?? true).length;
    const disabledCount = validItems.filter(item => !(item.updates_enabled ?? true)).length;

    // If more items have updates enabled, suggest disabling
    // If more items have updates disabled, suggest enabling
    // If equal or mixed, suggest enabling (more common use case)
    const shouldEnable = disabledCount >= enabledCount;

    return {
      shouldEnable,
      actionCount: validItems.length,
      enabledCount,
      disabledCount,
    };
  }, [selectedItemIds, items]);

  // Get the updates toggle configuration
  const updatesToggleConfig = getUpdatesToggleConfig();

  const primaryLeftActionsContent = (
    <div className="flex flex-col flex-grow min-w-0">
      <div className="flex items-center gap-2">
        <SearchWithFilters
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          placeholder={`Search ${itemTypeNamePlural}...`}
          showSort={false}
          showFilter={false}
          className="!h-8 flex-grow"
        />
      </div>
      {contentUpdateError && (
        <div className="text-xs text-red-400 p-1 bg-red-900/30 border border-red-700/50 rounded">
          {t('content.update_check_error', { error: contentUpdateError })}
        </div>
      )}
      <>
        <div className="flex items-center justify-between w-full min-h-14">
          {/* Left side: Select All Checkbox */}
          <CheckboxV2
            size="md"
            checked={areAllFilteredSelected}
            onChange={(checked) => handleSelectAllToggle(checked)}
            label={
              selectedItemIds.size > 0
                ? `${selectedItemIds.size} ${t('common.selected')}`
                : t('common.select_all')
            }
            tooltip={
              areAllFilteredSelected
                ? t('content.actions.deselect_all')
                : t('content.actions.select_all')
            }
          />

          {/* Right side: Action Buttons and NoRiskPack Dropdown */}
          <div className="flex items-center gap-2">
            {/* Batch Actions - Always visible when items are selected */}
            {selectedItemIds.size > 0 && (
              <ContentActionButtons
                actions={[
                  {
                    id: "batch-toggle",
                    label: isBatchToggling ? t('content.actions.toggling') : `${t('content.actions.toggle')} (${selectedItemIds.size})`,
                    icon: isBatchToggling ? LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[11] : "solar:refresh-bold",
                    variant: "text" as const,
                    disabled: isBatchToggling,
                    loading: isBatchToggling,
                    tooltip: t('content.actions.toggle_selected', { count: selectedItemIds.size }),
                    onClick: handleBatchToggleSelected,
                  },
                  // Smart updates toggle button - only show if we have valid items
                  ...(updatesToggleConfig ? [{
                    id: "batch-toggle-updates",
                    label: updatesToggleConfig.shouldEnable
                      ? `${t('content.actions.enable_check')} (${updatesToggleConfig.actionCount})`
                      : `${t('content.actions.disable_check')} (${updatesToggleConfig.actionCount})`,
                    icon: updatesToggleConfig.shouldEnable
                      ? "solar:check-circle-bold"
                      : "solar:close-circle-bold",
                    variant: "text" as const,
                    tooltip: updatesToggleConfig.shouldEnable
                      ? t('content.actions.enable_checks_selected', { count: updatesToggleConfig.actionCount })
                      : t('content.actions.disable_checks_selected', { count: updatesToggleConfig.actionCount }),
                    onClick: () => handleBatchToggleSelectedUpdatesEnabled(updatesToggleConfig.shouldEnable),
                  }] : []),
                  ...(contentType !== "NoRiskMod" ? [{
                    id: "batch-delete",
                    label: isBatchDeleting ? t('content.actions.deleting') : `${t('common.delete')} (${selectedItemIds.size})`,
                    icon: isBatchDeleting ? LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[11] : LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[6],
                    variant: "text" as const,
                    disabled: isBatchDeleting,
                    loading: isBatchDeleting,
                    tooltip: t('content.actions.delete_selected', { count: selectedItemIds.size }),
                    onClick: handleBatchDeleteSelected,
                  }] : []),
                ]}
                size="sm"
              />
            )}

            {/* Hide other buttons when any items are selected */}
            {selectedItemIds.size === 0 && (
              <>
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
                        placeholder={t('content.select_pack_placeholder')}
                        className="!h-9 text-sm min-w-[180px] max-w-[250px] truncate"
                        size="sm"
                      />
                      {profile?.selected_norisk_pack_id &&
                        noriskPacksConfig?.packs[profile.selected_norisk_pack_id]
                          ?.isExperimental && (
                          <div className="text-xs text-yellow-500/80 font-minecraft">
                            {t('content.experimental')}
                          </div>
                        )}
                    </div>
                  )}

                {/* Update All buttons - Only for non-NoRiskMod types */}
                {contentType !== "NoRiskMod" && updatableContentCount > 0 && (
                  <ContentActionButtons
                    actions={[
                      {
                        id: "update-all",
                        label: isUpdatingAll ? t('content.actions.updating_all') : `${t('content.actions.update_all')} (${updatableContentCount})`,
                        icon: isUpdatingAll ? LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[11] : LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[14],
                        variant: "highlight" as const,
                        disabled: isUpdatingAll,
                        loading: isUpdatingAll,
                        tooltip: t('content.actions.update_all_tooltip', { count: updatableContentCount }),
                        onClick: handleUpdateAllAvailableContent,
                      },
                    ]}
                    size="sm"
                  />
                )}

                {/* Browse and Add buttons - only for non-NoRiskMod types */}
                {effectiveOnAddContent && contentType !== "NoRiskMod" && profile && (
                  <ContentActionButtons
                    actions={[
                      {
                        id: "browse",
                        label: `${t('content.actions.download')} ${itemTypeNamePlural.toUpperCase()}`,
                        icon: "solar:add-circle-bold",
                        variant: "highlight" as const,
                        tooltip: t('content.actions.browse_tooltip', { itemType: itemTypeNamePlural }),
                        onClick: () => {
                          if (profile && onBrowseContentRequest) {
                            const browseContentType = getBrowseTabContentType(contentType);
                            onBrowseContentRequest(browseContentType);
                          } else if (profile) {
                            const browseContentType = getBrowseTabContentType(contentType);
                            navigate(`/profilesv2/${profile.id}/browse/${browseContentType}`);
                          }
                        },
                      },
                      {
                        id: "add",
                        label: t('content.actions.import'),
                        icon: "solar:folder-with-files-bold",
                        variant: "text" as const,
                        tooltip: addContentButtonText,
                        onClick: effectiveOnAddContent,
                      },
                    ]}
                    size="sm"
                  />
                )}

                {/* Refresh button - visible when no items are selected */}
                <ContentActionButtons
                  actions={[
                    {
                      id: "refresh",
                      label: t('common.refresh'),
                      icon: LOCAL_CONTENT_TAB_ICONS_TO_PRELOAD[13],
                      variant: "text" as const,
                      tooltip: t('content.actions.refresh_list'),
                      onClick: () => fetchData(true),
                    },
                  ]}
                  size="sm"
                />
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
        {t('content.profile_unavailable', { itemType: itemTypeNamePlural.toLowerCase() })}
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
          title: t('profiles.clone'),
          inputLabel: t('profiles.new_name'),
          inputPlaceholder: t('profiles.clone_name_placeholder'),
          inputInitialValue: `${profile.name} (Copy)`,
          inputRequired: true,
          confirmText: t('profiles.clone_button'),
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
            loading: t('content.toast.cloning', { name: profile.name, newName }),
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
              navigate(`/profilesv2/${newProfileId}`); // Navigate to the new profile's detail view
              return t('content.toast.clone_success', { name: newName }); // Toast for cloning success
            },
            error: (err) =>
              t('content.toast.clone_failed', { error: err instanceof Error ? err.message : String(err.message) }),
          });
        }
      } catch (err) {
        // This catch block is for errors from the confirm dialog itself (e.g., user cancelled)
        // If it's a cancel, we don't need to show an error toast.
        if (err !== "cancel") {
          // Check if it's not a cancellation
          console.error("Error in clone setup or dialog: ", err);
          toast.error(t('content.toast.clone_init_failed'));
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
        {t('profiles.clone_profile')}
      </Button>
    );

    return (
      <>
        <EmptyState
          icon="solar:shield-warning-bold-duotone"
          message={t('content.standard_readonly')}
          description={t('content.clone_to_edit')}
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
      return t('content.no_pack_selected');
    } else if (error) {
      return ""; // Remove title, show only button
    } else if ((isLoading || isFetchingPacksConfig) && items.length === 0) {
      return t('content.loading_items', { itemType: itemTypeNamePlural });
    } else if (
      !searchQuery &&
      items.length === 0 &&
      selectedItemIds.size === 0
    ) {
      return ""; // Remove title, show only button
    } else if (
      searchQuery &&
      filteredItems.length === 0 &&
      selectedItemIds.size === 0
    ) {
      return ""; // Remove title, show only button
    } else {
      return t('content.manage_items', { itemType: itemTypeNamePlural });
    }
  };

  const getEmptyStateDescription = () => {
    if (contentType === "NoRiskMod" && !profile?.selected_norisk_pack_id) {
      return t('content.select_pack_description');
    } else if (error) {
      return t('content.error_description');
    } else if ((isLoading || isFetchingPacksConfig) && items.length === 0) {
      return t('content.loading_description');
    } else if (
      !searchQuery &&
      items.length === 0 &&
      selectedItemIds.size === 0
    ) {
      return t('content.empty_description', { itemType: itemTypeNamePlural });
    } else if (
      searchQuery &&
      filteredItems.length === 0 &&
      selectedItemIds.size === 0
    ) {
      return t('content.no_search_results');
    } else {
      return t('content.select_to_manage', { itemType: itemTypeNamePlural });
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
    else navigate(`/profilesv2/${profile.id}/browse/${browseType}`);
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
        emptyStateAction={
          // Show browse button for empty states (except when NoRisk pack not selected and when loading)
          (isTrulyEmptyState ||
           (searchQuery && filteredItems.length === 0 && selectedItemIds.size === 0) ||
           (error && !isLoading)) &&
          !(contentType === "NoRiskMod" && !profile?.selected_norisk_pack_id) ? (
            <ContentActionButtons
              actions={[
                {
                  id: "browse-empty",
                  label: `${t('content.actions.browse')} ${itemTypeNamePlural.toUpperCase()}`,
                  icon: "solar:add-circle-bold",
                  variant: "highlight" as const,
                  tooltip: t('content.actions.browse_tooltip', { itemType: itemTypeNamePlural }),
                  onClick: handleEmptyStateBrowse,
                },
              ]}
              size="lg"
            />
          ) : undefined
        }
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
            ? t('content.delete_item_title', { name: getDisplayFileName(itemToDeleteForDialog) })
            : t('content.delete_selected_title', { itemType: itemTypeNamePlural })
        }
      />
    </>
  );
}
