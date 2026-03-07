"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import UnifiedService from '../../../services/unified-service';
import { ModrinthService } from '../../../services/modrinth-service';
import { CurseForgeService } from '../../../services/curseforge-service';
import type {
  UnifiedModSearchResult,
  UnifiedModSearchResponse,
  UnifiedVersion
} from '../../../types/unified';
import { ModPlatform, UnifiedSortType, UnifiedProjectType } from '../../../types/unified';
import { getBlockedModsConfig, getModNoRiskStatus } from '../../../services/flagsmith-service';
import type {
  ModrinthProjectType,
  ModrinthSearchResponse,
  ModrinthCategory,
  ModrinthGameVersion,
  ModrinthLoader,
  ModrinthSortType,
  ModrinthVersion
} from '../../../types/modrinth';

// Helper function to convert ModrinthProjectType to UnifiedProjectType
const convertToUnifiedProjectType = (modrinthType: ModrinthProjectType): UnifiedProjectType => {
  switch (modrinthType) {
    case 'mod': return UnifiedProjectType.Mod;
    case 'modpack': return UnifiedProjectType.Modpack;
    case 'resourcepack': return UnifiedProjectType.ResourcePack;
    case 'shader': return UnifiedProjectType.Shader;
    case 'datapack': return UnifiedProjectType.Datapack;
    default: return UnifiedProjectType.Mod; // fallback
  }
};
import * as ProfileService from '../../../services/profile-service';
import { toast } from 'react-hot-toast';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { EventType, type EventPayload } from '../../../types/events';
import { ProgressToast } from '../../ui/ProgressToast';
import { Button } from '../../ui/buttons/Button';
import { SearchInput } from '../../ui/SearchInput';
import { Dropdown } from '../../ui/dropdown/Dropdown';
import { Icon } from '@iconify/react';
import { cn } from '../../../lib/utils';
import { Select } from '../../ui/Select'; // Import Select component
import { IconButton } from '../../ui/buttons/IconButton'; // Import IconButton
import { TagBadge } from '../../ui/TagBadge'; // Import TagBadge
import { Input } from '../../ui/Input'; // Import Input component
import { Checkbox } from '../../ui/Checkbox'; // Import Checkbox component
import { ModrinthVersionItemV2 } from './ModrinthVersionItemV2'; // Import the new component
import { ModrinthVersionListV2 } from './ModrinthVersionListV2'; // Import the new version list component
import { ModrinthQuickInstallModalV2 } from './ModrinthQuickInstallModalV2'; // Import the quick install modal
// Removed ModrinthInstallModalV2 - now using the universal ModrinthQuickInstallProfilesModal
import { ModrinthFilterSidebarV2 } from './ModrinthFilterSidebarV2'; // Import the new sidebar component
import { ModrinthProjectCardV2 } from './ModrinthProjectCardV2'; // Import the new project card component
import { ModrinthSearchControlsV2 } from './ModrinthSearchControlsV2'; // Import the new search controls component
import { ModrinthQuickInstallProfilesModal } from './ModrinthQuickInstallProfilesModal'; // Import the new quick install profiles modal

// Consolidate imports from content-service and types/content
import {
  installContentToProfile,
  uninstallContentFromProfile, // Ensure it's here
  toggleContentFromProfile
} from '../../../services/content-service';
import {
  ContentType as NrContentType, // Alias for ContentType from content.ts
  type InstallContentPayload,
  type UninstallContentPayload,
  type ToggleContentPayload
} from '../../../types/content';
import type { ContentInstallStatus, ContentCheckRequest, BatchCheckContentParams } from '../../../types/profile'; // For the extended status

import { useProfileStore } from '../../../store/profile-store'; // Hinzufügen des ProfileStore Imports
import { useModSearchStore } from '../../../store/useModSearchStore';
import { Virtuoso } from 'react-virtuoso'; // Import Virtuoso
import { useNavigate } from 'react-router-dom';
import { useGlobalModal } from '../../../hooks/useGlobalModal';
import { useThemeStore } from '../../../store/useThemeStore';
import { handleIrisCheckAndShowModal, IrisRequiredModal } from '../../../utils/iris-detection.tsx';
import { useTranslation } from "react-i18next";

// Remove any other stray imports of uninstallContentFromProfile below this point

// Placeholder for the new service function and payload type
// import { removeContentFromProfile, type RemoveContentPayload } from '../../../services/content-service';

// Profile type can remain generic for now or be imported if a specific type exists
type Profile = any;

export interface ModrinthSearchV2Props {
  profiles: Profile[];
  onInstallSuccess?: () => void;
  className?: string;
  selectedProfileId?: string; // Optional ID of pre-selected profile
  initialSidebarVisible?: boolean; // New prop for initial sidebar visibility
  overrideDisplayContext?: "detail" | "standalone"; // New prop
  initialProjectType?: ModrinthProjectType; // Added new prop
  allowedProjectTypes?: ModrinthProjectType[]; // New prop for allowed project types
  disableVirtualization?: boolean; // New prop to disable Virtuoso and use infinite div scrolling
}

const ALL_MODRINTH_PROJECT_TYPES: ModrinthProjectType[] = ['modpack', 'mod', 'resourcepack', 'shader', 'datapack'];

// Define the order for known headers, others will be alphabetical
const PREFERRED_HEADER_ORDER = ["resolutions", "performance impact", "features", "categories"];

interface UIDynamicFilterGroup {
  accordionTitle: string;
  headerValue: string;
  options: ModrinthCategory[];
}

