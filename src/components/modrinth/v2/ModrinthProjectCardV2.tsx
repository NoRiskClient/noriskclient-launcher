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
import { ThemedSurface } from "../../ui/ThemedSurface";
import { Tooltip } from "../../ui/Tooltip";

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
  isExpanded: boolean;
  isLoadingVersions: boolean;
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
    isExpanded,
    isLoadingVersions,
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
  }) => {
    useEffect(() => {
      preloadIcons([
        "solar:download-minimalistic-bold",
        "solar:alt-arrow-up-bold",
        "solar:alt-arrow-down-bold",
      ]);
    }, []);

    return (
      <div>
        {/* Main Card */}
        <div
          className={cn(
            "relative flex items-center gap-4 p-3 rounded-lg bg-black/20 border border-white/10 hover:border-white/20 transition-all duration-200",
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
        <div className="absolute top-3 right-3 flex items-center space-x-2 text-xs text-gray-400 font-minecraft-ten">
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
          className="relative w-20 h-20 flex-shrink-0 rounded-md overflow-hidden border"
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
        <div className="flex-1 min-w-0">
          <div className="flex flex-row items-baseline space-x-1.5 mb-1">
            <a
              href={hit.project_url}
              onClick={async (e) => {
                e.preventDefault();
                try {
                  await openExternalUrl(hit.project_url);
                } catch (error) {
                  console.error("Failed to open external URL:", error);
                  toast.error("Could not open link in browser.");
                }
              }}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white font-minecraft-ten text-lg whitespace-nowrap overflow-hidden text-ellipsis normal-case hover:underline cursor-pointer"
              title={`Open ${hit.title} on ${hit.source === 'Modrinth' ? 'Modrinth' : 'CurseForge'}`}
            >
              {hit.title}
            </a>
            {hit.author && (
              <a
                href={
                  hit.source === 'Modrinth'
                    ? `https://modrinth.com/user/${hit.author}`
                    : `https://www.curseforge.com/members/${hit.author}/projects`
                }
                onClick={async (e) => {
                  e.preventDefault();
                  try {
                    await openExternalUrl(
                      hit.source === 'Modrinth'
                        ? `https://modrinth.com/user/${hit.author}`
                        : `https://www.curseforge.com/members/${hit.author}/projects`
                    );
                  } catch (error) {
                    console.error("Failed to open external URL:", error);
                    toast.error("Could not open link in browser.");
                  }
                }}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 truncate font-minecraft-ten flex-shrink min-w-0 hover:text-gray-200 hover:underline cursor-pointer"
                title={`Open ${hit.author}'s profile on ${hit.source === 'Modrinth' ? 'Modrinth' : 'CurseForge'}`}
              >
                by {hit.author}
              </a>
            )}
          </div>

          {/* Description */}
          <p className="text-xs text-gray-300 line-clamp-2 font-minecraft-ten leading-tight mb-2 min-h-[2rem]">
            {hit.description}
          </p>

          <div className="flex items-center gap-1 text-sm font-minecraft-ten">
            {/* Status badges */}
            {installStatus && (
              <>
                {installStatus.is_installed && (
                  <TagBadge variant="success" size="sm">
                    Installed
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
                  >
                    NoRisk Pack
                  </TagBadge>
                )}
              </>
            )}

            {/* Categories */}
            {hit.categories &&
              hit.categories.length > 0 &&
              hit.categories
                .slice(0, 3)
                .map((category) => (
                  <TagBadge key={category} size="sm">
                    {category.replace(/-/g, " ")}
                  </TagBadge>
                ))}
          </div>
        </div>



        {/* Action Buttons */}
        <div className="flex items-center space-x-1">
          {hit.project_type === "modpack" ? (
            <ActionButton
              label={isInstallingModpackAsProfile ? "Installing..." : "Install"}
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
              label={isQuickInstalling ? "Installing..." : "Install"}
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
            disabled={isLoadingVersions}
            tooltip={isExpanded ? "Hide Versions" : "Show Versions"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleVersionsClick(hit.project_id);
            }}
            size="sm"
          />
        </div>

        </div>

        {/* Version List - Below Card */}
        {isExpanded &&
          Array.isArray(projectVersions) &&
          projectVersions.length > 0 && (
            <div className="mt-4">
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
    );
  },
);
