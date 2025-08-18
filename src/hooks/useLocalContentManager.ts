import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'react-hot-toast';
import type { Profile, LocalContentItem as ProfileLocalContentItem, GenericModrinthInfo as ProfileGenericModrinthInfo, LoadItemsParams } from '../types/profile';
import type { ModrinthVersion, ModrinthBulkUpdateRequestBody, ModrinthHashAlgorithm, ResourcePackModrinthInfo, ShaderPackModrinthInfo, DataPackModrinthInfo } from '../types/modrinth';
import { ContentType as NrContentType } from '../types/content';
import type { ToggleContentPayload, UninstallContentPayload, SwitchContentVersionPayload } from '../types/content';
import { ModrinthService } from '../services/modrinth-service';
import { getLocalContent } from '../services/profile-service';
import { toggleContentFromProfile, uninstallContentFromProfile, switchContentVersion } from '../services/content-service';
import { revealItemInDir, openPath } from '@tauri-apps/plugin-opener';

// Base type for content items managed by this hook - maps to ProfileLocalContentItem
// We'll use ProfileLocalContentItem directly or ensure T extends it.
export interface LocalContentItem extends ProfileLocalContentItem { 
  path: string;
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

  modrinthIcons: Record<string, string | null>;
  localArchiveIcons: Record<string, string | null>;

  contentUpdates: Record<string, ModrinthVersion | null>;
  isCheckingUpdates: boolean;
  itemsBeingUpdated: Set<string>;
  contentUpdateError: string | null;
  isUpdatingAll: boolean;

  fetchData: (initialFetch?: boolean) => Promise<void>;
  handleToggleItemEnabled: (item: T) => Promise<void>;
  handleDeleteItem: (item: T) => void;
  handleBatchToggleSelected: () => Promise<void>;
  handleBatchDeleteSelected: () => void;
  handleOpenItemFolder: (item: T) => void;

  checkForContentUpdates: (currentProfile?: Profile, currentItems?: T[]) => Promise<void>;
  handleUpdateContentItem: (item: T, updateVersion: ModrinthVersion, suppressOwnToast?: boolean) => Promise<void>;
  handleUpdateAllAvailableContent: () => Promise<void>;
  handleSwitchContentVersion: (item: T, newVersion: ModrinthVersion) => Promise<void>;
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
  console.log(`mapBackendItemToFrontendType: Raw item from backend - PathStr: ${rawItem.path_str}, Filename: ${rawItem.filename}`);

  const outputItem = {
    ...rawItem, // Spread all properties from rawItem (which is typed as ProfileLocalContentItem)
    path: rawItem.path_str, // Add/override path using path_str from ProfileLocalContentItem // Fallback to the typed norisk_identifier if norisk_info isn't there
  };

