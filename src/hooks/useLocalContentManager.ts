import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'react-hot-toast';
import i18n from '../i18n/i18n';
import type { Profile, LocalContentItem as ProfileLocalContentItem, GenericModrinthInfo as ProfileGenericModrinthInfo, LoadItemsParams, CacheBehaviour } from '../types/profile';
import type { ModrinthVersion, ModrinthBulkUpdateRequestBody, ModrinthHashAlgorithm, ResourcePackModrinthInfo, ShaderPackModrinthInfo, DataPackModrinthInfo } from '../types/modrinth';
import type { UnifiedUpdateCheckRequest, UnifiedUpdateCheckResponse, UnifiedVersion } from '../types/unified';
import { ModPlatform } from '../types/unified';
import { ContentType as NrContentType } from '../types/content';
import type { ToggleContentPayload, UninstallContentPayload, SwitchContentVersionPayload } from '../types/content';
import { ModrinthService } from '../services/modrinth-service';
import { CurseForgeService } from '../services/curseforge-service';
import UnifiedService from '../services/unified-service';
import { getLocalContent } from '../services/profile-service';
import { toggleContentFromProfile, uninstallContentFromProfile, switchContentVersion, toggleModUpdates, bulkToggleModUpdates } from '../services/content-service';
import { openPath } from '@tauri-apps/plugin-opener';
import { revealItemInDir } from '../utils/opener-utils';
import { getUpdateIdentifier, getContentPlatform } from '../utils/update-identifier-utils';
import { parseErrorMessage } from "../utils/error-utils";
import { contentCacheKey, useContentCacheStore } from '../store/content-cache-store';
import { archiveIconKey, useIconCacheStore } from '../store/icon-cache-store';

// Base type for content items managed by this hook - maps to ProfileLocalContentItem
// We'll use ProfileLocalContentItem directly or ensure T extends it.
export interface LocalContentItem extends ProfileLocalContentItem {
  path: string;
  // Neue Felder für ModPack-Integration
  modpack_origin?: string | null; // "modrinth:project_id" oder "curseforge:project_id:file_id"
  updates_enabled?: boolean | null; // null = Standard (true), true/false = explizit gesetzt
  // This can be used to extend ProfileLocalContentItem with frontend-specific fields if needed
  // For now, it will be structurally the same as ProfileLocalContentItem
}

// Enum for the types of content this hook can manage (used for UI/logic, maps to NrContentType for backend)
export type LocalContentType = 'ShaderPack' | 'ResourcePack' | 'DataPack' | 'Mod' | 'NoRiskMod';

interface UseLocalContentManagerProps<T extends LocalContentItem> {
  profile?: Profile;
  contentType: LocalContentType;
  getDisplayFileName: (item: T) => string;
  onRefreshRequired?: () => void;
}

interface UseLocalContentManagerReturn<T extends LocalContentItem> {
  items: T[];
  isLoading: boolean;
  isRevalidating: boolean;
  isFetchingHashes: boolean;
  isFetchingModrinthDetails: boolean;
  isAnyTaskRunning: boolean;
  error: string | null;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedItemIds: Set<string>;
  handleItemSelectionChange: (itemId: string, isSelected: boolean) => void;
  handleSelectAllToggle: (isChecked: boolean) => void;
  areAllFilteredSelected: boolean;
  filteredItems: T[];

  itemBeingToggled: string | null;
  itemBeingDeleted: string | null;
  isBatchToggling: boolean;
  isBatchDeleting: boolean;

  activeDropdownId: string | null;
  setActiveDropdownId: (id: string | null) => void;
  dropdownRef: React.RefObject<HTMLDivElement>;

  isConfirmDeleteDialogOpen: boolean;
  isDialogActionLoading: boolean;
  handleConfirmDeletion: () => Promise<void>;
  handleCloseDeleteDialog: () => void;
  itemToDeleteForDialog: T | null;

  getItemIcon: (item: T) => string | null;
  getItemPlatformDisplayName: (item: T) => string;

  contentUpdates: Record<string, UnifiedVersion>;
  isCheckingUpdates: boolean;
  itemsBeingUpdated: Set<string>;
  contentUpdateError: string | null;
  isUpdatingAll: boolean;

  // Anzahl der tatsächlich aktualisierbaren Updates (nur mods mit enabled updates)
  updatableContentCount: number;

  fetchData: (initialFetch?: boolean) => Promise<void>;
  handleToggleItemEnabled: (item: T) => Promise<void>;
  handleDeleteItem: (item: T) => void;
  handleBatchToggleSelected: () => Promise<void>;
  handleBatchDeleteSelected: () => void;
  handleOpenItemFolder: (item: T) => void;

  checkForContentUpdates: (currentProfile?: Profile, currentItems?: T[]) => Promise<void>;
  handleUpdateContentItem: (item: T, updateVersion: UnifiedVersion, suppressOwnToast?: boolean) => Promise<void>;
  handleUpdateAllAvailableContent: () => Promise<void>;
  handleSwitchContentVersion: (item: T, newVersion: UnifiedVersion) => Promise<void>;

  // Mod update toggle methods
  handleToggleItemUpdatesEnabled: (item: T) => Promise<void>;
  handleBatchToggleSelectedUpdatesEnabled: (updatesEnabled: boolean) => Promise<void>;
}

// Helper to map LocalContentType (UI string) to NrContentType (backend enum string)
function mapUiContentTypeToBackend(uiType: LocalContentType): NrContentType {
  switch (uiType) {
    case 'ResourcePack': return NrContentType.ResourcePack;
    case 'ShaderPack': return NrContentType.ShaderPack;
    case 'DataPack': return NrContentType.DataPack;
    case 'Mod': return NrContentType.Mod;
    case 'NoRiskMod': return NrContentType.NoRiskMod;
    default: throw new Error(`Unsupported UI content type: ${uiType}`);
  }
}

// Helper to map backend ProfileLocalContentItem to frontend T (which extends LocalContentItem)
function mapBackendItemToFrontendType<T extends LocalContentItem>(rawItem: ProfileLocalContentItem): T {
  // rawItem is typed as ProfileLocalContentItem (from types/profile.ts)
  // It has fields like: filename, path_str, ..., norisk_identifier, fallback_version
  // The actual object from Rust via invoke might have `norisk_info` field instead of `norisk_identifier` being populated.
  const outputItem = {
    ...rawItem, // Spread all properties from rawItem (which is typed as ProfileLocalContentItem)
    path: rawItem.path_str, // Add/override path using path_str from ProfileLocalContentItem // Fallback to the typed norisk_identifier if norisk_info isn't there
  };

  // Optional: For cleanliness, if T is not expected to have path_str, we could delete it.
  // However, LocalContentItem (the type T extends) currently inherits path_str from ProfileLocalContentItem.
  // delete (outputItem as any).path_str;
  return outputItem as T;
}

