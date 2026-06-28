"use client";

import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import type {
  ModrinthProjectType,
} from "../../../types/modrinth";
import { UnifiedSortType, ModPlatform } from "../../../types/unified";
// Profile type will be defined locally
import { SearchWithFilters } from "../../ui/SearchWithFilters";
import { GroupTabs, type GroupTab } from "../../ui/GroupTabs";
import { IconButton } from "../../ui/buttons/IconButton";
import { TagBadge } from "../../ui/TagBadge";
import { Icon } from "@iconify/react";
import { useDisplayContextStore } from "../../../store/useDisplayContextStore";
import { useThemeStore } from "../../../store/useThemeStore";
import { cn } from "../../../lib/utils";

// Define Profile type locally, similar to ModrinthSearchV2.tsx
type Profile = any;

export // Define SelectOption type locally
interface SelectOption {
  value: UnifiedSortType;
  label: string;
  icon?: string;
}

interface ModrinthSearchControlsV2Props {
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
  projectType: ModrinthProjectType;
  onProjectTypeChange: (type: ModrinthProjectType) => void;
  allProjectTypes: ModrinthProjectType[]; // This will be ALL_MODRINTH_PROJECT_TYPES from parent
  profiles: Profile[];
  selectedProfile: Profile | null;
  onSelectedProfileChange: (profile: Profile | null) => void;
  sortOrder: UnifiedSortType;
  onSortOrderChange: (sort: UnifiedSortType) => void;
  sortOptions: SelectOption[];
  isSidebarVisible: boolean;
  onToggleSidebar: () => void;
  selectedGameVersions: string[];
  currentSelectedLoaders: string[];
  currentSelectedCategories: string[];
  filterClientRequired: boolean;
  filterServerRequired: boolean;
  onRemoveGameVersionTag: (version: string) => void;
  onRemoveLoaderTag: (loader: string) => void;
  onRemoveCategoryTag: (category: string) => void;
  onRemoveClientRequiredTag: () => void;
  onRemoveServerRequiredTag: () => void;
  onClearAllFilters: () => void;
  overrideDisplayContext?: "detail" | "standalone";
  modSource: ModPlatform;
  onModSourceChange: (source: ModPlatform) => void;
}

export const ModrinthSearchControlsV2: React.FC<
  ModrinthSearchControlsV2Props