  // Optional: For cleanliness, if T is not expected to have path_str, we could delete it.
  // However, LocalContentItem (the type T extends) currently inherits path_str from ProfileLocalContentItem.
  // delete (outputItem as any).path_str;
  console.log(`mapBackendItemToFrontendType: Mapped item - Path: ${outputItem.path}, Filename: ${outputItem.filename}`);
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
        toast.error(`Custom Mod item ${item.filename} must have a valid path for uninstallation.`);
        return null;
      }
      return { profile_id: profileId, file_path: item.path };
    } else {
      // For Modrinth or other non-custom mods, require SHA1 for uninstallation
      // as this is likely used to remove it from the profile's mod list as well.
      if (!item.sha1_hash) {
        toast.error(`Mod item ${item.filename} is missing an SHA1 hash, which is required for uninstallation.`);
        return null;
      }
      return { profile_id: profileId, sha1_hash: item.sha1_hash, content_type: NrContentType.Mod };
    }
  } else if (uiContentType === 'ResourcePack' || uiContentType === 'ShaderPack' || uiContentType === 'DataPack') {
    if (!item.path) {
      toast.error(`${uiContentType} item ${item.filename} must have a valid path for uninstallation.`);
      return null;
    }
    return { profile_id: profileId, file_path: item.path };
  } else if (uiContentType === 'NoRiskMod') {
    toast.error("Direct uninstallation of NoRiskMod items is not supported via this method. Please manage NoRisk Packs directly.");
    console.error("[useLocalContentManager] Attempted to create uninstall payload for NoRiskMod. This is generally not supported here.");
    return null;
  }

  toast.error(`Unsupported content type for uninstallation: ${uiContentType}`);
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
      toast.error(`NoRiskMod item ${item.filename} is missing the norisk_info. Cannot toggle.`);
      return null;
    }
  } else if (uiContentType === 'Mod') {
    if (item.source_type === "custom") {
        if (!item.path) {
            toast.error(`Custom Mod item ${item.filename} must have a valid path to be toggled.`);
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
            toast.error(`Mod item ${item.filename} is missing essential identifiers (SHA1 or Path) for toggle.`);
            return null;
        }
    }
  } else {
    // For ResourcePacks, ShaderPacks, DataPacks, use file_path
    if (item.path) {
      return { ...payloadBase, file_path: item.path };
    } else {
      toast.error(`Path is missing for ${uiContentType} ${item.filename}. Cannot toggle.`);
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
  const [items, setItems] = useState<T[]>([]);
  const [isInitialLoadingState, setIsInitialLoadingState] = useState(false);
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

  const [modrinthIcons, setModrinthIcons] = useState<Record<string, string | null>>({});
  const [localArchiveIcons, setLocalArchiveIcons] = useState<Record<string, string | null>>({});
  const [hashesToFetchModrinthDetailsFor, setHashesToFetchModrinthDetailsFor] = useState<string[] | null>(null);

  const [contentUpdates, setContentUpdates] = useState<Record<string, ModrinthVersion | null>>({});
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [itemsBeingUpdated, setItemsBeingUpdated] = useState<Set<string>>(new Set());
  const [contentUpdateError, setContentUpdateError] = useState<string | null>(null);
  const [isUpdatingAll, setIsUpdatingAll] = useState(false);

  const [isInitialLoadProcessComplete, setIsInitialLoadProcessComplete] = useState(false);

  const onRefreshRequiredRef = useRef(onRefreshRequired);
  useEffect(() => {
    onRefreshRequiredRef.current = onRefreshRequired;
  }, [onRefreshRequired]);

  // Generic Phase 1: Fetch basic info for all content types
  const fetchBasicInfo = useCallback(async (): Promise<void> => {
    if (!profile?.id) {
      setItems([]);
      return;
    }
    setIsInitialLoadingState(true);
    setIsFetchingHashesState(false);
    setIsFetchingModrinthDetailsState(false);
    setError(null);
    setModrinthIcons({});
    setLocalArchiveIcons({});
    setContentUpdates({});
    setContentUpdateError(null);
    setHashesToFetchModrinthDetailsFor(null); // Reset this here

    const backendContentType = mapUiContentTypeToBackend(contentType);
    console.log(`[${contentType}] Phase 1: Fetching basic info...`, new Date().toISOString());
    try {
      const serviceParams: LoadItemsParams = {
        profile_id: profile.id,
        content_type: backendContentType,
        calculate_hashes: false,
        fetch_modrinth_data: false,
      };
      const fetchedBackendItems = await getLocalContent(serviceParams) as ProfileLocalContentItem[];
      console.log(`[${contentType}] Phase 1: Raw items from getLocalContent`, new Date().toISOString(), fetchedBackendItems);

      const mappedItemsToFrontend = fetchedBackendItems.map(item => mapBackendItemToFrontendType<T>(item));
      const processedBasicItems = mappedItemsToFrontend.map(item => {
        const finalFilename = item.filename || getDisplayFileName(item);
        console.log(`[${contentType}] fetchBasicInfo: Processing item - Original Filename: ${item.filename}, Path: ${item.path}, getDisplayFileName: ${getDisplayFileName(item)}, Final Filename: ${finalFilename}`);
        return {
          ...item,
          filename: finalFilename,
          modrinth_info: null, // Ensure modrinth_info is initially null
          sha1_hash: null, // Ensure sha1_hash is initially null for Phase 1
        };
      });
      setItems(processedBasicItems as T[]);
      console.log(`[${contentType}] Phase 1: Basic items set (count: ${processedBasicItems.length})`, new Date().toISOString());
      setSelectedItemIds(new Set());
      if (onRefreshRequiredRef.current) onRefreshRequiredRef.current();
    } catch (err) {
      console.error(`[${contentType}] Phase 1: Error fetching basic info:`, err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsInitialLoadingState(false);
    }
  }, [profile?.id, contentType, getDisplayFileName]);

  // Generic Phase 2: Fetch hashes and update items
  const fetchHashesAndUpdateItems = useCallback(async (): Promise<void> => {
    if (!profile?.id || items.length === 0) return;

    const backendContentType = mapUiContentTypeToBackend(contentType);
    console.log(`[${contentType}] Phase 2: Fetching hashes and full local info...`, new Date().toISOString());
    setIsFetchingHashesState(true);
    setError(null); // Clear previous errors before this specific phase

    try {
      const serviceParams: LoadItemsParams = {
        profile_id: profile.id,
        content_type: backendContentType,
        calculate_hashes: true,
        fetch_modrinth_data: false, // Modrinth details via JS in Phase 3
      };
      const fetchedBackendItemsWithHashes = await getLocalContent(serviceParams) as ProfileLocalContentItem[];
      console.log(`[${contentType}] Phase 2: Raw items with hashes from getLocalContent`, new Date().toISOString(), fetchedBackendItemsWithHashes);
      
      const mappedItemsToFrontend = fetchedBackendItemsWithHashes.map(item => mapBackendItemToFrontendType<T>(item));

      setItems(currentItems =>
        currentItems.map(currentItem => {
          const match = mappedItemsToFrontend.find(fi => fi.path === currentItem.path);
          if (match) { // Merge all details from the hash-calculated fetch
            return { 
              ...currentItem, 
              sha1_hash: match.sha1_hash, 
              file_size: match.file_size, 
              is_disabled: match.is_disabled,
              is_directory: match.is_directory, // Ensure this is also updated
              // Modrinth info is still deferred to Phase 3
            } as T;
          }
          return currentItem;
        })
      );

      const allKnownHashes = mappedItemsToFrontend
        .map(item => item.sha1_hash)
        .filter(hash => hash != null) as string[];
      
      if (allKnownHashes.length > 0) {
        console.log(`[${contentType}] Phase 2: Hashes obtained, setting for Modrinth lookup.`, new Date().toISOString(), allKnownHashes);
        setHashesToFetchModrinthDetailsFor(allKnownHashes);
      } else {
        setHashesToFetchModrinthDetailsFor(null);
      }
    } catch (err) {
      console.error(`[${contentType}] Phase 2: Error fetching hashes:`, err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFetchingHashesState(false);
    }
  }, [profile?.id, contentType, items, getDisplayFileName]); // items is a dependency here

  // fetchData now just calls fetchBasicInfo, which is Phase 1
  const fetchData = useCallback(async (initialFetch = true): Promise<void> => {
    // The 'initialFetch' parameter for fetchData is now more about resetting UI states like selection
    // The actual data fetching sequence is managed by fetchBasicInfo and subsequent effects.
    if (initialFetch) {
      setSelectedItemIds(new Set());
      setContentUpdates({}); // Clear previous updates
      setContentUpdateError(null);
      setIsInitialLoadProcessComplete(false); // Reset flag for new load process
      setSearchQuery(""); // Clear search query on refresh
    }
    await fetchBasicInfo();
  }, [fetchBasicInfo, setSearchQuery]); // Added setSearchQuery to dependencies

  // Initial data fetch (Phase 1)
  useEffect(() => {
    fetchBasicInfo();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchBasicInfo, profile?.selected_norisk_pack_id]); // Added profile.selected_norisk_pack_id to ensure refetch on pack change
  
  // Phase 2: Trigger Fetch Hashes (for all content types)
  useEffect(() => {
    // Only trigger if Phase 1 is done, and there are items that might need hashes,
    // and hash fetching isn't already in progress.
    if (!isInitialLoadingState && items.length > 0 && items.some(item => item.sha1_hash === null) && !isFetchingHashesState) {
      fetchHashesAndUpdateItems(); 
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, isInitialLoadingState, isFetchingHashesState, fetchHashesAndUpdateItems]); // fetchHashesAndUpdateItems is memoized
  
  // Phase 3: Fetch Modrinth project details based on hashes (existing logic, should be fine)
  useEffect(() => {
    let isMounted = true; // To prevent state updates on unmounted component
    if (hashesToFetchModrinthDetailsFor && hashesToFetchModrinthDetailsFor.length > 0 && profile?.id && !isFetchingModrinthDetailsState) {
      console.log(`[${contentType}] Phase 3: Triggering Modrinth project details fetch for hashes`, new Date().toISOString(), hashesToFetchModrinthDetailsFor);
      setIsFetchingModrinthDetailsState(true);
      const fetchModrinthDataByHashes = async () => {
        try {
          const modrinthVersionsMap = await ModrinthService.getVersionsByHashes(hashesToFetchModrinthDetailsFor!);
          if (!isMounted) return;
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
          const errorMsg = modrinthError instanceof Error ? modrinthError.message : String(modrinthError);
          setError(prevError => prevError ? `${prevError}; Failed to fetch Modrinth details (${errorMsg})` : `Failed to fetch Modrinth details (${errorMsg})`);
        } finally {
          if (isMounted) { // Ensure component is still mounted before setting state
            setIsFetchingModrinthDetailsState(false);
            setHashesToFetchModrinthDetailsFor(null); 
            setIsInitialLoadProcessComplete(true); // Set the flag indicating Phase 3 completion
          }
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
        const moreActionsButton = (event.target as HTMLElement).closest(`[data-item-id="${activeDropdownId}"] [title~="More"]`);
        if (!moreActionsButton) {
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
      if (!items || items.length === 0) {
        setModrinthIcons({});
        return;
      }

      const projectIdsToFetch = items
        .filter(item => item.modrinth_info?.project_id && modrinthIcons[item.modrinth_info.project_id] === undefined)
        .map(item => item.modrinth_info!.project_id!)
      const uniqueProjectIds = [...new Set(projectIdsToFetch)];

      if (uniqueProjectIds.length > 0) {
        try {
          const projectDetailsList = await ModrinthService.getProjectDetails(uniqueProjectIds);
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
          setModrinthIcons(prevIcons => ({ ...prevIcons, ...newIcons }));
        } catch (err) {
          console.error("[useLocalContentManager] Failed to fetch Modrinth project details for icons:", err);
          const errorIcons: Record<string, string | null> = {};
          uniqueProjectIds.forEach(id => { errorIcons[id] = null; });
          setModrinthIcons(prevIcons => ({ ...prevIcons, ...errorIcons }));
        }
      }
    };
    fetchModrinthIcons();
  }, [items]); 

  // Fetch local archive icons
  useEffect(() => {
    console.log(`[${contentType}] Running useEffect for fetchLocalArchiveIcons. Items count: ${items.length}, localArchiveIcons keys: ${Object.keys(localArchiveIcons).length}`);
    const fetchLocalArchiveIcons = async () => {
      if (!items || items.length === 0) {
        // Only set to empty if it's not already empty, to prevent infinite loop
        if (Object.keys(localArchiveIcons).length > 0) {
          setLocalArchiveIcons({});
          console.log(`[${contentType}] fetchLocalArchiveIcons: No items or items array empty, clearing localArchiveIcons because it wasn't empty.`);
        } else {
          // console.log(`[${contentType}] fetchLocalArchiveIcons: No items and localArchiveIcons already empty. Doing nothing to prevent loop.`);
        }
        return;
      }

      // console.log(`[${contentType}] fetchLocalArchiveIcons: Current localArchiveIcons keys:`, Object.keys(localArchiveIcons));
      items.forEach(item => {
        // console.log(`[${contentType}] fetchLocalArchiveIcons: Checking item - Path: ${item.path}, Filename: ${item.filename}, Cached: ${localArchiveIcons[item.path!] !== undefined}`);
      });

      const pathsToFetchIconsFor = items
        .filter(item => {
          if (!item.path || localArchiveIcons[item.path] !== undefined) {
            return false;
          }
          // For NoRiskMod, the item.path points to a .jar file in cache
          // For other types, item.path usually points to a .zip file
          const lowerPath = item.path.toLowerCase();
          if (contentType === 'NoRiskMod') {
            return lowerPath.endsWith('.jar');
          } else {
            return lowerPath.endsWith('.zip');
          }
        })
        .map(item => ({ filename: item.filename, path: item.path! })); 
      
      const uniquePathObjects = pathsToFetchIconsFor.filter((obj, index, self) => 
        index === self.findIndex(t => t.path === obj.path)
      );
      console.log(`[${contentType}] fetchLocalArchiveIcons: Unique paths to fetch icons for:`, uniquePathObjects.map(obj => obj.path));

      if (uniquePathObjects.length > 0) {
        try {
          const archivePaths = uniquePathObjects.map(obj => obj.path);
          const iconsResult = await invoke<Record<string, string | null>>(
            "get_icons_for_archives",
            { archivePaths }
          );

          if (iconsResult) {
            const newLocalIcons: Record<string, string | null> = {};
            uniquePathObjects.forEach(obj => {
                const base64Icon = iconsResult[obj.path];
                if (obj.path) {
                  newLocalIcons[obj.path] = base64Icon ? 'data:image/png;base64,' + base64Icon : null;
                }
            });
            setLocalArchiveIcons(prevIcons => ({ ...prevIcons, ...newLocalIcons }));
          } else {
            console.warn("[useLocalContentManager] get_icons_for_archives returned null or undefined.");
          }
        } catch (err) {
          console.error("[useLocalContentManager] Failed to fetch local archive icons:", err);
          const errorIcons: Record<string, string | null> = {};
          uniquePathObjects.forEach(obj => { 
            if (obj.path) errorIcons[obj.path] = null;
          });
          setLocalArchiveIcons(prevIcons => ({ ...prevIcons, ...errorIcons }));
        }
      }
    };
    fetchLocalArchiveIcons();
  }, [items, contentType, localArchiveIcons]); 

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
      toast.error("Profile missing for toggle.");
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
            const updatedItem = { ...i, is_disabled: !targetEnabledState };
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
      const errorMsg = err instanceof Error ? err.message : String(err.message);
      toast.error(`Failed to toggle ${getDisplayFileName(item)}: ${errorMsg}`);
    } finally {
      setItemBeingToggled(null);
    }
  }, [profile, contentType, getDisplayFileName]); 

  const handleDeleteItem = useCallback((item: T) => {
    if (!item.path) { // Use path
      toast.error("Item path missing, cannot delete.");
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
      toast.error("Profile data missing, cannot complete deletion.");
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
              const errorDetail = err instanceof Error ? err.message : String(err.message);
              errors.push(`Failed to delete ${getDisplayFileName(item)}: ${errorDetail}`);
            }
          } else {
             // Error already toasted by createUninstallPayload
            errors.push(`Could not create uninstall payload for ${getDisplayFileName(item)}.`);
          }
        } else {
          errors.push(`Could not find item ID ${itemId} to delete.`);
        }
      }
      if (errors.length > 0) toast.error(`Batch delete failed for some items: ${errors.join("; ")}`);
      if (successfulOperations > 0) toast.success(`Successfully deleted ${successfulOperations} item(s).`);
      setIsBatchDeleting(false);
      setSelectedItemIds(new Set());
    } else if (itemToDeleteForDialog) {
      setItemBeingDeleted(itemToDeleteForDialog.filename);
      const payload = createUninstallPayload(itemToDeleteForDialog, profile.id, contentType);
      if (payload) {
        try {
          await uninstallContentFromProfile(payload);
          toast.success(`Deleted ${getDisplayFileName(itemToDeleteForDialog)}.`);
          successfulOperations++;
          setItems(prevItems => prevItems.filter(i => i.filename !== itemToDeleteForDialog.filename));
          setSelectedItemIds(prevIds => {
            const newSet = new Set(prevIds);
            newSet.delete(itemToDeleteForDialog.filename);
            return newSet;
          });
        } catch (err) {
          const errorDetail = err instanceof Error ? err.message : String(err.message);
          toast.error(`Failed to delete ${getDisplayFileName(itemToDeleteForDialog)}: ${errorDetail}`);
          errors.push(`Failed to delete ${getDisplayFileName(itemToDeleteForDialog)}: ${errorDetail}`);
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
            const errorDetail = err instanceof Error ? err.message : String(err.message);
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
    if (errors.length > 0) toast.error(`Batch toggle failed for some items: ${errors.join("; ")}`);
    if (successfulOperations > 0) {
      toast.success(`Successfully toggled ${successfulOperations} item(s).`);
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
    console.log("handleOpenItemFolder", item);
    if (!item.path) {
      toast.error("Path not available for this item.");
      return;
    }
    try {
      //TODO Reveal profilemods
      await revealItemInDir(item.path);
      console.log(`[Opener] Successfully revealed item in directory: ${item.path}`);
    } catch (revealError: any) {
      console.warn(`[Opener] revealItemInDir failed for ${item.path}:`, revealError);
      try {
        await openPath(item.path);
        console.log(`[Opener] Successfully opened path (fallback): ${item.path}`);
      } catch (openError: any) {
        console.error(`[Opener] openPath also failed for ${item.path}:`, openError);
        const errorMsg = openError?.message || revealError?.message || "Failed to open item location.";
        toast.error(`Failed to open location: ${errorMsg}`);
      }
    }
  }, []);
  
  const checkForContentUpdates = useCallback(async (currentProfile = profile, currentItems = items) => {
    if (!currentProfile || !currentItems || currentItems.length === 0) {
      setContentUpdates({});
      return;
    }
    const itemsWithHashes = currentItems.filter(item => item.modrinth_info && item.sha1_hash);
    if (itemsWithHashes.length === 0) {
      setContentUpdates({});
      return;
    }
    const hashes = itemsWithHashes.map(item => item.sha1_hash!);
    setIsCheckingUpdates(true);
    setContentUpdateError(null);
    console.log("Current Items:", currentItems);
    try {
      const requestBody: ModrinthBulkUpdateRequestBody = {
        hashes,
        algorithm: "sha1" as ModrinthHashAlgorithm,
        loaders: (contentType === 'Mod' || contentType === 'NoRiskMod') && currentProfile.loader ? [currentProfile.loader] : [],
        game_versions: [currentProfile.game_version],
      };
      const updates = await invoke<Record<string, ModrinthVersion | null>>(
        "check_modrinth_updates", 
        { request: requestBody } 
      );
      const filteredUpdates: Record<string, ModrinthVersion> = {};
      const itemsByHash = new Map<string, T>();
      for (const item of itemsWithHashes) {
        if(item.sha1_hash) itemsByHash.set(item.sha1_hash, item);
      }
      for (const [hash, versionInfo] of Object.entries(updates)) {
        const item = itemsByHash.get(hash);
        if (item && versionInfo && versionInfo.id && 
           ((item.modrinth_info && item.modrinth_info.version_id !== versionInfo.id) || !item.modrinth_info)) {
          filteredUpdates[hash] = versionInfo;
        }
      }
      setContentUpdates(filteredUpdates);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error checking for ${contentType} updates:`, errorMsg);
      setContentUpdateError(`Error checking for ${contentType} updates: ${errorMsg}`);
      setContentUpdates({});
    } finally {
      setIsCheckingUpdates(false);
    }
  }, [profile, items, contentType]);

  const handleUpdateContentItem = useCallback(async (item: T, updateVersion: ModrinthVersion, suppressOwnToast: boolean = false) => {
    // 1. Initial checks
    if (!profile) {
      toast.error("Profile missing, cannot update.");
      return;
    }

    let command = "";
    let payload: any;
    let isModUpdateById = false;

    // 2. Determine command, payload, and handle unsupported scenarios
    if (contentType === 'Mod' && item.id && !item.source_type && !item.norisk_info) {
      if (!item.modrinth_info) { 
          toast.error(`Mod ${getDisplayFileName(item)} is not recognized as a Modrinth mod. Cannot update.`);
          return;
      }
      command = "update_modrinth_mod_version";
      payload = {
        profileId: profile.id,
        modInstanceId: item.id,
        newVersionDetails: updateVersion,
      };
      isModUpdateById = true;
      console.log(`[${contentType}] Using update_modrinth_mod_version for item ID: ${item.id}`);
    } else {
      if (!item.path) {
          toast.error(`Item path missing for ${getDisplayFileName(item)}, cannot update.`);
          return;
      }
      // For non-ID based updates (assets or fallback mods), modrinth_info and sha1_hash are crucial.
      if (!item.modrinth_info || !item.sha1_hash) {
          toast.error(`Item ${getDisplayFileName(item)} is not linked to Modrinth correctly or missing hash, cannot auto-update.`);
          return;
      }

      payload = { profileId: profile.id, newVersionDetails: updateVersion };
      const itemPayloadKey = contentType.toLowerCase(); 
      payload[itemPayloadKey] = item; 

      switch (contentType) {
        case 'ShaderPack': command = "update_shaderpack_from_modrinth"; break;
        case 'ResourcePack': command = "update_resourcepack_from_modrinth"; break;
        case 'DataPack': command = "update_datapack_from_modrinth"; break;
        case 'Mod':
          // For custom/local mods (no id) use the generic switch_content_version path
          command = "switch_content_version";
          payload = {
            payload: {
              profile_id: profile.id,
              content_type: mapUiContentTypeToBackend(contentType),
              current_item_details: { ...item, path_str: item.path },
              new_modrinth_version_details: updateVersion,
            },
          };
          break;
        default:
          toast.error(`Unsupported content type for update: ${contentType}`);
          return;
      }
      console.log(`[${contentType}] Using generic update command: ${command} for item: ${item.filename}`);
    }

    if (!command) { // Should ideally be caught by earlier checks
        toast.error(`Could not determine update action for ${getDisplayFileName(item)}.`);
        return;
    }

    // 3. Setup for the operation
    setItemsBeingUpdated(prev => new Set(prev).add(item.filename));
    setContentUpdateError(null);

    const promiseAction = async () => {
      await invoke(command, payload); // Core operation

      // After successful invoke, create the updated item for the frontend state.
      const primaryFile = updateVersion.files.find(f => f.primary) || updateVersion.files[0];
      if (!primaryFile) throw new Error("Updated version details are missing a primary file.");

      const newSha1 = primaryFile.hashes?.sha1 || null;
      const newFilename = primaryFile.filename;
      const oldPath = item.path;
      const pathSeparator = oldPath.includes('/') ? '/' : '\\';
      const dirPath = oldPath.substring(0, oldPath.lastIndexOf(pathSeparator));
      const newPath = `${dirPath}${pathSeparator}${newFilename}`;

      const updatedItem: T = {
          ...item, // Start with the old item to preserve path etc.
          filename: newFilename,
          path: newPath,
          path_str: newPath,
          is_disabled: false,
          sha1_hash: newSha1,
          fallback_version: updateVersion.version_number,
          modrinth_info: {
              ...(item.modrinth_info || {}),
              project_id: updateVersion.project_id,
              version_id: updateVersion.id,
              name: updateVersion.name,
              version_number: updateVersion.version_number,
              download_url: primaryFile.url,
          },
      };

      // Update the main items list with the new item data
      setItems(prevItems => prevItems.map(i => i.filename === item.filename ? updatedItem : i));
      
      // Remove the update notification
      if (item.sha1_hash) {
          setContentUpdates(prev => {
              const newUpdates = { ...prev };
              delete newUpdates[item.sha1_hash!];
              return newUpdates;
          });
      }
    };

    // 4. Execute with toast.promise and cleanup
    try {
      if (suppressOwnToast) {
        await promiseAction();
      } else {
        await toast.promise(
          promiseAction(),
          {
            loading: `Updating ${getDisplayFileName(item)} to ${updateVersion.version_number}...`,
            success: `Successfully updated ${getDisplayFileName(item)} to ${updateVersion.version_number}!`,
            error: (err: any) => {
              console.error(`Failed to update ${contentType} for ${getDisplayFileName(item)}:`, err);
              const displayName = getDisplayFileName(item);
              const errorMsg = err?.message || (typeof err === 'string' ? err : "An unknown error occurred during the update.");
              return `Failed to update ${displayName}: ${errorMsg}`;
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
  }, [profile, contentType, getDisplayFileName, setItemsBeingUpdated, setContentUpdateError, setContentUpdates]);

  const handleUpdateAllAvailableContent = useCallback(async () => {
    if (Object.keys(contentUpdates).length === 0 || !profile) return;
    
    const itemsToUpdateWithDetails: {item: T, version: ModrinthVersion}[] = [];
    for (const item of items) { 
      if (item.sha1_hash && contentUpdates[item.sha1_hash]) {
        itemsToUpdateWithDetails.push({ item, version: contentUpdates[item.sha1_hash]! });
      }
    }

    if (itemsToUpdateWithDetails.length === 0) {
        return;
    }
    
    setIsUpdatingAll(true);
    setContentUpdateError(null);
    let succeededCount = 0;
    const totalCount = itemsToUpdateWithDetails.length;
    
    const toastId = toast.loading(`Updating 0/${totalCount} ${contentType}s...`);
    
    for (const { item, version } of itemsToUpdateWithDetails) {
      try {
        await handleUpdateContentItem(item, version, true); // suppressOwnToast
        succeededCount++;
        toast.loading(`Updating ${succeededCount}/${totalCount} ${contentType}s...`, { id: toastId });
      } catch(err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        toast.error(`Failed to update ${getDisplayFileName(item)}: ${errorMsg}`);
      }
    }
    
    setIsUpdatingAll(false);
    
    const failedCount = totalCount - succeededCount;
    if (failedCount > 0) {
      if (totalCount > 1) {
        const message = `Finished: ${succeededCount} succeeded, ${failedCount} failed.`;
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
      toast.success(`Successfully updated all ${succeededCount} ${contentType}(s).`, { id: toastId, duration: 700 });
    } else {
      toast.dismiss(toastId);
    }
    
    if (succeededCount > 0) {
        // The state has been updated in-place for each item.
        // We don't need to re-check for updates immediately, as this could use stale data
        // and cause the "Update All" button to reappear incorrectly.
        // A manual refresh will catch any brand new updates.
    }
  }, [profile, items, contentUpdates, contentType, getDisplayFileName, handleUpdateContentItem]);

  const handleSwitchContentVersion = useCallback(async (item: T, newVersion: ModrinthVersion) => {
    if (!profile) {
      toast.error("Cannot switch version: Missing profile.");
      return;
    }
    
    const payload: SwitchContentVersionPayload = {
      profile_id: profile.id,
      content_type: mapUiContentTypeToBackend(contentType),
      current_item_details: {
        ...item,
        path_str: item.path,
      },
      new_modrinth_version_details: newVersion,
    };

    const promiseAction = async () => {
      await switchContentVersion(payload);

      const primaryFile = newVersion.files.find(f => f.primary) || newVersion.files[0];
      if (!primaryFile) throw new Error("Switched version details are missing a primary file.");

      const newSha1 = primaryFile.hashes?.sha1 || null;
      const newFilename = primaryFile.filename;
      const oldPath = item.path;
      const pathSeparator = oldPath.includes('/') ? '/' : '\\';
      const dirPath = oldPath.substring(0, oldPath.lastIndexOf(pathSeparator));
      const newPath = `${dirPath}${pathSeparator}${newFilename}`;

      const updatedItem: T = {
        ...item,
        filename: newFilename,
        path: newPath,
        path_str: newPath,
        is_disabled: false,
        sha1_hash: newSha1,
        fallback_version: newVersion.version_number,
        modrinth_info: { ...(item.modrinth_info || {}), project_id: newVersion.project_id, version_id: newVersion.id, name: newVersion.name, version_number: newVersion.version_number, download_url: primaryFile.url },
      };

      setItems(prevItems => prevItems.map(i => i.filename === item.filename ? updatedItem : i));
    };

    await toast.promise(
      promiseAction(),
      {
        loading: `Switching to ${newVersion.name}...`,
        success: `Switched ${getDisplayFileName(item)} to ${newVersion.name}.`,
        error: (err) => `Failed to switch version: ${err.message.toString()}`,
      },
      {
        success: {
          duration: 700,
        },
      },
    );

  }, [profile, contentType, getDisplayFileName]);

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

  return {
    items,
    isLoading: isInitialLoadingState, 
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
    modrinthIcons,
    localArchiveIcons,
    contentUpdates,
    isCheckingUpdates, 
    itemsBeingUpdated,
    contentUpdateError,
    isUpdatingAll, 
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
  };
} 