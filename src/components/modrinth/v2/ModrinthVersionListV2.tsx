"use client";

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ModrinthGameVersion,
  ModrinthSearchHit,
  ModrinthVersion,
} from "../../../types/modrinth";
import type { UnifiedVersion } from "../../../types/unified";
import type { AccentColor } from "../../../store/useThemeStore";
import type { ContentInstallStatus } from "../../../types/profile";
import { Icon } from "@iconify/react";
import { Button } from "../../ui/buttons/Button";
import { Checkbox } from "../../ui/Checkbox";
import { ModrinthVersionItemV2 } from "./ModrinthVersionItemV2";
import { Select, type SelectOption } from "../../ui/Select";
import { TagBadge } from "../../ui/TagBadge";
import { gsap } from "gsap";
import { useThemeStore } from "../../../store/useThemeStore";

// --- Define Props for the new component ---
interface ModrinthVersionListV2Props {
  projectId: string;
  project: ModrinthSearchHit;
  versions: UnifiedVersion[];
  displayedCount: number;
  filters: {
    gameVersions: string[];
    loaders: string[];
    versionType: string;
  };
  uiState: {
    showAllGameVersions: boolean;
    gameVersionSearchTerm: string;
  };
  openDropdowns: {
    type: boolean;
    gameVersion: boolean;
    loader: boolean;
  };
  installedVersions: Record<string, ContentInstallStatus | null>;
  installingVersionStates?: Record<string, boolean>;
  installingModpackVersionStates?: Record<string, boolean>;
  selectedProfile: any | null; // Replace 'any' with actual Profile type if available
  accentColor: AccentColor;
  hoveredVersionId: string | null;
  gameVersionsData: ModrinthGameVersion[]; // Needed for filtering
  showAllGameVersionsSidebar: boolean; // State from main sidebar
  selectedGameVersionsSidebar: string[]; // State from main sidebar
  onFilterChange: (
    projectId: string,
    filterType: "gameVersions" | "loaders" | "versionType",
    value: string | string[],
  ) => void;
  onUiStateChange: (
    projectId: string,
    field: keyof ModrinthVersionListV2Props["uiState"],
    value: boolean | string,
  ) => void;
  onToggleDropdown: (
    projectId: string,
    dropdownType: "type" | "gameVersion" | "loader",
  ) => void;
  onCloseAllDropdowns: (projectId: string) => void;
  onLoadMore: (projectId: string) => void;
  onInstallClick: (
    project: ModrinthSearchHit,
    version: UnifiedVersion,
  ) => void;
  onInstallModpackVersionAsProfileClick?: (
    project: ModrinthSearchHit,
    version: UnifiedVersion,
  ) => void;
  onHoverVersion: (id: string | null) => void;
  selectedProfileId?: string | null;
  onDeleteClick?: (
    profileId: string,
    project: ModrinthSearchHit,
    version: UnifiedVersion,
  ) => void;
  onToggleEnableClick?: (
    profileId: string,
    project: ModrinthSearchHit,
    version: UnifiedVersion,
    newEnabledState: boolean,
    sha1Hash: string,
  ) => void;
  isProjectBlocked?: boolean; // Deprecated, use projectNoRiskStatus instead
  projectNoRiskStatus?: 'blocked' | 'warning' | null;
}

