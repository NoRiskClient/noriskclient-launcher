"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { ModrinthService } from "../../services/modrinth-service";
import { ProfileSelectionPopup } from "./ProfileSelectionPopup";
import type {
  ModrinthFile,
  ModrinthProjectType,
  ModrinthSearchHit,
  ModrinthSearchResponse,
  ModrinthSortType,
  ModrinthVersion,
} from "../../types/modrinth";
import type {
  CheckContentParams,
  ContentInstallStatus,
  Profile,
} from "../../types/profile";
import { ModrinthProjectCard } from "./ModrinthProjectCard";
import { ModrinthVersionItem } from "./ModrinthVersionItem";
import { LoadingIndicator } from "../ui/LoadingIndicator";
import { ErrorMessage } from "../ui/ErrorMessage";
import { EmptyState } from "../ui/EmptyState";
import { useModrinthInstaller } from "../../hooks/useModrinthInstaller";
import { Input } from "../ui/Input";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { Select } from "../ui/Select";
import { Label } from "../ui/Label";
import { useThemeStore } from "../../store/useThemeStore";

function CategoryTransitionLoader() {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);

  return (
    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm flex flex-col items-center justify-center z-10 animate-fadeIn">
      <div className="relative w-16 h-16 mb-4">
        <div className="absolute inset-0 border-4 border-white/10 rounded-full"></div>
        <div
          className="absolute inset-0 border-4 border-t-white/80 rounded-full animate-spin"
          style={{ borderTopColor: accentColor.value }}
        ></div>
      </div>
      <div className="font-minecraft text-3xl text-white/80 tracking-wide lowercase select-none">
        {t('modrinth.loading_content')}
      </div>
    </div>
  );
}

const PROJECT_TYPES: { type: ModrinthProjectType; labelKey: string }[] = [
  { type: "mod", labelKey: "modrinth.project_types.mods" },
  { type: "modpack", labelKey: "modrinth.project_types.modpacks" },
  { type: "resourcepack", labelKey: "modrinth.project_types.resource_packs" },
  { type: "shader", labelKey: "modrinth.project_types.shaders" },
  { type: "datapack", labelKey: "modrinth.project_types.datapacks" },
];

const SORT_OPTIONS: { type: ModrinthSortType; labelKey: string }[] = [
  { type: "relevance", labelKey: "modrinth.sort.relevance" },
  { type: "downloads", labelKey: "modrinth.sort.downloads" },
  { type: "follows", labelKey: "modrinth.sort.followers" },
  { type: "newest", labelKey: "modrinth.sort.newest" },
  { type: "updated", labelKey: "modrinth.sort.recently_updated" },
];

interface ModrinthSearchProps {
  profiles: Profile[];
  onInstallSuccess?: () => void;
  className?: string;
  initialProjectType?: ModrinthProjectType;
  projectId?: string;
  autoInstall?: boolean;
  selectedProfileId?: string;
  onProfileCreated?: (profileId: string) => void;
  parentTransitionActive?: boolean;
  onProjectTypeChange?: (type: ModrinthProjectType) => void;
  selectedCategories?: string[];
  selectedGameVersions?: string[];
  selectedLoaders?: string[];
  selectedEnvironmentOptions?: string[];
}