// Helper function to create UninstallContentPayload
function createUninstallPayload<T extends LocalContentItem>(
  item: T,
  profileId: string,
  uiContentType: LocalContentType
): UninstallContentPayload | null {
  if (uiContentType === 'Mod') {
    if (item.source_type === "custom") {
      if (!item.path) {
        toast.error(i18n.t('content_manager.errors.custom_mod_missing_path_uninstall', { filename: item.filename }));
        return null;
      }
      return { profile_id: profileId, file_path: item.path };
    } else {
      // For Modrinth or other non-custom mods, require SHA1 for uninstallation
      // as this is likely used to remove it from the profile's mod list as well.
      if (!item.sha1_hash) {
        toast.error(i18n.t('content_manager.errors.mod_missing_sha1_uninstall', { filename: item.filename }));
        return null;
      }
      return { profile_id: profileId, sha1_hash: item.sha1_hash, content_type: NrContentType.Mod };
    }
  } else if (uiContentType === 'ResourcePack' || uiContentType === 'ShaderPack' || uiContentType === 'DataPack') {
    if (!item.path) {
      toast.error(i18n.t('content_manager.errors.content_missing_path_uninstall', { type: uiContentType, filename: item.filename }));
      return null;
    }
    return { profile_id: profileId, file_path: item.path };
  } else if (uiContentType === 'NoRiskMod') {
    toast.error(i18n.t('content_manager.errors.norisk_uninstall_not_supported'));
    console.error("[useLocalContentManager] Attempted to create uninstall payload for NoRiskMod. This is generally not supported here.");
    return null;
  }

  toast.error(i18n.t('content_manager.errors.unsupported_content_type_uninstall', { type: uiContentType }));
  return null;
}

// Helper function to create ToggleContentPayload
function createTogglePayload<T extends LocalContentItem>(
  item: T,
  profileId: string,
  uiContentType: LocalContentType,
  targetEnabledState: boolean // This is the 'enabled' field for the payload
): ToggleContentPayload | null {
  const backendContentType = mapUiContentTypeToBackend(uiContentType);

  const payloadBase: Omit<ToggleContentPayload, 'sha1_hash' | 'file_path' | 'norisk_mod_identifier'> = {
    profile_id: profileId,
    enabled: targetEnabledState,
    content_type: backendContentType,
  };

  if (uiContentType === 'NoRiskMod') {
    const noriskIdentifierFromItem = (item as ProfileLocalContentItem).norisk_info; // Expect norisk_info from the item
    if (noriskIdentifierFromItem) {
      return { ...payloadBase, norisk_mod_identifier: noriskIdentifierFromItem }; // Map to payload's norisk_mod_identifier
    } else {
      toast.error(i18n.t('content_manager.errors.norisk_missing_info_toggle', { filename: item.filename }));
      return null;
    }
  } else if (uiContentType === 'Mod') {
    if (item.source_type === "custom") {
        if (!item.path) {
            toast.error(i18n.t('content_manager.errors.custom_mod_missing_path_toggle', { filename: item.filename }));
            return null;
        }
        // For custom mods with a path, prioritize using the path.
        // SHA1 can be included if available.
        const payload: ToggleContentPayload = { ...payloadBase, file_path: item.path };
        if (item.sha1_hash) {
            payload.sha1_hash = item.sha1_hash;
        }
        return payload;
    } else {
        // Original logic for non-custom (e.g., Modrinth) mods
        if (item.sha1_hash) {
            const modPayload: ToggleContentPayload = {...payloadBase, sha1_hash: item.sha1_hash};
            if (item.path) {
                //modPayload.file_path = item.path;
            }
            return modPayload;
        } else if (item.path) {
            return { ...payloadBase, /*file_path: item.path*/ };
        } else {
            toast.error(i18n.t('content_manager.errors.mod_missing_identifiers_toggle', { filename: item.filename }));
            return null;
        }
    }
  } else {
    // For ResourcePacks, ShaderPacks, DataPacks, use file_path
    if (item.path) {
      return { ...payloadBase, file_path: item.path };
    } else {
      toast.error(i18n.t('content_manager.errors.path_missing_toggle', { type: uiContentType, filename: item.filename }));
      return null;
    }
  }
}

