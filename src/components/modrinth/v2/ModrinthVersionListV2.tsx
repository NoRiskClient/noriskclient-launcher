import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ModrinthGameVersion,
  ModrinthSearchHit,
} from "../../../types/modrinth";
import type { UnifiedVersion } from "../../../types/unified";
import type { AccentColor } from "../../../store/useThemeStore";
import type { ContentInstallStatus } from "../../../types/profile";
import { Icon } from "@iconify/react";
import { Button } from "../../ui/buttons/Button";
import { VersionTable, type VersionRowState } from "../../mods/VersionTable";
import { FilterDropdown } from "../../ui/FilterDropdown";
import { Select, type SelectOption } from "../../ui/Select";
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
  installedVersions: Record<string, ContentInstallStatus | null>;
  installingVersionStates?: Record<string, boolean>;
  installingModpackVersionStates?: Record<string, boolean>;
  selectedProfile: any | null; // Replace 'any' with actual Profile type if available
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
  onLoadMore: (projectId: string) => void;
  onInstallClick: (
    project: ModrinthSearchHit,
    version: UnifiedVersion,
  ) => void;
  onInstallModpackVersionAsProfileClick?: (
    project: ModrinthSearchHit,
    version: UnifiedVersion,
  ) => void;
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
  installedVersions,
  installingVersionStates,
  installingModpackVersionStates,
  selectedProfile,
  gameVersionsData,
  showAllGameVersionsSidebar,
  selectedGameVersionsSidebar,
  onFilterChange,
  onUiStateChange,
  onLoadMore,
  onInstallClick,
  onInstallModpackVersionAsProfileClick,
  selectedProfileId,
  onDeleteClick,
  onToggleEnableClick,
  isProjectBlocked = false, // Deprecated
  projectNoRiskStatus = null,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
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
      })),
    ],
    [availableGameVersions, t],
  );

  const loaderOptions = useMemo(
    () => [
      { value: "all", label: t('mod_detail.versions.all_loaders') },
      ...availableLoaders.map((loader) => ({
        value: loader,
        label: loader,
      })),
    ],
    [availableLoaders, t],
  );


  const stateFor = (version: UnifiedVersion): VersionRowState | null => {
    const status = selectedProfile ? installedVersions?.[version.id] ?? null : null;
    const noRisk = (version as { noRiskStatus?: string }).noRiskStatus ?? projectNoRiskStatus;
    return {
      installed: !!status?.is_installed,
      enabled: status?.is_enabled,
      inPack: !!status?.is_included_in_norisk_pack,
      blocked: noRisk === "blocked" || !!isProjectBlocked,
    };
  };

  const isModpack = project.project_type === "modpack";

  const handleToggleEnabled = (version: UnifiedVersion, enabled: boolean) => {
    if (!onToggleEnableClick || !selectedProfileId || isModpack) return;
    const status = installedVersions?.[version.id];
    if (status?.norisk_pack_item_details?.norisk_mod_identifier) {
      onToggleEnableClick(selectedProfileId, project, version, enabled, "");
      return;
    }
    const primaryFile = version.files.find((f) => f.primary) || version.files[0];
    if (primaryFile?.hashes?.sha1) {
      onToggleEnableClick(selectedProfileId, project, version, enabled, primaryFile.hashes.sha1);
    }
  };

  return (
    <div ref={containerRef} className="p-3 relative">
      <div className="mb-3 flex items-center gap-2">
        <FilterDropdown
          icon="solar:tag-bold"
          value={filters.versionType}
          onChange={(value) => onFilterChange(projectId, "versionType", value)}
          options={versionTypeOptions}
          className="flex-1 min-w-0"
        />
        <FilterDropdown
          icon="solar:gamepad-bold"
          multiple
          value={filters.gameVersions}
          onChange={(value) => onFilterChange(projectId, "gameVersions", value)}
          options={gameVersionOptions}
          className="flex-1 min-w-0"
        />
        <FilterDropdown
          icon="solar:box-bold"
          multiple
          value={filters.loaders}
          onChange={(value) => onFilterChange(projectId, "loaders", value)}
          options={loaderOptions}
          className="flex-1 min-w-0"
        />
        <button
          type="button"
          aria-pressed={!!uiState?.showAllGameVersions}
          onClick={() => onUiStateChange(projectId, "showAllGameVersions", !uiState?.showAllGameVersions)}
          title={t('modrinth.show_all_versions')}
          className={`shrink-0 h-[42px] px-3 flex items-center gap-2 rounded-lg border font-minecraft text-sm transition-colors ${
            uiState?.showAllGameVersions
              ? "bg-white/10 border-white/25 text-white"
              : "bg-black/50 border-white/10 text-white/60 hover:text-white hover:border-white/20"
          }`}
        >
          <Icon icon="solar:history-bold" className="w-4 h-4" />
          <span className="normal-case">{t('modrinth.show_all_versions')}</span>
        </button>
      </div>

      {filteredVersions.length > 0 ? (
        <div className="space-y-2">
          <VersionTable
            versions={filteredVersions.slice(0, displayedCount)}
            remaining={filteredVersions.length - displayedCount}
            onLoadMore={() => onLoadMore(projectId)}
            installingIds={{ ...(installingVersionStates ?? {}), ...(installingModpackVersionStates ?? {}) }}
            stateFor={stateFor}
            onInstall={(version) =>
              isModpack && onInstallModpackVersionAsProfileClick
                ? onInstallModpackVersionAsProfileClick(project, version)
                : onInstallClick(project, version)
            }
            onToggleEnabled={selectedProfileId && onToggleEnableClick && !isModpack ? handleToggleEnabled : undefined}
            onDelete={
              selectedProfileId && onDeleteClick && !isModpack
                ? (version) => onDeleteClick(selectedProfileId, project, version)
                : undefined
            }
          />
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-white/50 text-center font-minecraft">
          {t('modrinth.no_versions_match_filters')}
        </div>
      )}
    </div>
  );
};
