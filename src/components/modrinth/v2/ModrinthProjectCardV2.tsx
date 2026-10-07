"use client";

import React, { useEffect } from "react";
import type {
  ModrinthGameVersion,
} from "../../../types/modrinth";
import type { UnifiedModSearchResult, UnifiedVersion } from "../../../types/unified";

// Unified project card supporting both Modrinth and CurseForge
type CompatibleProject = UnifiedModSearchResult;
import type { AccentColor } from "../../../store/useThemeStore";
import type { ContentInstallStatus } from "../../../types/profile";
import { ActionButton } from "../../ui/ActionButton";
import { Icon } from "@iconify/react";
import { TagBadge } from "../../ui/TagBadge";
import { cn } from "../../../lib/utils";
import { ModrinthVersionListV2 } from "./ModrinthVersionListV2";
import { openExternalUrl } from "../../../services/tauri-service";
import { toast } from "react-hot-toast";
import { preloadIcons } from "../../../lib/icon-utils";
import { useTranslation } from "react-i18next";
import { ThemedSurface } from "../../ui/ThemedSurface";
import { Tooltip } from "../../ui/Tooltip";
import { useNavigate } from "react-router-dom";

type Profile = any;

interface VersionListPassthroughProps {
  projectVersions: UnifiedVersion[] | null | "loading";
  displayedCount: number;
  versionFilters: {
    gameVersions: string[];
    loaders: string[];
    versionType: string;
  };
  versionDropdownUIState: {
    showAllGameVersions: boolean;
    gameVersionSearchTerm: string;
  };
  openVersionDropdowns: {
    type: boolean;
    gameVersion: boolean;
    loader: boolean;
  };
  installedVersions: Record<string, ContentInstallStatus | null>;
  selectedProfile: Profile | null;
  hoveredVersionId: string | null;
  gameVersionsData: ModrinthGameVersion[];
  showAllGameVersionsSidebar: boolean;
  selectedGameVersionsSidebar: string[];
  onVersionFilterChange: (
    projectId: string,
    filterType: "gameVersions" | "loaders" | "versionType",
    value: string | string[],
  ) => void;
  onVersionUiStateChange: (
    projectId: string,
    field: "showAllGameVersions" | "gameVersionSearchTerm",
    value: boolean | string,
  ) => void;
  onToggleVersionDropdown: (
    projectId: string,
    dropdownType: "type" | "gameVersion" | "loader",
  ) => void;
  onCloseAllVersionDropdowns: (projectId: string) => void;
  onLoadMoreVersions: (projectId: string) => void;
  onInstallVersionClick: (
    project: UnifiedModSearchResult | any,
    version: UnifiedVersion,
  ) => void;
  onHoverVersion: (versionId: string | null) => void;
  selectedProfileId?: string | null;
  onDeleteVersionClick?: (
    profileId: string,
    project: UnifiedModSearchResult | any,
    version: UnifiedVersion,
  ) => void;
  onToggleEnableClick?: (
    profileId: string,
    project: UnifiedModSearchResult | any,
    version: UnifiedVersion,
    newEnabledState: boolean,
    sha1Hash: string,
  ) => void;
  itemIndex?: number;
}