export function useLocalContentManager<T extends LocalContentItem>({
  profile,
  contentType,
  getDisplayFileName,
  onRefreshRequired,
}: UseLocalContentManagerProps<T>): UseLocalContentManagerReturn<T> {
  const initialEntry = profile?.id
    ? useContentCacheStore.getState().getEntry<T>(contentCacheKey(profile.id, contentType))
    : undefined;

  const [items, setItems] = useState<T[]>(() => initialEntry?.items ?? []);
  const [isInitialLoadingState, setIsInitialLoadingState] = useState(() => !!profile?.id && !initialEntry);
  const [isRevalidating, setIsRevalidating] = useState(() => !!initialEntry);
  const [isFetchingHashesState, setIsFetchingHashesState] = useState(false);
  const [isFetchingModrinthDetailsState, setIsFetchingModrinthDetailsState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  const [itemBeingToggled, setItemBeingToggled] = useState<string | null>(null);
  const [itemBeingDeleted, setItemBeingDeleted] = useState<string | null>(null);
  const [isBatchToggling, setIsBatchToggling] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [isConfirmDeleteDialogOpen, setIsConfirmDeleteDialogOpen] = useState(false);
  const [itemToDeleteForDialog, setItemToDeleteForDialog] = useState<T | null>(null);
  const [isBatchDeleteConfirmActive, setIsBatchDeleteConfirmActive] = useState(false);
  const [isDialogActionLoading, setIsDialogActionLoading] = useState(false);

  const modrinthIcons = useIconCacheStore(state => state.modrinthIcons);
  const curseforgeIcons = useIconCacheStore(state => state.curseforgeIcons);
  const archiveIcons = useIconCacheStore(state => state.archiveIcons);

  // Helper function to determine which platform to use for an item
  const getItemPlatform = useCallback((item: T): 'modrinth' | 'curseforge' | 'local' => {
    // If platform is explicitly set, use that
    if (item.platform) {
      return item.platform === 'Modrinth' ? 'modrinth' : 'curseforge';
    }

    // Fallback: check if we have info from both platforms
    if (item.modrinth_info && item.curseforge_info) {
      // If both are available, prefer the one with more complete info
      // This is a heuristic - could be improved based on your needs
      return item.modrinth_info.project_id ? 'modrinth' : 'curseforge';
    }

    // Single platform info
    if (item.modrinth_info) return 'modrinth';
    if (item.curseforge_info) return 'curseforge';

    // No platform info available
    return 'local';
  }, []);

  // Helper function to get the appropriate icon for an item
  const getItemIcon = useCallback((item: T): string | null => {
    const platform = getItemPlatform(item);

    switch (platform) {
      case 'modrinth':
        if (item.modrinth_info?.project_id) {
          return modrinthIcons[item.modrinth_info.project_id] || null;
        }
        break;
      case 'curseforge':
        if (item.curseforge_info?.project_id) {
          return curseforgeIcons[item.curseforge_info.project_id] || null;
        }
        break;
      case 'local':
        return archiveIcons[archiveIconKey(item)] || null;
    }

    // Fallback to local archive icon
    return archiveIcons[archiveIconKey(item)] || null;
  }, [getItemPlatform, modrinthIcons, curseforgeIcons, archiveIcons]);

  // Helper function to get platform display name
  const getItemPlatformDisplayName = useCallback((item: T): string => {
    const platform = getItemPlatform(item);

    switch (platform) {
      case 'modrinth': return 'Modrinth';
      case 'curseforge': return 'CurseForge';
      case 'local': return 'Local';
      default: return 'Unknown';
    }
  }, [getItemPlatform]);
  const [hashesToFetchModrinthDetailsFor, setHashesToFetchModrinthDetailsFor] = useState<string[] | null>(null);

  const [contentUpdates, setContentUpdates] = useState<Record<string, UnifiedVersion>>(() => initialEntry?.contentUpdates ?? {});
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [itemsBeingUpdated, setItemsBeingUpdated] = useState<Set<string>>(new Set());
  const [contentUpdateError, setContentUpdateError] = useState<string | null>(null);
  const [isUpdatingAll, setIsUpdatingAll] = useState(false);

  const [isInitialLoadProcessComplete, setIsInitialLoadProcessComplete] = useState(false);

  const onRefreshRequiredRef = useRef(onRefreshRequired);
  const itemsRef = useRef<T[]>([]);
  const cacheBehaviourRef = useRef<CacheBehaviour>('stale_while_revalidate');
  const loadIdRef = useRef(0);

  const cacheKey = profile?.id ? contentCacheKey(profile.id, contentType) : null;

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    onRefreshRequiredRef.current = onRefreshRequired;
  }, [onRefreshRequired]);

  const fetchBasicInfo = useCallback(async (behaviour: CacheBehaviour = 'stale_while_revalidate'): Promise<void> => {
    if (!profile?.id) {
      setItems([]);
      return;
    }
    cacheBehaviourRef.current = behaviour;
    const loadId = ++loadIdRef.current;

    const key = contentCacheKey(profile.id, contentType);
    const cached = behaviour === 'stale_while_revalidate'
      ? useContentCacheStore.getState().getEntry<T>(key)
      : undefined;

    if (cached) {
      setItems(cached.items);
      setContentUpdates(cached.contentUpdates);
      setIsInitialLoadingState(false);
      setIsRevalidating(true);
    } else {
      setIsInitialLoadingState(true);
    }
    setIsFetchingHashesState(false);
    setIsFetchingModrinthDetailsState(false);
    setError(null);
    // Note: contentUpdates wird hier NICHT geleert (stale-while-revalidate).
    // Der Check nach Phase 3 ersetzt sie natuerlich mit frischen Daten. Bei
    // manuellem Refresh oder Tab-Switch flackert sonst die Update-Info kurz
    // weg. Hard-Reset passiert weiter via fetchData(initialFetch=true).
    setContentUpdateError(null);
    setHashesToFetchModrinthDetailsFor(null); // Reset this here

    const backendContentType = mapUiContentTypeToBackend(contentType);
    console.log(`[${contentType}] Phase 1: Fetching local content...`, new Date().toISOString());
    try {
      const serviceParams: LoadItemsParams = {
        profile_id: profile.id,
        content_type: backendContentType,
        calculate_hashes: true,
        fetch_modrinth_data: false, // Modrinth details via JS in Phase 3
        cache_behaviour: behaviour,
      };
      const fetchedBackendItems = await getLocalContent(serviceParams) as ProfileLocalContentItem[];
      if (loadIdRef.current !== loadId) return; // superseded by a newer load

      const previousByPath = new Map(itemsRef.current.map(item => [item.path, item]));
      const mappedItemsToFrontend = fetchedBackendItems.map(item => mapBackendItemToFrontendType<T>(item));
      const processedBasicItems = mappedItemsToFrontend.map(item => {
        const previous = previousByPath.get(item.path);
        return {
          ...item,
          filename: item.filename || getDisplayFileName(item),
          modrinth_info: item.modrinth_info ?? previous?.modrinth_info ?? null,
          curseforge_info: item.curseforge_info ?? previous?.curseforge_info ?? null,
        };
      });
      setItems(processedBasicItems as T[]);
      console.log(`[${contentType}] Phase 1: Items set (count: ${processedBasicItems.length})`, new Date().toISOString());
      if (!cached) setSelectedItemIds(new Set());

      const allKnownHashes = processedBasicItems
        .map(item => item.sha1_hash)
        .filter((hash): hash is string => hash != null && hash !== "0");

      if (allKnownHashes.length > 0) {
        setHashesToFetchModrinthDetailsFor(allKnownHashes);
      } else {
        setIsInitialLoadProcessComplete(true);
        setIsRevalidating(false);
      }

      if (onRefreshRequiredRef.current) onRefreshRequiredRef.current();
    } catch (err) {
      console.error(`[${contentType}] Phase 1: Error fetching local content:`, err);
      setError(parseErrorMessage(err));
      setIsRevalidating(false);
    } finally {
      setIsInitialLoadingState(false);
    }
  }, [profile?.id, contentType, getDisplayFileName]);

  const fetchData = useCallback(async (initialFetch = true): Promise<void> => {
    if (profile?.id) {
      useContentCacheStore.getState().invalidate(contentCacheKey(profile.id, contentType));
    }
    if (initialFetch) {
      setSelectedItemIds(new Set());
      setContentUpdates({}); // Clear previous updates
      setContentUpdateError(null);
      setSearchQuery(""); // Clear search query on refresh
    }
    setIsInitialLoadProcessComplete(false); // Reset flag for new load process
    await fetchBasicInfo('must_revalidate');
  }, [fetchBasicInfo, profile?.id, contentType, setSearchQuery]);

  // Initial data fetch (Phase 1)
  useEffect(() => {
    fetchBasicInfo();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchBasicInfo, profile?.selected_norisk_pack_id]); // Added profile.selected_norisk_pack_id to ensure refetch on pack change

  // Phase 3: Fetch Modrinth project details based on hashes (existing logic, should be fine)
  useEffect(() => {
    let isMounted = true; // To prevent state updates on unmounted component
    if (hashesToFetchModrinthDetailsFor && hashesToFetchModrinthDetailsFor.length > 0 && profile?.id && !isFetchingModrinthDetailsState) {
      console.log(`[${contentType}] Phase 3: Triggering Modrinth project details fetch for hashes`, new Date().toISOString(), hashesToFetchModrinthDetailsFor);
      setIsFetchingModrinthDetailsState(true);
      const loadId = loadIdRef.current;
      const behaviour = cacheBehaviourRef.current;
      const fetchModrinthDataByHashes = async () => {
        try {
          const modrinthVersionsMap = await ModrinthService.getVersionsByHashes(hashesToFetchModrinthDetailsFor!, behaviour);
          if (!isMounted || loadIdRef.current !== loadId) return;
          console.log(`[${contentType}] Phase 3: Modrinth data received`, new Date().toISOString(), modrinthVersionsMap);
          setItems(currentItems =>
            currentItems.map(item => {
              if (item.sha1_hash && modrinthVersionsMap[item.sha1_hash]) {
                const modrinthVersion = modrinthVersionsMap[item.sha1_hash];
                const primaryFile = modrinthVersion.files.find(f => f.primary) || modrinthVersion.files[0];
                const newModrinthInfo: ProfileGenericModrinthInfo | null = primaryFile ? {
                  project_id: modrinthVersion.project_id,
                  version_id: modrinthVersion.id,
                  name: modrinthVersion.name, 
                  version_number: modrinthVersion.version_number,
                  download_url: primaryFile.url,
                } : null;
                return { ...item, modrinth_info: newModrinthInfo } as T;
              }
              return item;
            })
          );
          console.log(`[${contentType}] Phase 3: Items updated with Modrinth data`, new Date().toISOString());
        } catch (modrinthError) {
          if (!isMounted) return;
          console.warn(`[${contentType}] Phase 3: Failed to fetch Modrinth details by hashes:`, modrinthError);
          const errorMsg = parseErrorMessage(modrinthError);
          setError(prevError => prevError ? `${prevError}; Failed to fetch Modrinth details (${errorMsg})` : `Failed to fetch Modrinth details (${errorMsg})`);
        } finally {
          if (!isMounted) return;
          setIsFetchingModrinthDetailsState(false);
          if (loadIdRef.current !== loadId) return; // a newer load owns the state now
          setHashesToFetchModrinthDetailsFor(null);
          setIsInitialLoadProcessComplete(true); // Set the flag indicating Phase 3 completion
          setIsRevalidating(false);
        }
      };
      fetchModrinthDataByHashes();
    }
    return () => { isMounted = false; }; // Cleanup function
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashesToFetchModrinthDetailsFor, profile?.id, contentType]); // Dependencies should NOT include isInitialLoadProcessComplete

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (activeDropdownId && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        // Check if the click was on the "More Actions" button or any of its children
        const clickedElement = event.target as HTMLElement;
        const isMoreActionsButton = clickedElement.closest(`button[title="More Actions"], button[aria-label="More Actions"]`);
        if (!isMoreActionsButton) {
          setActiveDropdownId(null);
        }
      }
    };
    if (activeDropdownId) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activeDropdownId]);

  // Fetch Modrinth icons
  useEffect(() => {
    const fetchModrinthIcons = async () => {
      if (!items || items.length === 0) return;

      const { modrinthIcons: cached, mergeModrinthIcons } = useIconCacheStore.getState();
      const projectIdsToFetch = items
        .filter(item => {
          const platform = getItemPlatform(item);
          return platform === 'modrinth' && item.modrinth_info?.project_id && cached[item.modrinth_info.project_id] === undefined;
        })
        .map(item => item.modrinth_info!.project_id!)
      const uniqueProjectIds = [...new Set(projectIdsToFetch)];

      if (uniqueProjectIds.length > 0) {
        try {
          const projectDetailsList = await ModrinthService.getProjectDetails(uniqueProjectIds, cacheBehaviourRef.current);
          const newIcons: Record<string, string | null> = {};
          if (Array.isArray(projectDetailsList)) {
            projectDetailsList.forEach(detail => {
              if (detail && typeof detail === 'object' && detail.id) {
                newIcons[detail.id] = detail.icon_url || null;
              }
            });
          } else {
             console.warn("[useLocalContentManager] ModrinthService.getProjectDetails did not return an array. Received:", projectDetailsList);
          }
          mergeModrinthIcons(newIcons);
        } catch (err) {
          console.error("[useLocalContentManager] Failed to fetch Modrinth project details for icons:", err);
        }
      }
    };
    fetchModrinthIcons();
  }, [items, getItemPlatform]);

  // Fetch CurseForge icons
  useEffect(() => {
    const fetchCurseForgeIcons = async () => {
      if (!items || items.length === 0) return;

      const { curseforgeIcons: cached, mergeCurseforgeIcons } = useIconCacheStore.getState();
      const projectIdsToFetch = items
        .filter(item => {
          const platform = getItemPlatform(item);
          return platform === 'curseforge' && item.curseforge_info?.project_id && cached[item.curseforge_info.project_id] === undefined;
        })
        .map(item => item.curseforge_info!.project_id!)
        .map(id => parseInt(id, 10)) // Convert string to number
        .filter(id => !isNaN(id)); // Filter out invalid IDs

      const uniqueProjectIds = [...new Set(projectIdsToFetch)];

      if (uniqueProjectIds.length > 0) {
        try {
          const modsResponse = await CurseForgeService.getModsByIds(uniqueProjectIds, undefined, cacheBehaviourRef.current);
          const newIcons: Record<string, string | null> = {};

          if (modsResponse && modsResponse.data) {
            modsResponse.data.forEach(mod => {
              if (mod && mod.id && mod.logo) {
                newIcons[mod.id.toString()] = mod.logo.url || null;
              } else if (mod && mod.id) {
                // Mod exists but has no logo
                newIcons[mod.id.toString()] = null;
              }
            });
          } else {
            console.warn("[useLocalContentManager] CurseForgeService.getModsByIds did not return expected structure. Received:", modsResponse);
          }

          mergeCurseforgeIcons(newIcons);
        } catch (err) {
          console.error("[useLocalContentManager] Failed to fetch CurseForge mod details for icons:", err);
        }
      }
    };
    fetchCurseForgeIcons();
  }, [items, getItemPlatform]);

  useEffect(() => {
    const fetchLocalArchiveIcons = async () => {
      if (!items || items.length === 0) return;

      const { archiveIcons: cached, mergeArchiveIcons } = useIconCacheStore.getState();
      const wanted = new Map<string, string>(); // icon key -> path to read it from
      for (const item of items) {
        if (!item.path) continue;
        const lowerPath = item.path.toLowerCase();
        const isArchive = contentType === 'NoRiskMod' ? lowerPath.endsWith('.jar') : lowerPath.endsWith('.zip');
        if (!isArchive) continue;

        const key = archiveIconKey(item);
        if (cached[key] !== undefined || wanted.has(key)) continue;
        wanted.set(key, item.path);
      }

      if (wanted.size === 0) return;

      const entries = [...wanted.entries()];
      try {
        const iconsResult = await invoke<Record<string, string | null>>(
          "get_icons_for_archives",
          { archivePaths: entries.map(([, path]) => path) }
        );

        const newIcons: Record<string, string | null> = {};
        for (const [key, path] of entries) {
          const base64Icon = iconsResult?.[path];
          newIcons[key] = base64Icon ? 'data:image/png;base64,' + base64Icon : null;
        }
        mergeArchiveIcons(newIcons);
      } catch (err) {
        console.error("[useLocalContentManager] Failed to fetch local archive icons:", err);
      }
    };
    fetchLocalArchiveIcons();
  }, [items, contentType]);

  useEffect(() => {
    if (!cacheKey || !isInitialLoadProcessComplete) return;
    useContentCacheStore.getState().setEntry(cacheKey, { items, contentUpdates });
  }, [cacheKey, items, contentUpdates, isInitialLoadProcessComplete]);

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    return items.filter((item) =>
      getDisplayFileName(item).toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.filename.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [items, searchQuery, getDisplayFileName]);

  const handleItemSelectionChange = useCallback((itemId: string, isSelected: boolean) => {
    setSelectedItemIds(prev => {
      const newSet = new Set(prev);
      if (isSelected) newSet.add(itemId);
      else newSet.delete(itemId);
      return newSet;
    });
  }, []);

  const areAllFilteredSelected = useMemo(() => {
    return filteredItems.length > 0 && filteredItems.every(item => selectedItemIds.has(item.filename));
  }, [filteredItems, selectedItemIds]);

  // Calculate the number of actually updatable content (only mods with updates enabled)
  const updatableContentCount = useMemo(() => {
    let count = 0;
    for (const item of items) {
      const updateIdentifier = getUpdateIdentifier(item);
      if (updateIdentifier && contentUpdates[updateIdentifier]) {
        // Only count mods that have updates enabled (default to true if null/undefined)
        const updatesEnabledDefault = item.updates_enabled ?? true;
        const hasUpdatesEnabled = contentType === 'Mod' && updatesEnabledDefault !== false;

        if (hasUpdatesEnabled) {
          count++;
        }
      }
    }
    return count;
  }, [items, contentUpdates, contentType]);

  const handleSelectAllToggle = useCallback((isChecked: boolean) => {
    setSelectedItemIds(prev => {
      const newSet = new Set(prev);
      if (isChecked) filteredItems.forEach(item => newSet.add(item.filename));
      else filteredItems.forEach(item => newSet.delete(item.filename));
      return newSet;
    });
  }, [filteredItems]);

  const handleToggleItemEnabled = useCallback(async (item: T) => {
    if (!profile) {
      toast.error(i18n.t('content_manager.errors.profile_missing_toggle'));
      return;
    }
    console.log(`[${contentType}] handleToggleItemEnabled: Item BEFORE toggle - Path: ${item.path}, Filename: ${item.filename}, Disabled: ${item.is_disabled}`);
    
    setItemBeingToggled(item.filename);
    // If item.is_disabled is true (it's disabled), targetEnabledState becomes true (to enable it).
    // If item.is_disabled is false (it's enabled), targetEnabledState becomes false (to disable it).
    const targetEnabledState = item.is_disabled; 

    const payload = createTogglePayload(item, profile.id, contentType, targetEnabledState);

    if (!payload) {
      setItemBeingToggled(null);
      // createTogglePayload already shows a toast for some error cases
      return;
    }

    try {
      await toggleContentFromProfile(payload);

      setItems(prevItems =>
        prevItems.map(i => {
          if (i.filename === item.filename) {
            const nowDisabled = !targetEnabledState;
            const enabledPath = i.path.replace(/\.disabled$/, '');
            const updatedItem = {
              ...i,
              is_disabled: nowDisabled,
              path: nowDisabled ? `${enabledPath}.disabled` : enabledPath,
            };
            console.log(`[${contentType}] handleToggleItemEnabled: Item AFTER toggle (in setItems) - Path: ${updatedItem.path}, Filename: ${updatedItem.filename}, Disabled: ${updatedItem.is_disabled}`);
            return updatedItem;
          }
          return i;
        })
      );
      if (contentType !== 'NoRiskMod' && onRefreshRequiredRef.current) {
        onRefreshRequiredRef.current();
      }
    } catch (err) {
      console.error(`Failed to toggle ${getDisplayFileName(item)}:`, err);
      const errorMsg = parseErrorMessage(err);
      toast.error(i18n.t('content_manager.errors.toggle_failed', { name: getDisplayFileName(item), error: errorMsg }));
    } finally {
      setItemBeingToggled(null);
    }
  }, [profile, contentType, getDisplayFileName]); 

  const handleDeleteItem = useCallback((item: T) => {
    if (!item.path) { // Use path
      toast.error(i18n.t('content_manager.errors.item_path_missing_delete'));
      return;
    }
    setItemToDeleteForDialog(item);
    setIsBatchDeleteConfirmActive(false);
    setIsConfirmDeleteDialogOpen(true);
  }, []);

  const handleCloseDeleteDialog = useCallback(() => {
    setIsConfirmDeleteDialogOpen(false);
    setItemToDeleteForDialog(null);
    setIsBatchDeleteConfirmActive(false);
  }, []);

  const handleConfirmDeletion = useCallback(async () => {
    if (!profile) {
      toast.error(i18n.t('content_manager.errors.profile_missing_delete'));
      handleCloseDeleteDialog();
      return;
    }
    setIsDialogActionLoading(true);
    setError(null);
    let successfulOperations = 0;
    const errors: string[] = [];

    if (isBatchDeleteConfirmActive) {
      setIsBatchDeleting(true);
      for (const itemId of selectedItemIds) {
        const item = items.find(i => i.filename === itemId);
        if (item) {
          const payload = createUninstallPayload(item, profile.id, contentType);
          if (payload) {
            try {
              await uninstallContentFromProfile(payload);
              successfulOperations++;
            } catch (err) {
              const errorDetail = parseErrorMessage(err);
              errors.push(i18n.t('content_manager.errors.delete_failed', { name: getDisplayFileName(item), error: errorDetail }));
            }
          } else {
             // Error already toasted by createUninstallPayload
            errors.push(`Could not create uninstall payload for ${getDisplayFileName(item)}.`);
          }
        } else {
          errors.push(`Could not find item ID ${itemId} to delete.`);
        }
      }
      if (errors.length > 0) toast.error(i18n.t('content_manager.errors.batch_delete_failed', { errors: errors.join("; ") }));
      if (successfulOperations > 0) toast.success(i18n.t('content_manager.success.batch_deleted', { count: successfulOperations }));
      setIsBatchDeleting(false);
      setSelectedItemIds(new Set());
    } else if (itemToDeleteForDialog) {
      setItemBeingDeleted(itemToDeleteForDialog.filename);
      const payload = createUninstallPayload(itemToDeleteForDialog, profile.id, contentType);
      if (payload) {
        try {
          await uninstallContentFromProfile(payload);
          toast.success(i18n.t('content_manager.success.deleted', { name: getDisplayFileName(itemToDeleteForDialog) }));
          successfulOperations++;
          setItems(prevItems => prevItems.filter(i => i.filename !== itemToDeleteForDialog.filename));
          setSelectedItemIds(prevIds => {
            const newSet = new Set(prevIds);
            newSet.delete(itemToDeleteForDialog.filename);
            return newSet;
          });
        } catch (err) {
          const errorDetail = parseErrorMessage(err);
          toast.error(i18n.t('content_manager.errors.delete_failed', { name: getDisplayFileName(itemToDeleteForDialog), error: errorDetail }));
          errors.push(i18n.t('content_manager.errors.delete_failed', { name: getDisplayFileName(itemToDeleteForDialog), error: errorDetail }));
        }
      } else {
        // Error already toasted by createUninstallPayload
        // No specific error push here as it's a single item, and the toast is the primary feedback
      }
      setItemBeingDeleted(null);
    }

    setIsDialogActionLoading(false);
    handleCloseDeleteDialog();
    if (successfulOperations > 0 || errors.length > 0) { 
      if (isBatchDeleteConfirmActive || errors.length > 0) { // Refresh if batch or single error
        await fetchData(true); // Full refresh
      }
      if (onRefreshRequiredRef.current) onRefreshRequiredRef.current();
    }
    if (errors.length > 0 && !isBatchDeleteConfirmActive) setError(errors.join("; "));

  }, [profile, selectedItemIds, items, itemToDeleteForDialog, isBatchDeleteConfirmActive, fetchData, getDisplayFileName, handleCloseDeleteDialog]);

  const handleBatchToggleSelected = useCallback(async () => {
    if (!profile || selectedItemIds.size === 0) return;
    setIsBatchToggling(true);
    const errors: string[] = [];
    let successfulOperations = 0;

    for (const itemId of selectedItemIds) {
      const item = items.find(i => i.filename === itemId);
      if (item) {
        // Determine the target state for *this specific item*
        const targetEnabledStateForItem = item.is_disabled; // If disabled (true), target is to enable (true). If enabled (false), target is to disable (false).
        
        const payload = createTogglePayload(item, profile.id, contentType, targetEnabledStateForItem);

        if (payload) {
          try {
            await toggleContentFromProfile(payload);
            setItems(prev => prev.map(i => 
              i.filename === itemId ? { ...i, is_disabled: !targetEnabledStateForItem } : i
            ));
            successfulOperations++;
          } catch (err) {
            const errorDetail = parseErrorMessage(err);
            errors.push(`Failed to toggle ${getDisplayFileName(item)}: ${errorDetail}`);
          }
        } else {
          // Error already toasted by createTogglePayload if it returned null
          errors.push(`Could not create toggle payload for ${getDisplayFileName(item)}.`);
        }
      } else {
        errors.push(`Could not find item ID ${itemId} to toggle.`);
      }
    }
    setIsBatchToggling(false);
    if (errors.length > 0) toast.error(i18n.t('content_manager.errors.batch_toggle_failed', { errors: errors.join("; ") }));
    if (successfulOperations > 0) {
      toast.success(i18n.t('content_manager.success.batch_toggled', { count: successfulOperations }));
      if (onRefreshRequiredRef.current) onRefreshRequiredRef.current();
    }
    setSelectedItemIds(new Set());
  }, [profile, selectedItemIds, items, contentType, getDisplayFileName]); 

  const handleBatchDeleteSelected = useCallback(() => {
    if (!profile || selectedItemIds.size === 0) return;
    setItemToDeleteForDialog(null); 
    setIsBatchDeleteConfirmActive(true);
    setIsConfirmDeleteDialogOpen(true);
  }, [profile, selectedItemIds]);

  const handleOpenItemFolder = useCallback(async (item: T) => {
    if (!item.path) {
      toast.error(i18n.t('content_manager.errors.path_not_available'));
      return;
    }
    try {
      await revealItemInDir(item.path);
    } catch (revealError: any) {
      try {
        const parentPath = item.path.replace(/[\\/][^\\/]+$/, '');
        await openPath(parentPath || item.path);
      } catch (openError: any) {
        const errorMsg = openError?.message || revealError?.message || "Failed to open item location.";
        toast.error(i18n.t('content_manager.errors.failed_open_location', { error: errorMsg }));
      }
    }
  }, []);
  
  const checkForContentUpdates = useCallback(async (currentProfile = profile, currentItems = items) => {
    if (!currentProfile || !currentItems || currentItems.length === 0) {
      setContentUpdates({});
      return;
    }

    // Sammle alle Items die entweder einen sha1_hash (Modrinth) oder fingerprint (CurseForge) haben
    const itemsWithIdentifiers = currentItems.filter(item =>
      item.sha1_hash || (item.curseforge_info?.fingerprint !== undefined)
    );

    if (itemsWithIdentifiers.length === 0) {
      setContentUpdates({});
      return;
    }

    // Erstelle Identifier-Mapping: für jeden Item einen eindeutigen String-Identifier
    const itemIdentifiers: Array<{ item: T; identifier: string; platform: ModPlatform }> = [];

    for (const item of itemsWithIdentifiers) {
      // Use centralized utility function for consistent identifier logic
      const identifier = getUpdateIdentifier(item);
      const platform = getContentPlatform(item) === 'CurseForge' ? ModPlatform.CurseForge : ModPlatform.Modrinth;

      if (identifier) {
        itemIdentifiers.push({ item, identifier, platform });
      }
    }

    const hashes = itemIdentifiers.map(({ identifier }) => identifier);

    // Sammle Plattform-Informationen für jeden Identifier
    const hashPlatforms: Record<string, ModPlatform> = {};
    const hashFingerprints: Record<string, number> = {};

    for (const { identifier, platform, item } of itemIdentifiers) {
      hashPlatforms[identifier] = platform;

      // Sammle CurseForge Fingerprints wenn verfügbar
      if (platform === ModPlatform.CurseForge && item.curseforge_info?.fingerprint) {
        hashFingerprints[identifier] = item.curseforge_info.fingerprint;
      }
    }

    setIsCheckingUpdates(true);
    setContentUpdateError(null);
    console.log("Current Items:", currentItems);
    console.log("Hash platforms:", hashPlatforms);

    try {
      const request: UnifiedUpdateCheckRequest = {
        hashes,
        algorithm: "sha1",
        loaders: (contentType === 'Mod' || contentType === 'NoRiskMod') && currentProfile.loader ? [currentProfile.loader] : [],
        game_versions: [currentProfile.game_version],
        hash_platforms: hashPlatforms, // Neue Plattform-Mapping
        hash_fingerprints: Object.keys(hashFingerprints).length > 0 ? hashFingerprints : undefined,
      };

      // Verwende den UnifiedService
      const updates: UnifiedUpdateCheckResponse = await UnifiedService.checkModUpdates(request, cacheBehaviourRef.current);

      // Debug logging
      console.log('=== UPDATE CHECK DEBUG ===');
      console.log('Available update keys:', Object.keys(updates.updates));
      console.log('Sample updates:');
      Object.entries(updates.updates).slice(0, 3).forEach(([key, update]) => {
        console.log(`  Key: "${key}" -> ${update.version_number} (${update.source})`);
      });

      const filteredUpdates: Record<string, UnifiedVersion> = {};
      const itemsByIdentifier = new Map<string, T>();

      // Erstelle Mapping von Identifier zu Item
      for (const { item, identifier } of itemIdentifiers) {
        itemsByIdentifier.set(identifier, item);
      }

      console.log('=== FILTERING DEBUG ===');
      console.log('Items by identifier keys:', Array.from(itemsByIdentifier.keys()));
      console.log('Update keys to process:', Object.keys(updates.updates));

      for (const [identifier, unifiedVersion] of Object.entries(updates.updates)) {
        const item = itemsByIdentifier.get(identifier);
        console.log(`Processing update key "${identifier}": item found = ${!!item}`);
        if (item) {
          console.log(`  Item: ${item.filename}, platform: ${item.platform}, has curseforge_info: ${!!item.curseforge_info}, fingerprint: ${item.curseforge_info?.fingerprint}, sha1_hash: ${item.sha1_hash}`);
        } else {
          // Try to find item with different identifier formats
          console.log(`  Looking for item with fingerprint ${identifier}...`);
          const foundByFingerprint = items.find(i => i.curseforge_info?.fingerprint?.toString() === identifier);
          if (foundByFingerprint) {
            console.log(`  Found by fingerprint: ${foundByFingerprint.filename}`);
          } else {
            console.log(`  No item found with fingerprint ${identifier}`);
          }
        }

        if (item && unifiedVersion && unifiedVersion.id) {
          // Vergleiche die aktuelle Version mit der verfügbaren Update-Version
          const currentVersionId = item.modrinth_info?.version_id || item.curseforge_info?.file_id || item.id;
          console.log(`Comparing versions for ${item.filename}: current=${currentVersionId} (${typeof currentVersionId}), update=${unifiedVersion.id} (${typeof unifiedVersion.id})`);
          if (currentVersionId !== unifiedVersion.id) {
            console.log(`Found update for ${item.filename}: ${currentVersionId} -> ${unifiedVersion.id}`);
            // Verwende UnifiedVersion direkt ohne Konvertierung
            filteredUpdates[identifier] = unifiedVersion as UnifiedVersion;
          } else {
            console.log(`No update needed for ${item.filename}: versions match (${currentVersionId})`);
          }
        } else {
          console.log(`Skipping update for key "${identifier}": item=${!!item}, unifiedVersion=${!!unifiedVersion}, unifiedVersion.id=${unifiedVersion?.id}`);
        }
      }

      console.log('Filtered updates result:', Object.keys(filteredUpdates));

      console.log("Filtered updates:", filteredUpdates);
      setContentUpdates(filteredUpdates);
    } catch (error) {
      const errorMsg = parseErrorMessage(error);
      console.error(`Error checking for ${contentType} updates:`, errorMsg);
      setContentUpdateError(`Error checking for ${contentType} updates: ${errorMsg}`);
      setContentUpdates({});
    } finally {
      setIsCheckingUpdates(false);
    }
  }, [profile, items, contentType]);

  // Common function for switching content versions
  const performContentVersionSwitch = useCallback(async (
    item: T,
    newVersion: UnifiedVersion,
    options: {
      removeUpdateNotification?: boolean;
      isUpdateOperation?: boolean;
    } = {}
  ): Promise<T> => {
    // Use the unified service method - backend handles all platform logic
    await UnifiedService.switchContentVersion(
      profile.id,
      mapUiContentTypeToBackend(contentType),
      item,
      newVersion
    );

    // After successful invoke, create the updated item for the frontend state.
    const primaryFile = newVersion.files.find(f => f.primary) || newVersion.files[0];
    if (!primaryFile) throw new Error(`${options.isUpdateOperation ? 'Updated' : 'Switched'} version details are missing a primary file.`);

    const newSha1 = primaryFile.hashes.sha1 || null;
    const newFilename = primaryFile.filename;
    const oldPath = item.path;
    const pathSeparator = oldPath.includes('/') ? '/' : '\\';
    const dirPath = oldPath.substring(0, oldPath.lastIndexOf(pathSeparator));
    const newPath = `${dirPath}${pathSeparator}${newFilename}`;

    // Plattform-spezifische Info-Updates
    const platform = newVersion.source;
    let updatedModrinthInfo = item.modrinth_info;
    let updatedCurseForgeInfo = item.curseforge_info;

    if (platform === 'Modrinth') {
      updatedModrinthInfo = {
        ...(item.modrinth_info || {}),
        project_id: newVersion.project_id,
        version_id: newVersion.id,
        name: newVersion.name,
        version_number: newVersion.version_number,
        download_url: primaryFile.url,
      };
    } else if (platform === 'CurseForge') {
      updatedCurseForgeInfo = {
        ...(item.curseforge_info || {}),
        project_id: newVersion.project_id,
        file_id: newVersion.id,
        name: newVersion.name,
        version_number: newVersion.version_number,
        download_url: primaryFile.url,
      };
    }

    const updatedItem: T = {
      ...item, // Start with the old item to preserve path etc.
      filename: newFilename,
      path: newPath,
      path_str: newPath,
      is_disabled: false,
      sha1_hash: newSha1,
      fallback_version: newVersion.version_number,
      modrinth_info: updatedModrinthInfo,
      curseforge_info: updatedCurseForgeInfo,
    };

    // Update the main items list with the new item data
    setItems(prevItems => prevItems.map(i => i.filename === item.filename ? updatedItem : i));

    // Remove update notification if requested
    if (options.removeUpdateNotification) {
      const updateIdentifier = getUpdateIdentifier(item);
      if (updateIdentifier) {
        setContentUpdates(prev => {
          const newUpdates = { ...prev };
          delete newUpdates[updateIdentifier];
          return newUpdates;
        });
      }
    }

    return updatedItem;
  }, [profile, contentType, setItems, setContentUpdates]);

  const handleUpdateContentItem = useCallback(async (item: T, updateVersion: UnifiedVersion, suppressOwnToast: boolean = false) => {
    // 1. Initial checks
    if (!profile) {
      toast.error(i18n.t('content_manager.errors.profile_missing_update'));
      return;
    }

    // 1.5. Check if this is a modpack mod (blocked unless updates are explicitly enabled)
    if (contentType === 'Mod' && item.modpack_origin !== null && item.modpack_origin !== undefined && item.updates_enabled !== true) {
      toast.error(i18n.t('content_manager.errors.modpack_mod_update_blocked', { name: getDisplayFileName(item) }));
      return;
    }

    // 2. Validate requirements for all content types
    const platform = updateVersion.source;

    // Basic validation for all content types
    if (!item.path && !(contentType === 'Mod' && item.id && !item.source_type && !item.norisk_info)) {
      toast.error(i18n.t('content_manager.errors.item_path_missing_update', { name: getDisplayFileName(item) }));
      return;
    }

    // Platform-specific validation
    if (platform === 'Modrinth' && contentType === 'Mod' && item.id && !item.source_type && !item.norisk_info && !item.modrinth_info) {
      toast.error(i18n.t('content_manager.errors.mod_not_modrinth', { name: getDisplayFileName(item) }));
      return;
    }

    if (platform === 'CurseForge' && contentType === 'Mod' && item.id && !item.source_type && !item.norisk_info && !item.curseforge_info) {
      toast.error(i18n.t('content_manager.errors.mod_not_curseforge', { name: getDisplayFileName(item) }));
      return;
    }

    console.log(`[${contentType}] Updating ${getDisplayFileName(item)} to version ${updateVersion.version_number} (${platform})`);

    // 3. Setup for the operation
    setItemsBeingUpdated(prev => new Set(prev).add(item.filename));
    setContentUpdateError(null);

    const promiseAction = async () => {
      await performContentVersionSwitch(item, updateVersion, {
        removeUpdateNotification: true,
        isUpdateOperation: true
      });
    };

    // 4. Execute with toast.promise and cleanup
    try {
      if (suppressOwnToast) {
        await promiseAction();
      } else {
        await toast.promise(
          promiseAction(),
          {
            loading: i18n.t('content_manager.loading.updating', { name: getDisplayFileName(item), version: updateVersion.version_number }),
            success: i18n.t('content_manager.success.updated', { name: getDisplayFileName(item), version: updateVersion.version_number }),
            error: (err: any) => {
              console.error(`Failed to update ${contentType} for ${getDisplayFileName(item)} (${platform}):`, err);
              const errorMsg = err?.message || (typeof err === 'string' ? err : "An unknown error occurred during the update.");
              return i18n.t('content_manager.errors.update_failed', { name: getDisplayFileName(item), error: errorMsg });
            }
          },
          {
            success: {
              duration: 700,
            },
          }
        );
      }
    } catch (err) {
      if (suppressOwnToast) {
        throw err;
      }
      // This catch is for issues if toast.promise itself or the promise chain has an unhandled rejection
      // not already processed by the 'error' callback of toast.promise.
      console.error(`Outer catch during update process for ${getDisplayFileName(item)}:`, err);
      // No additional user-facing toast here, as toast.promise's error handler should cover it.
    } finally {
      setItemsBeingUpdated(prev => {
        const newSet = new Set(prev);
        newSet.delete(item.filename);
        return newSet;
      });
    }
  }, [profile, contentType, getDisplayFileName, setItemsBeingUpdated, setContentUpdateError, setContentUpdates, performContentVersionSwitch]);

  const handleUpdateAllAvailableContent = useCallback(async () => {
    if (Object.keys(contentUpdates).length === 0 || !profile) return;
    
    const itemsToUpdateWithDetails: {item: T, version: UnifiedVersion}[] = [];
    for (const item of items) {
      // Use the same identifier logic as in checkForContentUpdates
      const updateIdentifier = getUpdateIdentifier(item);
      if (updateIdentifier && contentUpdates[updateIdentifier]) {
        // Only include mods that have updates enabled (true or null/undefined)
        const hasUpdatesEnabled = contentType === 'Mod' && item.updates_enabled !== false;

        if (hasUpdatesEnabled) {
          itemsToUpdateWithDetails.push({ item, version: contentUpdates[updateIdentifier] });
        } else {
          console.log(`Skipping ${getDisplayFileName(item)} from bulk update - UpdatesDisabled: ${!hasUpdatesEnabled}`);
        }
      }
    }

    if (itemsToUpdateWithDetails.length === 0) {
        return;
    }
    
    setIsUpdatingAll(true);
    setContentUpdateError(null);
    let succeededCount = 0;
    const totalCount = itemsToUpdateWithDetails.length;
    
    const toastId = toast.loading(i18n.t('content_manager.loading.updating_progress', { current: 0, total: totalCount, type: contentType }));
    
    for (const { item, version } of itemsToUpdateWithDetails) {
      try {
        await handleUpdateContentItem(item, version, true); // suppressOwnToast - version ist jetzt UnifiedVersion
        succeededCount++;
        toast.loading(i18n.t('content_manager.loading.updating_progress', { current: succeededCount, total: totalCount, type: contentType }), { id: toastId });
      } catch(err) {
        const errorMsg = parseErrorMessage(err);
        toast.error(i18n.t('content_manager.errors.update_failed', { name: getDisplayFileName(item), error: errorMsg }));
      }
    }
    
    setIsUpdatingAll(false);
    
    const failedCount = totalCount - succeededCount;
    if (failedCount > 0) {
      if (totalCount > 1) {
        const message = i18n.t('content_manager.update_result.finished_partial', { succeeded: succeededCount, failed: failedCount });
        if (succeededCount > 0) {
          toast.success(message, { id: toastId, duration: 700 });
        } else {
          toast.error(message, { id: toastId, duration: 2000 });
        }
      } else {
        // Single item failed, just dismiss the loading toast, individual error was shown
        toast.dismiss(toastId);
      }
    } else if (succeededCount > 0) {
      toast.success(i18n.t('content_manager.success.updated_all', { count: succeededCount, type: contentType }), { id: toastId, duration: 700 });
    } else {
      toast.dismiss(toastId);
    }
    
    if (succeededCount > 0) {
        // The state has been updated in-place for each item.
        // We don't need to re-check for updates immediately, as this could use stale data
        // and cause the "Update All" button to reappear incorrectly.
        // A manual refresh will catch any brand new updates.
    }
  }, [profile, items, contentUpdates, contentType, getDisplayFileName, handleUpdateContentItem, performContentVersionSwitch]);

  const handleSwitchContentVersion = useCallback(async (item: T, newVersion: UnifiedVersion) => {
    if (!profile) {
      toast.error(i18n.t('content_manager.errors.profile_missing_switch'));
      return;
    }

    const promiseAction = async () => {
      await performContentVersionSwitch(item, newVersion, {
        isUpdateOperation: false
      });
    };

    await toast.promise(
      promiseAction(),
      {
        loading: i18n.t('content_manager.loading.switching', { version: newVersion.name }),
        success: i18n.t('content_manager.success.switched', { name: getDisplayFileName(item), version: newVersion.name }),
        error: (err) => i18n.t('content_manager.errors.switch_failed', { error: err.message.toString() }),
      },
      {
        success: {
          duration: 700,
        },
      },
    );

    // the switch may have installed new dependency mods on the backend — re-fetch so they show up
    await fetchData(true);
  }, [profile, contentType, getDisplayFileName, performContentVersionSwitch, fetchData]);

  useEffect(() => {
    // Check for updates only after the initial full loading process for the current profile is complete,
    // and if there are items to check.
    if (profile?.id && items.length > 0 && isInitialLoadProcessComplete) {
      console.log(`[${contentType}] Initial load process complete. Triggering checkForContentUpdates.`);
      checkForContentUpdates();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, isInitialLoadProcessComplete, contentType]); // Removed items, relying on checkForContentUpdates internal dep on items. checkForContentUpdates itself is a dependency here to ensure it's the latest version.
  // Note: We are intentionally omitting `items` from this dependency array to prevent re-checking on every toggle.
  // `checkForContentUpdates` is a useCallback that itself depends on `items`, so it will use the latest `items` when called.
  // The `isInitialLoadProcessComplete` flag is the primary gate for this effect.

  // Toggle updates enabled for a single item
  const handleToggleItemUpdatesEnabled = useCallback(async (item: T) => {
    if (!profile) {
      toast.error(i18n.t('content_manager.errors.profile_missing_toggle_updates'));
      return;
    }

    if (!item.id) {
      toast.error(i18n.t('content_manager.errors.no_valid_id_toggle_updates', { name: getDisplayFileName(item) }));
      return;
    }

    const currentUpdatesEnabled = item.updates_enabled ?? true; // Default to true if null
    const newUpdatesEnabled = !currentUpdatesEnabled;

    const promiseAction = async () => {
      await toggleModUpdates({
        profile_id: profile.id,
        mod_id: item.id,
        updates_enabled: newUpdatesEnabled,
      });

      // Update local state immediately for better UX
      setItems(prevItems =>
        prevItems.map(prevItem =>
          prevItem.id === item.id
            ? { ...prevItem, updates_enabled: newUpdatesEnabled }
            : prevItem
        )
      );
    };

    await toast.promise(
      promiseAction(),
      {
        loading: i18n.t(newUpdatesEnabled ? 'content_manager.loading.enabling_update_checks' : 'content_manager.loading.disabling_update_checks', { name: getDisplayFileName(item) }),
        success: i18n.t(newUpdatesEnabled ? 'content_manager.success.toggle_updates_enabled' : 'content_manager.success.toggle_updates_disabled', { name: getDisplayFileName(item) }),
        error: (err) => i18n.t('content_manager.errors.toggle_update_checks_failed', { error: err.message?.toString() || 'Unknown error' }),
      },
      {
        success: {
          duration: 700,
        },
      },
    );

  }, [profile, getDisplayFileName]);

  // Bulk toggle updates enabled for selected items
  const handleBatchToggleSelectedUpdatesEnabled = useCallback(async (updatesEnabled: boolean) => {
    if (!profile) {
      toast.error(i18n.t('content_manager.errors.profile_missing_toggle_updates'));
      return;
    }

    if (selectedItemIds.size === 0) {
      toast.error(i18n.t('content_manager.errors.no_items_selected'));
      return;
    }

    // Find the selected items
    const selectedItems = items.filter(item => selectedItemIds.has(item.filename));

    if (selectedItems.length === 0) {
      toast.error(i18n.t('content_manager.errors.selected_items_not_found'));
      return;
    }

    const itemLabel = i18n.t(selectedItems.length === 1 ? 'content_manager.update_result.item' : 'content_manager.update_result.items');

    const promiseAction = async () => {
      // Filter out items without valid IDs and prepare bulk update payload
      const validItems = selectedItems.filter(item => item.id);
      if (validItems.length === 0) {
        throw new Error("No valid items found with IDs for update check toggle");
      }

      const modUpdates = validItems.map(item => ({
        mod_id: item.id,
        updates_enabled: updatesEnabled,
      }));

      await bulkToggleModUpdates({
        profile_id: profile.id,
        mod_updates: modUpdates,
      });

      // Update local state immediately for better UX (only for valid items)
      setItems(prevItems =>
        prevItems.map(prevItem =>
          validItems.some(validItem => validItem.filename === prevItem.filename)
            ? { ...prevItem, updates_enabled: updatesEnabled }
            : prevItem
        )
      );

      // Clear selection after successful operation
      setSelectedItemIds(new Set());
    };

    await toast.promise(
      promiseAction(),
      {
        loading: i18n.t(updatesEnabled ? 'content_manager.loading.enabling_update_checks_batch' : 'content_manager.loading.disabling_update_checks_batch', { count: selectedItems.length, itemLabel }),
        success: i18n.t(updatesEnabled ? 'content_manager.success.batch_toggle_updates_enabled' : 'content_manager.success.batch_toggle_updates_disabled', { count: selectedItems.length, itemLabel }),
        error: (err) => i18n.t('content_manager.errors.toggle_update_checks_failed', { error: err.message || 'Unknown error' }),
      },
      {
        success: {
          duration: 700,
        },
      },
    ).catch((err) => {
      // If we get an error about valid items, show a more specific message
      if (err.message && err.message.includes('No valid items found')) {
        toast.error(i18n.t('content_manager.errors.no_valid_ids_toggle_updates'));
      }
    });

  }, [profile, selectedItemIds, items]);

  return {
    items,
    isLoading: isInitialLoadingState,
    isRevalidating,
    isFetchingHashes: isFetchingHashesState,
    isFetchingModrinthDetails: isFetchingModrinthDetailsState,
    isAnyTaskRunning: isInitialLoadingState || isFetchingHashesState || isFetchingModrinthDetailsState || isCheckingUpdates || isUpdatingAll, 
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
    getItemIcon,
    getItemPlatformDisplayName,
    contentUpdates,
    isCheckingUpdates,
    itemsBeingUpdated,
    contentUpdateError,
    isUpdatingAll,
    updatableContentCount,
    fetchData,
    handleToggleItemEnabled,
    handleDeleteItem,
    handleBatchToggleSelected,
    handleBatchDeleteSelected,
    handleOpenItemFolder,
    checkForContentUpdates,
    handleUpdateContentItem,
    handleUpdateAllAvailableContent,
    handleSwitchContentVersion,

    // Mod update toggle methods
    handleToggleItemUpdatesEnabled,
    handleBatchToggleSelectedUpdatesEnabled,
  };
} 