export function ModrinthSearchV2({
  profiles: initialProfiles,
  onInstallSuccess,
  className = '',
  selectedProfileId,
  initialSidebarVisible = true, // Default to true if not provided
  overrideDisplayContext, // Destructure new prop
  initialProjectType, // Added new prop
  allowedProjectTypes, // Destructure new prop
  disableVirtualization = false, // Default to false (use Virtuoso by default)
}: ModrinthSearchV2Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showModal, hideModal } = useGlobalModal();
  const searchResultsAreaRef = useRef<HTMLDivElement>(null); // Ref for the scrollable area

  const {
    searchTerm, setSearchTerm,
    projectType, setProjectType,
    sortOrder, setSortOrder,
    selectedCategoriesByProjectType, setSelectedCategoriesByProjectType,
    selectedLoadersByProjectType, setSelectedLoadersByProjectType,
    selectedGameVersions, setSelectedGameVersions,
    filterClientRequired, setFilterClientRequired,
    filterServerRequired, setFilterServerRequired,
    scrollPosition, setScrollPosition,
    offset, setOffset,
    searchResults, setSearchResults,
    totalHits, setTotalHits,
  } = useModSearchStore();

  const hasInitializedProjectType = useRef(false);
  useEffect(() => {
    if (!hasInitializedProjectType.current) {
      hasInitializedProjectType.current = true;
      const effectiveAllowedTypes = allowedProjectTypes || ALL_MODRINTH_PROJECT_TYPES;
      if (initialProjectType && effectiveAllowedTypes.includes(initialProjectType)) {
        if (projectType !== initialProjectType) {
          setProjectType(initialProjectType);
        }
      }
    }
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  // State to control delayed display of "No results found" message
  const [showNoResultsMessage, setShowNoResultsMessage] = useState(false);
  const noResultsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const sortOptions: { value: UnifiedSortType; label: string; icon?: string }[] = [
    { value: UnifiedSortType.Relevance, label: t('content.search.sort.relevance'), icon: 'solar:sort-bold' },
    { value: UnifiedSortType.Downloads, label: t('content.search.sort.downloads'), icon: 'solar:download-bold' },
    { value: UnifiedSortType.Follows, label: t('content.search.sort.follows'), icon: 'solar:heart-bold' },
    { value: UnifiedSortType.Newest, label: t('content.search.sort.newest'), icon: 'solar:calendar-mark-bold' },
    { value: UnifiedSortType.Updated, label: t('content.search.sort.updated'), icon: 'solar:refresh-bold' },
  ];

  // State for blocked mods configuration
  const [blockedModsConfigLoaded, setBlockedModsConfigLoaded] = useState(false);

  const [allCategoriesData, setAllCategoriesData] = useState<ModrinthCategory[]>([]);
  const [gameVersionsData, setGameVersionsData] = useState<ModrinthGameVersion[]>([]);
  const [allLoadersData, setAllLoadersData] = useState<ModrinthLoader[]>([]);

  const [showAllGameVersionsSidebar, setShowAllGameVersionsSidebar] = useState(false); // Renamed state and set default to false
  const [gameVersionSearchTerm, setGameVersionSearchTerm] = useState('');

  // New state for expanded versions
  const [expandedVersions, setExpandedVersions] = useState<Record<string, UnifiedVersion[] | null | 'loading'>>({});

  // New state for managing how many versions are displayed per project
  const [numDisplayedVersions, setNumDisplayedVersions] = useState<Record<string, number>>({});
  const initialDisplayCount = 5;
  const loadMoreIncrement = 5;

  // New state for version filtering
  const [versionFilters, setVersionFilters] = useState<Record<string, {
    gameVersions: string[],
    loaders: string[],
    versionType: string
  }>>({});

  // State for installation modal
  // Removed installModalOpen state - now using global modal system
  const [selectedVersion, setSelectedVersion] = useState<UnifiedVersion | null>(null);
  const [selectedProject, setSelectedProject] = useState<UnifiedModSearchResult | null>(null);

  // State to track the currently opened install modal
  const [currentInstallProject, setCurrentInstallProject] = useState<UnifiedModSearchResult | any | null>(null);
  const [currentInstallVersion, setCurrentInstallVersion] = useState<UnifiedVersion | null>(null);
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [uninstalling, setUninstalling] = useState<Record<string, boolean>>({});
  const [installStatus, setInstallStatus] = useState<Record<string, boolean>>({});
  const [loadingStatus, setLoadingStatus] = useState(false);

  // Global modal hooks already declared above

  // Add new state for sidebar visibility
  const [isSidebarVisible, setIsSidebarVisible] = useState(initialSidebarVisible);

  // Add state for currently selected profile
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);

  // Get mod source from theme store (persistent)
  const { modSource, setModSource } = useThemeStore();

  // New state for tracking which projects are installed in the selected profile
  const [installedProjects, setInstalledProjects] = useState<Record<string, ContentInstallStatus | null>>({}); // Updated type

  // Change installedVersions to be keyed by profileId+versionId
  const [installedVersions, setInstalledVersions] = useState<Record<string, Record<string, ContentInstallStatus>>>({});

  // Internal state for profiles, synced with the prop
  const [internalProfiles, setInternalProfiles] = useState<Profile[]>(initialProfiles);
  const justInstalledOrToggledRef = useRef(false); // New ref to prevent re-check loops

  useEffect(() => {
    setInternalProfiles(initialProfiles);
    // If a selectedProfileId is passed as a prop, find and set it.
    if (selectedProfileId && initialProfiles.length > 0) {
      const initiallySelectedProfile = initialProfiles.find(p => p.id === selectedProfileId);
      if (initiallySelectedProfile) {
        setSelectedProfile(initiallySelectedProfile);
      }
    }
  }, [initialProfiles, selectedProfileId]);

  const currentSelectedCategories = useMemo(() => {
    return selectedCategoriesByProjectType[projectType] || [];
  }, [selectedCategoriesByProjectType, projectType]);

  const currentSelectedLoaders = useMemo(() => {
    return selectedLoadersByProjectType[projectType] || [];
  }, [selectedLoadersByProjectType, projectType]);

  // Fetch filter data on mount
  useEffect(() => {
    const fetchFilterData = async () => {
      try {
        setAllCategoriesData(await ModrinthService.getModrinthCategories());
        setGameVersionsData(await ModrinthService.getModrinthGameVersions());
        setAllLoadersData(await ModrinthService.getModrinthLoaders());
      } catch (err) { console.error("Failed to load filter data:", err); }
    };
    fetchFilterData();
  }, []);

  // Load blocked mods config on mount (cached from nrc-service if already loaded)
  useEffect(() => {
    const loadBlockedModsConfig = async () => {
      try {
        console.log('[ModrinthSearchV2] Getting blocked mods config (cached if already loaded)...');
        const config = await getBlockedModsConfig();
        console.log('[ModrinthSearchV2] Blocked mods config available:', config);
        setBlockedModsConfigLoaded(true);
      } catch (error) {
        console.error('[ModrinthSearchV2] Failed to load blocked mods config:', error);
        console.error('[ModrinthSearchV2] Error details:', error);
        // Set to true anyway so we can use the hardcoded test ID
        console.log('[ModrinthSearchV2] Setting blockedModsConfigLoaded to true anyway for hardcoded IDs');
        setBlockedModsConfigLoaded(true);
      }
    };
    loadBlockedModsConfig();
  }, []);

  // Define preferred loader order
  const preferredLoaderOrder = ['fabric', 'forge', 'quilt', 'neoforge'];

  const availableLoaders = useMemo(() => {
    const loaders = allLoadersData.filter(loader => loader.supported_project_types.includes(projectType));
    // Sort loaders: preferred first, then alphabetical
    return loaders.sort((a, b) => {
      const indexA = preferredLoaderOrder.indexOf(a.name.toLowerCase());
      const indexB = preferredLoaderOrder.indexOf(b.name.toLowerCase());

      if (indexA !== -1 && indexB !== -1) return indexA - indexB; // Both preferred
      if (indexA !== -1) return -1; // Only A is preferred
      if (indexB !== -1) return 1; // Only B is preferred
      return a.name.localeCompare(b.name); // Neither preferred, sort alphabetically
    });
  }, [allLoadersData, projectType]);

  const displayedGameVersions = useMemo(() => {
    let versions = gameVersionsData;
    // Inverted logic: Only filter for release if showAllGameVersionsSidebar is FALSE
    if (!showAllGameVersionsSidebar) { 
      versions = versions.filter(gv => gv.version_type === 'release'); 
    }
    if (gameVersionSearchTerm) { 
      versions = versions.filter(gv => gv.version.toLowerCase().includes(gameVersionSearchTerm.toLowerCase()));
    }
    return versions;
  }, [gameVersionsData, showAllGameVersionsSidebar, gameVersionSearchTerm]); // Use new state here

  // Dynamically generate filter groups based on headers for the current project type
  const dynamicFilterGroups = useMemo<UIDynamicFilterGroup[]>(() => {
    if (!allCategoriesData.length || !projectType) return [];

    const categoriesForProjectType = allCategoriesData.filter(cat => cat.project_type === projectType);
    const headers = [...new Set(categoriesForProjectType.map(cat => cat.header))];

    const groups = headers.map(header => {
      const optionsForHeader = categoriesForProjectType.filter(cat => cat.header === header);
      // Simple title generation: capitalize first letter, replace hyphens
      const accordionTitle = header.charAt(0).toUpperCase() + header.slice(1).replace(/-/g, ' ');
      return {
        accordionTitle,
        headerValue: header,
        options: optionsForHeader.sort((a, b) => a.name.localeCompare(b.name)), // Sort options alphabetically
      };
    });

    // Sort the groups themselves
    return groups.sort((a, b) => {
      const lowerA = a.headerValue.toLowerCase();
      const lowerB = b.headerValue.toLowerCase();
      const indexA = PREFERRED_HEADER_ORDER.indexOf(lowerA);
      const indexB = PREFERRED_HEADER_ORDER.indexOf(lowerB);

      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return a.accordionTitle.localeCompare(b.accordionTitle);
    });
  }, [allCategoriesData, projectType]);

  const performSearch = useCallback(async (newSearch = false) => {
    console.log('[ModrinthSearchV2] performSearch ENTRY:', {
      newSearch,
      projectType,
      searchTerm,
      categories: currentSelectedCategories,
      gameVersions: selectedGameVersions,
      loaders: currentSelectedLoaders,
      offset: newSearch ? 0 : offset // Log the offset that will be used
    });

    // Clear any existing timeout for the "No results found" message
    if (noResultsTimeoutRef.current) {
      clearTimeout(noResultsTimeoutRef.current);
      noResultsTimeoutRef.current = null;
    }
    setShowNoResultsMessage(false);

    if (newSearch) {
      console.log('[ModrinthSearchV2] New search, resetting offset.');
      setOffset(0);
      // setSearchResults([]); // DO NOT clear previous results here to prevent flicker
    }

    console.log('[ModrinthSearchV2] Proceeding with API call. Setting loading true.');
    setLoading(true);
    setError(null);

    // Determine game version for search
    let gameVersionForSearch = selectedGameVersions.length > 0 ? selectedGameVersions[0] : undefined;

    // CurseForge API requires gameVersion when using modLoaderType filter
    // Auto-set to latest release version if loader is selected but no version specified
    if (modSource === 'CurseForge' &&
        currentSelectedLoaders.length > 0 &&
        !gameVersionForSearch &&
        gameVersionsData.length > 0) {
      const latestRelease = gameVersionsData.find(v => v.version_type === 'release');
      if (latestRelease) {
        gameVersionForSearch = latestRelease.version;
        console.log('[ModrinthSearchV2] CurseForge: Auto-setting game version to', latestRelease.version, 'for loader filter to work');
      }
    }

    try {
      const response: UnifiedModSearchResponse = await UnifiedService.searchMods({
        query: searchTerm,
        source: modSource,
        project_type: convertToUnifiedProjectType(projectType),
        game_version: gameVersionForSearch,
        mod_loaders: currentSelectedLoaders.length > 0 ? currentSelectedLoaders : undefined,
        limit,
        offset: newSearch ? 0 : offset,
        sort: sortOrder as UnifiedSortType,
        categories: currentSelectedCategories.length > 0 ? currentSelectedCategories : undefined,
        client_side_filter: filterClientRequired ? "required" : undefined,
        server_side_filter: filterServerRequired ? "required" : undefined
      });
      setSearchResults(prevResults => newSearch ? response.results : [...prevResults, ...response.results]);
      setTotalHits(response.pagination.total_count);
      if (!newSearch) {
        setOffset(prevOffset => prevOffset + response.results.length);
      } else {
        setOffset(response.results.length);
      }
    } catch (err) {
      console.error("Failed to search Modrinth projects:", err);
      setError(`${err.message}`);
      if (newSearch) {
        setSearchResults([]);
        setTotalHits(0);
        setOffset(0);
      }
    } finally {
      setLoading(false);
      
      // Set up delayed "No results found" message only for new searches
      if (newSearch) {
        noResultsTimeoutRef.current = setTimeout(() => {
          setShowNoResultsMessage(true);
        }, 250); // Show message after 1.5 seconds
      }
    }
  }, [
    searchTerm, projectType, offset, limit, sortOrder, modSource,
    currentSelectedCategories, selectedGameVersions, currentSelectedLoaders,
    filterClientRequired, filterServerRequired,
    allCategoriesData, allLoadersData, gameVersionsData
  ]);

  const isInitialMount = useRef(true);
  const restoredScrollTop = useRef(searchResults.length > 0 ? scrollPosition : 0);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      if (searchResults.length > 0) {
        console.log('[ModrinthSearchV2] Restoring cached results from store, skipping initial fetch.');
        if (disableVirtualization && searchResultsAreaRef.current && scrollPosition > 0) {
          requestAnimationFrame(() => {
            if (searchResultsAreaRef.current) {
              searchResultsAreaRef.current.scrollTop = scrollPosition;
            }
          });
        }
        return;
      }
    }

    console.log('[ModrinthSearchV2] useEffect for search triggered. Calling performSearch(true). Params:', {
      searchTerm,
      projectType,
      modSource,
      categories: currentSelectedCategories,
      gameVersions: selectedGameVersions,
      loaders: currentSelectedLoaders
    });

    // Scroll to top when filters/search term changes
    if (searchResultsAreaRef.current) {
      searchResultsAreaRef.current.scrollTop = 0;
    }
    setScrollPosition(0);

    // Reset expanded versions when filter changes
    setExpandedVersions({});
    setNumDisplayedVersions({});
    setVersionFilters({});

    performSearch(true);
  }, [
    searchTerm, projectType, sortOrder, modSource,
    currentSelectedCategories, selectedGameVersions, currentSelectedLoaders,
    filterClientRequired, filterServerRequired
  ]);

  const handleProjectTypeChange = (newProjectType: ModrinthProjectType) => {
    setProjectType(newProjectType);
  };

  // Simplified handleCategoryToggle - all category groups are multi-select
  const handleCategoryToggle = (categoryName: string) => {
    const currentSelectionsForActiveType = selectedCategoriesByProjectType[projectType] || [];
    const wasPreviouslySelected = currentSelectionsForActiveType.includes(categoryName);

    setSelectedCategoriesByProjectType(prevGlobalSelections => {
      const updatedSelectionsForCurrentType = wasPreviouslySelected
        ? currentSelectionsForActiveType.filter(c => c !== categoryName)
        : [...currentSelectionsForActiveType, categoryName];
      
      const newGlobalSelections = { ...prevGlobalSelections, [projectType]: updatedSelectionsForCurrentType };

      // Synchronize with other project types
      const effectiveAllowedTypes = allowedProjectTypes || ALL_MODRINTH_PROJECT_TYPES;
      for (const otherPT of effectiveAllowedTypes) {
        if (otherPT === projectType) continue; // Skip the currently active type

        const selectionsForOtherPT = newGlobalSelections[otherPT] || [];
        
        if (wasPreviouslySelected) {
          // Category was REMOVED from the active project type
          // So, remove it from other project types as well if it was selected there
          if (selectionsForOtherPT.includes(categoryName)) {
            newGlobalSelections[otherPT] = selectionsForOtherPT.filter(c => c !== categoryName);
          }
        } else {
          // Category was ADDED to the active project type
          // Add it to other project types if the category is defined for them and not already present
          const categoryDefinitionForOtherPT = allCategoriesData.find(
            catDef => catDef.name === categoryName && catDef.project_type === otherPT
          );
          if (categoryDefinitionForOtherPT) {
            if (!selectionsForOtherPT.includes(categoryName)) {
              newGlobalSelections[otherPT] = [...selectionsForOtherPT, categoryName];
            }
          }
        }
      }
      return newGlobalSelections;
    });
  };

  const handleGameVersionToggle = (version: string) => {
    setSelectedGameVersions(prev =>
      prev.includes(version)
        ? prev.filter(v => v !== version)
        : [...prev, version]
    );
  };

  const handleLoaderToggle = (loaderName: string) => {
    const currentSelectionsForActiveType = selectedLoadersByProjectType[projectType] || [];
    const wasPreviouslySelected = currentSelectionsForActiveType.includes(loaderName);

    setSelectedLoadersByProjectType(prevGlobalSelections => {
      const updatedSelectionsForCurrentType = wasPreviouslySelected
        ? currentSelectionsForActiveType.filter(l => l !== loaderName)
        : [...currentSelectionsForActiveType, loaderName];
      
      const newGlobalSelections = { ...prevGlobalSelections, [projectType]: updatedSelectionsForCurrentType };

      // Synchronize with other project types
      const effectiveAllowedTypes = allowedProjectTypes || ALL_MODRINTH_PROJECT_TYPES;
      for (const otherPT of effectiveAllowedTypes) {
        if (otherPT === projectType) continue; // Skip the currently active type

        const selectionsForOtherPT = newGlobalSelections[otherPT] || [];
        const loaderDefinition = allLoadersData.find(ldrDef => ldrDef.name === loaderName);

        if (wasPreviouslySelected) {
          // Loader was REMOVED from the active project type
          // So, remove it from other project types as well if it was selected there
          if (selectionsForOtherPT.includes(loaderName)) {
            newGlobalSelections[otherPT] = selectionsForOtherPT.filter(l => l !== loaderName);
          }
        } else {
          // Loader was ADDED to the active project type
          // Add it to other supported project types if not already present
          if (loaderDefinition && loaderDefinition.supported_project_types.includes(otherPT)) {
            if (!selectionsForOtherPT.includes(loaderName)) {
              newGlobalSelections[otherPT] = [...selectionsForOtherPT, loaderName];
            }
          }
        }
      }
      return newGlobalSelections;
    });
  };
  
  const loadMoreResults = () => {
    if (!loading && searchResults.length < totalHits) {
      performSearch(false);
    }
  };

  const scrollSaveTimer = useRef<NodeJS.Timeout | null>(null);
  const handleScrollSave = useCallback(() => {
    if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
    scrollSaveTimer.current = setTimeout(() => {
      if (searchResultsAreaRef.current) {
        setScrollPosition(searchResultsAreaRef.current.scrollTop);
      }
    }, 150);
  }, [setScrollPosition]);

  // Functions to remove individual filter tags
  const removeGameVersionTag = (version: string) => handleGameVersionToggle(version);
  const removeLoaderTag = (loaderName: string) => handleLoaderToggle(loaderName);
  const removeCategoryTag = (categoryName: string) => handleCategoryToggle(categoryName);
  const removeClientRequiredTag = () => setFilterClientRequired(false);
  const removeServerRequiredTag = () => setFilterServerRequired(false);

  const clearAllFilters = () => {
    setSelectedGameVersions([]);
    setSelectedCategoriesByProjectType(prev => ({ ...prev, [projectType]: [] }));
    setSelectedLoadersByProjectType(prev => ({ ...prev, [projectType]: [] }));
    setGameVersionSearchTerm(''); 
    setShowAllGameVersionsSidebar(false); // Reset new state to false
    setFilterClientRequired(false); // Reset new filter
    setFilterServerRequired(false); // Reset new filter
  };

  const toggleProjectVersions = async (projectId: string) => {
    if (expandedVersions[projectId] === 'loading') return;

    if (expandedVersions[projectId]) { 
      setExpandedVersions(prev => ({ ...prev, [projectId]: null }));
      // Reset the display count when versions are hidden
      setNumDisplayedVersions(prev => {
        const newState = { ...prev };
        delete newState[projectId];
        return newState;
      });
      // Clear version filters for this project
      setVersionFilters(prev => {
        const newState = { ...prev };
        delete newState[projectId];
        return newState;
      });
      // Clear version dropdown UI state for this project
      setVersionDropdownUIState(prev => {
        const newState = { ...prev };
        delete newState[projectId];
        return newState;
      });
    } else { 
      await loadProjectVersions(projectId);
    }
  };

  const loadProjectVersions = async (projectId: string) => {
    setExpandedVersions(prev => ({ ...prev, [projectId]: 'loading' }));
    try {
      console.log(`Fetching versions for project: ${projectId}`);
      const response = await UnifiedService.getModVersions({
        source: modSource,
        project_id: projectId
      });
      
      // Add NoRisk status to each version
      const versionsWithNoRiskStatus = response.versions.map(version => {
        const primaryFile = version.files.find(file => file.primary) || version.files[0];
        const filename = primaryFile?.filename || '';
        const noRiskStatus = getModNoRiskStatus(filename, projectId, version.id);
        
        return {
          ...version,
          noRiskStatus // Add this property ('blocked' | 'warning' | null)
        };
      });
      
      const sortedVersions = versionsWithNoRiskStatus.sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime());

      setExpandedVersions(prev => ({ ...prev, [projectId]: sortedVersions }));
      // Initialize the number of displayed versions for this project
      setNumDisplayedVersions(prev => ({ ...prev, [projectId]: initialDisplayCount }));

      // Initialize version filters with main search selections
      setVersionFilters(prev => ({
        ...prev,
        [projectId]: {
          gameVersions: [...selectedGameVersions], // Start with main search selections
          loaders: [...currentSelectedLoaders],    // Start with main search selections
          versionType: 'all'  // Standardmäßig immer 'all' verwenden, nicht vom showReleaseGameVersionsOnly abhängig machen
        }
      }));

      // Initialize version dropdown UI state
      setVersionDropdownUIState(prev => ({
        ...prev,
        [projectId]: {
          showAllGameVersions: false, // Default to OFF
          gameVersionSearchTerm: '',
        }
      }));

      // No longer checking installation status for all versions here
    } catch (err) {
      console.error(`Failed to load versions for project ${projectId}:`, err);
      setExpandedVersions(prev => ({ ...prev, [projectId]: null }));
      setNumDisplayedVersions(prev => {
        const newState = { ...prev };
        delete newState[projectId];
        return newState;
      });
       // Clear version dropdown UI state on error too
      setVersionDropdownUIState(prev => {
        const newState = { ...prev };
        delete newState[projectId];
        return newState;
      });
    }
  };
  
  // Create a new function to check installation status for displayed versions only
  const checkDisplayedVersionsStatus = async (projectId: string, versions: UnifiedVersion[], startIndex: number, count: number, forceRefresh: string[] = []) => {
    if (!selectedProfile || !versions || versions.length === 0) return;
    
    const displayedVersions = versions.slice(startIndex, startIndex + count);
    if (displayedVersions.length === 0) return;
    
    console.log(`Checking installation status for ${displayedVersions.length} displayed versions of project ${projectId}`);
    
    try {
      // Create batch requests for all versions to check
      const requests: ContentCheckRequest[] = [];
      
      // First request for just the project to check NoRisk pack status
      requests.push({
        project_id: projectId,
        project_type: projectType,
        request_id: `project-${projectId}`
      });
      
      // Then requests for individual versions
      for (const version of displayedVersions) {
        // Skip versions we don't need to refresh
        if (installedVersions[selectedProfile.id]?.[version.id] && !forceRefresh.includes(version.id)) {
          continue;
        }
        
        const primaryFile = version.files.find(file => file.primary) || version.files[0];
        if (!primaryFile) continue;
        
        requests.push({
          project_id: projectId,
          version_id: version.id,
          file_hash_sha1: primaryFile.hashes?.sha1,
          file_name: primaryFile.filename,
          project_type: projectType,
          game_version: version.game_versions[0],
          loader: version.loaders[0],
          pack_version_number: version.version_number,
          request_id: version.id // Use version.id as request_id for mapping
        });
      }
      
      if (requests.length === 0) return;
      
      // Make the batch API call
      const batchResults = await ProfileService.batchCheckContentInstalled({
        profile_id: selectedProfile.id,
        requests
      });
      
      // Debug the entire response
      console.log("Batch check results:", batchResults);
      
      // Process the results
      const newInstalledState: Record<string, ContentInstallStatus | null> = 
        installedVersions[selectedProfile.id] || {};
      let projectInNoRiskStatus: ContentInstallStatus | null = null;
      
      batchResults.results.forEach(result => {
        if (result.request_id === `project-${projectId}`) {
          // This is the project-level check for NoRisk pack
          projectInNoRiskStatus = result.status;
        } else if (result.request_id) {
          // This is a version check
          newInstalledState[result.request_id] = {
            ...result.status,
            // If project is in NoRisk pack, set is_included_in_norisk_pack based on version match
            is_included_in_norisk_pack: 
              projectInNoRiskStatus?.is_included_in_norisk_pack && result.status.is_specific_version_in_pack
          };
        }
      });
      
      // For versions we skipped (already in cache), keep them in the state
      for (const version of displayedVersions) {
        if (!newInstalledState[version.id] && installedVersions[selectedProfile.id]?.[version.id]) {
          newInstalledState[version.id] = installedVersions[selectedProfile.id][version.id];
        }
      }
      
      if (Object.keys(newInstalledState).length > 0) {
        setInstalledVersions(prev => {
          const newState = { ...prev };
          if (!newState[selectedProfile.id]) {
            newState[selectedProfile.id] = {};
          }
          
          // Merge the newInstalledState into the profile's versions
          newState[selectedProfile.id] = { 
            ...newState[selectedProfile.id],
            ...newInstalledState 
          };
          
          return newState;
        });
      }
    } catch (error) {
      console.error(`Failed to batch check versions for project ${projectId}:`, error);
      
      // Fallback to original method if batch fails
      try {
        const projectInNoRiskStatus = await ProfileService.isContentInstalled({
          profile_id: selectedProfile.id,
          project_id: projectId,
          project_type: projectType
        });

        const newInstalledState: Record<string, ContentInstallStatus | null> = {};

        for (const version of displayedVersions) {
          try {
            // Skip versions we don't need to refresh
            if (installedVersions[selectedProfile.id]?.[version.id] && !forceRefresh.includes(version.id)) {
              newInstalledState[version.id] = installedVersions[selectedProfile.id][version.id];
              continue; 
            }
            
            const primaryFile = version.files.find(file => file.primary) || version.files[0];
            if (!primaryFile) {
              newInstalledState[version.id] = {
                is_installed: false,
                is_included_in_norisk_pack: false,
                is_specific_version_in_pack: false,
                is_enabled: null,
                found_item_details: null,
                norisk_pack_item_details: null,
              };
              continue;
            }
            
            const statusFromService = await ProfileService.isContentInstalled({
              profile_id: selectedProfile.id,
              project_id: projectId,
              version_id: version.id,
              file_hash_sha1: primaryFile.hashes?.sha1,
              project_type: projectType,
              game_version: version.game_versions[0],
              loader: version.loaders[0], 
              pack_version_number: version.version_number,
              file_name: primaryFile.filename
            });
            
            newInstalledState[version.id] = {
              is_installed: statusFromService.is_installed,
              is_included_in_norisk_pack: projectInNoRiskStatus.is_included_in_norisk_pack && statusFromService.is_specific_version_in_pack,
              is_specific_version_in_pack: statusFromService.is_specific_version_in_pack,
              is_enabled: statusFromService.is_enabled !== undefined ? statusFromService.is_enabled : null,
              found_item_details: statusFromService.found_item_details || null,
              norisk_pack_item_details: statusFromService.norisk_pack_item_details || null,
            };
          } catch (error) {
            console.error(`Failed to check status for version ${version.version_number}:`, error);
            newInstalledState[version.id] = {
              is_installed: false,
              is_included_in_norisk_pack: false,
              is_specific_version_in_pack: false,
              is_enabled: null,
              found_item_details: null,
              norisk_pack_item_details: null,
            };
          }
        }

        if (Object.keys(newInstalledState).length > 0) {
          setInstalledVersions(prev => {
            const newState = { ...prev };
            if (!newState[selectedProfile.id]) {
              newState[selectedProfile.id] = {};
            }
            
            // Merge the newInstalledState into the profile's versions
            newState[selectedProfile.id] = { 
              ...newState[selectedProfile.id],
              ...newInstalledState 
            };
            
            return newState;
          });
        }
      } catch (e) {
        console.error(`Failed to get project status for ${projectId}:`, e);
      }
    }
  };

  // Handler for version filter changes
  const handleVersionFilterChange = (projectId: string, filterType: 'gameVersions' | 'loaders' | 'versionType', value: string | string[]) => {
    setVersionFilters(prev => ({
      ...prev,
      [projectId]: {
        ...prev[projectId],
        [filterType]: value
      }
    }));
  };
  
  // Modified useEffect for version display - now checks status when versions are displayed
  useEffect(() => {
    // For each expanded project with a display count, check status of visible versions
    Object.entries(expandedVersions).forEach(([projectId, versions]) => {
      if (Array.isArray(versions) && versions.length > 0 && selectedProfile) {
        const displayCount = numDisplayedVersions[projectId] || initialDisplayCount;
        
        // Get filtered versions
        const filteredVersions = getFilteredVersions(projectId, versions);
        
        // Check status only for versions that will be displayed
        checkDisplayedVersionsStatus(projectId, filteredVersions, 0, displayCount);
      }
    });
  }, [expandedVersions, numDisplayedVersions, selectedProfile, versionFilters]);
  
  // Modify loadMoreProjectVersions to check installation status for newly displayed versions
  const loadMoreProjectVersions = (projectId: string) => {
    const currentDisplayCount = numDisplayedVersions[projectId] || initialDisplayCount;
    const newDisplayCount = currentDisplayCount + loadMoreIncrement;
    
    setNumDisplayedVersions(prev => ({
      ...prev,
      [projectId]: newDisplayCount,
    }));
    
    // Check status for newly visible versions
    const versions = expandedVersions[projectId];
    if (Array.isArray(versions) && selectedProfile) {
      const filteredVersions = getFilteredVersions(projectId, versions);
      checkDisplayedVersionsStatus(projectId, filteredVersions, currentDisplayCount, loadMoreIncrement);
    }
  };

  // Filter function for versions
  const getFilteredVersions = (projectId: string, versions: UnifiedVersion[]) => {
    if (!versionFilters[projectId]) return versions;
    
    const filters = versionFilters[projectId];
    
    return versions.filter(version => {
      // Filter by version type
      if (filters.versionType !== 'all' && version.release_type !== filters.versionType) {
        return false;
      }
      
      // Filter by game versions (if any selected)
      if (filters.gameVersions.length > 0) {
        const hasMatchingGameVersion = version.game_versions.some(gv => 
          filters.gameVersions.includes(gv)
        );
        if (!hasMatchingGameVersion) return false;
      }
      
      // Filter by loaders (if any selected)
      if (filters.loaders.length > 0) {
        const hasMatchingLoader = version.loaders.some(loader => 
          filters.loaders.includes(loader)
        );
        if (!hasMatchingLoader) return false;
      }
      
      return true;
    });
  };

  // Open install modal using global modal system
  const openInstallModal = async (project: UnifiedModSearchResult | any, version: UnifiedVersion) => {
    console.log('🚀 Opening install modal for:', project.title, version.version_number);
    setSelectedVersion(version);
    setSelectedProject(project);
    setCurrentInstallProject(project);
    setCurrentInstallVersion(version);
    setLoadingStatus(true);
    setInstallStatus({}); // Reset install status

    const modalId = `install-${project.project_id}-${version.id}`;

    try {
      const primaryFile = version.files.find(file => file.primary) || version.files[0];
      if (!primaryFile) {
        throw new Error("No primary file available for this version");
      }

      const statuses: Record<string, boolean> = {};
      // Initialize all statuses to false
      for (const profile of internalProfiles) {
        statuses[profile.id] = false;
      }

      // Perform individual checks for each profile
      for (const profile of internalProfiles) {
        try {
          const status = await ProfileService.isContentInstalled({
            profile_id: profile.id,
            project_id: project.project_id,
            version_id: version.id,
            project_type: project.project_type as ModrinthProjectType, // Cast to ensure compatibility
            game_version: version.game_versions[0], // Use first game version
            loader: version.loaders[0], // Use first loader
            file_hash_sha1: primaryFile.hashes?.sha1,
            pack_version_number: version.version_number, // Use actual version number for pack checks
            file_name: primaryFile.filename,
          });
          statuses[profile.id] = !!status.is_installed; // Ensure boolean
          console.log(`[openInstallModal] Profile ${profile.id} ('${profile.name}') status for ${project.title} v${version.version_number}: ${status.is_installed}`);
        } catch (e) {
          console.error(`[openInstallModal] Failed to check status for profile ${profile.id} ('${profile.name}'):`, e);
          statuses[profile.id] = false; // Default to false on error
        }
      }
      
      setInstallStatus(statuses);

      console.log('📊 Final install statuses for modal:', statuses);

      // Open the global modal with the universal profiles modal
      showModal(
        modalId,
        <ModrinthQuickInstallProfilesModal
          project={project}
          version={version}
          profiles={internalProfiles}
          onInstallToProfile={(profileId) => {
            console.log('🎯 Installing to profile:', profileId, 'project:', project.title, 'version:', version.version_number);
            installToProfile(profileId, project, version);
          }}
          onUninstallClick={async (profileId, project, version) => {
            console.log('🗑️ Uninstalling from profile:', profileId);
            await handleDeleteVersionFromProfile(profileId, project, version);
          }}
          onInstallToNewProfile={handleInstallToNewProfile}
          onProfileClick={(profile) => {
            console.log('🖱️ Navigating to profile:', profile.name);
            hideModal(modalId);
            navigate(`/profilesv2/${profile.id}`);
          }}
          onClose={() => {
            console.log('❌ Closing install modal');
            hideModal(modalId);
            setSelectedVersion(null);
            setSelectedProject(null);
            setCurrentInstallProject(null);
            setCurrentInstallVersion(null);
            setInstallStatus({});
            setUninstalling({});
          }}
          installingProfiles={installing}
          uninstallingProfiles={uninstalling}
          installStatus={installStatus}
        />,
        1200 // Higher z-index to ensure it's on top
      );

    } catch (error) {
      console.error("[openInstallModal] Failed to check installation status for modal:", error);
      // Fallback: Initialize all statuses to false if there's a general error (e.g., no primary file)
      const fallbackStatuses: Record<string, boolean> = {};
      internalProfiles.forEach(profile => {
        fallbackStatuses[profile.id] = false;
      });
      setInstallStatus(fallbackStatuses);

      // Still open the modal even if status check failed
      showModal(
        modalId,
        <ModrinthQuickInstallProfilesModal
          project={project}
          version={version}
          profiles={internalProfiles}
          onInstallToProfile={(profileId) => {
            console.log('🎯 Installing to profile:', profileId, 'project:', project.title, 'version:', version.version_number);
            installToProfile(profileId, project, version);
          }}
          onUninstallClick={async (profileId, project, version) => {
            console.log('🗑️ Uninstalling from profile:', profileId);
            await handleDeleteVersionFromProfile(profileId, project, version);
          }}
          onInstallToNewProfile={handleInstallToNewProfile}
          onProfileClick={(profile) => {
            console.log('🖱️ Navigating to profile:', profile.name);
            hideModal(modalId);
            navigate(`/profilesv2/${profile.id}`);
          }}
          onClose={() => {
            console.log('❌ Closing install modal');
            hideModal(modalId);
            setSelectedVersion(null);
            setSelectedProject(null);
            setCurrentInstallProject(null);
            setCurrentInstallVersion(null);
            setInstallStatus({});
            setUninstalling({});
          }}
          installingProfiles={installing}
          uninstallingProfiles={uninstalling}
          installStatus={installStatus}
        />,
        1200
      );
    } finally {
      setLoadingStatus(false);
    }
  };

  // Update the install modal when installation states change
  useEffect(() => {
    if (currentInstallProject && currentInstallVersion) {
      const modalId = `install-${currentInstallProject.project_id}-${currentInstallVersion.id}`;
      console.log('🔄 Updating install modal with new states:', { installing, uninstalling, installStatus });

      showModal(
        modalId,
        <ModrinthQuickInstallProfilesModal
          project={currentInstallProject}
          version={currentInstallVersion}
          profiles={internalProfiles}
          onInstallToProfile={(profileId) => {
            console.log('🎯 Installing to profile:', profileId, 'project:', currentInstallProject.title, 'version:', currentInstallVersion.version_number);
            installToProfile(profileId, currentInstallProject, currentInstallVersion);
          }}
          onUninstallClick={async (profileId, project, version) => {
            console.log('🗑️ Uninstalling from profile:', profileId);
            await handleDeleteVersionFromProfile(profileId, project, version);
          }}
          onInstallToNewProfile={handleInstallToNewProfile}
          onProfileClick={(profile) => {
            console.log('🖱️ Navigating to profile:', profile.name);
            hideModal(modalId);
            navigate(`/profilesv2/${profile.id}`);
          }}
          onClose={() => {
            console.log('❌ Closing install modal');
            hideModal(modalId);
            setSelectedVersion(null);
            setSelectedProject(null);
            setCurrentInstallProject(null);
            setCurrentInstallVersion(null);
            setInstallStatus({});
            setUninstalling({});
          }}
          installingProfiles={installing}
          uninstallingProfiles={uninstalling}
          installStatus={installStatus}
        />,
        1200
      );
    }
  }, [installing, uninstalling, installStatus, currentInstallProject, currentInstallVersion]);

  // Check installation status when profiles change
  useEffect(() => {
    if (currentInstallProject && currentInstallVersion && internalProfiles.length > 0) {
      console.log('🔍 Re-checking installation status for profiles change');
      // We could add a function to check status here if needed
    }
  }, [internalProfiles, currentInstallProject, currentInstallVersion]);

  // Removed closeInstallModal - now handled by global modal system

  // Install mod to selected profile
  const installToProfile = async (profileId: string, project?: UnifiedModSearchResult | any, version?: UnifiedVersion) => {
    // Use provided parameters or fall back to global state
    const targetProject = project || selectedProject;
    const targetVersion = version || selectedVersion;

    if (!targetVersion || !targetProject) {
      console.error('❌ Missing required installation information:', { targetProject, targetVersion });
      toast.error(t('content.install.missing_info'));
      return;
    }

    setInstalling(prev => ({ ...prev, [profileId]: true }));

    try {
      const primaryFile = targetVersion.files.find(file => file.primary) || targetVersion.files[0];
      if (!primaryFile) {
        toast.error(t('content.install.no_file'));
        setInstalling(prev => ({ ...prev, [profileId]: false }));
        return;
      }

      const mappedContentType = mapUnifiedProjectTypeToNrContentType(targetProject.project_type);
      if (!mappedContentType) {
        setInstalling(prev => ({ ...prev, [profileId]: false }));
        return;
      }
      
      // Special handling for modpacks: should not reach here if mapUnifiedProjectTypeToNrContentType works correctly
      if (targetProject.project_type === 'modpack') {
        toast.error(t('content.install.modpack_as_profile'));
        setInstalling(prev => ({ ...prev, [profileId]: false }));
        return;
      }

      const payload: InstallContentPayload = {
        profile_id: profileId,
        project_id: targetProject.project_id,
        version_id: targetVersion.id,
        file_name: primaryFile.filename,
        download_url: primaryFile.url,
        file_hash_sha1: primaryFile.hashes?.sha1 || undefined,
        file_fingerprint: undefined, // Modrinth doesn't use fingerprints
        content_name: targetProject.title,
        version_number: targetVersion.version_number,
        content_type: mappedContentType,
        loaders: targetVersion.loaders,
        game_versions: targetVersion.game_versions,
        source: targetProject.source,
      };

      await installContentToProfile(payload);

      toast.success(t('content.install.success', { title: targetProject.title, version: targetVersion.version_number, profile: internalProfiles.find(p => p.id === profileId)?.name || 'profile' }));

      // Check for Iris shader mod if a shader pack was installed
      if (targetProject.project_type === 'shader') {
        await handleIrisCheckAndShowModal(
          targetProject.title,
          profileId,
          targetProject.project_id,
          "Installation",
          showModal,
          hideModal,
          () => {
            // TODO: Implement Iris installation logic
            console.log('🎯 User clicked "Install Iris Now"');
          }
        );
      }

      setInstallStatus(prev => ({ ...prev, [profileId]: true }));
      
      setInstalledProjects(prev => ({
        ...prev,
        [targetProject.project_id]: getStatusForNewInstall(prev[targetProject.project_id])
      }));

      // Fix für den TypeScript-Fehler: Verwende die korrekte verschachtelte Struktur
      setInstalledVersions(prev => {
        const newState = { ...prev };
        const currentProfileId = profileId;

        if (!newState[currentProfileId]) {
          newState[currentProfileId] = {};
        }

        newState[currentProfileId][targetVersion.id] = getStatusForNewInstall(
          newState[currentProfileId][targetVersion.id]
        );

        return newState;
      });

      justInstalledOrToggledRef.current = true; // Set flag
      if (onInstallSuccess) {
        onInstallSuccess();
      }
      
    } catch (error) {
      toast.error(t('content.install.failed', { error: error instanceof Error ? error.message : String(error) }));
      console.error("Install error in installToProfile:", error);
    } finally {
      setInstalling(prev => ({ ...prev, [profileId]: false }));
    }
  };

  // New function to install directly to the selected profile without opening a modal
  const handleDirectInstall = async (project: UnifiedModSearchResult | any, version: UnifiedVersion) => {
    if (!selectedProfile) {
      // Open the install modal instead of showing an error
      openInstallModal(project, version);
      return;
    }

    const profileId = selectedProfile.id;
    const profileName = selectedProfile.name;

    setInstallingVersion(prev => ({ ...prev, [version.id]: true }));

    try {
      // Get primary file
      const primaryFile = version.files.find(f => f.primary) || version.files[0];
      if (!primaryFile) {
        toast.error(t('content.install.no_primary_file', { title: project.title }));
        setInstallingVersion(prev => ({ ...prev, [version.id]: false }));
        return;
      }

      // Check content type
      const mappedContentType = mapUnifiedProjectTypeToNrContentType(project.project_type);
      if (!mappedContentType) {
        setInstallingVersion(prev => ({ ...prev, [version.id]: false }));
        return;
      }

      // Special handling for modpacks
      if (project.project_type === 'modpack') {
        toast.error(t('content.install.modpack_as_profile'));
        setInstallingVersion(prev => ({ ...prev, [version.id]: false }));
        return;
      }

      // Proceed with installation using the unified generic function
      const payload: InstallContentPayload = {
        profile_id: profileId,
        project_id: project.project_id,
        version_id: version.id,
        file_name: primaryFile.filename,
        download_url: primaryFile.url,
        file_hash_sha1: primaryFile.hashes?.sha1 || undefined,
        file_fingerprint: primaryFile.fingerprint || undefined,
        content_name: project.title,
        version_number: version.version_number,
        content_type: mappedContentType,
        loaders: version.loaders,
        game_versions: version.game_versions,
        source: project.source,
      };

      await toast.promise(
        installContentToProfile(payload),
        {
          loading: `Installing ${project.title} (${version.version_number}) to ${profileName}...`,
          success: t('content.install.success', { title: project.title, version: version.version_number, profile: profileName }),
          error: (err) => t('content.install.failed', { error: err.message || String(err) }),
        }
      );

      // Check for Iris shader mod if a shader pack was installed
      if (project.project_type === 'shader') {
        await handleIrisCheckAndShowModal(
          project.title,
          profileId,
          project.project_id,
          "Direct install",
          showModal,
          hideModal,
          () => {
            // TODO: Implement Iris installation logic
            console.log('🎯 User clicked "Install Iris Now"');
          }
        );
      }

      // Update installation status
      setInstalledProjects(prev => ({
        ...prev,
        [project.project_id]: getStatusForNewInstall(prev[project.project_id])
      }));

      setInstalledVersions(prev => {
        const newState = { ...prev };
        if (!newState[profileId]) newState[profileId] = {};
        newState[profileId][version.id] = getStatusForNewInstall(
          newState[profileId][version.id]
        );
        return newState;
      });

      justInstalledOrToggledRef.current = true;

      if (onInstallSuccess) onInstallSuccess();

    } catch (error) {
      console.error(`Direct install failed for ${project.title}:`, error);
      toast.error(t('content.install.failed', { error: project.title }));
    } finally {
      // Reset loading state for the version
      setInstallingVersion(prev => ({ ...prev, [version.id]: false }));
    }
  };

  // Find the selected profile when the component mounts or selectedProfileId changes
  useEffect(() => {
    if (selectedProfileId && internalProfiles.length > 0) {
      const profile = internalProfiles.find(p => p.id === selectedProfileId);
      if (profile) {
        setSelectedProfile(profile);
      }
    } else if (selectedProfileId === '') {
      // Explicit empty selection - set to null
      setSelectedProfile(null);
    } else if (internalProfiles.length > 0 && !selectedProfile && selectedProfileId !== '' && selectedProfileId !== undefined) {
      // Auto-select first profile ONLY if:
      // - We have profiles
      // - No profile is currently selected
      // - No empty selection was requested (selectedProfileId !== '')
      // - selectedProfileId is not undefined (meaning it was explicitly passed as a prop)
      setSelectedProfile(internalProfiles[0]);
    }
  }, [selectedProfileId, internalProfiles, selectedProfile]);

  // Reset profile selection if explicit empty option was requested
  useEffect(() => {
    if (selectedProfileId === '') {
      setSelectedProfile(null);
      // Reset filters related to profile
      setSelectedGameVersions([]);
      setSelectedLoadersByProjectType(prev => ({
        ...prev,
        [projectType]: []
      }));
    }
  }, [selectedProfileId, projectType]);

  // Apply profile filters when selected profile changes - only set relevant filters based on project type
  useEffect(() => {
    if (selectedProfile) {
      // Set game version filter from profile - applicable to all project types
      if (selectedProfile.game_version) {
        setSelectedGameVersions([selectedProfile.game_version]);
      }
      
      // Set loader filter from profile - only for project types that use loaders
      if (selectedProfile.loader && ['mod', 'modpack'].includes(projectType)) {
        setSelectedLoadersByProjectType(prev => ({
          ...prev,
          [projectType]: [selectedProfile.loader]
        }));
      }
    }
  }, [selectedProfile, projectType]);

  // New state for quick install modal
  const [quickInstallModalOpen, setQuickInstallModalOpen] = useState(false);
  const [quickInstallProject, setQuickInstallProject] = useState<UnifiedModSearchResult | any | null>(null);
  const [quickInstallVersions, setQuickInstallVersions] = useState<any[] | null>(null); // Changed to any[] to handle UnifiedVersion
  const [quickInstallLoading, setQuickInstallLoading] = useState(false); // Loading for fetching versions for modal
  const [quickInstallError, setQuickInstallError] = useState<string | null>(null);
  const [quickInstallingProjects, setQuickInstallingProjects] = useState<Record<string, boolean>>({}); // New state for card button loading
  const [installingModpackAsProfile, setInstallingModpackAsProfile] = useState<Record<string, boolean>>({}); // New state for modpack install loading
  const [installingVersion, setInstallingVersion] = useState<Record<string, boolean>>({}); // New state for specific version install loading
  const [installingModpackVersion, setInstallingModpackVersion] = useState<Record<string, boolean>>({}); // New state for modpack version install loading

  // Helper function to map Unified project type to our ContentType enum
  function mapUnifiedProjectTypeToNrContentType(projectType: string): NrContentType | null {
    switch (projectType) {
      case 'mod':
      case UnifiedProjectType.Mod:
        return NrContentType.Mod;
      case 'resourcepack':
      case UnifiedProjectType.ResourcePack:
        return NrContentType.ResourcePack;
      case 'shader':
      case UnifiedProjectType.Shader:
        return NrContentType.ShaderPack;
      case 'datapack':
      case UnifiedProjectType.Datapack:
        return NrContentType.DataPack;
      case 'modpack':
      case UnifiedProjectType.Modpack: // Modpacks are handled by creating a new profile
        toast.error(t('content.install.modpack_as_profile'));
        return null;
      default:
        // Log unhandled project types if any, but avoid throwing error that breaks UI
        console.warn(`Unsupported project type for direct installation: ${projectType}`);
        toast.error(t('content.install.unsupported_type', { type: projectType }));
        return null;
    }
  }

  // Find the best version for a profile
  const findBestVersionForProfile = (profile: Profile, versions: UnifiedVersion[]): UnifiedVersion | null => {
    if (!profile || !versions || versions.length === 0) return null;
    
    // First try: find a version matching both game version and loader
    if (profile.game_version && profile.loader) {
      const exactMatch = versions.find(v => 
        v.game_versions.includes(profile.game_version) && 
        v.loaders.includes(profile.loader)
      );
      if (exactMatch) return exactMatch;
    }
    
    // Second try: match just game version (for resourcepacks, datapacks, etc.)
    if (profile.game_version) {
      const gameVersionMatch = versions.find(v => 
        v.game_versions.includes(profile.game_version)
      );
      if (gameVersionMatch) return gameVersionMatch;
    }
    
    // Last resort: just return the latest version
    return versions[0];
  };

  // State to track the currently opened quick install project
  const [currentQuickInstallProject, setCurrentQuickInstallProject] = useState<UnifiedModSearchResult | any | null>(null);

  // Function to handle quick install - shows profile selection modal using global modal
  const quickInstall = async (project: UnifiedModSearchResult | any) => {
    const modalId = `quick-install-${project.project_id}`;
    setCurrentQuickInstallProject(project);

    // Check installation status for all profiles when opening modal
    console.log('🚀 Opening quick install modal for:', project.title);
    await checkInstallationStatusForModal(project, internalProfiles);

    console.log('📊 Current installStatus before modal:', installStatus);

    showModal(
      modalId,
      <ModrinthQuickInstallProfilesModal
        project={project}
        profiles={internalProfiles}
        onProfileSelect={handleProfileSelectionForQuickInstall}
        onInstallToNewProfile={handleInstallToNewProfile}
        onProfileClick={(profile) => {
          // Close modal first, then navigate to profile page
          console.log('🖱️ Profile clicked for navigation:', profile.name);
          hideModal(modalId);
          setCurrentQuickInstallProject(null);
          navigate(`/profilesv2/${profile.id}`);
        }}
        onClose={() => {
          console.log('❌ Modal closed');
          hideModal(modalId);
          setCurrentQuickInstallProject(null);
        }}
        installingProfiles={installing}
        installStatus={installStatus}
      />,
      1200 // Higher z-index to ensure it's on top
    );
  };

  // Function to handle direct quick install for BrowseTab context - no modal
  const handleDirectQuickInstall = async (project: UnifiedModSearchResult | any) => {
    console.log('🚀 Direct quick install for:', project.title);

    if (!selectedProfile) {
      console.error('❌ No selected profile for direct install');
      toast.error(t('content.install.no_profile_selected'));
      return;
    }

    // Set loading state for the project
    setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: true }));

    try {
      // Fetch versions for this project
      const response = await UnifiedService.getModVersions({
        source: project.source,
        project_id: project.project_id
      });
      if (!response.versions || response.versions.length === 0) {
        toast.error(t('content.install.no_versions', { title: project.title }));
        setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
        return;
      }

      // Find best version for selected profile
      const sortedVersions = response.versions.sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime());
      const bestVersion = findBestVersionForProfile(selectedProfile, sortedVersions);

      if (!bestVersion) {
        toast.error(t('content.install.no_compatible_version', { title: project.title, profile: selectedProfile.name }));
        setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
        return;
      }

      // Get primary file
      const primaryFile = bestVersion.files.find(f => f.primary) || bestVersion.files[0];
      if (!primaryFile) {
        toast.error(t('content.install.no_primary_file', { title: project.title }));
        setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
        return;
      }

      // Check content type
      const mappedContentType = mapUnifiedProjectTypeToNrContentType(project.project_type);
      if (!mappedContentType) {
        setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
        return;
      }

      // Special handling for modpacks
      if (project.project_type === 'modpack') {
        toast.error(t('content.install.modpack_as_profile'));
        setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
        return;
      }

      // Proceed with installation using the same logic as handleProfileSelectionForQuickInstall
      const payload: InstallContentPayload = {
        profile_id: selectedProfile.id,
        project_id: project.project_id,
        version_id: bestVersion.id,
        file_name: primaryFile.filename,
        download_url: primaryFile.url,
        file_hash_sha1: primaryFile.hashes?.sha1 || undefined,
        file_fingerprint: undefined, // Modrinth doesn't use fingerprints
        content_name: project.title,
        version_number: bestVersion.version_number,
        content_type: mappedContentType,
        loaders: bestVersion.loaders,
        game_versions: bestVersion.game_versions,
        source: project.source,
        };

        await toast.promise(
        installContentToProfile(payload),
        {
          loading: `Installing ${project.title} (${bestVersion.version_number}) to ${selectedProfile.name}...`,
          success: t('content.install.success', { title: project.title, version: bestVersion.version_number, profile: selectedProfile.name }),
          error: (err) => t('content.install.failed', { error: err.message || String(err) }),
        }
      );

      // Update installation status
      setInstalledProjects(prev => ({
        ...prev,
        [project.project_id]: getStatusForNewInstall(prev[project.project_id])
      }));

      setInstalledVersions(prev => {
        const newState = { ...prev };
        if (!newState[selectedProfile.id]) newState[selectedProfile.id] = {};
        newState[selectedProfile.id][bestVersion.id] = getStatusForNewInstall(
          newState[selectedProfile.id][bestVersion.id]
        );
        return newState;
      });

      justInstalledOrToggledRef.current = true;

      // Check for Iris shader mod if a shader pack was installed
      if (project.project_type === 'shader') {
        await handleIrisCheckAndShowModal(
          project.title,
          selectedProfile.id,
          project.project_id,
          "Direct install",
          showModal,
          hideModal,
          () => {
            // TODO: Implement Iris installation logic
            console.log('🎯 User clicked "Install Iris Now"');
          }
        );
      }

      if (onInstallSuccess) onInstallSuccess();

    } catch (error) {
      console.error(`Quick install failed for ${project.title}:`, error);
      toast.error(t('content.install.failed', { error: project.title }));
    } finally {
      // Reset loading state for the project
      setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
    }
  };

  // Check installation status for all profiles when opening modal
  const checkInstallationStatusForModal = async (project: UnifiedModSearchResult | any, profiles: Profile[]) => {
    console.log('🔍 Checking installation status for modal:', project.title, profiles.length, 'profiles');

    if (profiles.length === 0) {
      console.log('❌ No profiles to check');
      return;
    }

    const newInstallStatuses: Record<string, boolean> = {};

    // Initialize all profiles as false first
    profiles.forEach(profile => {
      newInstallStatuses[profile.id] = false;
    });

    try {
      // Check each profile individually for better error handling
      for (const profile of profiles) {
        try {
          console.log(`🔍 Checking profile: ${profile.name} (${profile.id})`);

          const status = await ProfileService.isContentInstalled({
            profile_id: profile.id,
            project_id: project.project_id,
            project_type: project.project_type
          });

          const isInstalled = !!status?.is_installed;
          newInstallStatuses[profile.id] = isInstalled;

          console.log(`✅ Profile ${profile.name}: ${isInstalled ? 'INSTALLED' : 'NOT INSTALLED'}`);
        } catch (error) {
          console.error(`❌ Failed to check profile ${profile.name}:`, error);
          newInstallStatuses[profile.id] = false;
        }
      }

      console.log('📊 Final install statuses:', newInstallStatuses);
      setInstallStatus(newInstallStatuses);
    } catch (error) {
      console.error('❌ Failed to check installation status for modal:', error);
      setInstallStatus(newInstallStatuses); // Keep the initialized false values
    }
  };

  // Update the modal when installation states change
  useEffect(() => {
    // Check if there's an open quick install modal
    if (currentQuickInstallProject) {
      const modalId = `quick-install-${currentQuickInstallProject.project_id}`;
      // Re-open the modal with updated states
      showModal(
        modalId,
        <ModrinthQuickInstallProfilesModal
          project={currentQuickInstallProject}
          profiles={internalProfiles}
          onProfileSelect={handleProfileSelectionForQuickInstall}
          onInstallToNewProfile={handleInstallToNewProfile}
          onProfileClick={(profile) => {
            // Close modal first, then navigate to profile page
            hideModal(modalId);
            setCurrentQuickInstallProject(null);
            navigate(`/profilesv2/${profile.id}`);
          }}
          onClose={() => {
            hideModal(modalId);
            setCurrentQuickInstallProject(null);
          }}
          installingProfiles={installing}
          uninstallingProfiles={uninstalling}
          installStatus={installStatus}
        />,
        1200
      );
    }
  }, [installing, uninstalling, installStatus, currentQuickInstallProject]);

  // Re-check installation status when profiles change
  useEffect(() => {
    if (currentQuickInstallProject && internalProfiles.length > 0) {
      checkInstallationStatusForModal(currentQuickInstallProject, internalProfiles);
    }
  }, [internalProfiles]);

  // Handle profile selection and proceed with installation
  const handleProfileSelectionForQuickInstall = async (project: UnifiedModSearchResult | any, profile: Profile) => {
    // Don't close the modal - let it stay open so user can install to multiple profiles
    // Set loading state for the profile being installed
    setInstalling(prev => ({ ...prev, [profile.id]: true }));

    try {
      // Fetch versions for this project
      const response = await UnifiedService.getModVersions({
        source: project.source,
        project_id: project.project_id
      });
      if (!response.versions || response.versions.length === 0) {
        toast.error(t('content.install.no_versions', { title: project.title }));
        setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
        return;
      }

      // Find best version for selected profile
      const sortedVersions = response.versions.sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime());
      const bestVersion = findBestVersionForProfile(profile, sortedVersions);

      if (!bestVersion) {
        toast.error(t('content.install.no_compatible_version', { title: project.title, profile: profile.name }));
        setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
        return;
      }

      // Get primary file
      const primaryFile = bestVersion.files.find(f => f.primary) || bestVersion.files[0];
      if (!primaryFile) {
        toast.error(t('content.install.no_primary_file', { title: project.title }));
        setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
        return;
      }

      // Check content type
      const mappedContentType = mapUnifiedProjectTypeToNrContentType(project.project_type);
      if (!mappedContentType) {
        setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
        return;
      }

      // Special handling for modpacks
      if (project.project_type === 'modpack') {
        toast.error(t('content.install.modpack_as_profile'));
        setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
        return;
      }

      // Proceed with installation
      const payload: InstallContentPayload = {
        profile_id: profile.id,
        project_id: project.project_id,
        version_id: bestVersion.id,
        file_name: primaryFile.filename,
        download_url: primaryFile.url,
        file_hash_sha1: primaryFile.hashes?.sha1 || undefined,
        file_fingerprint: undefined, // Modrinth doesn't use fingerprints
        content_name: project.title,
        version_number: bestVersion.version_number,
        content_type: mappedContentType,
        loaders: bestVersion.loaders,
        game_versions: bestVersion.game_versions,
        source: project.source,
        };

        await toast.promise(
        installContentToProfile(payload),
        {
          loading: `Installing ${project.title} (${bestVersion.version_number}) to ${profile.name}...`,
          success: t('content.install.success', { title: project.title, version: bestVersion.version_number, profile: profile.name }),
          error: (err) => t('content.install.failed', { error: err.message || String(err) }),
        }
      );

      // Check for Iris shader mod if a shader pack was installed
      if (project.project_type === 'shader') {
        await handleIrisCheckAndShowModal(
          project.title,
          profile.id,
          project.project_id,
          "Quick install",
          showModal,
          hideModal,
          () => {
            // TODO: Implement Iris installation logic
            console.log('🎯 User clicked "Install Iris Now"');
          }
        );
      }

      // Update installation status
      setInstalledProjects(prev => ({
        ...prev,
        [project.project_id]: getStatusForNewInstall(prev[project.project_id])
      }));

      setInstalledVersions(prev => {
        const newState = { ...prev };
        if (!newState[profile.id]) newState[profile.id] = {};
        newState[profile.id][bestVersion.id] = getStatusForNewInstall(
          newState[profile.id][bestVersion.id]
        );
        return newState;
      });

      justInstalledOrToggledRef.current = true;

      // Set install status to true for successful installation
      setInstallStatus(prev => ({ ...prev, [profile.id]: true }));

      if (onInstallSuccess) onInstallSuccess();

    } catch (error) {
      console.error(`Quick install failed for ${project.title}:`, error);
      toast.error(t('content.install.failed', { error: project.title }));
    } finally {
      // Reset loading state for the profile
      setInstalling(prev => ({ ...prev, [profile.id]: false }));
    }
  };

  // Close quick install modal
  const closeQuickInstallModal = () => {
    setQuickInstallModalOpen(false);
    setQuickInstallProject(null);
    setQuickInstallVersions(null);
    setInstallStatus({});
    setInstalling({});
  };

  // Install mod to selected profile via quick install
  const quickInstallToProfile = async (profileId: string) => {
    if (!quickInstallProject || !quickInstallVersions) {
      toast.error(t('content.install.missing_info'));
      return;
    }

    const profile = internalProfiles.find(p => p.id === profileId);
    if (!profile) {
      toast.error(t('content.install.profile_not_found'));
      return;
    }

    const bestVersion = findBestVersionForProfile(profile, quickInstallVersions);
    if (!bestVersion) {
      toast.error(t('content.install.no_compatible_version', { title: quickInstallProject.title, profile: profile.name }));
      return;
    }

    setInstalling(prev => ({ ...prev, [profileId]: true }));

    try {
      const primaryFile = bestVersion.files.find(file => file.primary) || bestVersion.files[0];
      if (!primaryFile) {
        toast.error(t('content.install.no_file'));
        setInstalling(prev => ({ ...prev, [profileId]: false }));
        return;
      }

      const mappedContentType = mapUnifiedProjectTypeToNrContentType(quickInstallProject.project_type);
      if (!mappedContentType) {
        setInstalling(prev => ({ ...prev, [profileId]: false }));
        return;
      }

      if (quickInstallProject.project_type === 'modpack') {
          toast.error(t('content.install.modpack_as_profile'));
          setInstalling(prev => ({ ...prev, [profileId]: false }));
          return;
      }

      const payload: InstallContentPayload = {
        profile_id: profileId, // Use the passed profileId
        project_id: quickInstallProject.project_id,
        version_id: bestVersion.id,
        file_name: primaryFile.filename,
        download_url: primaryFile.url,
        file_hash_sha1: primaryFile.hashes?.sha1 || undefined,
        file_fingerprint: undefined, // Modrinth doesn't use fingerprints
        content_name: quickInstallProject.title,
        version_number: bestVersion.version_number,
        content_type: mappedContentType,
        loaders: bestVersion.loaders,
        game_versions: bestVersion.game_versions,
        source: quickInstallProject.source,
      };

      await installContentToProfile(payload);

      toast.success(t('content.install.success', { title: quickInstallProject.title, version: bestVersion.version_number, profile: profile.name }));

      // Check for Iris shader mod if a shader pack was installed
      if (quickInstallProject.project_type === 'shader') {
        await handleIrisCheckAndShowModal(
          quickInstallProject.title,
          profileId,
          quickInstallProject.project_id,
          "Quick install to profile",
          showModal,
          hideModal,
          () => {
            // TODO: Implement Iris installation logic
            console.log('🎯 User clicked "Install Iris Now"');
          }
        );
      }

      setInstallStatus(prev => ({ ...prev, [profileId]: true }));
      
      // Update installedProjects state only if this profile is the currently selected one in the main view
      if (selectedProfile && selectedProfile.id === profileId) {
        setInstalledProjects(prev => ({
          ...prev,
          [quickInstallProject.project_id]: getStatusForNewInstall(prev[quickInstallProject.project_id])
        }));
      }
      
      // Update installedVersions state for the specific profileId
      setInstalledVersions(prev => {
        const newState = { ...prev };
        if (!newState[profileId]) { // Use profileId
          newState[profileId] = {};   // Use profileId
        }
        
        newState[profileId][bestVersion.id] = getStatusForNewInstall( // Use profileId
          newState[profileId][bestVersion.id] // Use profileId
        );
        
        return newState;
      });

      justInstalledOrToggledRef.current = true; 
      if (onInstallSuccess) {
        onInstallSuccess();
      }
      
    } catch (error) {
      toast.error(t('content.install.failed', { error: error instanceof Error ? error.message : String(error) }));
      console.error("Install error in quickInstallToProfile:", error);
    } finally {
      setInstalling(prev => ({ ...prev, [profileId]: false }));
    }
  };

  // Check installation status for all displayed projects when profile changes
  useEffect(() => {
    const checkInstallationStatus = async () => {
      if (!selectedProfile || !searchResults.length) {
        setInstalledProjects({});
        return;
      }
      if (justInstalledOrToggledRef.current) { // Check flag
        justInstalledOrToggledRef.current = false; // Reset flag
        return;
      }

      // Create batch request for all projects
      const requests: ContentCheckRequest[] = searchResults.map(project => ({
        project_id: project.project_id,
        project_type: project.project_type,
        request_id: project.project_id // Use project_id as request_id for mapping
      }));

      try {
        // Use batch check instead of individual checks
        const batchResults = await ProfileService.batchCheckContentInstalled({
          profile_id: selectedProfile.id,
          requests
        });

        // Process results into the same state format
        const newInstalledState: Record<string, ContentInstallStatus | null> = {};
        
        batchResults.results.forEach(result => {
          if (result.request_id) {
            newInstalledState[result.request_id] = result.status;
          }
        });

        setInstalledProjects(newInstalledState);
      } catch (error) {
        console.error('Failed to batch check installation status:', error);
        
        // Fallback to individual checks if batch fails
        const newInstalledState: Record<string, ContentInstallStatus | null> = {};
        for (const project of searchResults) {
          try {
            const status = await ProfileService.isContentInstalled({
              profile_id: selectedProfile.id,
              project_id: project.project_id,
              project_type: project.project_type
            });
            newInstalledState[project.project_id] = status;
          } catch (error) {
            console.error(`Failed to check status for ${project.title}:`, error);
            newInstalledState[project.project_id] = { ...defaultErrorContentStatus };
          }
        }
        setInstalledProjects(newInstalledState);
      }
    };

    checkInstallationStatus();
  }, [selectedProfile, searchResults]);

  // Check installation status when loading more results
  useEffect(() => {
    const checkNewResultsInstallation = async () => {
      if (!selectedProfile || !searchResults.length) return;

      if (justInstalledOrToggledRef.current) { // Check flag
        justInstalledOrToggledRef.current = false; // Reset flag
        return;
      }

      // Find projects that haven't been checked yet
      const uncheckedProjects = searchResults.filter(project => 
        !installedProjects[project.project_id]
      );

      if (uncheckedProjects.length === 0) return;

      try {
        // Create requests for unchecked projects
        const requests: ContentCheckRequest[] = uncheckedProjects.map(project => ({
          project_id: project.project_id,
          project_type: project.project_type,
          request_id: project.project_id
        }));

        // Use batch check for unchecked projects
        const batchResults = await ProfileService.batchCheckContentInstalled({
          profile_id: selectedProfile.id,
          requests
        });

        // Add results to existing state
        const newInstalledState = {...installedProjects};
        batchResults.results.forEach(result => {
          if (result.request_id) {
            newInstalledState[result.request_id] = result.status;
          }
        });

        setInstalledProjects(newInstalledState);
      } catch (error) {
        console.error('Failed to batch check new results installation status:', error);
        
        // Fallback to individual checks
        const newInstalledState = {...installedProjects};
        for (const project of uncheckedProjects) {
          try {
            const status = await ProfileService.isContentInstalled({
              profile_id: selectedProfile.id,
              project_id: project.project_id,
              project_type: project.project_type
            });
            newInstalledState[project.project_id] = status;
          } catch (error) {
            console.error(`Failed to check status for ${project.title}:`, error);
            newInstalledState[project.project_id] = { ...defaultErrorContentStatus };
          }
        }
        
        if (uncheckedProjects.length > 0) {
          setInstalledProjects(newInstalledState);
        }
      }
    };

    checkNewResultsInstallation();
  }, [searchResults.length, selectedProfile, installedProjects]);

  // Reset project-level installation status when no profile is selected.
  // Version statuses in `installedVersions` are kept as a cache.
  useEffect(() => {
    if (!selectedProfile) {
      console.log("No profile selected - resetting project installation status");
      setInstalledProjects({});
      // NOTE: setInstalledVersions({}); is intentionally removed here to persist version status cache.
    }
  }, [selectedProfile]);

  // Additional check when project type changes to update project-level installation status
  useEffect(() => {
    if (selectedProfile) {
      // Reset project-level installation status when project type changes, as it's view-specific
      setInstalledProjects({});
    }
  }, [projectType, selectedProfile]);

  // Cleanup timeout on component unmount
  useEffect(() => {
    return () => {
      if (noResultsTimeoutRef.current) {
        clearTimeout(noResultsTimeoutRef.current);
      }
    };
  }, []);

  const accentColor = useThemeStore((state) => state.accentColor); // Get accent color
  const [hoveredVersionId, setHoveredVersionId] = useState<string | null>(null); // New state for version hover
  const [openVersionDropdowns, setOpenVersionDropdowns] = useState<Record<string, { type: boolean; gameVersion: boolean; loader: boolean }>>({});

  const toggleVersionDropdown = (projectId: string, dropdownType: 'type' | 'gameVersion' | 'loader') => {
    setOpenVersionDropdowns(prev => {
      const currentProjectDropdowns = prev[projectId] || { type: false, gameVersion: false, loader: false };
      const isOpen = currentProjectDropdowns[dropdownType];
      
      // Close all dropdowns for this project first, then open the target one if it was closed
      const newStateForProject = {
        type: false,
        gameVersion: false,
        loader: false,
        [dropdownType]: !isOpen, // Toggle the state of the clicked dropdown
      };

      return {
        ...prev,
        [projectId]: newStateForProject,
      };
    });
  };

  const closeAllVersionDropdowns = (projectId: string) => {
    setOpenVersionDropdowns(prev => ({
      ...prev,
      [projectId]: { type: false, gameVersion: false, loader: false },
    }));
  };

  // New state for version filtering UI controls within the expanded view
  const [versionDropdownUIState, setVersionDropdownUIState] = useState<Record<string, {
    showAllGameVersions: boolean;
    gameVersionSearchTerm: string;
  }>>({});

  // Handler for version dropdown UI state changes
  const handleVersionDropdownUIChange = (projectId: string, field: keyof typeof versionDropdownUIState[string], value: boolean | string) => {
    setVersionDropdownUIState(prev => ({
      ...prev,
      [projectId]: {
        ...prev[projectId],
        [field]: value,
      },
    }));
  };

  const handleInstallModpackAsProfile = async (project: UnifiedModSearchResult | any) => {
    if (project.project_type !== 'modpack') {
      toast.error(t('content.install.modpack_handler_warning'));
      if (onInstallSuccess) {
        onInstallSuccess();
      }
      return;
    }
    const eventId = crypto.randomUUID();
    const toastId = `install-${eventId}`;
    let progressUnlisten: UnlistenFn | null = null;

    setInstallingModpackAsProfile(prev => ({ ...prev, [project.project_id]: true })); // Start loading
    toast.loading(t('content.install.fetching_versions', { title: project.title }), { id: toastId });

    try {
      const response = await UnifiedService.getModVersions({
        source: project.source,
        project_id: project.project_id
      });
      const allVersions = response.versions;

      if (!allVersions || allVersions.length === 0) {
        throw new Error(t('content.install.modpack_no_versions'));
      }

      // Sort all versions by date published, newest first
      const sortedVersions = allVersions.sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime());

      // Try to find the latest 'release' version
      let latestVersion = sortedVersions.find(v => v.release_type === 'release');

      // If no release version is found, fall back to the absolute latest version
      if (!latestVersion) {
        latestVersion = sortedVersions[0];
      }

      if (!latestVersion || !latestVersion.files || latestVersion.files.length === 0) { throw new Error(t('content.install.modpack_no_files')); }
      const primaryFile = latestVersion.files.find(f => f.primary) || latestVersion.files[0];
      if (!primaryFile) { throw new Error(t('content.install.no_primary_file', { title: project.title })); }

      const fileName = primaryFile.filename || project.title || "modpack";

      // Set up event listener for progress updates
      progressUnlisten = await listen<EventPayload>("state_event", (progressEvent) => {
        const progressPayload = progressEvent.payload;
        if (progressPayload.event_type !== EventType.TaskProgress) return;
        if (progressPayload.event_id !== eventId) return;

        const progress = (progressPayload.progress ?? 0) * 100;

        toast.custom(
          () => <ProgressToast message={`Installing ${fileName}`} progress={progress} />,
          { id: toastId, duration: Infinity }
        );
      });

      // Show initial progress toast
      toast.custom(
        () => <ProgressToast message={`Installing ${fileName}`} progress={0} />,
        { id: toastId, duration: Infinity }
      );

      let newProfileId: string;

      // Choose the appropriate service based on modSource
      if (modSource === ModPlatform.CurseForge) {
        // For CurseForge, we need projectId and fileId as numbers
        const projectId = parseInt(project.project_id);
        const fileId = parseInt(latestVersion.id);

        if (isNaN(projectId) || isNaN(fileId)) {
          throw new Error("Invalid project or file ID for CurseForge modpack");
        }

        newProfileId = await CurseForgeService.downloadAndInstallCurseForgeModpack(
          projectId,
          fileId,
          primaryFile.filename,
          primaryFile.url,
          project.icon_url || undefined,
          primaryFile.size,
          eventId
        );
      } else {
        // Default to Modrinth
        newProfileId = await ModrinthService.downloadAndInstallModpack(
          project.project_id,
          latestVersion.id,
          primaryFile.filename,
          primaryFile.url,
          project.icon_url || undefined,
          primaryFile.size,
          eventId
        );
      }

      // Clean up listener before showing success
      if (progressUnlisten) {
        progressUnlisten();
        progressUnlisten = null;
      }

      toast.success(t('content.install.modpack_success', { title: project.title }), { id: toastId, duration: 3000 });

      try {
        // Wait for the profile list to be updated in the global store
        await useProfileStore.getState().fetchProfiles();
        const updatedProfiles = useProfileStore.getState().profiles;
        setInternalProfiles(updatedProfiles); // Sync local state

        // Now it's safe to navigate
        navigate(`/profilesv2/${newProfileId}`);
      } catch (profileError) {
        console.error("Failed to refresh profiles list internally:", profileError);
        toast.error(t('content.install.profile_refresh_failed'));
      }

      // Conditionally call onInstallSuccess
      if (project.project_type !== 'modpack' && onInstallSuccess) {
        onInstallSuccess();
      }
      // For modpacks, onInstallSuccess is intentionally skipped to prevent page reload,
      // as internalProfiles state is updated directly.

    } catch (err: any) {
      console.error("Failed to install modpack as profile:", err);
      toast.error(t('content.install.modpack_error', { title: project.title, error: err.message || 'Unknown error' }), { id: toastId });
    } finally {
      // Clean up listener
      if (progressUnlisten) {
        progressUnlisten();
      }
      setInstallingModpackAsProfile(prev => ({ ...prev, [project.project_id]: false })); // Stop loading
    }
  };

  const handleInstallModpackVersionAsProfile = async (project: UnifiedModSearchResult | any, version: UnifiedVersion) => {
    if (project.project_type !== 'modpack') {
      toast.error(t('content.install.modpack_version_handler_warning'));
      if (onInstallSuccess) {
        onInstallSuccess();
      }
      return;
    }
    if (!version || !version.files || version.files.length === 0) {
      toast.error(t('content.install.version_no_files'));
      return;
    }

    const eventId = crypto.randomUUID();
    const toastId = `install-${eventId}`;
    let progressUnlisten: UnlistenFn | null = null;

    setInstallingModpackVersion(prev => ({ ...prev, [version.id]: true })); // Start loading for this modpack version

    const primaryFile = version.files.find(f => f.primary) || version.files[0];
    if (!primaryFile) {
        toast.error(t('content.install.no_primary_file_version'));
        return;
    }

    const fileName = primaryFile.filename || project.title || "modpack";

    try {
      // Set up event listener for progress updates
      progressUnlisten = await listen<EventPayload>("state_event", (progressEvent) => {
        const progressPayload = progressEvent.payload;
        if (progressPayload.event_type !== EventType.TaskProgress) return;
        if (progressPayload.event_id !== eventId) return;

        const progress = (progressPayload.progress ?? 0) * 100;

        toast.custom(
          () => <ProgressToast message={`Installing ${fileName}`} progress={progress} />,
          { id: toastId, duration: Infinity }
        );
      });

      // Show initial progress toast
      toast.custom(
        () => <ProgressToast message={`Installing ${fileName}`} progress={0} />,
        { id: toastId, duration: Infinity }
      );

      let newProfileId: string;

      // Choose the appropriate service based on modSource
      if (modSource === ModPlatform.CurseForge) {
        // For CurseForge, we need projectId and fileId as numbers
        const projectId = parseInt(project.project_id);
        const fileId = parseInt(version.id);

        if (isNaN(projectId) || isNaN(fileId)) {
          throw new Error("Invalid project or file ID for CurseForge modpack");
        }

        newProfileId = await CurseForgeService.downloadAndInstallCurseForgeModpack(
          projectId,
          fileId,
          primaryFile.filename,
          primaryFile.url,
          project.icon_url || undefined,
          primaryFile.size,
          eventId
        );
      } else {
        // Default to Modrinth
        newProfileId = await ModrinthService.downloadAndInstallModpack(
          project.project_id,
          version.id,
          primaryFile.filename,
          primaryFile.url,
          project.icon_url || undefined,
          primaryFile.size,
          eventId
        );
      }

      // Clean up listener before showing success
      if (progressUnlisten) {
        progressUnlisten();
        progressUnlisten = null;
      }

      toast.success(t('content.install.modpack_version_success', { title: project.title, version: version.version_number }), { id: toastId, duration: 3000 });

      try {
        // Wait for the profile list to be updated in the global store
        await useProfileStore.getState().fetchProfiles();
        const updatedProfiles = useProfileStore.getState().profiles;
        setInternalProfiles(updatedProfiles); // Sync local state

        // Now it's safe to navigate
        navigate(`/profilesv2/${newProfileId}`);
      } catch (profileError) {
        console.error("Failed to refresh profiles list internally:", profileError);
        toast.error(t('content.install.profile_refresh_failed'));
      }

      // Conditionally call onInstallSuccess
      if (project.project_type !== 'modpack' && onInstallSuccess) {
        onInstallSuccess();
      }
      // For modpacks, onInstallSuccess is intentionally skipped.

    } catch (err: any) {
      console.error("Failed to install modpack version as profile:", err);
      toast.error(t('content.install.modpack_error', { title: project.title, error: err.message || 'Unknown error' }), { id: toastId });
    } finally {
      // Clean up listener
      if (progressUnlisten) {
        progressUnlisten();
      }
      setInstallingModpackVersion(prev => ({ ...prev, [version.id]: false })); // Stop loading for this modpack version
    }
  };

  const handleInstallToNewProfile = async (
    profileName: string,
    project: UnifiedModSearchResult | any,
    version: UnifiedVersion | null,
    sourceProfileIdToCopy?: string | null // Parameter for copying
  ): Promise<void> => {

    try {
      let newProfileId: string;
      let successMessageDetail = `Successfully created profile '${profileName}'`;
      let gameVersion = '1.21.1'; // Default fallback
      let loader = 'fabric'; // Default to fabric, will be overridden if needed
      let versionToInstall: UnifiedVersion | null = null; // The version we'll install

      // Handle profile creation
      if (sourceProfileIdToCopy) {
        // Get the source profile from the store
        console.log('🔍 Looking for source profile:', sourceProfileIdToCopy);
        const allProfiles = await ProfileService.getAllProfilesAndLastPlayed();
        console.log('📋 Available profiles:', allProfiles.all_profiles.map(p => ({ id: p.id, name: p.name })));

        const sourceProfile = allProfiles.all_profiles.find(p => p.id === sourceProfileIdToCopy);
        console.log('🎯 Found source profile:', sourceProfile);

        if (!sourceProfile) {
          throw new Error(`Source profile with ID ${sourceProfileIdToCopy} not found`);
        }

        const sourceProfileName = sourceProfile.name;

        // Copy profile using the service directly
        const copyParams = {
          source_profile_id: sourceProfileIdToCopy,
          new_profile_name: profileName,
          include_files: undefined, // Let the backend handle includeAll
        };

        console.log('🔄 Copying profile with params:', copyParams);
        newProfileId = await ProfileService.copyProfile(copyParams);
        console.log('✅ Profile copied successfully, new ID:', newProfileId);

        // If the source profile is a standard version, update the new profile to be custom
        if (sourceProfile?.is_standard_version) {
          await ProfileService.updateProfile(newProfileId, {
            group: "CUSTOM",
          });
        }

        successMessageDetail = `Successfully copied profile '${profileName}' from '${sourceProfileName}'`;

        // Get game version from the source profile for compatibility filtering
        if (sourceProfile) {
          gameVersion = sourceProfile.game_version || '1.21.1';
          loader = sourceProfile.loader || 'vanilla';
        }
      } else {
        // Handle both cases: with version and without version
      let versionToInstall: any = null; // Will be set below

        if (version) {
          // Version is available - use it
          gameVersion = version.game_versions[0] || '1.21.1';
          if (project.project_type === 'mod' || project.project_type === 'modpack') {
            loader = version.loaders[0] || 'vanilla';
          }
        } else {
          // No version specified - get the best compatible version based on current filters
          console.log('🔍 Finding best compatible version for:', project.title);
          console.log('🔍 Current filters - Game versions:', selectedGameVersions, 'Loaders:', currentSelectedLoaders);
          console.log('🔍 Available loaders from UI:', allLoadersData.map(l => l.name));

          // Get all versions for this project
          console.log('🔄 Fetching mod versions from API...');
          const response = await UnifiedService.getModVersions({
            source: project.source,
            project_id: project.project_id
          });
          const modVersions = response.versions;
          console.log('✅ Got', modVersions.length, 'versions from API');

          if (!modVersions || modVersions.length === 0) {
            throw new Error(`No versions found for ${project.title}`);
          }

          // STRATEGY: FABRIC-FIRST with Filter Support
          console.log('🎯 FABRIC-FIRST strategy with filter support');
          console.log('🔍 Current filters - Game versions:', selectedGameVersions, 'Loaders:', currentSelectedLoaders);

          // Step 1: Apply game version filter if active
          let filteredVersions: any[] = modVersions;
          if (selectedGameVersions && selectedGameVersions.length > 0) {
            filteredVersions = modVersions.filter(version =>
              version.game_versions.some(gv => selectedGameVersions.includes(gv))
            );
            console.log(`🎮 Filtered to ${filteredVersions.length} versions matching game versions:`, selectedGameVersions);
          }

          // Step 2: Apply loader filter if active
          if (currentSelectedLoaders && currentSelectedLoaders.length > 0) {
            filteredVersions = filteredVersions.filter(version =>
              version.loaders && version.loaders.some(l =>
                currentSelectedLoaders.some(filterL => filterL.toLowerCase() === l.toLowerCase())
              )
            );
            console.log(`🔧 Filtered to ${filteredVersions.length} versions matching loaders:`, currentSelectedLoaders);
          }

          // Step 3: If no versions match filters, fall back to all versions
          if (filteredVersions.length === 0) {
            console.log('⚠️ No versions match current filters, using all versions');
            filteredVersions = modVersions;
          }

          // Step 4: FABRIC-FIRST within filtered versions
          const fabricVersions = filteredVersions.filter(version =>
            version.loaders && version.loaders.some(l => l.toLowerCase() === 'fabric')
          );

          console.log(`✅ Found ${fabricVersions.length} Fabric-compatible versions out of ${filteredVersions.length} filtered versions`);

          if (fabricVersions.length > 0) {
            // Use Fabric version with highest MC version
            const sortedFabricVersions = fabricVersions.sort((a, b) => {
              const aMaxMC = a.game_versions.sort((x, y) => y.localeCompare(x, undefined, { numeric: true }))[0];
              const bMaxMC = b.game_versions.sort((x, y) => y.localeCompare(x, undefined, { numeric: true }))[0];
              return bMaxMC.localeCompare(aMaxMC, undefined, { numeric: true });
            });

            versionToInstall = sortedFabricVersions[0];
            loader = 'fabric';

            // Get highest MC version supported by this Fabric version
            const sortedMCVersions = [...versionToInstall.game_versions].sort((a, b) => {
              return b.localeCompare(a, undefined, { numeric: true });
            });
            gameVersion = sortedMCVersions[0] || '1.21.1';

            console.log('🎉 FABRIC SUCCESS: Using Fabric version', versionToInstall.version_number, 'for MC', gameVersion);
          } else {
            // No Fabric versions found in filtered results, use best available
            console.log('⚠️ No Fabric versions found in filtered results, using best available');

            // Try to find any version that matches loader filter
            if (currentSelectedLoaders && currentSelectedLoaders.length > 0) {
              const loaderMatchingVersions = filteredVersions.filter(version =>
                version.loaders && version.loaders.some(l =>
                  currentSelectedLoaders.some(filterL => filterL.toLowerCase() === l.toLowerCase())
                )
              );

              if (loaderMatchingVersions.length > 0) {
                // Sort by MC version and pick highest
                const sortedLoaderVersions = loaderMatchingVersions.sort((a, b) => {
                  const aMaxMC = a.game_versions.sort((x, y) => y.localeCompare(x, undefined, { numeric: true }))[0];
                  const bMaxMC = b.game_versions.sort((x, y) => y.localeCompare(x, undefined, { numeric: true }))[0];
                  return bMaxMC.localeCompare(aMaxMC, undefined, { numeric: true });
                });

                versionToInstall = sortedLoaderVersions[0] as any;
                loader = currentSelectedLoaders[0].toLowerCase(); // Use filtered loader

                const sortedMCVersions = [...versionToInstall.game_versions].sort((a, b) => {
                  return b.localeCompare(a, undefined, { numeric: true });
                });
                gameVersion = sortedMCVersions[0] || '1.21.1';

                console.log('🎯 FILTER MATCH: Using filtered loader', loader, 'version', versionToInstall.version_number, 'for MC', gameVersion);
              } else {
                // No loader match, use latest from filtered
                versionToInstall = filteredVersions[0] as any;
                loader = 'fabric'; // Default fallback

                const sortedMCVersions = [...versionToInstall.game_versions].sort((a, b) => {
                  return b.localeCompare(a, undefined, { numeric: true });
                });
                gameVersion = sortedMCVersions[0] || '1.21.1';

                console.log('📦 FILTERED FALLBACK: Using latest filtered version with fabric loader');
              }
            } else {
              // No loader filter, use latest from filtered
              versionToInstall = filteredVersions[0] as any;
              loader = 'fabric'; // Default to fabric

              const sortedMCVersions = [...versionToInstall.game_versions].sort((a, b) => {
                return b.localeCompare(a, undefined, { numeric: true });
              });
              gameVersion = sortedMCVersions[0] || '1.21.1';

              console.log('📦 SIMPLE FALLBACK: Using latest filtered version with fabric loader');
            }
          }

          // Safety check - ensure versionToInstall is valid
          if (!versionToInstall) {
            console.log('⚠️ Version selection logic failed, versionToInstall is null');
            console.log('🔍 Debug info:', {
              modVersionsLength: modVersions.length,
              selectedGameVersions,
              currentSelectedLoaders,
              filteredVersionsLength: filteredVersions.length,
              fabricVersionsLength: fabricVersions?.length || 0
            });
            // Don't throw here, let the fallback logic handle it
          }





          // Set the loader based on the version to install (with Fabric priority)
          if (versionToInstall && versionToInstall.loaders && versionToInstall.loaders.length > 0) {
            const versionLoaders = versionToInstall.loaders.map(l => l.toLowerCase());
            console.log('🔧 Available loaders in selected version:', versionLoaders);
            console.log('🔧 Version details:', {
              version: versionToInstall.version_number,
              mc_versions: versionToInstall.game_versions,
              loaders: versionToInstall.loaders
            });

            // Use preferred loader order: fabric > forge > quilt > neoforge
            const preferredLoaderOrder = ['fabric', 'forge', 'quilt', 'neoforge'];
            console.log('🔧 Checking against priority order:', preferredLoaderOrder);

            const selectedLoader = preferredLoaderOrder.find(l => versionLoaders.includes(l.toLowerCase()));

            if (selectedLoader) {
              loader = selectedLoader;
              console.log('✅ Selected preferred loader:', loader, 'from priority order');
            } else {
              // If no preferred loader found, use the first available loader
              loader = versionLoaders[0];
              console.log('⚠️ No preferred loader found, using first available:', loader, '(available:', versionLoaders, ')');
            }

            // If we have specific loader filters, try to respect them
            if (currentSelectedLoaders && currentSelectedLoaders.length > 0) {
              const filteredLoader = currentSelectedLoaders.find(l =>
                versionLoaders.includes(l.toLowerCase())
              );
              if (filteredLoader) {
                loader = filteredLoader.toLowerCase();
                console.log('🔧 Using filtered loader:', loader);
              }
            }
          } else {
            loader = 'fabric'; // Fallback
            console.log('⚠️ No loaders found in version, using fallback:', loader);
          }

          console.log('📦 Final selection - MC version:', gameVersion, 'with loader:', loader, 'for mod:', project.title, 'using version:', versionToInstall?.version_number || 'null');

          // Final safety check - if versionToInstall is still null, set it to the first available version
          if (!versionToInstall) {
            console.log('🚨 EMERGENCY FALLBACK: versionToInstall is still null, using first available version');
            if (modVersions && modVersions.length > 0) {
              versionToInstall = modVersions[0];
              console.log('✅ Emergency fallback version:', versionToInstall.version_number);
            } else {
              throw new Error(`No versions available for ${project.title} after all fallback attempts`);
            }
          }
        }

        // Create new profile using the service directly
        console.log('🔄 Creating new profile:', { name: profileName, game_version: gameVersion, loader });
        newProfileId = await ProfileService.createProfile({
          name: profileName,
          game_version: gameVersion,
          loader: loader,
        });
        console.log('✅ Profile created successfully, new ID:', newProfileId);
      }

      // Handle installation based on whether version is available
      if (version) {
        // Version is available - install the specific version
        versionToInstall = version; // Set the version to install
        const primaryFile = version.files.find((f) => f.primary) || version.files[0];
        if (!primaryFile) {
          throw new Error("No primary file found for the selected version.");
        }

        const mappedContentType = mapUnifiedProjectTypeToNrContentType(project.project_type);
        if (!mappedContentType) {
          throw new Error(`Unsupported project type for installation: ${project.project_type}`);
        }

        // Safeguard: Modpacks should not be installed as content here.
        // mapUnifiedProjectTypeToNrContentType handles toast, but this ensures error propagation for toast.promise
        if (project.project_type === 'modpack') {
          throw new Error("Modpacks should be installed as new profiles, not as content to an existing one.");
        }

        const payload: InstallContentPayload = {
          profile_id: newProfileId,
          project_id: project.project_id,
          version_id: version.id,
          file_name: primaryFile.filename,
          download_url: primaryFile.url,
          file_hash_sha1: primaryFile.hashes?.sha1 || undefined,
          file_fingerprint: undefined, // Modrinth doesn't use fingerprints
          content_name: project.title,
          version_number: version.version_number,
          content_type: mappedContentType,
          loaders: version.loaders,
          game_versions: version.game_versions,
          source: project.source,
        };

        // Install content (toast is handled by the modal)
        await installContentToProfile(payload);
        console.log('✅ Content installed successfully:', project.title, version.version_number);
      } else {
        // No specific version - get the latest version and install it
        console.log('🔍 Getting latest version for:', project.title);

        // Get all versions for this project
        const response = await UnifiedService.getModVersions({
          source: project.source,
          project_id: project.project_id
        });
        const versions = response.versions;

        if (versions.length === 0) {
          throw new Error(`No versions found for ${project.title}`);
        }

        console.log('📦 Installing version:', versionToInstall?.version_number || 'unknown', 'for MC', gameVersion);
        console.log('🔍 Version data:', JSON.stringify(versionToInstall, null, 2));

        // Safety check before installation
        if (!versionToInstall) {
          console.log('⚠️ No version was selected by the complex logic, falling back to first available version');
          // Fallback: use the first version from the versions array
          if (versions && versions.length > 0) {
            versionToInstall = versions[0] as any;
            console.log('✅ Using fallback version:', versionToInstall.version_number);
          } else {
            throw new Error(`No versions available for ${project.title}`);
          }
        }

        // Handle different possible file structures
        let primaryFile = null;

        if (versionToInstall.files && Array.isArray(versionToInstall.files) && versionToInstall.files.length > 0) {
          // Standard case: files array is available
          primaryFile = versionToInstall.files.find((f) => f.primary) || versionToInstall.files[0];
        } else {
          // Fallback: try to find another version that has files
          console.warn('⚠️ No files array found for selected version, looking for alternative version');

          // Get fresh versions data to find one with files
          const response = await UnifiedService.getModVersions({
            source: project.source,
            project_id: project.project_id
          });
          const allVersions = response.versions;
          const versionWithFiles = allVersions.find(v =>
            v.files && Array.isArray(v.files) && v.files.length > 0
          );

          if (versionWithFiles) {
            console.log('✅ Found alternative version with files:', versionWithFiles.version_number);
            versionToInstall = versionWithFiles as any;
            primaryFile = versionToInstall.files.find((f) => f.primary) || versionToInstall.files[0];
          } else {
            throw new Error(`No downloadable versions found for ${project.title}. This may be a temporary API issue.`);
          }
        }

        if (!primaryFile) {
          console.error('❌ No primary file found. Available files:', versionToInstall.files);
          throw new Error(`No suitable download file found for ${project.title} version ${versionToInstall.version_number}`);
        }

        console.log('✅ Using file:', primaryFile.filename, 'from URL:', primaryFile.url);

        const mappedContentType = mapUnifiedProjectTypeToNrContentType(project.project_type);
        if (!mappedContentType) {
          throw new Error(`Unsupported project type for installation: ${project.project_type}`);
        }

        // Safeguard: Modpacks should not be installed as content here.
        if (project.project_type === 'modpack') {
          throw new Error("Modpacks should be installed as new profiles, not as content to an existing one.");
        }

        const payload = {
          profile_id: newProfileId,
          project_id: project.project_id,
          version_id: versionToInstall.id,
          download_url: primaryFile.url,
          file_name: primaryFile.filename,
          version_number: versionToInstall.version_number,
          content_type: mappedContentType,
          loaders: versionToInstall.loaders,
          game_versions: versionToInstall.game_versions,
          source: project.source,
        };

        // Install content (toast is handled by the modal)
        await installContentToProfile(payload);
        console.log('✅ Content installed successfully:', project.title, versionToInstall.version_number);
      }

      // Update the store and local state to reflect changes
      const updatedProfiles = await ProfileService.getAllProfilesAndLastPlayed();
      setInternalProfiles(updatedProfiles.all_profiles);

      // Update the global profile store properly
      useProfileStore.setState({
        profiles: updatedProfiles.all_profiles,
        lastPlayedProfileId: updatedProfiles.last_played_profile_id,
        loading: false,
      });

      // Navigate to the newly created profile
      console.log('🚀 Navigating to new profile:', newProfileId);
      navigate(`/profilesv2/${newProfileId}`);

      // Call onInstallSuccess if it exists and the installed content was not a modpack
      if (project.project_type !== 'modpack' && onInstallSuccess) {
        justInstalledOrToggledRef.current = true;
        onInstallSuccess();
      }

    } catch (error) {
      console.error("Error in handleInstallToNewProfile:", error);
      toast.error(t('content.install.create_profile_failed', { error: error instanceof Error ? error.message : 'Unknown error' }));
    }
  };

  // Function to handle deleting a version from a profile
  const handleDeleteVersionFromProfile = async (
    profileId: string, // This is the definitive profile ID for this operation
    project: UnifiedModSearchResult | any,
    version: UnifiedVersion
  ) => {
    // REMOVED: if (!selectedProfile) { ... }

    const profileName = internalProfiles.find(p => p.id === profileId)?.name || profileId;

    const primaryFile = version.files.find(file => file.primary) || version.files[0];
    if (!primaryFile) {
      toast.error(t('content.install.no_primary_file_delete'));
      return;
    }

    const payload: UninstallContentPayload = {
      profile_id: profileId,
      sha1_hash: primaryFile.hashes?.sha1 || undefined,
    };

    if (!payload.sha1_hash) {
      toast.error(t('content.install.sha1_missing'));
      console.error("Deletion failed: SHA1 hash missing for", project.title, version.version_number, primaryFile);
      return;
    }

    console.log("Attempting to remove content with payload:", payload);

    // Set uninstalling state
    console.log('🗑️ Setting uninstalling state for profile:', profileId);
    setUninstalling(prev => ({ ...prev, [profileId]: true }));

    const removePromise = uninstallContentFromProfile(payload);

    await toast.promise(
      removePromise,
      {
        loading: `Removing ${project.title} (${version.version_number}) from ${profileName}...`,
        success: (data: any) => {
          // Update version status - set to not installed FOR THE SPECIFIC profileId
          setInstalledVersions(prev => {
            const newState = { ...prev };
            if (!newState[profileId]) { // Use profileId
              newState[profileId] = {}; // Use profileId
            }
            
            newState[profileId][version.id] = { // Use profileId
              is_installed: false,
              is_included_in_norisk_pack: newState[profileId]?.[version.id]?.is_included_in_norisk_pack || false, // Use profileId
              is_specific_version_in_pack: newState[profileId]?.[version.id]?.is_specific_version_in_pack || false, // Use profileId
              is_enabled: null,
              found_item_details: null,
              norisk_pack_item_details: newState[profileId]?.[version.id]?.norisk_pack_item_details || null, // Use profileId
            };
            
            return newState;
          });
          
          // Update modal states if they are open and showing this item
          // Reset install status for the profile so it can be installed again
          console.log('🗑️ Resetting install status for profile:', profileId, 'after uninstall');
          setInstallStatus(prev => {
            const newStatus = { ...prev };
            delete newStatus[profileId]; // Remove the install status completely
            return newStatus;
          });

          // Reset uninstalling state
          console.log('✅ Resetting uninstalling state for profile:', profileId);
          setUninstalling(prev => {
            const newState = { ...prev };
            delete newState[profileId];
            return newState;
          });

          // Check if any other versions of this project remain installed IN THE SPECIFIC profileId
          const anyVersionsStillInstalled = Object.entries(installedVersions[profileId] || {})
            .some(([vId, status]) => {
              if (vId === version.id) return false;
              const versionProject = expandedVersions[project.project_id];
              if (!Array.isArray(versionProject)) return false;
              const belongsToProject = versionProject.some(v => v.id === vId);
              return belongsToProject && status?.is_installed === true;
            });

          // If no versions are still installed, update project status ONLY IF profileId is the selectedProfile
          if (!anyVersionsStillInstalled && selectedProfile && selectedProfile.id === profileId) {
            setInstalledProjects(prev => ({
              ...prev,
              [project.project_id]: {
                is_installed: false,
                is_included_in_norisk_pack: prev[project.project_id]?.is_included_in_norisk_pack || false,
                is_specific_version_in_pack: prev[project.project_id]?.is_specific_version_in_pack || false,
                is_enabled: null,
                found_item_details: null,
                norisk_pack_item_details: prev[project.project_id]?.norisk_pack_item_details || null,
              }
            }));
          }

          justInstalledOrToggledRef.current = true;
          if (onInstallSuccess) {
            onInstallSuccess();
          }
          return `Successfully removed ${project.title} (${version.version_number}) from ${profileName}`;
        },
        error: (err) => {
          // Reset uninstalling state on error
          console.log('❌ Resetting uninstalling state on error for profile:', profileId);
          setUninstalling(prev => {
            const newState = { ...prev };
            delete newState[profileId];
            return newState;
          });
          return `Failed to remove: ${err.message || String(err)}`;
        },
      }
    ).finally(() => {
      // Always reset uninstalling state
      console.log('🔄 Finally resetting uninstalling state for profile:', profileId);
      setUninstalling(prev => {
        const newState = { ...prev };
        delete newState[profileId];
        return newState;
      });
    });
  };

  // New function to handle toggling enable/disable state of a version
  const handleToggleEnableVersion = async (
    profileId: string,
    project: UnifiedModSearchResult | any,
    version: UnifiedVersion,
    newEnabledState: boolean,
    sha1Hash: string
  ) => {
    // Get current installation status for the version
    const currentVersionStatus = installedVersions[selectedProfile.id]?.[version.id];

    // Determine NrContentType from project.project_type
    let nrContentType: NrContentType | undefined = undefined;
    switch (project.project_type as ModrinthProjectType) {
      case 'mod':
        nrContentType = NrContentType.Mod;
        break;
      case 'resourcepack':
        nrContentType = NrContentType.ResourcePack;
        break;
      case 'shader':
        nrContentType = NrContentType.ShaderPack;
        break;
      case 'datapack':
        nrContentType = NrContentType.DataPack;
        break;
      default:
        // Optionally log a warning for unhandled project types if needed
        console.warn("[ModrinthSearchV2] Unhandled project_type for NrContentType mapping in toggle:", project.project_type);
    }

    // Check if this is a NoRisk Pack item
    if (currentVersionStatus?.norisk_pack_item_details?.norisk_mod_identifier) {
      const noriskIdentifier = currentVersionStatus.norisk_pack_item_details.norisk_mod_identifier;
      
      const toastMessage = newEnabledState ? "Enabling" : "Disabling";
      const successMessage = newEnabledState ? "enabled" : "disabled";
      
      await toast.promise(
        async () => {
          const payload: ToggleContentPayload = {
            profile_id: profileId,
            enabled: newEnabledState,
            norisk_mod_identifier: noriskIdentifier,
            content_type: nrContentType, // Pass content_type here as well
            // sha1_hash is not strictly needed for norisk_mod_identifier-based toggling by current backend logic,
            // but can be included for consistency if desired or if backend logic changes.
            sha1_hash: sha1Hash, 
          };
          
          await toggleContentFromProfile(payload);
          
          // Update version's installation status
          setInstalledVersions(prev => {
            const newState = { ...prev };
            if (!newState[selectedProfile.id]) {
              newState[selectedProfile.id] = {};
            }
            
            if (newState[selectedProfile.id][version.id]) {
              newState[selectedProfile.id][version.id] = {
                ...newState[selectedProfile.id][version.id]!,
                is_enabled: newEnabledState,
                norisk_pack_item_details: {
                  ...newState[selectedProfile.id][version.id]!.norisk_pack_item_details!,
                  is_enabled: newEnabledState
                }
              };
            }
            
            return newState;
          });

          // Also update the project's installation status to reflect the change
          // This is important if the project card's display depends on this specific item's state.
          setInstalledProjects(prev => {
            const currentProjectStatus = prev[project.project_id];
            if (currentProjectStatus) {
              return {
                ...prev,
                [project.project_id]: {
                  ...currentProjectStatus,
                  is_enabled: newEnabledState, // Update top-level is_enabled for the project
                  norisk_pack_item_details: {
                    // Ensure we spread existing details if they exist, or initialize if not
                    ...(currentProjectStatus.norisk_pack_item_details || {}),
                    // We might not have a full norisk_mod_identifier here at project level,
                    // but the key is to update its is_enabled state if these details are what project card uses.
                    is_enabled: newEnabledState 
                  }
                }
              };
            }
            return prev; // If no existing project status, don't change it
          });

          return { versionName: version.version_number };
        },
        {
          loading: `${toastMessage} NoRisk Pack item: ${project.title} (${version.version_number})...`,
          success: ({ versionName }) => `Successfully ${successMessage} NoRisk Pack item: ${project.title} (${versionName})`,
          error: (err) => `Failed to ${toastMessage.toLowerCase()} NoRisk Pack item: ${err.message || String(err)}`
        }
      ).catch(err => {
        console.error(`Error ${toastMessage.toLowerCase()} NoRisk Pack item:`, err);
      });
      
      return; // Exit after handling NoRisk pack item
    }

    // Regular content toggle using SHA1 hash (for non-NoRisk pack items)
    if (!sha1Hash) {
      toast.error(t('content.install.toggle_missing_hash'));
      return;
    }

    const toastMessage = newEnabledState ? "Enabling" : "Disabling";
    const successMessage = newEnabledState ? "enabled" : "disabled";
    
    await toast.promise(
      async () => {
        const payload: ToggleContentPayload = {
          profile_id: profileId,
          sha1_hash: sha1Hash,
          enabled: newEnabledState,
          content_type: nrContentType, // Add mapped content_type
          norisk_mod_identifier: undefined, // Explicitly undefined for non-NoRisk items
        };
        
        await toggleContentFromProfile(payload);
        
        // Update version's installation status
        setInstalledVersions(prev => {
          const newState = { ...prev };
          if (!newState[selectedProfile.id]) {
            newState[selectedProfile.id] = {};
          }
          
          if (newState[selectedProfile.id][version.id]) {
            newState[selectedProfile.id][version.id] = {
              ...newState[selectedProfile.id][version.id]!,
              is_enabled: newEnabledState
            };
          }
          
          return newState;
        });

        // Update project's installation status (only its is_enabled field)
        setInstalledProjects(prev => {
            const currentProjectStatus = prev[project.project_id];
            if (currentProjectStatus && currentProjectStatus.is_installed) { // Only update if project is considered installed
              return {
                ...prev,
                [project.project_id]: {
                  ...currentProjectStatus,
                  is_enabled: newEnabledState 
                }
              };
            }
            return prev;
        });
        
        return { versionName: version.version_number };
      },
      {
        loading: `${toastMessage} ${project.title} (${version.version_number})...`,
        success: ({ versionName }) => `Successfully ${successMessage} ${project.title} (${versionName})`,
        error: (err) => `Failed to ${toastMessage.toLowerCase()}: ${err.message || String(err)}`
      }
    ).catch(err => {
      console.error(`Error ${toastMessage.toLowerCase()} content:`, err);
    });
  };

  // Define helper objects/functions at the component scope
  const defaultErrorContentStatus: ContentInstallStatus = {
    is_installed: false,
    is_included_in_norisk_pack: false,
    is_specific_version_in_pack: false,
    is_enabled: null,
    found_item_details: null,
    norisk_pack_item_details: null,
  };

  const getStatusForNewInstall = (
    existingPreviousStatus?: ContentInstallStatus | null,
  ): ContentInstallStatus => ({
    is_installed: true,
    is_included_in_norisk_pack: existingPreviousStatus?.is_included_in_norisk_pack || false,
    is_specific_version_in_pack: existingPreviousStatus?.is_specific_version_in_pack || false,
    is_enabled: true, 
    found_item_details: existingPreviousStatus?.found_item_details || null,
    norisk_pack_item_details: existingPreviousStatus?.norisk_pack_item_details || null,
  });

  // Helper function to get NoRisk status for a project
  const getProjectNoRiskStatus = (project: UnifiedModSearchResult): 'blocked' | 'warning' | null => {
    console.log('[getProjectNoRiskStatus] Checking project:', project.title, 'ID:', project.project_id);
    console.log('[getProjectNoRiskStatus] Config loaded:', blockedModsConfigLoaded);
    
    if (!blockedModsConfigLoaded) {
      console.log('[getProjectNoRiskStatus] Config not loaded yet, returning null');
      return null;
    }
    
    const result = getModNoRiskStatus('', project.project_id, null);
    console.log('[getProjectNoRiskStatus] Result for', project.project_id, ':', result);
    return result;
  };

  // Helper function to check if a project is blocked (for backward compatibility)
  const isProjectBlocked = (project: UnifiedModSearchResult): boolean => {
    return getProjectNoRiskStatus(project) === 'blocked';
  };

  return (
    // Overall container: now flex-row to place left content and sidebar side-by-side
    <div className={`modrinth-search-v2 flex flex-row h-full gap-3 ${className}`}> {/* Added gap-3 */} 
      {/* Left Content Area: Takes up most space, contains search bar and results */} 
      <div className="left-content-area flex flex-col flex-1 overflow-hidden">
        {/* Search controls are now in a separate component */}
        <ModrinthSearchControlsV2
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          projectType={projectType}
          onProjectTypeChange={handleProjectTypeChange}
          allProjectTypes={allowedProjectTypes || ALL_MODRINTH_PROJECT_TYPES} // Use filtered list
          profiles={internalProfiles}
          selectedProfile={selectedProfile}
          onSelectedProfileChange={(profile) => {
            if (profile === null) {
              setSelectedProfile(null);
              setSelectedGameVersions([]);
              setSelectedLoadersByProjectType(prev => ({ ...prev, [projectType]: [] }));
            } else {
              setSelectedProfile(profile);
            }
          }}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
          sortOptions={sortOptions}
          isSidebarVisible={isSidebarVisible}
          onToggleSidebar={() => setIsSidebarVisible(!isSidebarVisible)}
          selectedGameVersions={selectedGameVersions}
          currentSelectedLoaders={currentSelectedLoaders}
          currentSelectedCategories={currentSelectedCategories}
          filterClientRequired={filterClientRequired}
          filterServerRequired={filterServerRequired}
          onRemoveGameVersionTag={removeGameVersionTag}
          onRemoveLoaderTag={removeLoaderTag}
          onRemoveCategoryTag={removeCategoryTag}
          onRemoveClientRequiredTag={removeClientRequiredTag}
          onRemoveServerRequiredTag={removeServerRequiredTag}
          onClearAllFilters={clearAllFilters}
          overrideDisplayContext={overrideDisplayContext} // Pass down
          modSource={modSource}
          onModSourceChange={setModSource}
        />

        {/* Search Results Area (scrollable within the left content area) */}
        <div ref={searchResultsAreaRef} onScroll={handleScrollSave} className="search-results-area flex-1 overflow-y-auto"> {/* Removed p-4 */}
          {/* {loading && searchResults.length === 0 && <p className="p-4 text-center">Loading initial results...</p>} REMOVED */}
          {searchResults.length === 0 && !loading && error && (
            <p className="p-4 text-red-500 text-center">{t('content.search.error', { error })}</p>
          )}
          {searchResults.length === 0 && !loading && !error && showNoResultsMessage && (
            <p className="p-4 text-center text-xl lowercase text-gray-400">{t('content.search.no_results')}</p>
          )}

          {searchResults.length > 0 && (
            disableVirtualization ? (
              // Non-virtualized scrollable div
              <div className="space-y-1">
                {searchResults.map((hit, index) => {
                  const projectVersions = expandedVersions[hit.project_id];
                  const displayedCount = numDisplayedVersions[hit.project_id] || initialDisplayCount;
                  const currentProjectInstallStatus = selectedProfile ? installedProjects[hit.project_id] : null;
                  const currentVersionFilters = versionFilters[hit.project_id] || { gameVersions: [], loaders: [], versionType: 'all' };
                  const currentVersionDropdownUIState = versionDropdownUIState[hit.project_id] || { showAllGameVersions: false, gameVersionSearchTerm: '' };
                  const currentOpenVersionDropdowns = openVersionDropdowns[hit.project_id] || { type: false, gameVersion: false, loader: false };
                  const projectNoRiskStatus = getProjectNoRiskStatus(hit);

                  return (
                    <ModrinthProjectCardV2
                      key={hit.project_id}
                      itemIndex={index}
                      hit={hit}
                      accentColor={accentColor}
                      installStatus={currentProjectInstallStatus}
                      isQuickInstalling={quickInstallingProjects[hit.project_id] || false}
                      isInstallingModpackAsProfile={installingModpackAsProfile[hit.project_id] || false}
                      installingVersionStates={installingVersion}
                      installingModpackVersionStates={installingModpackVersion}
                      onQuickInstallClick={overrideDisplayContext === "detail" ? handleDirectQuickInstall : quickInstall}
                      onInstallModpackAsProfileClick={handleInstallModpackAsProfile}
                      onInstallModpackVersionAsProfileClick={handleInstallModpackVersionAsProfile}
                      onToggleVersionsClick={toggleProjectVersions}
                      isExpanded={Array.isArray(projectVersions) && projectVersions.length > 0}
                      isLoadingVersions={projectVersions === 'loading'}
                      projectVersions={projectVersions}
                      displayedCount={displayedCount}
                      versionFilters={currentVersionFilters}
                      versionDropdownUIState={currentVersionDropdownUIState}
                      openVersionDropdowns={currentOpenVersionDropdowns}
                      installedVersions={selectedProfile ? (installedVersions[selectedProfile.id] || {}) : {}}
                      selectedProfile={selectedProfile}
                      selectedProfileId={selectedProfile?.id}
                      hoveredVersionId={hoveredVersionId}
                      gameVersionsData={gameVersionsData}
                      showAllGameVersionsSidebar={showAllGameVersionsSidebar}
                      selectedGameVersionsSidebar={selectedGameVersions}
                      onVersionFilterChange={handleVersionFilterChange}
                      onVersionUiStateChange={handleVersionDropdownUIChange}
                      onToggleVersionDropdown={toggleVersionDropdown}
                      onCloseAllVersionDropdowns={closeAllVersionDropdowns}
                      onLoadMoreVersions={loadMoreProjectVersions}
                      onInstallVersionClick={handleDirectInstall}
                      onHoverVersion={setHoveredVersionId}
                      onDeleteVersionClick={handleDeleteVersionFromProfile}
                      onToggleEnableClick={handleToggleEnableVersion}
                      isBlocked={isProjectBlocked(hit)}
                      projectNoRiskStatus={projectNoRiskStatus}
                    />
                  );
                })}
                
                {/* Load more button for non-virtualized mode */}
                {!loading && searchResults.length > 0 && searchResults.length < totalHits && (
                  <div className="flex justify-center p-4">
                    <button
                      onClick={loadMoreResults}
                      className="px-4 py-2 bg-black/30 hover:bg-black/40 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded-lg font-minecraft text-2xl lowercase transition-all duration-200"
                    >
                      {t('content.search.load_more', { remaining: totalHits - searchResults.length })}
                    </button>
                  </div>
                )}

                {/* Loading indicator */}
                {loading && searchResults.length > 0 && (
                  <div className="p-4 text-center">
                    {t('content.search.loading_more')}
                  </div>
                )}

                {/* End of results */}
                {!loading && searchResults.length > 0 && searchResults.length >= totalHits && (
                  <div className="p-4 text-center text-xl text-gray-400">
                    {t('content.search.no_more_results')}
                  </div>
                )}
              </div>
            ) : (
              // Virtualized list (original implementation)
              <Virtuoso
                style={{ height: '100%' }}
                initialScrollTop={restoredScrollTop.current}
                data={searchResults}
                endReached={loadMoreResults}
                onScroll={(e) => {
                  if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
                  scrollSaveTimer.current = setTimeout(() => {
                    setScrollPosition((e.target as HTMLElement).scrollTop);
                  }, 150);
                }}
                itemContent={(index, hit) => {
                  const projectVersions = expandedVersions[hit.project_id];
                  const displayedCount = numDisplayedVersions[hit.project_id] || initialDisplayCount;
                  const currentProjectInstallStatus = selectedProfile ? installedProjects[hit.project_id] : null;
                  const currentVersionFilters = versionFilters[hit.project_id] || { gameVersions: [], loaders: [], versionType: 'all' };
                  const currentVersionDropdownUIState = versionDropdownUIState[hit.project_id] || { showAllGameVersions: false, gameVersionSearchTerm: '' };
                  const currentOpenVersionDropdowns = openVersionDropdowns[hit.project_id] || { type: false, gameVersion: false, loader: false };
                  const projectNoRiskStatus = getProjectNoRiskStatus(hit);

                  return (
                    <ModrinthProjectCardV2
                      key={hit.project_id}
                      itemIndex={index}
                      hit={hit}
                      accentColor={accentColor}
                      installStatus={currentProjectInstallStatus}
                      isQuickInstalling={quickInstallingProjects[hit.project_id] || false}
                      isInstallingModpackAsProfile={installingModpackAsProfile[hit.project_id] || false}
                      installingVersionStates={installingVersion}
                      installingModpackVersionStates={installingModpackVersion}
                      onQuickInstallClick={overrideDisplayContext === "detail" ? handleDirectQuickInstall : quickInstall}
                      onInstallModpackAsProfileClick={handleInstallModpackAsProfile}
                      onInstallModpackVersionAsProfileClick={handleInstallModpackVersionAsProfile}
                      onToggleVersionsClick={toggleProjectVersions}
                      isExpanded={Array.isArray(projectVersions) && projectVersions.length > 0}
                      isLoadingVersions={projectVersions === 'loading'}
                      projectVersions={projectVersions}
                      displayedCount={displayedCount}
                      versionFilters={currentVersionFilters}
                      versionDropdownUIState={currentVersionDropdownUIState}
                      openVersionDropdowns={currentOpenVersionDropdowns}
                      installedVersions={selectedProfile ? (installedVersions[selectedProfile.id] || {}) : {}}
                      selectedProfile={selectedProfile}
                      selectedProfileId={selectedProfile?.id}
                      hoveredVersionId={hoveredVersionId}
                      gameVersionsData={gameVersionsData}
                      showAllGameVersionsSidebar={showAllGameVersionsSidebar}
                      selectedGameVersionsSidebar={selectedGameVersions}
                      onVersionFilterChange={handleVersionFilterChange}
                      onVersionUiStateChange={handleVersionDropdownUIChange}
                      onToggleVersionDropdown={toggleVersionDropdown}
                      onCloseAllVersionDropdowns={closeAllVersionDropdowns}
                      onLoadMoreVersions={loadMoreProjectVersions}
                      onInstallVersionClick={handleDirectInstall}
                      onHoverVersion={setHoveredVersionId}
                      onDeleteVersionClick={handleDeleteVersionFromProfile}
                      onToggleEnableClick={handleToggleEnableVersion}
                      isBlocked={isProjectBlocked(hit)}
                      projectNoRiskStatus={projectNoRiskStatus}
                    />
                  );
                }}
                components={{
                  Footer: () => {
                    if (loading && searchResults.length > 0) {
                      return (
                        <div className="p-4 text-center">
                          {t('content.search.loading_more')}
                        </div>
                      );
                    }
                    if (!loading && searchResults.length > 0 && searchResults.length >= totalHits) {
                       return (
                        <div className="p-4 text-center text-xl lowercase text-gray-400">
                          {t('content.search.no_more_results')}
                        </div>
                      );
                    }
                    return null;
                  },
                }}
              />
            )
          )}

        </div>
      </div>

      {/* Filters Sidebar (Right, full height, scrollable) - Now with conditional rendering */} 
      {isSidebarVisible && (
        <ModrinthFilterSidebarV2
          projectType={projectType}
          accentColor={accentColor}
          gameVersionSearchTerm={gameVersionSearchTerm}
          onGameVersionSearchTermChange={setGameVersionSearchTerm}
          displayedGameVersions={displayedGameVersions}
          selectedGameVersions={selectedGameVersions}
          onGameVersionToggle={handleGameVersionToggle}
          showAllGameVersionsSidebar={showAllGameVersionsSidebar}
          onShowAllGameVersionsSidebarChange={setShowAllGameVersionsSidebar}
          availableLoaders={availableLoaders}
          currentSelectedLoaders={currentSelectedLoaders}
          onLoaderToggle={handleLoaderToggle}
          allLoadersData={allLoadersData}
          dynamicFilterGroups={dynamicFilterGroups}
          currentSelectedCategories={currentSelectedCategories}
          onCategoryToggle={handleCategoryToggle}
          filterClientRequired={filterClientRequired}
          onClientRequiredToggle={() => setFilterClientRequired(!filterClientRequired)}
          filterServerRequired={filterServerRequired}
          onServerRequiredToggle={() => setFilterServerRequired(!filterServerRequired)}
        />
      )}

      {/* Regular Install Modal - Now using global modal system */}

      {/* Quick Install Modal */}
      {quickInstallProject && quickInstallModalOpen && (
      <ModrinthQuickInstallModalV2
        isOpen={quickInstallModalOpen}
        onClose={closeQuickInstallModal}
        project={quickInstallProject}
        versions={quickInstallVersions}
        isLoading={quickInstallLoading}
        error={quickInstallError}
        profiles={internalProfiles}
        selectedProfileId={selectedProfile?.id}
        installStatus={installStatus}
        installingProfiles={installing}
          onInstallToProfile={(profileId) => {
            // Call the existing quickInstallToProfile function
            quickInstallToProfile(profileId);
          }}
          onUninstallClick={async (profileId, project, version) => {
            await handleDeleteVersionFromProfile(profileId, project, version);
          }}
        findBestVersionForProfile={findBestVersionForProfile}
          onInstallToNewProfile={handleInstallToNewProfile}
        />
      )}

    </div>
  );
} 