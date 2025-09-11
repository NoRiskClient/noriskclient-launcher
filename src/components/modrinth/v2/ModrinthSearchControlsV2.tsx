"use client";

import React, { useRef } from "react";
import type {
  ModrinthProjectType,
  ModrinthSortType,
} from "../../../types/modrinth";
// Profile type will be defined locally
import { Button } from "../../ui/buttons/Button";
import { SearchInput } from "../../ui/SearchInput";
import { Select, type SelectOption } from "../../ui/Select";
import { IconButton } from "../../ui/buttons/IconButton";
import { TagBadge } from "../../ui/TagBadge";
import { Icon } from "@iconify/react";
import { useDisplayContextStore } from "../../../store/useDisplayContextStore";
import { useThemeStore } from "../../../store/useThemeStore";
import { cn } from "../../../lib/utils";

// Define Profile type locally, similar to ModrinthSearchV2.tsx
type Profile = any;

export interface ModrinthSearchControlsV2Props {
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
  projectType: ModrinthProjectType;
  onProjectTypeChange: (type: ModrinthProjectType) => void;
  allProjectTypes: ModrinthProjectType[]; // This will be ALL_MODRINTH_PROJECT_TYPES from parent
  profiles: Profile[];
  selectedProfile: Profile | null;
  onSelectedProfileChange: (profile: Profile | null) => void;
  sortOrder: ModrinthSortType;
  onSortOrderChange: (sort: ModrinthSortType) => void;
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
}) => {
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

  return (
    <div
      className="p-3 rounded-lg border backdrop-blur-sm mb-3"
      style={{
        backgroundColor: `${accentColor.value}10`,
        borderColor: `${accentColor.value}30`,
      }}
    >
      <div className={`search-bar-and-types p-${isDetailView ? "1.5" : "2"}`}>
        <div className="project-types flex space-x-2 mb-3">
          {allProjectTypes.map((type) => (
            <Button
              key={type}
              onClick={() => onProjectTypeChange(type)}
              variant={projectType === type ? "flat" : "ghost"}
              size={buttonSize}
              className={`flex-1 min-w-0 text-2xl`}
            >
              {type}s
            </Button>
          ))}
        </div>

        <div className="flex items-center space-x-2 mb-2">
          <SearchInput
            value={searchTerm}
            onChange={onSearchTermChange}
            placeholder={`Search for ${projectType}s...`}
            className={`flex-grow h-[48px]`}
            variant="flat"
            size="lg"
          />

          <Select
            value={sortOrder}
            onChange={(value) => onSortOrderChange(value as ModrinthSortType)}
            options={sortOptions}
            className={`max-w-[180px] h-[48px]`}
            variant="flat"
            size="sm"
          />

          <IconButton
            onClick={onToggleSidebar}
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                />
              </svg>
            }
            size={isDetailView ? "md" : "md"}
            variant={"ghost"}
            title={isSidebarVisible ? "Hide filters" : "Show filters"}
          />
        </div>

        {totalFilters > 0 && (
          <div className={cn("flex items-center mt-2 gap-2")}>
            <div
              className={cn(
                "flex-1 border rounded-md h-[48px] overflow-x-auto overflow-y-hidden whitespace-nowrap",
                "hide-scrollbar",
              )}
              style={{
                backgroundColor: `${accentColor.value}15`,
                borderColor: `${accentColor.value}30`,
                boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.05)",
              }}
              ref={filtersContainerRef}
            >
              <div className="flex items-center gap-2 p-2">
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
                  <span>Clear All</span>
                </TagBadge>

                {selectedGameVersions.map((version) => (
                  <TagBadge
                    key={`gv-${version}`}
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
                    className="inline-flex whitespace-nowrap items-center"
                    size="md"
                    onClick={onRemoveClientRequiredTag}
                  >
                    <span>Client</span>
                    <Icon
                      icon="solar:close-circle-bold"
                      className="w-4 h-4 ml-1"
                    />
                  </TagBadge>
                )}

                {filterServerRequired && (
                  <TagBadge
                    key="server-req"
                    className="inline-flex whitespace-nowrap items-center"
                    size="md"
                    onClick={onRemoveServerRequiredTag}
                  >
                    <span>Server</span>
                    <Icon
                      icon="solar:close-circle-bold"
                      className="w-4 h-4 ml-1"
                    />
                  </TagBadge>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