export interface ModrinthProjectCardV2Props
  extends VersionListPassthroughProps {
  hit: UnifiedModSearchResult | any; // Temporary for compatibility
  accentColor: AccentColor;
  installStatus: ContentInstallStatus | null;
  isQuickInstalling?: boolean;
  isInstallingModpackAsProfile?: boolean;
  installingVersionStates?: Record<string, boolean>;
  installingModpackVersionStates?: Record<string, boolean>;
  onQuickInstallClick: (project: UnifiedModSearchResult | any) => void;
  onInstallModpackAsProfileClick?: (project: UnifiedModSearchResult) => void;
  onInstallModpackVersionAsProfileClick?: (
    project: UnifiedModSearchResult | any,
    version: UnifiedVersion,
  ) => void;
  onToggleVersionsClick: (projectId: string) => void;
  onReserveVersionsFocus: (trigger: Element) => void;
  isExpanded: boolean;
  isLoadingVersions: boolean;
  versionsReadError?: string;
  versionsReadDisabled?: boolean;
  onRetryVersionsClick?: (projectId: string) => void;
  isBlocked?: boolean; // Deprecated, use projectNoRiskStatus instead
  projectNoRiskStatus?: 'blocked' | 'warning' | null;
  projectVersions: UnifiedVersion[] | null | "loading";
  displayedCount: number;
  versionDropdownUIState: {
    showAllGameVersions: boolean;
    gameVersionSearchTerm: string;
  };
  openVersionDropdowns: {
    type: boolean;
    gameVersion: boolean;
    loader: boolean;
  };
  installedVersions: Record<string, ContentInstallStatus | null>;
  selectedProfile: Profile | null;
  hoveredVersionId: string | null;
  gameVersionsData: ModrinthGameVersion[];
  showAllGameVersionsSidebar: boolean;
  selectedGameVersionsSidebar: string[];
  onVersionFilterChange: (
    projectId: string,
    filterType: "gameVersions" | "loaders" | "versionType",
    value: string | string[],
  ) => void;
  onVersionUiStateChange: (
    projectId: string,
    field: "showAllGameVersions" | "gameVersionSearchTerm",
    value: boolean | string,
  ) => void;
  onToggleVersionDropdown: (
    projectId: string,
    dropdownType: "type" | "gameVersion" | "loader",
  ) => void;
  onCloseAllVersionDropdowns: (projectId: string) => void;
  onLoadMoreVersions: (projectId: string) => void;
  onInstallVersionClick: (
    project: UnifiedModSearchResult | any,
    version: UnifiedVersion,
  ) => void;
  onHoverVersion: (versionId: string | null) => void;
  selectedProfileId?: string | null;
  onDeleteVersionClick?: (
    profileId: string,
    project: UnifiedModSearchResult | any,
    version: UnifiedVersion,
  ) => void;
  onToggleEnableClick?: (
    profileId: string,
    project: UnifiedModSearchResult | any,
    version: UnifiedVersion,
    newEnabledState: boolean,
    sha1Hash: string,
  ) => void;
  itemIndex?: number;
  /**
   * Override the default title-click behavior. Used by in-place detail
   * views (e.g. the V3 Add-content sheet) to render the mod detail as a
   * stacked layer instead of navigating away from the current surface.
   * The router-based full-page fallback is used when not provided.
   */
  onProjectClick?: (
    project: UnifiedModSearchResult | any,
    source: "modrinth" | "curseforge",
  ) => void;
}