// --- Component Implementation ---
export const ModrinthVersionListV2: React.FC<ModrinthVersionListV2Props> = ({
  projectId,
  project,
  versions,
  displayedCount,
  filters,
  uiState,
  openDropdowns,
  installedVersions,
  installingVersionStates,
  installingModpackVersionStates,
  selectedProfile,
  accentColor,
  hoveredVersionId,
  gameVersionsData,
  showAllGameVersionsSidebar,
  selectedGameVersionsSidebar,
  onFilterChange,
  onUiStateChange,
  onToggleDropdown,
  onCloseAllDropdowns,
  onLoadMore,
  onInstallClick,
  onInstallModpackVersionAsProfileClick,
  onHoverVersion,
  selectedProfileId,
  onDeleteClick,
  onToggleEnableClick,
  isProjectBlocked = false, // Deprecated
  projectNoRiskStatus = null,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [showFilters, setShowFilters] = useState(false);
  const isAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);

  // Create Select options for version type
  const versionTypeOptions: SelectOption[] = [
    { value: "all", label: t('mod_detail.versions.all_types') },
    { value: "release", label: t('mod_detail.versions.release') },
    { value: "beta", label: t('mod_detail.versions.beta') },
    { value: "alpha", label: t('mod_detail.versions.alpha') },
  ];

  // Animation for the container when it mounts
  useEffect(() => {
    if (containerRef.current && isAnimationEnabled) {
      // Use a more performant animation approach
      requestAnimationFrame(() => {
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
      });
    }
  }, [isAnimationEnabled]);

  // Update showFilters state when filters change
  useEffect(() => {
    setShowFilters(
      filters.gameVersions.length > 0 ||
        filters.loaders.length > 0 ||
        filters.versionType !== "all",
    );
  }, [filters]);

  // --- Helper function to get filtered versions (moved from parent) ---
  const getFilteredVersions = (
    allVersions: UnifiedVersion[],
  ): UnifiedVersion[] => {
    if (!filters) return allVersions;

    return allVersions.filter((version) => {
      // Filter by version type
      if (
        filters.versionType !== "all" &&
        version.release_type !== filters.versionType
      ) {
        return false;
      }

      // Filter by game versions (if any selected)
      if (filters.gameVersions.length > 0) {
        const hasMatchingGameVersion = version.game_versions.some((gv) =>
          filters.gameVersions.includes(gv),
        );
        if (!hasMatchingGameVersion) return false;
      }

      // Filter by loaders (if any selected)
      if (filters.loaders.length > 0) {
        const hasMatchingLoader = version.loaders.some((loader) =>
          filters.loaders.includes(loader),
        );
        if (!hasMatchingLoader) return false;
      }

      return true;
    });
  };

  const filteredVersions = useMemo(
    () => getFilteredVersions(versions),
    [versions, filters.versionType, filters.gameVersions, filters.loaders],
  );

  // Get available game versions
  const availableGameVersions = useMemo(() => {
    const allProjectGameVersionsSet = new Set(
      versions.flatMap((v) => v.game_versions),
    );
    let availableGVs = Array.from(allProjectGameVersionsSet);

    if (!uiState?.showAllGameVersions) {
      // Apply main sidebar filters when checkbox is OFF
      if (selectedGameVersionsSidebar.length > 0) {
        availableGVs = availableGVs.filter((gv) =>
          selectedGameVersionsSidebar.includes(gv),
        );
      }
      if (!showAllGameVersionsSidebar) {
        const releaseVersions = new Set(
          gameVersionsData
            .filter((v) => v.version_type === "release")
            .map((v) => v.version),
        );
        availableGVs = availableGVs.filter((gv) => releaseVersions.has(gv));
      }
    }

    // Sort versions
    return availableGVs.sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }),
    );
  }, [
    versions,
    uiState?.showAllGameVersions,
    selectedGameVersionsSidebar,
    showAllGameVersionsSidebar,
    gameVersionsData,
  ]);

  // Get available loaders for the current project type
  const availableLoaders = useMemo(() => {
    // Get loaders that are actually used in this project's versions
    const projectLoaders = Array.from(
      new Set(versions.flatMap((v) => v.loaders)),
    );

    // Only show loaders that are relevant to this project
    return projectLoaders.sort();
  }, [versions]);

  // Create game version options
  const gameVersionOptions = useMemo(
    () => [
      { value: "all", label: t('mod_detail.versions.all_game_versions') },
      ...availableGameVersions.map((gv) => ({
        value: gv,
        label: gv,
        icon: filters.gameVersions.includes(gv) ? (
          <Icon icon="solar:check-circle-bold" className="w-4 h-4" />
        ) : undefined,
      })),
    ],
    [availableGameVersions, filters.gameVersions],
  );

  const loaderOptions = useMemo(
    () => [
      { value: "all", label: t('mod_detail.versions.all_loaders') },
      ...availableLoaders.map((loader) => ({
        value: loader,
        label: loader,
        icon: filters.loaders.includes(loader) ? (
          <Icon icon="solar:check-circle-bold" className="w-4 h-4" />
        ) : undefined,
      })),
    ],
    [availableLoaders, filters.loaders],
  );

  // Handle clearing all filters
  const handleClearAllFilters = () => {
    onFilterChange(projectId, "versionType", "all");
    onFilterChange(projectId, "gameVersions", []);
    onFilterChange(projectId, "loaders", []);
  };

  // --- JSX Rendering (To be moved here in the next step) ---
  return (
    <div ref={containerRef} className="p-3 relative">
      {/* Header with version filters - New design */}
      <div
        className="mb-4 p-3 rounded-lg border backdrop-blur-sm"
        style={{
          backgroundColor: `${accentColor.value}10`,
          borderColor: `${accentColor.value}30`,
        }}
      >
        <div className="flex flex-wrap gap-2 items-center">
          {/* Version Type Select */}
          <div className="relative">
            <Select
              value={filters.versionType}
              onChange={(value) => {
                onFilterChange(projectId, "versionType", value);
              }}
              options={versionTypeOptions}
              size="sm"
              className="w-40"
            />
          </div>

          {/* Game Version Select */}
          <div className="relative">
            <Select
              value={
                filters.gameVersions.length > 0
                  ? filters.gameVersions[0]
                  : "all"
              }
              onChange={(value) => {
                if (value === "all") {
                  onFilterChange(projectId, "gameVersions", []);
                } else {
                  // Toggle the selected version
                  const current = filters.gameVersions || [];
                  const isAlreadySelected = current.includes(value);
                  const newValue = isAlreadySelected
                    ? current.filter((v) => v !== value)
                    : [...current, value];
                  onFilterChange(projectId, "gameVersions", newValue);
                }
              }}
              options={gameVersionOptions}
              size="sm"
              className="w-52"
            />
          </div>

          {/* Loader Select */}
          <div className="relative">
            <Select
              value={filters.loaders.length > 0 ? filters.loaders[0] : "all"}
              onChange={(value) => {
                if (value === "all") {
                  onFilterChange(projectId, "loaders", []);
                } else {
                  // Toggle the selected loader
                  const current = filters.loaders || [];
                  const isAlreadySelected = current.includes(value);
                  const newValue = isAlreadySelected
                    ? current.filter((l) => l !== value)
                    : [...current, value];
                  onFilterChange(projectId, "loaders", newValue);
                }
              }}
              options={loaderOptions}
              size="sm"
              className="w-40"
            />
          </div>

          {/* Show checkbox for 'Show All' when using game versions dropdown */}
          <div className="ml-auto">
            <Checkbox
              id={`show-all-gv-${projectId}`}
              label={t('modrinth.show_all_versions')}
              checked={uiState?.showAllGameVersions || false}
              onChange={(e) =>
                onUiStateChange(
                  projectId,
                  "showAllGameVersions",
                  e.target.checked,
                )
              }
              className="text-sm"
            />
          </div>
        </div>

        {showFilters && (
          <div className="flex items-center mt-2 gap-2">
            <div
              className="flex-1 border rounded-md h-[48px] overflow-x-auto overflow-y-hidden whitespace-nowrap hide-scrollbar"
              style={{
                backgroundColor: `${accentColor.value}08`,
                borderColor: `${accentColor.value}30`,
              }}
            >
              <div className="flex items-center gap-1.5 p-2">
                <TagBadge
                  variant="destructive"
                  className="cursor-pointer hover:brightness-110 transition-all flex-shrink-0 flex items-center"
                  onClick={handleClearAllFilters}
                >
                  <Icon icon="solar:trash-bin-trash-bold" className="w-3 h-3 mr-1.5" />
                  <span>{t('content.filters.clear_all')}</span>
                </TagBadge>

                {filters.versionType !== "all" && (
                  <TagBadge 
                    variant="filter"
                    className="inline-flex whitespace-nowrap">
                    {t('mod_detail.type')}: {filters.versionType}
                    <button
                      onClick={() =>
                        onFilterChange(projectId, "versionType", "all")
                      }
                      className="ml-1.5 text-current opacity-70 hover:opacity-100 focus:outline-none"
                      aria-label={`Remove version type ${filters.versionType}`}
                    >
                      <Icon
                        icon="solar:close-circle-bold"
                        className="w-3 h-3"
                      />
                    </button>
                  </TagBadge>
                )}

                {filters.gameVersions.map((version) => (
                  <TagBadge
                    key={`gv-${version}`}
                    variant="filter"
                    className="inline-flex whitespace-nowrap"
                  >
                    {version}
                    <button
                      onClick={() => {
                        const newVersions = filters.gameVersions.filter(
                          (v) => v !== version,
                        );
                        onFilterChange(projectId, "gameVersions", newVersions);
                      }}
                      className="ml-1.5 text-current opacity-70 hover:opacity-100 focus:outline-none"
                      aria-label={`Remove game version ${version}`}
                    >
                      <Icon
                        icon="solar:close-circle-bold"
                        className="w-3 h-3"
                      />
                    </button>
                  </TagBadge>
                ))}

                {filters.loaders.map((loader) => (
                  <TagBadge
                    key={`loader-${loader}`}
                    variant="filter"
                    className="inline-flex whitespace-nowrap"
                  >
                    {loader}
                    <button
                      onClick={() => {
                        const newLoaders = filters.loaders.filter(
                          (l) => l !== loader,
                        );
                        onFilterChange(projectId, "loaders", newLoaders);
                      }}
                      className="ml-1.5 text-current opacity-70 hover:opacity-100 focus:outline-none"
                      aria-label={`Remove loader ${loader}`}
                    >
                      <Icon
                        icon="solar:close-circle-bold"
                        className="w-3 h-3"
                      />
                    </button>
                  </TagBadge>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filtered Versions List - Moved from ModrinthSearchV2 */}
      {filteredVersions.length > 0 ? (
        <div className="space-y-2">
          {filteredVersions.slice(0, displayedCount).map((version) => {
            const versionStatus = selectedProfile
              ? installedVersions?.[version.id] || null
              : null;
            const isInstalling = installingVersionStates?.[version.id] || false;
            const isInstallingModpackVersion =
              installingModpackVersionStates?.[version.id] || false;
            const isVersionHovered = hoveredVersionId === version.id;
            return (
              <ModrinthVersionItemV2
                key={version.id}
                version={version}
                project={project}
                versionStatus={versionStatus}
                isInstalling={isInstalling}
                isInstallingModpackVersion={isInstallingModpackVersion}
                accentColor={accentColor}
                isHovered={isVersionHovered}
                onMouseEnter={() => onHoverVersion(version.id)}
                onMouseLeave={() => onHoverVersion(null)}
                onInstallClick={onInstallClick}
                onInstallModpackVersionAsProfileClick={
                  onInstallModpackVersionAsProfileClick
                }
                selectedProfileId={selectedProfileId}
                onDeleteClick={onDeleteClick}
                onToggleEnableClick={onToggleEnableClick}
                noRiskStatus={(version as any).noRiskStatus || projectNoRiskStatus}
              />
            );
          })}
          {/* Load More Button */}
          {filteredVersions.length > displayedCount && (
            <Button
              onClick={() => onLoadMore(projectId)}
              variant="ghost"
              size="xs"
              shadowDepth="short"
              className="w-full mt-2 text-xs"
            >
              {t('content.search.load_more', { remaining: filteredVersions.length - displayedCount })}
            </Button>
          )}
        </div>
      ) : (
        <div
          className="relative overflow-hidden transition-colors duration-150 rounded-md p-4 text-sm text-gray-400 text-center border-2 border-b-4 backdrop-blur-md"
          style={{
            borderColor: `${accentColor.value}60`,
            borderBottomColor: accentColor.value,
            boxShadow: `0 8px 0 rgba(0,0,0,0.3), 0 10px 15px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 0 0 1px rgba(255,255,255,0.05)`,
            backgroundColor: `${accentColor.value}15`,
          }}
        >
          {t('modrinth.no_versions_match_filters')}
        </div>
      )}
    </div>
  );
};
