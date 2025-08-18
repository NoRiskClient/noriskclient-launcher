"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ModrinthService } from '../../../services/modrinth-service';
import type {
  ModrinthSearchHit,
  ModrinthProjectType,
  ModrinthSearchResponse,
  ModrinthCategory,
  ModrinthGameVersion,
  ModrinthLoader,
  ModrinthSortType,
  ModrinthVersion
} from '../../../types/modrinth';
import * as ProfileService from '../../../services/profile-service';
import { toast } from 'react-hot-toast';
import { Button } from '../../ui/buttons/Button';
import { SearchInput } from '../../ui/SearchInput';
import { Dropdown } from '../../ui/dropdown/Dropdown';
import { Icon } from '@iconify/react';
import { cn } from '../../../lib/utils';
import { Select } from '../../ui/Select'; // Import Select component
import { IconButton } from '../../ui/buttons/IconButton'; // Import IconButton
import { useThemeStore } from '../../../store/useThemeStore'; // Import useThemeStore
import { TagBadge } from '../../ui/TagBadge'; // Import TagBadge
import { Input } from '../../ui/Input'; // Import Input component
import { Checkbox } from '../../ui/Checkbox'; // Import Checkbox component
import { ModrinthVersionItemV2 } from './ModrinthVersionItemV2'; // Import the new component
import { ModrinthVersionListV2 } from './ModrinthVersionListV2'; // Import the new version list component
import { ModrinthQuickInstallModalV2 } from './ModrinthQuickInstallModalV2'; // Import the quick install modal
import { ModrinthInstallModalV2 } from './ModrinthInstallModalV2'; // Import the detailed install modal
import { ModrinthFilterSidebarV2 } from './ModrinthFilterSidebarV2'; // Import the new sidebar component
import { ModrinthProjectCardV2 } from './ModrinthProjectCardV2'; // Import the new project card component
import { ModrinthSearchControlsV2 } from './ModrinthSearchControlsV2'; // Import the new search controls component

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
import { Virtuoso } from 'react-virtuoso'; // Import Virtuoso
import { useNavigate } from 'react-router-dom';

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
}: ModrinthSearchV2Props) {
  const navigate = useNavigate();
  const searchResultsAreaRef = useRef<HTMLDivElement>(null); // Ref for the scrollable area
  const [searchTerm, setSearchTerm] = useState('');
  const [projectType, setProjectType] = useState<ModrinthProjectType>(() => {
    const effectiveAllowedTypes = allowedProjectTypes || ALL_MODRINTH_PROJECT_TYPES;
    if (initialProjectType && effectiveAllowedTypes.includes(initialProjectType)) {
      return initialProjectType;
    }
    return effectiveAllowedTypes[0] || 'mod'; // Default to first allowed type or 'mod'
  });
  const [searchResults, setSearchResults] = useState<ModrinthSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [totalHits, setTotalHits] = useState(0);
  const limit = 20;

  // New state for Sort Order, now with ModrinthSortType
  const [sortOrder, setSortOrder] = useState<ModrinthSortType>('relevance');
  
  const sortOptions: { value: ModrinthSortType; label: string; icon?: React.ReactNode }[] = [
    { value: 'relevance', label: 'Relevance', icon: <Icon icon="solar:sort-bold" className="w-4 h-4" /> },
    { value: 'downloads', label: 'Downloads', icon: <Icon icon="solar:download-bold" className="w-4 h-4" /> },
    { value: 'follows', label: 'Follows', icon: <Icon icon="solar:heart-bold" className="w-4 h-4" /> },
    { value: 'newest', label: 'Newest', icon: <Icon icon="solar:calendar-mark-bold" className="w-4 h-4" /> }, // Changed icon
    { value: 'updated', label: 'Updated', icon: <Icon icon="solar:refresh-bold" className="w-4 h-4" /> },
  ];

  const [allCategoriesData, setAllCategoriesData] = useState<ModrinthCategory[]>([]);
  const [gameVersionsData, setGameVersionsData] = useState<ModrinthGameVersion[]>([]);
  const [allLoadersData, setAllLoadersData] = useState<ModrinthLoader[]>([]);

  const initialCategoriesState = useMemo(() => 
    (allowedProjectTypes || ALL_MODRINTH_PROJECT_TYPES).reduce((acc, pt) => ({ ...acc, [pt]: [] }), {} as Record<ModrinthProjectType, string[]>)
  , [allowedProjectTypes]);
  const [selectedCategoriesByProjectType, setSelectedCategoriesByProjectType] = useState(initialCategoriesState);
  
  const [selectedLoadersByProjectType, setSelectedLoadersByProjectType] = useState(initialCategoriesState);
  
  const [selectedGameVersions, setSelectedGameVersions] = useState<string[]>([]); 
  const [showAllGameVersionsSidebar, setShowAllGameVersionsSidebar] = useState(false); // Renamed state and set default to false
  const [gameVersionSearchTerm, setGameVersionSearchTerm] = useState('');

  // New states for Environment filter
  const [filterClientRequired, setFilterClientRequired] = useState(false);
  const [filterServerRequired, setFilterServerRequired] = useState(false);

  // New state for expanded versions
  const [expandedVersions, setExpandedVersions] = useState<Record<string, ModrinthVersion[] | null | 'loading'>>({});

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
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<ModrinthVersion | null>(null);
  const [selectedProject, setSelectedProject] = useState<ModrinthSearchHit | null>(null);
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [installStatus, setInstallStatus] = useState<Record<string, boolean>>({});
  const [loadingStatus, setLoadingStatus] = useState(false);

  // Add new state for sidebar visibility
  const [isSidebarVisible, setIsSidebarVisible] = useState(initialSidebarVisible);

  // Add state for currently selected profile
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);

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

    if (newSearch) {
      console.log('[ModrinthSearchV2] New search, resetting offset.');
      setOffset(0);
      // setSearchResults([]); // DO NOT clear previous results here to prevent flicker
    }

    console.log('[ModrinthSearchV2] Proceeding with API call. Setting loading true.');
    setLoading(true);
    setError(null);

    try {
      const response: ModrinthSearchResponse = await ModrinthService.searchProjects(
        searchTerm,
        projectType,
        selectedGameVersions.length > 0 ? selectedGameVersions[0] : undefined, 
        currentSelectedLoaders.length > 0 ? currentSelectedLoaders[0] : undefined, 
        limit,
        newSearch ? 0 : offset,
        sortOrder,
        currentSelectedCategories.length > 0 ? currentSelectedCategories : undefined,
        filterClientRequired ? "required" : undefined,
        filterServerRequired ? "required" : undefined
      );
      setSearchResults(prevResults => newSearch ? response.hits : [...prevResults, ...response.hits]);
      setTotalHits(response.total_hits);
      if (!newSearch) {
        setOffset(prevOffset => prevOffset + response.hits.length);
      } else {
        setOffset(response.hits.length);
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
    }
  }, [
    searchTerm, projectType, offset, limit, sortOrder,
    currentSelectedCategories, selectedGameVersions, currentSelectedLoaders, 
    filterClientRequired, filterServerRequired,
    allCategoriesData, allLoadersData, gameVersionsData
  ]);

  useEffect(() => {
    console.log('[ModrinthSearchV2] useEffect for search triggered. Calling performSearch(true). Params:', {
      searchTerm,
      projectType,
      categories: currentSelectedCategories,
      gameVersions: selectedGameVersions,
      loaders: currentSelectedLoaders
    });
    
    // Scroll to top when filters/search term changes
    if (searchResultsAreaRef.current) {
      searchResultsAreaRef.current.scrollTop = 0;
    }
    
    // Reset expanded versions when filter changes
    setExpandedVersions({});
    setNumDisplayedVersions({});
    setVersionFilters({});
    
    performSearch(true);
  }, [
    searchTerm, projectType, sortOrder,
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
      const versions = await ModrinthService.getModVersions(projectId);
      const sortedVersions = versions.sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime());
      
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
  const checkDisplayedVersionsStatus = async (projectId: string, versions: ModrinthVersion[], startIndex: number, count: number, forceRefresh: string[] = []) => {
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
  const getFilteredVersions = (projectId: string, versions: ModrinthVersion[]) => {
    if (!versionFilters[projectId]) return versions;
    
    const filters = versionFilters[projectId];
    
    return versions.filter(version => {
      // Filter by version type
      if (filters.versionType !== 'all' && version.version_type !== filters.versionType) {
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

  // Open install modal
  const openInstallModal = async (project: ModrinthSearchHit, version: ModrinthVersion) => {
    setSelectedVersion(version);
    setSelectedProject(project);
    setInstallModalOpen(true);
    setLoadingStatus(true);
    setInstallStatus({}); // Reset install status

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

    } catch (error) {
      console.error("[openInstallModal] Failed to check installation status for modal:", error);
      // Fallback: Initialize all statuses to false if there's a general error (e.g., no primary file)
      const fallbackStatuses: Record<string, boolean> = {};
      internalProfiles.forEach(profile => {
        fallbackStatuses[profile.id] = false;
      });
      setInstallStatus(fallbackStatuses);
    } finally {
      setLoadingStatus(false);
    }
  };

  // Close install modal
  const closeInstallModal = () => {
    setInstallModalOpen(false);
    setSelectedVersion(null);
    setSelectedProject(null);
    setInstallStatus({});
    setInstalling({});
  };

  // Install mod to selected profile
  const installToProfile = async (profileId: string) => {
    if (!selectedVersion || !selectedProject) {
      toast.error("Missing required installation information");
      return;
    }

    setInstalling(prev => ({ ...prev, [profileId]: true }));

    try {
      const primaryFile = selectedVersion.files.find(file => file.primary) || selectedVersion.files[0];
      if (!primaryFile) {
        toast.error("No download file available for the selected version.");
        setInstalling(prev => ({ ...prev, [profileId]: false }));
        return;
      }

      const mappedContentType = mapModrinthProjectTypeToNrContentType(selectedProject.project_type as ModrinthProjectType);
      if (!mappedContentType) {
        setInstalling(prev => ({ ...prev, [profileId]: false }));
        return;
      }
      
      // Special handling for modpacks: should not reach here if mapModrinthProjectTypeToNrContentType works correctly
      if (selectedProject.project_type === 'modpack') {
        toast.error("Modpacks must be installed as new profiles.");
        setInstalling(prev => ({ ...prev, [profileId]: false }));
        return;
      }

      const payload: InstallContentPayload = {
        profile_id: profileId,
        project_id: selectedProject.project_id,
        version_id: selectedVersion.id,
        file_name: primaryFile.filename,
        download_url: primaryFile.url,
        file_hash_sha1: primaryFile.hashes?.sha1 || undefined,
        content_name: selectedProject.title,
        version_number: selectedVersion.version_number,
        content_type: mappedContentType,
        loaders: selectedVersion.loaders,
        game_versions: selectedVersion.game_versions,
      };

      await installContentToProfile(payload);

      toast.success(`Successfully installed ${selectedProject.title} (${selectedVersion.version_number}) to ${internalProfiles.find(p => p.id === profileId)?.name || 'profile'}`);
      
      setInstallStatus(prev => ({ ...prev, [profileId]: true }));
      
      setInstalledProjects(prev => ({
        ...prev,
        [selectedProject.project_id]: getStatusForNewInstall(prev[selectedProject.project_id])
      }));
      
      // Fix für den TypeScript-Fehler: Verwende die korrekte verschachtelte Struktur
      setInstalledVersions(prev => {
        const newState = { ...prev };
        const currentProfileId = profileId;
        
        if (!newState[currentProfileId]) {
          newState[currentProfileId] = {};
        }
        
        newState[currentProfileId][selectedVersion.id] = getStatusForNewInstall(
          newState[currentProfileId][selectedVersion.id]
        );
        
        return newState;
      });

      justInstalledOrToggledRef.current = true; // Set flag
      if (onInstallSuccess) {
        onInstallSuccess();
      }
      
    } catch (error) {
      toast.error(`Failed to install: ${error instanceof Error ? error.message : String(error)}`);
      console.error("Install error in installToProfile:", error);
    } finally {
      setInstalling(prev => ({ ...prev, [profileId]: false }));
    }
  };

  // New function to install directly to the selected profile without opening a modal
  const handleDirectInstall = async (project: ModrinthSearchHit, version: ModrinthVersion) => {
    if (!selectedProfile) {
      // Open the install modal instead of showing an error
      openInstallModal(project, version);
      return;
    }
    
    const profileId = selectedProfile.id;
    const profileName = selectedProfile.name;
    
    setInstallingVersion(prev => ({ ...prev, [version.id]: true }));
    
    toast.promise(
      async () => {
        const primaryFile = version.files.find(file => file.primary) || version.files[0];
        if (!primaryFile) {
          throw new Error("No primary file found for this version");
        }
        
        // Based on project type
        if (project.project_type === 'mod' || project.project_type === 'modpack') {
          // Use mod-specific API for mods and modpacks
          await ProfileService.addModrinthModToProfile(
            profileId,
            project.project_id,
            version.id,
            primaryFile.filename,
            primaryFile.url,
            primaryFile.hashes?.sha1 || undefined,
            project.title,
            version.version_number,
            version.loaders,
            version.game_versions
          );
        } else {
          // Use content API for resourcepacks, shaders, and datapacks
          await ProfileService.addModrinthContentToProfile(
            profileId,
            project.project_id,
            version.id,
            primaryFile.filename,
            primaryFile.url,
            primaryFile.hashes?.sha1 || null,
            project.title,
            version.version_number,
            project.project_type
          );
        }
        
        // Update project status for this profile - always set to installed when a version is installed
        setInstalledProjects(prev => ({
          ...prev,
          [project.project_id]: getStatusForNewInstall(prev[project.project_id])
        }));
        
        // Update version status to installed and enabled for this profile
        setInstalledVersions(prev => {
          // Erstelle eine Kopie des vorherigen Zustands
          const newState = { ...prev };
          
          // Stelle sicher, dass der Profil-Eintrag existiert
          if (!newState[profileId]) {
            newState[profileId] = {};
          }
          
          // Aktualisiere den Versions-Status für dieses Profil
          newState[profileId][version.id] = getStatusForNewInstall(
            newState[profileId][version.id]
          );
          
          return newState;
        });
        
        // No need to call checkDisplayedVersionsStatus since we already know the state
        // This reduces server load and improves performance

        justInstalledOrToggledRef.current = true; // Set flag
        if (onInstallSuccess) {
            onInstallSuccess();
        }
      },
      {
        loading: `Installing ${project.title} (${version.version_number}) to ${profileName}...`,
        success: `Successfully installed ${project.title} (${version.version_number}) to ${profileName}`,
        error: (err) => `Failed to install: ${err.message || String(err)}`
      }
    ).catch(error => {
        // Catch is mostly for toast.promise rejections that don't get auto-logged by toast
        console.error("Direct install error (toast.promise rejected):", error);
    });
    setInstallingVersion(prev => ({ ...prev, [version.id]: false })); // Stop loading for this version
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
  const [quickInstallProject, setQuickInstallProject] = useState<ModrinthSearchHit | null>(null);
  const [quickInstallVersions, setQuickInstallVersions] = useState<ModrinthVersion[] | null>(null);
  const [quickInstallLoading, setQuickInstallLoading] = useState(false); // Loading for fetching versions for modal
  const [quickInstallError, setQuickInstallError] = useState<string | null>(null);
  const [quickInstallingProjects, setQuickInstallingProjects] = useState<Record<string, boolean>>({}); // New state for card button loading
  const [installingModpackAsProfile, setInstallingModpackAsProfile] = useState<Record<string, boolean>>({}); // New state for modpack install loading
  const [installingVersion, setInstallingVersion] = useState<Record<string, boolean>>({}); // New state for specific version install loading
  const [installingModpackVersion, setInstallingModpackVersion] = useState<Record<string, boolean>>({}); // New state for modpack version install loading

  // Helper function to map Modrinth project type to our ContentType enum
  function mapModrinthProjectTypeToNrContentType(projectType: ModrinthProjectType): NrContentType | null {
    switch (projectType) {
      case 'mod':
        return NrContentType.Mod;
      case 'resourcepack':
        return NrContentType.ResourcePack;
      case 'shader':
        return NrContentType.ShaderPack;
      case 'datapack':
        return NrContentType.DataPack;
      case 'modpack': // Modpacks are handled by creating a new profile
        toast.error("Modpacks should be installed as new profiles, not as content via this method.");
        return null;
      default:
        // Log unhandled project types if any, but avoid throwing error that breaks UI
        console.warn(`Unsupported Modrinth project type for direct installation: ${projectType}`);
        toast.error(`Cannot directly install project type: ${projectType}`);
        return null;
    }
  }

  // Find the best version for a profile
  const findBestVersionForProfile = (profile: Profile, versions: ModrinthVersion[]): ModrinthVersion | null => {
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

  // Function to handle quick install
  const quickInstall = async (project: ModrinthSearchHit) => {
    if (selectedProfile) {
      setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: true }));
      
      try {
        // Step 1: Fetch versions
        const versions = await ModrinthService.getModVersions(project.project_id);
        if (!versions || versions.length === 0) {
          toast(`No versions found for ${project.title}. Opening selection modal.`);
          setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
          // Fall through to modal opening logic below
        } else {
          // Step 2: Find best version
          const sortedVersions = versions.sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime());
          const bestVersionForDirectInstall = findBestVersionForProfile(selectedProfile, sortedVersions);

          if (!bestVersionForDirectInstall) {
            toast(`No compatible version of ${project.title} for profile '${selectedProfile.name}'. Opening selection modal.`);
            setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
            // Fall through to modal opening logic below
          } else {
            // Step 3: Get primary file
            const primaryFileForDirectInstall = bestVersionForDirectInstall.files.find(f => f.primary) || bestVersionForDirectInstall.files[0];
            if (!primaryFileForDirectInstall) {
              toast(`No primary file for selected version of ${project.title}. Opening selection modal.`);
              setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
              // Fall through to modal opening logic below
            } else {
              // Step 4: Check content type
              const mappedContentType = mapModrinthProjectTypeToNrContentType(project.project_type as ModrinthProjectType);
              if (!mappedContentType) {
                // mapModrinthProjectTypeToNrContentType already shows a toast (e.g., for modpacks).
                // This means the project type is not suitable for direct content installation.
                // Do not open the modal in this case.
                setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
                return; // EXIT: Not suitable for direct install or modal.
              }

              // Step 5: Attempt direct install
              const payload: InstallContentPayload = {
                profile_id: selectedProfile.id,
                project_id: project.project_id,
                version_id: bestVersionForDirectInstall.id,
                file_name: primaryFileForDirectInstall.filename,
                download_url: primaryFileForDirectInstall.url,
                file_hash_sha1: primaryFileForDirectInstall.hashes?.sha1 || undefined,
                content_name: project.title,
                version_number: bestVersionForDirectInstall.version_number,
                content_type: mappedContentType,
                loaders: bestVersionForDirectInstall.loaders,
                game_versions: bestVersionForDirectInstall.game_versions,
              };

              await toast.promise(
                installContentToProfile(payload),
                {
                  loading: `Installing ${project.title} (${bestVersionForDirectInstall.version_number}) to ${selectedProfile.name}...`,
                  success: `Successfully installed ${project.title} (${bestVersionForDirectInstall.version_number}) to ${selectedProfile.name}`,
                  error: (err) => `Failed to install: ${err.message || String(err)}`,
                }
              );

              // Success: update states & exit
              setInstalledProjects(prev => ({
                ...prev,
                [project.project_id]: getStatusForNewInstall(prev[project.project_id])
              }));
              setInstalledVersions(prev => {
                const newState = { ...prev };
                if (!newState[selectedProfile.id]) newState[selectedProfile.id] = {};
                newState[selectedProfile.id][bestVersionForDirectInstall.id] = getStatusForNewInstall(
                  newState[selectedProfile.id][bestVersionForDirectInstall.id]
                );
                return newState;
              });
              justInstalledOrToggledRef.current = true;
              if (onInstallSuccess) onInstallSuccess();
              setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
              return; // EXIT: Direct install successful.
            }
          }
        }
      } catch (error) { // Catches errors from getModVersions or the installContentToProfile promise
        console.error(`Direct install attempt for ${project.title} to profile ${selectedProfile.name} failed:`, error);
        // Toast.promise would have shown an error for installContentToProfile.
        // For other errors (e.g. getModVersions), a generic toast is good.
        if (!(error instanceof Error && error.message?.includes('installContentToProfile'))) {
            toast.error(`An error occurred with direct install for ${project.title}. Opening selection modal.`);
        }
        setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
        // Fall through to modal opening logic below
      }
      // If we reach here after selectedProfile was true, it means direct install failed (or was bypassed)
      // and intends to fall through to open the modal. Ensure loading is off.
      setQuickInstallingProjects(prev => ({ ...prev, [project.project_id]: false }));
    }

    // ---- Common Modal Opening Logic ----
    // This part executes if:
    // 1. selectedProfile was null from the start.
    // 2. selectedProfile was set, but the direct install attempt failed and fell through.
    
    setQuickInstallProject(project);
    setQuickInstallModalOpen(true);
    setQuickInstallLoading(true);
    setQuickInstallVersions(null);
    setQuickInstallError(null);
    setInstallStatus({});
    
    try {
      // Fetch versions for this project (for the modal)
      const versionsForModal = await ModrinthService.getModVersions(project.project_id);
      
      if (versionsForModal.length === 0) {
        setQuickInstallError('No versions found for this project');
        setQuickInstallLoading(false);
        return;
      }
      
      const sortedVersionsForModal = versionsForModal.sort((a, b) => 
        new Date(b.date_published).getTime() - new Date(a.date_published).getTime()
      );
      
      setQuickInstallVersions(sortedVersionsForModal);
      
      const newInstallStatuses: Record<string, boolean> = {};
      for (const profile of internalProfiles) {
        const bestVersion = findBestVersionForProfile(profile, sortedVersionsForModal);
        if (bestVersion) {
          const primaryFile = bestVersion.files.find(file => file.primary) || bestVersion.files[0];
          if (primaryFile) {
            const request: ContentCheckRequest = {
              project_id: project.project_id,
              version_id: bestVersion.id,
              file_hash_sha1: primaryFile.hashes?.sha1,
              file_name: primaryFile.filename,
              project_type: project.project_type as ModrinthProjectType,
              loader: bestVersion.loaders[0],
              pack_version_number: bestVersion.version_number,
              request_id: bestVersion.id
            };
            try {
              const batchResults = await ProfileService.batchCheckContentInstalled({
                profile_id: profile.id,
                requests: [request]
              });
              if (batchResults && batchResults.results && batchResults.results.length > 0 && batchResults.results[0].status) {
                newInstallStatuses[profile.id] = !!batchResults.results[0].status.is_installed;
              } else {
                newInstallStatuses[profile.id] = false;
              }
            } catch (err) {
              console.error(`Batch check failed for profile ${profile.name} (ID: ${profile.id}) and project ${project.title} in modal:`, err);
              newInstallStatuses[profile.id] = false;
            }
          } else {
            newInstallStatuses[profile.id] = false;
          }
        } else {
          newInstallStatuses[profile.id] = false;
        }
      }
      setInstallStatus(newInstallStatuses);

    } catch (error) {
      console.error("Failed to fetch versions for quick install modal:", error);
      setQuickInstallError(`Failed to fetch versions for modal: ${error instanceof Error ? error.message : String(error)}`);
      const fallbackStatuses: Record<string, boolean> = {};
      internalProfiles.forEach(profile => { fallbackStatuses[profile.id] = false; });
      setInstallStatus(fallbackStatuses);
    } finally {
      setQuickInstallLoading(false);
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
      toast.error("Missing required installation information");
      return;
    }

    const profile = internalProfiles.find(p => p.id === profileId);
    if (!profile) {
      toast.error("Profile not found");
      return;
    }

    const bestVersion = findBestVersionForProfile(profile, quickInstallVersions);
    if (!bestVersion) {
      toast.error(`No compatible version found for ${profile.name}`);
      return;
    }

    setInstalling(prev => ({ ...prev, [profileId]: true }));

    try {
      const primaryFile = bestVersion.files.find(file => file.primary) || bestVersion.files[0];
      if (!primaryFile) {
        toast.error("No download file available for the selected version.");
        setInstalling(prev => ({ ...prev, [profileId]: false }));
        return;
      }

      const mappedContentType = mapModrinthProjectTypeToNrContentType(quickInstallProject.project_type as ModrinthProjectType);
      if (!mappedContentType) {
        setInstalling(prev => ({ ...prev, [profileId]: false }));
        return;
      }
      
      if (quickInstallProject.project_type === 'modpack') {
          toast.error("Modpacks must be installed as new profiles.");
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
        content_name: quickInstallProject.title,
        version_number: bestVersion.version_number,
        content_type: mappedContentType,
        loaders: bestVersion.loaders,
        game_versions: bestVersion.game_versions,
      };

      await installContentToProfile(payload);

      toast.success(`Successfully installed ${quickInstallProject.title} (${bestVersion.version_number}) to ${profile.name}`);
      
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
      toast.error(`Failed to install: ${error instanceof Error ? error.message : String(error)}`);
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

  const handleInstallModpackAsProfile = async (project: ModrinthSearchHit) => {
    if (project.project_type !== 'modpack') {
      toast.error("This handler is primarily for modpacks. For other types, behavior might differ.");
      if (onInstallSuccess) {
        onInstallSuccess();
      }
      return;
    }
    setInstallingModpackAsProfile(prev => ({ ...prev, [project.project_id]: true })); // Start loading
    const toastId = toast.loading(`Fetching versions for ${project.title}...`);

    try {
      const allVersions = await ModrinthService.getModVersions(project.project_id);

      if (!allVersions || allVersions.length === 0) {
        throw new Error("No versions found for this modpack.");
      }

      // Sort all versions by date published, newest first
      const sortedVersions = allVersions.sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime());

      // Try to find the latest 'release' version
      let latestVersion = sortedVersions.find(v => v.version_type === 'release');

      // If no release version is found, fall back to the absolute latest version
      if (!latestVersion) {
        latestVersion = sortedVersions[0];
      }

      if (!latestVersion || !latestVersion.files || latestVersion.files.length === 0) { throw new Error("Latest version has no files."); }
      const primaryFile = latestVersion.files.find(f => f.primary) || latestVersion.files[0];
      if (!primaryFile) { throw new Error("No primary file found for the latest version."); }

      toast.loading(`Installing ${project.title} (v${latestVersion.version_number}) as new profile...`, { id: toastId });
      const newProfileId = await ModrinthService.downloadAndInstallModpack(
        project.project_id,
        latestVersion.id,
        primaryFile.filename, 
        primaryFile.url,
        project.icon_url || undefined // Pass icon_url here
      );
      toast.success(
        (t) => (
          <div className="flex flex-col">
            <span>Successfully installed {project.title} as a new profile!</span>
            <span className="text-xs text-gray-400">Profile ID: {newProfileId}</span>
            {/* TODO: Maybe add a button to switch to this profile or open its settings */}
          </div>
        ),
        { id: toastId, duration: 1000 }
      );

      try {
        // Wait for the profile list to be updated in the global store
        await useProfileStore.getState().fetchProfiles();
        const updatedProfiles = useProfileStore.getState().profiles;
        setInternalProfiles(updatedProfiles); // Sync local state

        // Now it's safe to navigate
        navigate(`/profiles/${newProfileId}`);
      } catch (profileError) {
        console.error("Failed to refresh profiles list internally:", profileError);
        toast.error("Profile installed, but failed to navigate automatically.");
      }

      // Conditionally call onInstallSuccess
      if (project.project_type !== 'modpack' && onInstallSuccess) {
        onInstallSuccess();
      }
      // For modpacks, onInstallSuccess is intentionally skipped to prevent page reload,
      // as internalProfiles state is updated directly.

    } catch (err: any) {
      console.error("Failed to install modpack as profile:", err);
      toast.error(`Error installing ${project.title}: ${err.message || 'Unknown error'}`, { id: toastId });
    } finally {
      setInstallingModpackAsProfile(prev => ({ ...prev, [project.project_id]: false })); // Stop loading
    }
  };

  const handleInstallModpackVersionAsProfile = async (project: ModrinthSearchHit, version: ModrinthVersion) => {
    if (project.project_type !== 'modpack') {
      toast.error("This handler is primarily for modpack versions. For other types, behavior might differ.");
      if (onInstallSuccess) {
        onInstallSuccess();
      }
      return;
    }
    if (!version || !version.files || version.files.length === 0) {
      toast.error("Selected version has no files.");
      return;
    }

    setInstallingModpackVersion(prev => ({ ...prev, [version.id]: true })); // Start loading for this modpack version

    const primaryFile = version.files.find(f => f.primary) || version.files[0];
    if (!primaryFile) { 
        toast.error("No primary file found for the selected version."); 
        return; 
    }
    const toastId = toast.loading(`Installing ${project.title} (version ${version.version_number}) as new profile...`);

    try {
      const newProfileId = await ModrinthService.downloadAndInstallModpack(
        project.project_id,
        version.id,
        primaryFile.filename, 
        primaryFile.url,
        project.icon_url || undefined // Pass icon_url here
      );
      toast.success(
        (t) => (
          <div className="flex flex-col">
            <span>Successfully installed {project.title} (v{version.version_number}) as a new profile!</span>
            <span className="text-xs text-gray-400">Profile ID: {newProfileId}</span>
          </div>
        ),
        { id: toastId, duration: 1000 }
      );

      try {
        // Wait for the profile list to be updated in the global store
        await useProfileStore.getState().fetchProfiles();
        const updatedProfiles = useProfileStore.getState().profiles;
        setInternalProfiles(updatedProfiles); // Sync local state

        // Now it's safe to navigate
        navigate(`/profiles/${newProfileId}`);
      } catch (profileError) {
        console.error("Failed to refresh profiles list internally:", profileError);
        toast.error("Profile installed, but failed to navigate automatically.");
      }

      // Conditionally call onInstallSuccess
      if (project.project_type !== 'modpack' && onInstallSuccess) {
        onInstallSuccess();
      }
      // For modpacks, onInstallSuccess is intentionally skipped.

    } catch (err: any) {
      console.error("Failed to install modpack version as profile:", err);
      toast.error(`Error installing ${project.title}: ${err.message || 'Unknown error'}`, { id: toastId });
    } finally {
      setInstallingModpackVersion(prev => ({ ...prev, [version.id]: false })); // Stop loading for this modpack version
    }
  };

  const handleInstallToNewProfile = async (
    profileName: string,
    project: ModrinthSearchHit,
    version: ModrinthVersion,
    sourceProfileIdToCopy?: string | null // Parameter for copying
  ): Promise<void> => {

    const installationPromise = async () => {
      let newProfileId: string;
      let successMessageDetail = `Successfully created profile '${profileName}'`;
      const store = useProfileStore.getState(); // Store-Instanz holen

      if (sourceProfileIdToCopy) {
        const sourceProfile = internalProfiles.find(p => p.id === sourceProfileIdToCopy);
        const sourceProfileName = sourceProfile ? sourceProfile.name : "source profile";
        
        // Verwende die Store-Methode copyProfile
        newProfileId = await store.copyProfile(
          sourceProfileIdToCopy, 
          profileName,
          undefined, // includeFiles is undefined, as we want to include all
          true       // includeAll is true
        );
        successMessageDetail = `Successfully copied profile '${profileName}' from '${sourceProfileName}'`;

      } else {
        const gameVersion = version.game_versions[0] || 'unknown';
        let loader = 'vanilla';
        if (project.project_type === 'mod' || project.project_type === 'modpack') {
          loader = version.loaders[0] || 'vanilla';
        }

        // Verwende die Store-Methode createProfile
        newProfileId = await store.createProfile({
          name: profileName,
          game_version: gameVersion,
          loader: loader,
        });
      }

      const primaryFile = version.files.find((f) => f.primary) || version.files[0];
      if (!primaryFile) {
        throw new Error("No primary file found for the selected version.");
      }

      const mappedContentType = mapModrinthProjectTypeToNrContentType(project.project_type as ModrinthProjectType);
      if (!mappedContentType) {
        throw new Error(`Unsupported project type for installation: ${project.project_type}`);
      }

      // Safeguard: Modpacks should not be installed as content here.
      // mapModrinthProjectTypeToNrContentType handles toast, but this ensures error propagation for toast.promise
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
        content_name: project.title,
        version_number: version.version_number,
        content_type: mappedContentType,
        loaders: version.loaders,
        game_versions: version.game_versions,
      };

      await installContentToProfile(payload);
      
      // The actual installation success of the content is handled by installContentToProfile.
      // This promise now mainly returns details for the toast message about profile creation/copying.
      return { successMessageDetail, projectTitle: project.title, versionNumber: version.version_number };
    };

    try {
      const loadingMessage = sourceProfileIdToCopy
        ? `Copying profile '${profileName}' and installing ${project.title} (${version.version_number})...` 
        : `Creating profile '${profileName}' and installing ${project.title} (${version.version_number})...`;

      await toast.promise(
        installationPromise(),
        {
          loading: loadingMessage,
          success: (data) => `${data.successMessageDetail} and installed ${data.projectTitle} v${data.versionNumber}!`,
          error: (err) => `Operation failed: ${err.message || 'Unknown error'}`,
        },
        {
          // success: { duration: 6000 }, 
        }
      );

      const refreshed = await ProfileService.getAllProfilesAndLastPlayed();
      setInternalProfiles(refreshed.all_profiles);
      
      // Call onInstallSuccess if it exists and the installed content was not a modpack
      // (Modpack specific installations as new profiles might have their own success handlers or flows)
      if (project.project_type !== 'modpack' && onInstallSuccess) {
        justInstalledOrToggledRef.current = true; // Set flag (also here for consistency if onInstallSuccess runs)
        onInstallSuccess();
      }

    } catch (err: any) {
      // This catch is for errors not caught by toast.promise or re-thrown
      console.error("Failed to create/copy profile and install content:", err);
      // toast.promise already shows an error, so re-throwing might not be necessary unless specific handling is needed here.
      // throw err; 
    }
  };

  // Function to handle deleting a version from a profile
  const handleDeleteVersionFromProfile = async (
    profileId: string, // This is the definitive profile ID for this operation
    project: ModrinthSearchHit,
    version: ModrinthVersion
  ) => {
    // REMOVED: if (!selectedProfile) { ... }

    const profileName = internalProfiles.find(p => p.id === profileId)?.name || profileId;

    const primaryFile = version.files.find(file => file.primary) || version.files[0];
    if (!primaryFile) {
      toast.error("No primary file found for the version. Cannot determine details for deletion.");
      return;
    }

    const payload: UninstallContentPayload = {
      profile_id: profileId,
      sha1_hash: primaryFile.hashes?.sha1 || undefined,
    };

    if (!payload.sha1_hash) {
      toast.error("SHA1 hash is missing for this version. Cannot proceed with deletion.");
      console.error("Deletion failed: SHA1 hash missing for", project.title, version.version_number, primaryFile);
      return;
    }

    console.log("Attempting to remove content with payload:", payload);

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
          if (installModalOpen && selectedProject?.project_id === project.project_id && selectedVersion?.id === version.id) {
            setInstallStatus(prev => ({ ...prev, [profileId]: false }));
          }
          if (quickInstallModalOpen && quickInstallProject?.project_id === project.project_id) {
            setInstallStatus(prev => ({ ...prev, [profileId]: false }));
          }

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
        error: (err) => `Failed to remove: ${err.message || String(err)}`,
      }
    );
  };

  // New function to handle toggling enable/disable state of a version
  const handleToggleEnableVersion = async (
    profileId: string,
    project: ModrinthSearchHit,
    version: ModrinthVersion,
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
      toast.error("Cannot enable/disable version: missing file hash");
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
          sortOptions={sortOptions.map(opt => ({ // Map to SelectOption structure if not already
            value: opt.value,
            label: opt.label,
            icon: opt.icon
          }))}
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
        />

        {/* Search Results Area (scrollable within the left content area) */}
        <div ref={searchResultsAreaRef} className="search-results-area flex-1 overflow-y-auto"> {/* Removed p-4 */}
          {/* {loading && searchResults.length === 0 && <p className="p-4 text-center">Loading initial results...</p>} REMOVED */}
          {searchResults.length === 0 && !loading && error && (
            <p className="p-4 text-red-500 text-center">Error: {error}</p>
          )}
          {searchResults.length === 0 && !loading && !error && (
            <p className="p-4 text-center text-gray-400">No results found. Try adjusting filters or search term.</p>
          )}

          {searchResults.length > 0 && (
            <Virtuoso
              style={{ height: '100%' }} // Ensure Virtuoso takes full height of its container
              data={searchResults}
              endReached={loadMoreResults}
              itemContent={(index, hit) => {
                const projectVersions = expandedVersions[hit.project_id];
                const displayedCount = numDisplayedVersions[hit.project_id] || initialDisplayCount;
                const currentProjectInstallStatus = selectedProfile ? installedProjects[hit.project_id] : null;
                const currentVersionFilters = versionFilters[hit.project_id] || { gameVersions: [], loaders: [], versionType: 'all' };
                const currentVersionDropdownUIState = versionDropdownUIState[hit.project_id] || { showAllGameVersions: false, gameVersionSearchTerm: '' };
                const currentOpenVersionDropdowns = openVersionDropdowns[hit.project_id] || { type: false, gameVersion: false, loader: false };

                return (
                  <ModrinthProjectCardV2
                    key={hit.project_id}
                    itemIndex={index} // Pass Virtuoso index as itemIndex
                    hit={hit}
                    accentColor={accentColor}
                    installStatus={currentProjectInstallStatus}
                    isQuickInstalling={quickInstallingProjects[hit.project_id] || false} // Pass loading state
                    isInstallingModpackAsProfile={installingModpackAsProfile[hit.project_id] || false} // Pass new loading state
                    installingVersionStates={installingVersion} // Pass the whole record for version install states
                    installingModpackVersionStates={installingModpackVersion} // Pass new state for modpack versions
                    onQuickInstallClick={quickInstall}
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
                    // showAllGameVersionsSidebar={showAllGameVersionsSidebar} // This seems to be main filter, not per card
                    // selectedGameVersionsSidebar={selectedGameVersions} // This seems to be main filter, not per card
                    showAllGameVersionsSidebar={showAllGameVersionsSidebar} // Pass main filter state
                    selectedGameVersionsSidebar={selectedGameVersions} // Pass main filter state
                    onVersionFilterChange={handleVersionFilterChange}
                    onVersionUiStateChange={handleVersionDropdownUIChange}
                    onToggleVersionDropdown={toggleVersionDropdown}
                    onCloseAllVersionDropdowns={closeAllVersionDropdowns}
                    onLoadMoreVersions={loadMoreProjectVersions}
                    onInstallVersionClick={handleDirectInstall} // Changed from openInstallModal
                    onHoverVersion={setHoveredVersionId}
                    onDeleteVersionClick={handleDeleteVersionFromProfile}
                    onToggleEnableClick={handleToggleEnableVersion} // Pass the new handler
                  />
                );
              }}
              // Optional: if you want a footer for loading or "no more items"
              components={{
                Footer: () => {
                  if (loading && searchResults.length > 0) { // Show loading indicator only when loading more, not initial load
                    return (
                      <div className="p-4 text-center">
                        Loading more items...
                      </div>
                    );
                  }
                  if (!loading && searchResults.length > 0 && searchResults.length >= totalHits) {
                     return (
                      <div className="p-4 text-center text-sm text-gray-400">
                        No more results.
                      </div>
                    );
                  }
                  return null;
                },
              }}
            />
          )}
          
          {/* Load More button - Retained for cases where Virtuoso might not trigger endReached correctly, or as fallback.
              Virtuoso's endReached should ideally handle this. Consider removing if endReached is reliable.
           */}
          {!loading && searchResults.length > 0 && searchResults.length < totalHits && !Virtuoso && ( // Conditionally render if not using Virtuoso, or as fallback
            <Button 
              onClick={loadMoreResults}
              variant="ghost" // Changed from default to ghost
              size="md"
              className="w-full mt-4"
              disabled={loading}
            >
              Load More ({totalHits - searchResults.length} remaining)
            </Button>
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

      {/* Regular Install Modal */}
      {selectedProject && selectedVersion && installModalOpen && (
        <ModrinthInstallModalV2
          isOpen={installModalOpen}
          onClose={() => setInstallModalOpen(false)}
          project={selectedProject}
          version={selectedVersion}
          profiles={internalProfiles}
          selectedProfileId={selectedProfile?.id}
          isLoadingStatus={loadingStatus} // Corrected from loadingProfiles to loadingStatus based on typical modal prop names
          installStatus={installStatus}
          installingProfiles={installing}
          onInstallToProfile={(profileId) => {
            // Call the existing installToProfile function which uses selectedProject and selectedVersion
            installToProfile(profileId);
          }}
          onUninstallClick={async (profileId, project, version) => {
            await handleDeleteVersionFromProfile(profileId, project, version);
          }}
          onInstallToNewProfile={handleInstallToNewProfile}
        />
      )}

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