> = ({
  searchTerm,
  onSearchTermChange,
  projectType,
  onProjectTypeChange,
  allProjectTypes,
  profiles,
  selectedProfile,
  onSelectedProfileChange,
  sortOrder,
  onSortOrderChange,
  sortOptions,
  isSidebarVisible,
  onToggleSidebar,
  selectedGameVersions,
  currentSelectedLoaders,
  currentSelectedCategories,
  filterClientRequired,
  filterServerRequired,
  onRemoveGameVersionTag,
  onRemoveLoaderTag,
  onRemoveCategoryTag,
  onRemoveClientRequiredTag,
  onRemoveServerRequiredTag,
  onClearAllFilters,
  overrideDisplayContext,
  modSource,
  onModSourceChange,
}) => {
  const { t } = useTranslation();
  const globalDisplayContext = useDisplayContextStore((state) => state.context);
  const effectiveDisplayContext =
    overrideDisplayContext || globalDisplayContext;
  const accentColor = useThemeStore((state) => state.accentColor);
  const filtersContainerRef = useRef<HTMLDivElement>(null);

  const isDetailView = effectiveDisplayContext === "detail";
  const buttonSize = isDetailView
    ? isSidebarVisible
      ? "xs"
      : "sm"
    : !isSidebarVisible
      ? "lg"
      : "sm";

  // Calculate total number of active filters
  const totalFilters =
    selectedGameVersions.length +
    currentSelectedLoaders.length +
    currentSelectedCategories.length +
    (filterClientRequired ? 1 : 0) +
    (filterServerRequired ? 1 : 0);

  // Create groups array for project types
  const groups: GroupTab[] = allProjectTypes.map(type => ({
    id: type,
    name: type.charAt(0).toUpperCase() + type.slice(1) + 's',
    count: 0, // Could be populated with result counts if needed
  }));

  return (
    <>
      {/* Group Tabs for Project Types */}
      <GroupTabs
        groups={groups}
        activeGroup={projectType}
        onGroupChange={onProjectTypeChange}
        showAddButton={false}
      />

      {/* Search & Filter Header */}
      <div className="mb-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 flex-1">
            <SearchWithFilters
              placeholder={t('content.search_placeholder', { type: projectType })}
              searchValue={searchTerm}
              onSearchChange={onSearchTermChange}
              sortOptions={sortOptions}
              sortValue={sortOrder}
              onSortChange={(value) => onSortOrderChange(value as UnifiedSortType)}
            />

            <button
              onClick={onToggleSidebar}
              className="flex items-center gap-2 px-4 py-2 bg-black/30 hover:bg-black/40 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded-lg font-minecraft text-2xl lowercase transition-all duration-200 min-h-[2.5rem]"
              title={isSidebarVisible ? t('content.filters.hide') : t('content.filters.show')}
            >
              <div className="w-4 h-8 flex items-center justify-center">
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/>
                </svg>
              </div>
            </button>
          </div>

          {/* Platform Selection Buttons - ganz rechts */}
          <div className="flex items-center gap-1 border border-white/10 rounded-lg p-0.5">
            <button
              onClick={() => onModSourceChange(ModPlatform.Modrinth)}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md font-minecraft text-2xl lowercase transition-all duration-200 min-h-[2.5rem]",
                modSource === ModPlatform.Modrinth
                  ? "bg-green-400/40 text-white border border-green-300/30"
                  : "bg-black/30 text-white/70 hover:text-white hover:bg-black/40 border border-transparent"
              )}
              title={t('content.search_modrinth')}
            >
              <img
                src="https://cdn.modrinth.com/modrinth-new.png"
                alt="Modrinth"
                className="w-5 h-5 object-contain"
              />
              <span className="hidden sm:inline">Modrinth</span>
            </button>

            <button
              onClick={() => onModSourceChange(ModPlatform.CurseForge)}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md font-minecraft text-2xl lowercase transition-all duration-200 min-h-[2.5rem]",
                modSource === ModPlatform.CurseForge
                  ? "bg-orange-400/40 text-white border border-orange-300/30"
                  : "bg-black/30 text-white/70 hover:text-white hover:bg-black/40 border border-transparent"
              )}
              title={t('content.search_curseforge')}
            >
              <img
                src="https://cdn.norisk.gg/misc/curseforge.webp"
                alt="CurseForge"
                className="w-5 h-5 object-contain"
              />
              <span className="hidden sm:inline">CurseForge</span>
            </button>
          </div>
        </div>

        {/* Filter Tags - Under Search */}
        {totalFilters > 0 && (
          <div className="flex items-center gap-2 mt-4">
            <TagBadge
              variant="destructive"
              className="cursor-pointer hover:brightness-110 transition-all flex-shrink-0 flex items-center"
              onClick={onClearAllFilters}
              size="md"
            >
              <Icon
                icon="solar:trash-bin-trash-bold"
                className="w-4 h-4 mr-1"
              />
              <span>{t('content.filters.clear_all')}</span>
            </TagBadge>

            {selectedGameVersions.map((version) => (
              <TagBadge
                key={`gv-${version}`}
                variant="filter"
                className="inline-flex whitespace-nowrap items-center"
                size="md"
                onClick={() => onRemoveGameVersionTag(version)}
              >
                <span>{version}</span>
                <Icon
                  icon="solar:close-circle-bold"
                  className="w-4 h-4 ml-1"
                />
              </TagBadge>
            ))}

            {currentSelectedLoaders.map((loader) => (
              <TagBadge
                key={`loader-${loader}`}
                variant="filter"
                className="inline-flex whitespace-nowrap items-center"
                size="md"
                onClick={() => onRemoveLoaderTag(loader)}
              >
                <span>{loader}</span>
                <Icon
                  icon="solar:close-circle-bold"
                  className="w-4 h-4 ml-1"
                />
              </TagBadge>
            ))}

            {currentSelectedCategories.map((category) => (
              <TagBadge
                key={`cat-${category}`}
                variant="filter"
                className="inline-flex whitespace-nowrap items-center"
                size="md"
                onClick={() => onRemoveCategoryTag(category)}
              >
                <span>{category}</span>
                <Icon
                  icon="solar:close-circle-bold"
                  className="w-4 h-4 ml-1"
                />
              </TagBadge>
            ))}

            {filterClientRequired && (
              <TagBadge
                key="client-req"
                variant="filter"
                className="inline-flex whitespace-nowrap items-center"
                size="md"
                onClick={onRemoveClientRequiredTag}
              >
                <span>{t('content.filters.client')}</span>
                <Icon
                  icon="solar:close-circle-bold"
                  className="w-4 h-4 ml-1"
                />
              </TagBadge>
            )}

            {filterServerRequired && (
              <TagBadge
                key="server-req"
                variant="filter"
                className="inline-flex whitespace-nowrap items-center"
                size="md"
                onClick={onRemoveServerRequiredTag}
              >
                <span>{t('content.filters.server')}</span>
                <Icon
                  icon="solar:close-circle-bold"
                  className="w-4 h-4 ml-1"
                />
              </TagBadge>
            )}
          </div>
        )}
      </div>
    </>
  );
};