export const ModrinthProjectCardV2 = React.memo<ModrinthProjectCardV2Props>(
  ({
    hit,
    accentColor,
    installStatus,
    isQuickInstalling,
    isInstallingModpackAsProfile,
    installingVersionStates,
    installingModpackVersionStates,
    onQuickInstallClick,
    onInstallModpackAsProfileClick,
    onInstallModpackVersionAsProfileClick,
    onToggleVersionsClick,
    onReserveVersionsFocus,
    isExpanded,
    isLoadingVersions,
    versionsReadError,
    versionsReadDisabled = false,
    onRetryVersionsClick,
    projectVersions,
    displayedCount,
    versionFilters,
    versionDropdownUIState,
    openVersionDropdowns,
    installedVersions,
    selectedProfile,
    hoveredVersionId,
    gameVersionsData,
    showAllGameVersionsSidebar,
    selectedGameVersionsSidebar,
    onVersionFilterChange,
    onVersionUiStateChange,
    onToggleVersionDropdown,
    onCloseAllVersionDropdowns,
    onLoadMoreVersions,
    onInstallVersionClick,
    onHoverVersion,
    selectedProfileId,
    onDeleteVersionClick,
    onToggleEnableClick,
    itemIndex,
    isBlocked = false, // Deprecated
    projectNoRiskStatus = null,
    onProjectClick,
  }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();

    useEffect(() => {
      preloadIcons([
        "solar:download-minimalistic-bold",
        "solar:alt-arrow-up-bold",
        "solar:alt-arrow-down-bold",
      ]);
    }, []);

    const handleTitleClick = (e: React.MouseEvent) => {
      e.preventDefault();
      const source: "modrinth" | "curseforge" =
        hit.source === "Modrinth" ? "modrinth" : "curseforge";
      // When a consumer owns the surface (e.g. the Add-content sheet),
      // let them handle the click in-place instead of hard-navigating
      // away from their overlay.
      if (onProjectClick) {
        onProjectClick(hit, source);
        return;
      }
      navigate(`/mods/${source}/${hit.project_id}`);
    };

    return (
      <div>
        {/* Main Card */}
        <div
          className={cn(
            "group relative flex items-center gap-4 p-3 rounded-lg bg-black/20 border border-white/10 hover:border-white/20 transition-all duration-200",
          installStatus?.is_installed &&
            !installStatus?.is_included_in_norisk_pack &&
            "border-l-green-500",
          !installStatus?.is_installed &&
            installStatus?.is_included_in_norisk_pack &&
            "border-l-blue-500",
          installStatus?.is_installed &&
            installStatus?.is_included_in_norisk_pack &&
            "border-l-blue-500",
        )}
      >
        {/* A native primary trigger covers the card, without nesting the
            independent author/install/version actions inside a button. */}
        <button
          type="button"
          aria-label={t('content.view_project', { title: hit.title })}
          onClick={handleTitleClick}
          className="absolute inset-0 rounded-lg cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
        />
        {/* Blocked Mod Warning Icon - Top Left */}
        {projectNoRiskStatus === 'blocked' && (
          <div className="absolute top-2 left-2 z-10 pointer-events-auto">
            <Tooltip content="This mod is blocked by NoRisk Client as it is known to cause crashes or severe compatibility issues. Installation is not recommended.">
              <div>
                <Icon 
                  icon="solar:danger-triangle-bold" 
                  className="w-5 h-5 text-red-500"
                />
              </div>
            </Tooltip>
          </div>
        )}
        {projectNoRiskStatus === 'warning' && (
          <div className="absolute top-2 left-2 z-10 pointer-events-auto">
            <Tooltip content="This version is known to cause crashes or compatibility issues with NoRisk Client. Installation is possible but not recommended.">
              <div>
                <Icon 
                  icon="solar:danger-triangle-bold" 
                  className="w-5 h-5 text-yellow-500"
                />
              </div>
            </Tooltip>
          </div>
        )}
        {/* Fallback for deprecated isBlocked prop */}
        {!projectNoRiskStatus && isBlocked && (
          <div className="absolute top-2 left-2 z-10 pointer-events-auto">
            <Tooltip content="This mod is blocked by NoRisk Client as it is known to cause crashes or severe compatibility issues. Installation is not recommended.">
              <div>
                <Icon 
                  icon="solar:danger-triangle-bold" 
                  className="w-5 h-5 text-red-500"
                />
              </div>
            </Tooltip>
          </div>
        )}

        {/* Stats - absolute oben rechts */}
        <div className="pointer-events-none absolute top-3 right-3 flex items-center space-x-2 text-xs text-gray-400 font-minecraft">
          {/* Downloads */}
          <div className="text-white/50 flex items-center gap-0.5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3 w-3"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" />
            </svg>
            <span>{hit.downloads.toLocaleString()}</span>
          </div>
        </div>

        {/* Project Icon */}
        <div
          className="pointer-events-none relative w-20 h-20 flex-shrink-0 rounded-md overflow-hidden border"
          style={{
            borderColor: `${accentColor.value}30`,
            backgroundColor: `${accentColor.value}10`,
          }}
        >
          {hit.icon_url ? (
            <img
              src={hit.icon_url || "/placeholder.svg"}
              alt={`${hit.title} icon`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gray-700/50 flex items-center justify-center">
              <span className="text-gray-500 text-xl">?</span>
            </div>
          )}
        </div>

        {/* Project Info */}
        <div className="pointer-events-none relative flex-1 min-w-0">
          <div className="flex flex-row items-baseline space-x-1.5 mb-1">
            <span
              className="text-white font-minecraft text-lg whitespace-nowrap overflow-hidden text-ellipsis normal-case group-hover:underline group-hover:text-accent group-focus-within:underline text-left transition-colors"
              title={t('content.view_project', { title: hit.title })}
            >
              {hit.title}
            </span>
            {hit.author && (
              <a
                href={
                  hit.source === 'Modrinth'
                    ? `https://modrinth.com/user/${hit.author}`
                    : `https://www.curseforge.com/members/${hit.author}/projects`
                }
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    await openExternalUrl(
                      hit.source === 'Modrinth'
                        ? `https://modrinth.com/user/${hit.author}`
                        : `https://www.curseforge.com/members/${hit.author}/projects`
                    );
                  } catch (error) {
                    console.error("Failed to open external URL:", error);
                    toast.error(t('common.open_link_failed'));
                  }
                }}
                target="_blank"
                rel="noopener noreferrer"
                className="pointer-events-auto relative z-[1] text-xs text-gray-400 truncate font-minecraft flex-shrink min-w-0 hover:text-gray-200 hover:underline cursor-pointer"
                title={t('content.view_creator_profile', { creator: hit.author, provider: hit.source === 'Modrinth' ? 'Modrinth' : 'CurseForge' })}
              >
                {t('content.by_creator', { creator: hit.author })}
              </a>
            )}
          </div>

          {/* Description */}
          <p className="text-xs text-gray-300 line-clamp-2 font-minecraft leading-tight mb-2 min-h-[2rem]">
            {hit.description}
          </p>

          <div onClick={handleTitleClick} className="pointer-events-auto relative z-[1] flex items-center gap-1 min-h-6 overflow-x-auto whitespace-nowrap text-sm font-minecraft">
            {/* Categories have a stable leading position while asynchronous
                installed/NoRisk status is still being resolved. */}
            {hit.categories && hit.categories.slice(0, 3).map((category) => (
              <TagBadge key={category} size="sm" className="flex-shrink-0">
                {category.replace(/-/g, " ")}
              </TagBadge>
            ))}
            {/* Status badges */}
            {installStatus && (
              <>
                {installStatus.is_installed && (
                  <TagBadge variant="success" size="sm" className="flex-shrink-0">
                    {t('common.installed')}
                  </TagBadge>
                )}
                {installStatus.is_included_in_norisk_pack && (
                  <TagBadge
                    variant={
                      installStatus.norisk_pack_item_details?.is_enabled === false
                        ? "inactive"
                        : "info"
                    }
                    size="sm"
                    className="flex-shrink-0"
                  >
                    NoRisk Pack
                  </TagBadge>
                )}
              </>
            )}

          </div>
        </div>



        {/* Action Buttons */}
        <div className="relative z-[1] flex items-center space-x-1">
          {hit.project_type === "modpack" ? (
            <ActionButton
              label={t(isInstallingModpackAsProfile ? 'modrinth.installing' : 'modrinth.install')}
              icon={isInstallingModpackAsProfile ? "solar:refresh-bold" : "solar:download-minimalistic-bold"}
              iconClassName={isInstallingModpackAsProfile ? "animate-spin-slow" : ""}
              variant={isInstallingModpackAsProfile ? "secondary" : "primary"}
              disabled={isInstallingModpackAsProfile || isQuickInstalling || (!!installStatus?.is_installed && !!selectedProfile)}
              onClick={(e) => {
                e.stopPropagation();
                if (onInstallModpackAsProfileClick) {
                  onInstallModpackAsProfileClick(hit);
                } else {
                  console.warn(
                    "onInstallModpackAsProfileClick is not defined for modpack",
                  );
                  onQuickInstallClick(hit);
                }
              }}
              size="sm"
            />
          ) : (
            <ActionButton
              label={t(isQuickInstalling ? 'modrinth.installing' : 'modrinth.install')}
              icon={
                isQuickInstalling 
                  ? "solar:refresh-bold" 
                  : (projectNoRiskStatus === 'blocked' || projectNoRiskStatus === 'warning')
                    ? "solar:danger-triangle-bold"
                    : "solar:download-minimalistic-bold"
              }
              iconClassName={isQuickInstalling ? "animate-spin-slow" : ""}
              variant={isQuickInstalling ? "secondary" : "primary"}
              disabled={isQuickInstalling || (!!installStatus?.is_installed && !!selectedProfile)}
              onClick={(e) => {
                e.stopPropagation();
                onQuickInstallClick(hit);
              }}
              size="sm"
            />
          )}
          <ActionButton
            icon={
              isLoadingVersions
                ? "solar:refresh-bold"
                : isExpanded
                  ? "solar:alt-arrow-up-bold"
                  : "solar:alt-arrow-down-bold"
            }
            iconClassName={isLoadingVersions ? "animate-spin-fast" : ""}
            variant="icon-only"
            disabled={isLoadingVersions || versionsReadDisabled}
            tooltip={t(isExpanded ? 'content.hide_versions' : 'content.show_versions')}
            onClick={(e) => {
              e.stopPropagation();
              if (!isExpanded) onReserveVersionsFocus(e.currentTarget);
              onToggleVersionsClick(hit.project_id);
            }}
            size="sm"
          />
        </div>

        </div>

        {/* Version List - Below Card */}
        {(isLoadingVersions || isExpanded) && (
          <div
            role="region"
            aria-label={t('modrinth.available_versions') + ' ' + hit.title}
            aria-busy={isLoadingVersions}
            tabIndex={0}
            className="mt-4 min-h-0 min-w-0 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] focus-visible:outline focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:-outline-offset-2 focus-visible:outline-white/30"
            style={{ height: "min(24rem, calc(var(--catalogue-results-height, 0px) * 0.8))" }}
          >
        {isLoadingVersions && (
          <div role="status" aria-busy="true" className="min-h-12 flex items-center gap-2 p-3 font-minecraft text-sm text-white/60">
            <Icon icon="solar:refresh-bold" aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('content.versions.loading')}
          </div>
        )}
        {isExpanded && versionsReadError !== undefined && !isLoadingVersions && (
          <div className="min-w-0 p-3 font-minecraft text-sm">
            <div role="alert" className="min-w-0 [overflow-wrap:anywhere] text-red-400">
              <p>{t('content.versions.load_failed', { title: hit.title })}</p>
              <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-xs">{versionsReadError}</p>
            </div>
            <button
              type="button"
              aria-label={t('content.versions.retry', { title: hit.title })}
              disabled={versionsReadDisabled || !onRetryVersionsClick}
              className="mt-2 rounded border border-white/20 px-3 py-2 text-white/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
              onClick={(e) => {
                e.stopPropagation();
                if (onRetryVersionsClick) onReserveVersionsFocus(e.currentTarget);
                onRetryVersionsClick?.(hit.project_id);
              }}
            >
              {t('common.try_again')}
            </button>
          </div>
        )}
        {isExpanded && !isLoadingVersions && versionsReadError === undefined && Array.isArray(projectVersions) && projectVersions.length === 0 && (
          <div role="status" className="min-h-12 p-3 font-minecraft text-sm text-white/60">
            {t('modrinth.no_versions_found')}
          </div>
        )}
        {isExpanded &&
          Array.isArray(projectVersions) &&
          projectVersions.length > 0 && (
            <div>
              <ModrinthVersionListV2
              projectId={hit.project_id}
              project={hit}
              versions={projectVersions as UnifiedVersion[]}
              displayedCount={displayedCount}
              filters={versionFilters}
              uiState={versionDropdownUIState}
              openDropdowns={openVersionDropdowns}
              installedVersions={installedVersions}
              installingVersionStates={installingVersionStates}
              installingModpackVersionStates={installingModpackVersionStates}
              selectedProfile={selectedProfile}
              selectedProfileId={selectedProfileId}
              hoveredVersionId={hoveredVersionId}
              gameVersionsData={gameVersionsData}
              showAllGameVersionsSidebar={showAllGameVersionsSidebar}
              selectedGameVersionsSidebar={selectedGameVersionsSidebar}
              accentColor={accentColor}
              onFilterChange={onVersionFilterChange}
              onUiStateChange={onVersionUiStateChange}
              onToggleDropdown={onToggleVersionDropdown}
              onCloseAllDropdowns={onCloseAllVersionDropdowns}
              onLoadMore={onLoadMoreVersions}
              onInstallClick={onInstallVersionClick}
              onInstallModpackVersionAsProfileClick={
                onInstallModpackVersionAsProfileClick
              }
              onHoverVersion={onHoverVersion}
              onDeleteClick={onDeleteVersionClick}
                onToggleEnableClick={onToggleEnableClick}
                isProjectBlocked={isBlocked}
                projectNoRiskStatus={projectNoRiskStatus || (isBlocked ? 'blocked' : null)}
              />
            </div>
          )}
          </div>
        )}
      </div>
    );
  },
);