export const ModrinthSearch: React.FC<ModrinthSearchProps> = ({
  profiles = [],
  onInstallSuccess,
  className = "",
  initialProjectType = "mod",
  projectId = null,
  autoInstall = false,
  selectedProfileId = null,
  onProfileCreated,
  parentTransitionActive = false,
  onProjectTypeChange,
  selectedCategories = [],
  selectedGameVersions = [],
  selectedLoaders = [],
  selectedEnvironmentOptions = [],
}) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<ModrinthSearchHit[]>([]);
  const [, setSearchResponse] = useState<ModrinthSearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const accentColor = useThemeStore((state) => state.accentColor);

  const [selectedProjectType, setSelectedProjectType] =
    useState<ModrinthProjectType>(initialProjectType);
  const [selectedSortType, setSelectedSortType] =
    useState<ModrinthSortType>("relevance");

  const [selectedGameVersion, setSelectedGameVersion] = useState<
    string | undefined
  >(undefined);
  const [selectedLoader, setSelectedLoader] = useState<string | undefined>(
    undefined,
  );
  const [, setAvailableGameVersions] = useState<string[]>([]);
  const [, setAvailableLoaders] = useState<string[]>([]);

  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageSize] = useState(20);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    projectId,
  );
  const [modVersions, setModVersions] = useState<ModrinthVersion[]>([]);
  const [filteredVersions, setFilteredVersions] = useState<ModrinthVersion[]>(
    [],
  );
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [, setCurrentlySelectedHit] = useState<ModrinthSearchHit | null>(null);

  const searchInProgressRef = useRef(false);

  const validProfiles = Array.isArray(profiles) ? profiles : [];

  const [hitInstallStatus, setHitInstallStatus] = useState<
    Record<string, ContentInstallStatus | "loading" | "error" | null>
  >({});
  const [versionInstallStatus, setVersionInstallStatus] = useState<
    Record<string, ContentInstallStatus | "loading" | "error" | null>
  >({});

  const [modpackInstallState, setModpackInstallState] = useState<
    Record<string, "idle" | "adding" | "success" | "error">
  >({});

  const [categoryTransition, setCategoryTransition] = useState(false);
  const categoryTransitionTimer = useRef<NodeJS.Timeout | null>(null);

  const {
    installState: addingModState,
    error: addError,
    installToProfile: directInstallToProfile,
    installModpack,
    showProfilePopup,
    setShowProfilePopup,
    pendingInstall,
    setPendingInstall,
    handleProfileSelect,
    handleContentInstall,
  } = useModrinthInstaller(validProfiles, selectedProfileId, onInstallSuccess);

  const handleModpackInstall = async (
    version: ModrinthVersion,
    file: ModrinthFile,
  ) => {
    const versionId = version.id;
    setModpackInstallState((prev) => ({ ...prev, [versionId]: "adding" }));

    try {
      const newProfileId = await installModpack(version, file);

      setModpackInstallState((prev) => ({ ...prev, [versionId]: "success" }));

      if (onProfileCreated) {
        onProfileCreated(newProfileId);
      }

      setTimeout(() => {
        setModpackInstallState((prev) => ({ ...prev, [versionId]: "idle" }));
      }, 2000);
    } catch (error) {
      console.error("Modpack installation failed:", error);
      setModpackInstallState((prev) => ({ ...prev, [versionId]: "error" }));

      console.error(
        `Failed to install modpack: ${error instanceof Error ? error.message : String(error)}`,
      );

      setTimeout(() => {
        setModpackInstallState((prev) => ({ ...prev, [versionId]: "idle" }));
      }, 5000);
    }
  };

  const handleInstallButtonClick = (
    version: ModrinthVersion,
    file: ModrinthFile,
  ) => {
    event?.preventDefault?.();

    if (version.search_hit?.project_type === "modpack") {
      handleModpackInstall(version, file);
    } else {
      handleContentInstall(version, file);
    }
  };

  const updateHitInstallStatus = useCallback(
    async (hit: ModrinthSearchHit) => {
      if (!selectedProfileId) {
        setHitInstallStatus((prev) => ({ ...prev, [hit.project_id]: null }));
        return;
      }

      setHitInstallStatus((prev) => ({ ...prev, [hit.project_id]: "loading" }));

      const selectedProfile = validProfiles.find(
        (p) => p.id === selectedProfileId,
      );
      if (!selectedProfile) {
        setHitInstallStatus((prev) => ({ ...prev, [hit.project_id]: null }));
        return;
      }

      const params: CheckContentParams = {
        profile_id: selectedProfileId,
        project_id: hit.project_id,
        game_version: selectedProfile.game_version || null,
        loader: selectedProfile.loader || null,
        version_id: null,
        file_hash_sha1: null,
        file_name: null,
        project_type: hit.project_type,
      };

      try {
        console.debug(
          `Checking install status for ${hit.project_id} in profile ${selectedProfileId}`,
        );
        const status = await invoke<ContentInstallStatus>(
          "is_content_installed",
          { params },
        );
        console.debug(`Status for ${hit.project_id}:`, status);
        setHitInstallStatus((prev) => ({ ...prev, [hit.project_id]: status }));
      } catch (err) {
        console.error(
          `Failed to check install status for ${hit.project_id}:`,
          err,
        );
        setHitInstallStatus((prev) => ({ ...prev, [hit.project_id]: "error" }));
      }
    },
    [selectedProfileId, validProfiles],
  );

  const updateAllHitStatuses = useCallback(
    async (hits: ModrinthSearchHit[]) => {
      const promises = hits.map((hit) => updateHitInstallStatus(hit));
      await Promise.all(promises);
    },
    [updateHitInstallStatus],
  );

  const updateVersionStatuses = useCallback(
    async (versions: ModrinthVersion[]) => {
      if (!selectedProfileId || versions.length === 0) {
        setVersionInstallStatus({});
        return;
      }

      const selectedProfile = validProfiles.find(
        (p) => p.id === selectedProfileId,
      );
      if (!selectedProfile) {
        setVersionInstallStatus({});
        return;
      }

      let newVersionStatuses: Record<
        string,
        ContentInstallStatus | "loading" | "error" | null
      > = {};

      const promises = versions.map(async (version) => {
        newVersionStatuses = { ...newVersionStatuses, [version.id]: "loading" };
        setVersionInstallStatus({ ...newVersionStatuses });

        const primaryFile =
          version.files.find((f) => f.primary) ?? version.files[0];
        const fileHash = primaryFile?.hashes?.sha1;
        const fileName = primaryFile?.filename;

        const params: CheckContentParams = {
          profile_id: selectedProfileId,
          project_id: version.project_id,
          version_id: version.id,
          file_hash_sha1: fileHash || null,
          file_name: fileName || null,
          pack_version_number: version.version_number,
          project_type: version.search_hit?.project_type || null,
          game_version: selectedProfile.game_version || null,
          loader: selectedProfile.loader || null,
        };

        try {
          console.info(`Checking specific install status for version`, version);
          const status = await invoke<ContentInstallStatus>(
            "is_content_installed",
            { params },
          );
          console.info(`Status for version ${version.id}:`, status);
          newVersionStatuses = { ...newVersionStatuses, [version.id]: status };
        } catch (err) {
          console.error(
            `Failed to check specific install status for version ${version.id}:`,
            err,
          );
          newVersionStatuses = { ...newVersionStatuses, [version.id]: "error" };
        }
      });

      await Promise.all(promises);
      setVersionInstallStatus(newVersionStatuses);
    },
    [selectedProfileId, validProfiles],
  );

  const requiresLoader = useCallback(
    (projectType: ModrinthProjectType = selectedProjectType) => {
      return projectType === "mod" || projectType === "modpack";
    },
    [selectedProjectType],
  );

  useEffect(() => {
    if (validProfiles.length > 0) {
      const gameVersions = [
        ...new Set(validProfiles.map((p) => p.game_version)),
      ].filter(Boolean);
      const loaders = [...new Set(validProfiles.map((p) => p.loader))].filter(
        Boolean,
      );

      setAvailableGameVersions(gameVersions);
      setAvailableLoaders(loaders);

      if (selectedProfileId) {
        const selectedProfile = validProfiles.find(
          (p) => p.id === selectedProfileId,
        );
        if (selectedProfile) {
          setSelectedGameVersion(selectedProfile.game_version);
          if (requiresLoader()) {
            setSelectedLoader(selectedProfile.loader);
          } else {
            setSelectedLoader(undefined);
          }
        } else {
          console.warn(
            "Selected profile not found in profiles array:",
            selectedProfileId,
          );
        }
      }
    } else {
      console.warn("No profiles available");
    }
  }, [validProfiles, selectedProfileId, requiresLoader]);

  useEffect(() => {
    if (!requiresLoader()) {
      setSelectedLoader(undefined);
    } else if (selectedProfileId) {
      const selectedProfile = validProfiles.find(
        (p) => p.id === selectedProfileId,
      );
      if (selectedProfile) {
        setSelectedLoader(selectedProfile.loader);
      }
    }
  }, [selectedProjectType, requiresLoader, selectedProfileId, validProfiles]);

  useEffect(() => {
    if (modVersions.length > 0) {
      let filtered = [...modVersions];

      if (selectedGameVersion) {
        filtered = filtered.filter((version) =>
          version.game_versions?.includes(selectedGameVersion),
        );
      }

      if (selectedLoader && requiresLoader()) {
        filtered = filtered.filter((version) =>
          version.loaders?.includes(selectedLoader),
        );
      }

      setFilteredVersions(filtered);
    } else {
      setFilteredVersions([]);
    }
  }, [modVersions, selectedGameVersion, selectedLoader, requiresLoader]);

  useEffect(() => {
    if (searchTerm.trim() === "") {
      setDebouncedSearchTerm("");
      return;
    }

    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 800);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const loadFeaturedContent = useCallback(
    async (projectType = selectedProjectType) => {
      if (searchInProgressRef.current) return;

      searchInProgressRef.current = true;

      setSearchLoading(true);
      setSearchError(null);
      setHitInstallStatus({});

      try {
        const loaderParam =
          projectType === "mod" || projectType === "modpack"
            ? selectedLoader
            : undefined;

        const response = await ModrinthService.searchProjects(
          "",
          projectType,
          selectedGameVersion,
          loaderParam,
          pageSize,
          0,
          "downloads",
        );

        const hitsArray = Array.isArray(response?.hits) ? response.hits : [];
        setSearchResponse(response);
        setSearchResults(hitsArray);
        setOffset(hitsArray.length);
        setHasMore(
          hitsArray.length === pageSize &&
            hitsArray.length < response.total_hits,
        );

        updateAllHitStatuses(hitsArray);
      } catch (err) {
        console.error("Failed to load featured content:", err);
        setSearchError(
          `Failed to load content: ${err instanceof Error ? err.message : String(err)}`,
        );
        setSearchResults([]);
        setSearchResponse(null);
      } finally {
        setSearchLoading(false);
        searchInProgressRef.current = false;
      }
    },
    [
      pageSize,
      selectedProjectType,
      selectedGameVersion,
      selectedLoader,
      updateAllHitStatuses,
    ],
  );

  const performSearch = useCallback(
    async (resetResults = true) => {
      if (resetResults && debouncedSearchTerm.trim() === "") return;

      if (searchInProgressRef.current) {
        return;
      }

      searchInProgressRef.current = true;

      if (resetResults) {
        setSearchLoading(true);
        setOffset(0);
        setHasMore(true);
      } else {
        setLoadingMore(true);
      }

      setSearchError(null);
      setHitInstallStatus({});
      const currentOffset = resetResults ? 0 : offset;

      try {
        // Use first game version if any selected, otherwise use the profile's game version
        const gameVersionParam = selectedGameVersions.length > 0 
          ? selectedGameVersions[0] 
          : selectedGameVersion;
          
        // Use first loader if any selected, otherwise use the profile's loader
        const loaderParam = selectedLoaders.length > 0 
          ? selectedLoaders[0] 
          : (requiresLoader() ? selectedLoader : undefined);

        const response = await ModrinthService.searchProjects(
          debouncedSearchTerm.trim(),
          selectedProjectType,
          gameVersionParam,
          loaderParam,
          pageSize,
          currentOffset,
          selectedSortType,
          selectedCategories.length > 0 ? selectedCategories : undefined,
          selectedEnvironmentOptions.includes("client") ? "required" : undefined,
          selectedEnvironmentOptions.includes("server") ? "required" : undefined,
        );

        const hitsArray = Array.isArray(response?.hits) ? response.hits : [];
        setSearchResponse(response);
        setSearchResults(hitsArray);
        setOffset(hitsArray.length);
        setHasMore(
          hitsArray.length === pageSize &&
            hitsArray.length < response.total_hits,
        );

        if (resetResults) {
          setSelectedProjectId(null);
          setModVersions([]);
          setFilteredVersions([]);
          setVersionsError(null);
        }

        updateAllHitStatuses(hitsArray);
      } catch (err) {
        console.error("Modrinth search failed:", err);
        setSearchError(
          `Search failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (resetResults) {
          setSearchResults([]);
          setSearchResponse(null);
        }
      } finally {
        if (resetResults) {
          setSearchLoading(false);
        } else {
          setLoadingMore(false);
        }

        searchInProgressRef.current = false;
      }
    },
    [
      debouncedSearchTerm,
      selectedProjectType,
      offset,
      pageSize,
      selectedSortType,
      selectedGameVersion,
      selectedLoader,
      requiresLoader,
      updateAllHitStatuses,
      selectedCategories,
      selectedGameVersions,
      selectedLoaders,
      selectedEnvironmentOptions,
    ],
  );

  useEffect(() => {
    if (projectId) {
      const loadProject = async () => {
        try {
          const projects = await ModrinthService.getProjectDetails([projectId]);
          if (!projects || projects.length === 0) {
            throw new Error("Project not found");
          }

          const project = projects[0];

          const searchHit: ModrinthSearchHit = {
            project_id: project.id,
            project_type: project.project_type,
            slug: project.slug,
            author: project.team || "Unknown",
            title: project.title,
            description: project.description,
            versions: project.versions,
            downloads: project.downloads,
            follows: project.followers,
            icon_url: project.icon_url,
            latest_version: project.versions[0] || null,
            categories: project.categories || [],
            display_categories: project.categories || [],
            client_side: project.client_side || "unknown",
            server_side: project.server_side || "unknown",
            date_created: project.published || "",
            date_modified: project.updated || "",
            license: project.license?.id || "unknown",
            gallery: project.gallery?.map(img => img.url) || [],
          };

          setSearchResults([searchHit]);
          setCurrentlySelectedHit(searchHit);
          setSelectedProjectId(projectId);
          setSelectedProjectType(project.project_type as ModrinthProjectType);

          await fetchVersions(projectId, searchHit);

          if (selectedProfileId) {
            updateHitInstallStatus(searchHit);
          }

          if (autoInstall && selectedProfileId) {
            setTimeout(() => {
              autoInstallLatestVersion(searchHit, selectedProfileId);
            }, 500);
          }
        } catch (error) {
          console.error("Failed to load project:", error);
          setSearchError(
            `Failed to load project: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      };

      loadProject();
    }
  }, [projectId, autoInstall, selectedProfileId, updateHitInstallStatus]);

  const fetchVersions = async (projectId: string, hit: ModrinthSearchHit) => {
    setVersionsLoading(true);
    setVersionsError(null);
    setModVersions([]);
    setFilteredVersions([]);
    setVersionInstallStatus({});

    try {
      const allVersionsData = await ModrinthService.getModVersions(
        projectId,
        undefined,
        undefined,
      );

      const versionsWithHit = allVersionsData.map((v) => ({
        ...v,
        search_hit: hit,
      }));

      setModVersions(versionsWithHit);

      if (selectedProfileId) {
        const selectedProfile = validProfiles.find(
          (p) => p.id === selectedProfileId,
        );
        if (selectedProfile) {
          let filtered = [...versionsWithHit];

          if (selectedProfile.game_version) {
            filtered = filtered.filter((version) =>
              version.game_versions?.includes(selectedProfile.game_version),
            );
          }

          if (
            (hit.project_type === "mod" || hit.project_type === "modpack") &&
            selectedProfile.loader
          ) {
            filtered = filtered.filter((version) =>
              version.loaders?.includes(selectedProfile.loader),
            );
          }

          setFilteredVersions(filtered);

          updateVersionStatuses(versionsWithHit);
        } else {
          console.warn("Selected profile not found:", selectedProfileId);
          setFilteredVersions(versionsWithHit);
        }
      } else {
        setFilteredVersions(versionsWithHit);
      }
    } catch (err) {
      console.error(`Failed to fetch versions for ${projectId}:`, err);
      setVersionsError(
        `Failed to load versions: ${err instanceof Error ? err.message : String(err)}`,
      );
      setModVersions([]);
      setFilteredVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  };

  const autoInstallLatestVersion = (
    hit: ModrinthSearchHit,
    profileId: string,
  ) => {
    if (filteredVersions.length === 0) {
      console.error("No versions available for auto-install");
      return;
    }

    const latestVersion = filteredVersions[0];
    const primaryFile =
      latestVersion.files.find((f) => f.primary) || latestVersion.files[0];

    if (!primaryFile) {
      console.error("No files available for auto-install");
      return;
    }

    if (hit.project_type === "modpack") {
      handleModpackInstall(latestVersion, primaryFile);
    } else {
      directInstallToProfile(latestVersion, primaryFile, profileId);
    }
  };

  // Effect to handle search with filters applied from the parent component
  useEffect(() => {
    if (projectId) {
      // If a specific project is being viewed, filter changes from parent don't trigger a new search here.
      return;
    }

    const filtersAreActive = 
      selectedCategories.length > 0 || 
      selectedGameVersions.length > 0 || 
      selectedLoaders.length > 0 || 
      selectedEnvironmentOptions.length > 0;

    if (filtersAreActive) {
      const searchWithAppliedFilters = async () => {
        if (searchInProgressRef.current) return;

        searchInProgressRef.current = true;
        setSearchLoading(true);
        setSearchError(null);
        setOffset(0); // Reset offset for new filter search
        setHasMore(true); // Assume more results initially

        try {
          const gameVersionParam = selectedGameVersions.length > 0 
            ? selectedGameVersions[0] 
            : selectedGameVersion; // Fallback to general selectedGameVersion
          
          const loaderParam = selectedLoaders.length > 0 
            ? selectedLoaders[0] 
            : (requiresLoader() ? selectedLoader : undefined); // Fallback to general selectedLoader

          const response = await ModrinthService.searchProjects(
            debouncedSearchTerm.trim(), // Use current search term
            selectedProjectType,
            gameVersionParam,
            loaderParam,
            pageSize,
            0, // Offset is 0 for a new filtered search
            selectedSortType,
            selectedCategories.length > 0 ? selectedCategories : undefined,
            selectedEnvironmentOptions.includes("client") ? "required" : undefined,
            selectedEnvironmentOptions.includes("server") ? "required" : undefined,
          );

          const hitsArray = Array.isArray(response?.hits) ? response.hits : [];
          setSearchResponse(response);
          setSearchResults(hitsArray);
          setOffset(hitsArray.length);
          setHasMore(
            hitsArray.length === pageSize &&
              hitsArray.length < response.total_hits
          );
          setSelectedProjectId(null);
          setModVersions([]);
          setFilteredVersions([]);
          setVersionsError(null);
          updateAllHitStatuses(hitsArray);
        } catch (err) {
          console.error("Modrinth filtered search (active filters) failed:", err);
          setSearchError(
            `Search failed: ${err instanceof Error ? err.message : String(err)}`
          );
          setSearchResults([]);
          setSearchResponse(null);
        } finally {
          setSearchLoading(false);
          searchInProgressRef.current = false;
        }
      };
      searchWithAppliedFilters();
    } else {
      // All filters are now empty (e.g., user cleared the last filter).
      const searchWithClearedFilters = async () => {
        if (searchInProgressRef.current) return;

        searchInProgressRef.current = true;
        setSearchLoading(true);
        setSearchError(null);
        setOffset(0); // Reset for a new search
        setHasMore(true);

        try {
          let response;
          if (debouncedSearchTerm.trim() !== "") {
            // Logic similar to performSearch(true) but without categories/env filters
            response = await ModrinthService.searchProjects(
              debouncedSearchTerm.trim(),
              selectedProjectType,
              selectedGameVersion, // Use general selectedGameVersion (profile's or last search)
              requiresLoader() ? selectedLoader : undefined, // Use general selectedLoader
              pageSize,
              0, // Offset is 0
              selectedSortType,
              undefined, // No categories as filters are cleared
              undefined, // No client env filter
              undefined  // No server env filter
            );
          } else {
            // Logic similar to loadFeaturedContent() but specifically for cleared filters
            response = await ModrinthService.searchProjects(
              "", // No query for featured
              selectedProjectType, // Current project type
              selectedGameVersion, // General selectedGameVersion
              requiresLoader() ? selectedLoader : undefined, // General selectedLoader
              pageSize,
              0, // Offset is 0
              "downloads", // Sort by downloads for featured
              undefined, // No categories
              undefined, // No client env filter
              undefined  // No server env filter
            );
          }

          const hitsArrayCleared = Array.isArray(response?.hits) ? response.hits : [];
          setSearchResponse(response);
          setSearchResults(hitsArrayCleared);
          setOffset(hitsArrayCleared.length);
          setHasMore(
            hitsArrayCleared.length === pageSize &&
            hitsArrayCleared.length < response.total_hits
          );
          setSelectedProjectId(null);
          setModVersions([]);
          setFilteredVersions([]);
          setVersionsError(null);
          updateAllHitStatuses(hitsArrayCleared);
        } catch (err) {
          console.error("Modrinth search (filters cleared) failed:", err);
          setSearchError(
            `Search failed: ${err instanceof Error ? err.message : String(err)}`
          );
          setSearchResults([]);
          setSearchResponse(null);
        } finally {
          setSearchLoading(false);
          searchInProgressRef.current = false;
        }
      };
      searchWithClearedFilters();
    }
  }, [
    // Primary triggers for this effect
    selectedCategories, 
    selectedGameVersions, 
    selectedLoaders, 
    selectedEnvironmentOptions,
    projectId,

    // Dependencies for the inline search logic (both branches)
    debouncedSearchTerm,
    selectedProjectType,
    selectedGameVersion, // General game version state (profile's or last search)
    selectedLoader,      // General loader state (profile's or last search)
    pageSize,
    selectedSortType,
    requiresLoader,      // Stable callback
    updateAllHitStatuses, // Stable callback
    // searchInProgressRef is a ref, state setters (setSearchLoading, etc.) are stable
  ]);

  useEffect(() => {
    const handleScroll = () => {
      if (
        !resultsContainerRef.current ||
        loadingMore ||
        !hasMore ||
        searchInProgressRef.current
      )
        return;

      const { scrollTop, scrollHeight, clientHeight } =
        resultsContainerRef.current;
      const scrollThreshold = scrollHeight - clientHeight - 200;

      if (scrollTop >= scrollThreshold) {
        performSearch(false);
      }
    };

    const container = resultsContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, [loadingMore, hasMore, performSearch]);

  const fetchAndShowVersions = useCallback(
    async (hit: ModrinthSearchHit) => {
      const projectId = hit.project_id;
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
        setModVersions([]);
        setFilteredVersions([]);
        setVersionsError(null);
        setCurrentlySelectedHit(null);
        setVersionInstallStatus({});
        return;
      }

      setSelectedProjectId(projectId);
      setCurrentlySelectedHit(hit);

      if (hit.project_type) {
        setSelectedProjectType(hit.project_type as ModrinthProjectType);
      }

      if (selectedProfileId) {
        const selectedProfile = validProfiles.find(
          (p) => p.id === selectedProfileId,
        );
        if (selectedProfile) {
          setSelectedGameVersion(selectedProfile.game_version);

          if (hit.project_type === "mod" || hit.project_type === "modpack") {
            setSelectedLoader(selectedProfile.loader);
          } else {
            setSelectedLoader(undefined);
          }
        }
      }

      await fetchVersions(projectId, hit);
    },
    [selectedProjectId, selectedProfileId, validProfiles],
  );

  const changeProjectType = useCallback(
    (newType: ModrinthProjectType) => {
      if (selectedProjectType === newType) return;

      setCategoryTransition(true);

      if (categoryTransitionTimer.current) {
        clearTimeout(categoryTransitionTimer.current);
      }

      categoryTransitionTimer.current = setTimeout(() => {
        setCategoryTransition(false);
      }, 800);

      setSelectedProjectType(newType);
      
      if (onProjectTypeChange) {
        onProjectTypeChange(newType);
      }

      if (newType !== "mod" && newType !== "modpack") {
        setSelectedLoader(undefined);
      }

      if (debouncedSearchTerm.trim() !== "") {
        const searchWithNewType = async () => {
          if (searchInProgressRef.current) return;

          searchInProgressRef.current = true;

          setSearchLoading(true);
          setSearchError(null);
          setOffset(0);
          setHasMore(true);
          setHitInstallStatus({});

          try {
            const loaderParam =
              newType === "mod" || newType === "modpack"
                ? selectedLoader
                : undefined;

            const response = await ModrinthService.searchProjects(
              debouncedSearchTerm.trim(),
              newType,
              selectedGameVersion,
              loaderParam,
              pageSize,
              0,
              selectedSortType,
            );

            const hitsArray = Array.isArray(response?.hits) ? response.hits : [];
            setSearchResponse(response);
            setSearchResults(hitsArray);
            setOffset(hitsArray.length);
            setHasMore(
              hitsArray.length === pageSize &&
                hitsArray.length < response.total_hits,
            );

            setSelectedProjectId(null);
            setModVersions([]);
            setFilteredVersions([]);
            setVersionsError(null);

            updateAllHitStatuses(hitsArray);
          } catch (err) {
            console.error("Modrinth search failed:", err);
            setSearchError(
              `Search failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            setSearchResults([]);
            setSearchResponse(null);
          } finally {
            setSearchLoading(false);
            searchInProgressRef.current = false;
          }
        };

        searchWithNewType();
      } else {
        loadFeaturedContent(newType);
      }
    },
    [
      selectedProjectType,
      debouncedSearchTerm,
      pageSize,
      selectedSortType,
      selectedGameVersion,
      selectedLoader,
      loadFeaturedContent,
      updateAllHitStatuses,
      onProjectTypeChange,
    ],
  );

  const changeSortType = useCallback(
    (newSort: ModrinthSortType) => {
      if (selectedSortType === newSort) return;

      setSelectedSortType(newSort);

      const searchWithNewSort = async () => {
        if (searchInProgressRef.current) return;

        searchInProgressRef.current = true;

        setSearchLoading(true);
        setSearchError(null);
        setOffset(0);
        setHasMore(true);
        setHitInstallStatus({});

        try {
          const loaderParam = requiresLoader() ? selectedLoader : undefined;

          const response = await ModrinthService.searchProjects(
            debouncedSearchTerm.trim(),
            selectedProjectType,
            selectedGameVersion,
            loaderParam,
            pageSize,
            0,
            newSort,
          );

          const hitsArray = Array.isArray(response?.hits) ? response.hits : [];
          setSearchResponse(response);
          setSearchResults(hitsArray);
          setOffset(hitsArray.length);
          setHasMore(
            hitsArray.length === pageSize &&
              hitsArray.length < response.total_hits,
          );

          setSelectedProjectId(null);
          setModVersions([]);
          setFilteredVersions([]);
          setVersionsError(null);

          updateAllHitStatuses(hitsArray);
        } catch (err) {
          console.error("Modrinth search failed:", err);
          setSearchError(
            `Search failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          setSearchResults([]);
          setSearchResponse(null);
        } finally {
          setSearchLoading(false);
          searchInProgressRef.current = false;
        }
      };

      searchWithNewSort();
    },
    [
      selectedSortType,
      selectedProjectType,
      debouncedSearchTerm,
      pageSize,
      selectedGameVersion,
      selectedLoader,
      requiresLoader,
      updateAllHitStatuses,
    ],
  );

  useEffect(() => {
    if (!projectId) {
      loadFeaturedContent();
    }
  }, []);

  useEffect(() => {
    return () => {
      if (categoryTransitionTimer.current) {
        clearTimeout(categoryTransitionTimer.current);
      }
    };
  }, []);

  const handleProfileSelection = async (profileId: string) => {
    if (!pendingInstall) return;

    try {
      await handleProfileSelect(profileId);
    } catch (error) {
      console.error("Error during installation:", error);
    }
  };

  const sortOptions = SORT_OPTIONS.map((option) => ({
    value: option.type,
    label: t(option.labelKey),
  }));

  return (
    <div className={`modrinth-search-container ${className} flex flex-col`}>
      {!projectId && (
        <>
          <div
            className="flex-shrink-0 mb-5 p-2 rounded-lg border-2 border-b-4 shadow-md overflow-x-auto scrollbar-hide"
            style={{
              backgroundColor: `${accentColor.value}20`,
              borderColor: `${accentColor.value}40`,
              borderBottomColor: `${accentColor.value}60`,
            }}
          >
            <div className="flex gap-2">
              {PROJECT_TYPES.map((tab) => (
                <Button
                  key={tab.type}
                  onClick={() => {
                    setCategoryTransition(true);

                    if (categoryTransitionTimer.current) {
                      clearTimeout(categoryTransitionTimer.current);
                    }

                    categoryTransitionTimer.current = setTimeout(() => {
                      setCategoryTransition(false);
                    }, 500);

                    changeProjectType(tab.type);
                  }}
                  variant={
                    selectedProjectType === tab.type ? "default" : "ghost"
                  }
                  size="md"
                  className={
                    selectedProjectType === tab.type
                      ? "text-white"
                      : "text-white/70"
                  }
                  disabled={searchLoading}
                >
                  {t(tab.labelKey).toLowerCase()}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-grow">
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('placeholders.search_modrinth')}
                clearable={searchTerm.length > 0}
                onClear={() => setSearchTerm("")}
                icon={<Icon icon="pixel:search" className="w-6 h-6" />}
                className="w-full"
              />
            </div>

            <div className="w-64">
              <Select
                value={selectedSortType}
                onChange={(value) => changeSortType(value as ModrinthSortType)}
                options={sortOptions}
                disabled={searchLoading}
              />
            </div>

            <IconButton
              icon={
                searchLoading ? (
                  <Icon
                    icon="pixel:circle-notch-solid"
                    className="animate-spin"
                  />
                ) : (
                  <Icon icon="pixel:search" />
                )
              }
              onClick={() => performSearch(true)}
              disabled={searchLoading || searchInProgressRef.current}
              size="lg"
            />
          </div>

          {searchError && (
            <ErrorMessage message={searchError} className="mb-4" />
          )}
        </>
      )}

      <div
        className="flex-1 min-h-0 overflow-hidden rounded-lg border-2 border-b-4 shadow-lg relative"
        style={{
          backgroundColor: `${accentColor.value}10`,
          borderColor: `${accentColor.value}40`,
          borderBottomColor: `${accentColor.value}60`,
        }}
      >
        {(searchLoading || categoryTransition) && !parentTransitionActive && (
          <CategoryTransitionLoader />
        )}

        <div
          ref={resultsContainerRef}
          className="h-full overflow-y-auto custom-scrollbar"
        >
          <div className="results-list space-y-4 p-4">
            {searchResults.length > 0 ? (
              <>
                {searchResults.map((hit) => (
                  <div key={hit.project_id} className="relative">
                    <ModrinthProjectCard
                      key={hit.project_id}
                      project={hit}
                      isExpanded={selectedProjectId === hit.project_id}
                      isLoading={
                        versionsLoading && selectedProjectId === hit.project_id
                      }
                      onToggleExpand={() => fetchAndShowVersions(hit)}
                      installStatus={hitInstallStatus[hit.project_id]}
                    >
                      {selectedProjectId === hit.project_id && (
                        <div
                          className="versions-container mt-4 pt-4 border-t"
                          style={{ borderColor: `${accentColor.value}30` }}
                        >
                          {versionsLoading ? (
                            <LoadingIndicator message={t('modrinth.loading_versions')} />
                          ) : versionsError ? (
                            <ErrorMessage message={versionsError} />
                          ) : filteredVersions.length > 0 ? (
                            <div>
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="text-white font-minecraft text-3xl tracking-wide lowercase select-none">
                                  {t('modrinth.available_versions')}
                                </h4>

                                {modVersions.length !==
                                  filteredVersions.length && (
                                  <Button
                                    onClick={() => {
                                      setFilteredVersions(modVersions);
                                      setSelectedGameVersion(undefined);
                                      setSelectedLoader(undefined);
                                    }}
                                    variant="ghost"
                                    size="sm"
                                    className="min-w-0"
                                    icon={
                                      <Icon
                                        icon="pixel:filter-solid"
                                        className="w-5 h-5"
                                      />
                                    }
                                  >
                                    {t('modrinth.show_all', { count: modVersions.length })}
                                  </Button>
                                )}
                              </div>
                              <div
                                className="versions-list space-y-3 max-h-96 overflow-y-auto custom-scrollbar pr-2"
                                style={{
                                  scrollbarColor: `${accentColor.value}50 transparent`,
                                }}
                              >
                                {filteredVersions.map((version) => {
                                  const primaryFile =
                                    version.files.find((f) => f.primary) ??
                                    version.files[0];
                                  const versionStatus =
                                    versionInstallStatus[version.id];
                                  const isVersionInstalled =
                                    typeof versionStatus === "object" &&
                                    versionStatus !== null &&
                                    versionStatus.is_installed;

                                  const isModpack =
                                    version.search_hit?.project_type ===
                                    "modpack";

                                  const installState = isModpack
                                    ? modpackInstallState[version.id] || "idle"
                                    : isVersionInstalled
                                      ? "success"
                                      : addingModState[version.id] || "idle";

                                  return primaryFile ? (
                                    <div key={version.id} className="relative">
                                      <ModrinthVersionItem
                                        key={version.id}
                                        version={version}
                                        file={primaryFile}
                                        installState={installState}
                                        onInstall={() =>
                                          handleInstallButtonClick(
                                            version,
                                            primaryFile,
                                          )
                                        }
                                        isModpack={isModpack}
                                      />

                                      <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center">
                                        {versionStatus === "loading" ? (
                                          <Label
                                            variant="info"
                                            size="xs"
                                            icon={
                                              <Icon
                                                icon="pixel:circle-notch-solid"
                                                className="w-4 h-4 animate-spin"
                                              />
                                            }
                                          />
                                        ) : versionStatus === "error" ? (
                                          <Label
                                            variant="destructive"
                                            size="xs"
                                            icon={
                                              <Icon
                                                icon="pixel:exclamation-triangle-solid"
                                                className="w-4 h-4"
                                              />
                                            }
                                            title={t('modrinth.error_check_status')}
                                          />
                                        ) : typeof versionStatus === "object" &&
                                          versionStatus !== null ? (
                                          <></>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null;
                                })}
                              </div>
                            </div>
                          ) : (
                            <EmptyState
                              message={
                                modVersions.length > 0
                                  ? t('modrinth.no_versions_match_filters')
                                  : t('modrinth.no_versions_criteria')
                              }
                            />
                          )}
                        </div>
                      )}
                    </ModrinthProjectCard>
                  </div>
                ))}

                {loadingMore && (
                  <LoadingIndicator message={t('modrinth.loading_more')} />
                )}

                {!hasMore && searchResults.length > 0 && !loadingMore && (
                  <div
                    className="text-center py-4 mt-2"
                    style={{
                      borderTopColor: `${accentColor.value}30`,
                      borderTopWidth: "1px",
                    }}
                  >
                    <p className="text-white/50 font-minecraft-ten text-2xl tracking-wide lowercase select-none">
                      {t('modrinth.end_of_results')}
                    </p>
                  </div>
                )}
              </>
            ) : !searchLoading && !searchError ? (
              <EmptyState
                icon="pixel:grid-solid"
                message={
                  searchTerm.trim()
                    ? t('empty_states.no_results_for', { query: searchTerm })
                    : searchResults.length === 0
                      ? t('empty_states.no_content_found')
                      : t('empty_states.browse_popular')
                }
              />
            ) : null}
          </div>
        </div>
      </div>

      {showProfilePopup && pendingInstall && (
        <ProfileSelectionPopup
          profiles={validProfiles}
          onSelect={handleProfileSelection}
          onCancel={() => {
            setShowProfilePopup(false);
            setPendingInstall(null);
          }}
          title={t('modrinth.profile_popup.title', { type: pendingInstall.version.search_hit?.project_type || "Content" })}
          description={t('modrinth.profile_popup.description', { title: pendingInstall.version.search_hit?.title || "this content" })}
          contentVersion={pendingInstall.version}
        />
      )}

      {addError && (
        <div
          className="fixed bottom-4 right-4 backdrop-blur-md px-4 py-3 font-minecraft-ten text-2xl shadow-md z-50 tracking-wide lowercase select-none"
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            borderColor: "rgba(239, 68, 68, 0.3)",
            borderWidth: "1px",
            color: "white",
          }}
        >
          <Icon
            icon="pixel:exclamation-triangle-solid"
            className="inline-block mr-2 w-5 h-5 text-red-400"
          />
          {addError}
        </div>
      )}
    </div>
  );
};
