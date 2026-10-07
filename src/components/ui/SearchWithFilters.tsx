"use client";

import { Icon } from "@iconify/react";
import { useRef } from "react";
import { StableIcon } from "./IconWrapper";
import { CustomDropdown } from "./CustomDropdown";
import type { DropdownOption } from "./CustomDropdown";
import { useTranslation } from "react-i18next";

export interface SearchWithFiltersProps {
  /** Placeholder text for the search input */
  placeholder?: string;
  /** Current search value */
  searchValue?: string;
  /** Callback when search value changes */
  onSearchChange?: (value: string) => void;
  /** Callback when Enter is pressed in search input */
  onSearchEnter?: (value: string) => void;
  /** Sort options for the sort dropdown */
  sortOptions?: DropdownOption[];
  /** Current sort value */
  sortValue?: string;
  /** Callback when sort value changes */
  onSortChange?: (value: string) => void;
  /** Filter options for the filter dropdown */
  filterOptions?: DropdownOption[];
  /** Current filter value */
  filterValue?: string;
  /** Callback when filter value changes */
  onFilterChange?: (value: string) => void;
  /** Additional CSS classes */
  className?: string;
  /** Optional icon for the search input */
  searchIcon?: string;
  /** Whether to show the sort dropdown */
  showSort?: boolean;
  /** Whether to show the filter dropdown */
  showFilter?: boolean;
  /** Custom filter control rendered in the filter slot (inside the search bar), replacing the default dropdown. */
  filterSlot?: React.ReactNode;
  dropdownSize?: 'sm' | 'md';
  compact?: boolean;
}

export function SearchWithFilters({
  placeholder = "Search...",
  searchValue = "",
  onSearchChange,
  onSearchEnter,
  sortOptions = [],
  sortValue = "",
  onSortChange,
  filterOptions = [],
  filterValue = "",
  onFilterChange,
  className = "",
  searchIcon = "solar:magnifer-bold",
  showSort = true,
  showFilter = true,
  filterSlot,
  dropdownSize = 'md',
  compact = false,
}: SearchWithFiltersProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange?.(e.target.value);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onSearchEnter) {
      onSearchEnter(searchValue);
    }
  };

  const handleClearSearch = () => {
    onSearchChange?.("");
    if (inputRef.current) {
      inputRef.current.focus({ preventScroll: true });
    }
  };

  const handleSearchAreaClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && !event.target.closest("button,input")) {
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const showSortSection = showSort && sortOptions.length > 0;
  const showFilterSection = showFilter && filterOptions.length > 0;
  const hasSearchValue = Boolean(searchValue);

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {/* Search with integrated filters */}
      <div
        className={`flex min-w-0 items-center gap-2 bg-black/50 rounded-lg border border-white/10 hover:border-white/20 transition-colors focus-within:outline focus-within:outline-2 focus-within:[outline-style:solid] focus-within:-outline-offset-2 focus-within:outline-white/70 ${
          compact ? "px-3 py-2 w-full" : "px-4 py-3 flex-1 max-w-md"
        }`}
        onClick={event => { if (event.target === event.currentTarget) handleSearchAreaClick(event); }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0" onClick={handleSearchAreaClick}>
          <StableIcon icon={searchIcon} className="w-4 h-4 text-white/50 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            role="searchbox"
            aria-label={placeholder}
            placeholder={placeholder}
            value={searchValue}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            className="bg-transparent text-white placeholder-white/50 font-minecraft text-sm flex-1 min-w-0 outline-none"
          />
          {hasSearchValue ? (
            <button
              type="button"
              onClick={handleClearSearch}
              aria-label={t("common.clear_search")}
              className="text-white/60 hover:text-white transition-colors duration-200 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded"
            >
              <Icon icon="lucide:x" className="w-4 h-4" />
            </button>
          ) : (
            <span aria-hidden="true" className="h-4 w-4 shrink-0" />
          )}
        </div>
        
        {/* Sort Filter */}
        {showSortSection && (
          <>
            {/* Separator */}
            <div className="h-4 w-px bg-white/20 mx-2"></div>
            
            {/* Sort Filter Button */}
            <div className="relative">
              <CustomDropdown
                label=""
                value={sortValue}
                onChange={onSortChange}
                options={sortOptions}
                className="w-auto"
                size={dropdownSize}
              />
            </div>
          </>
        )}
        
        {/* Version/Filter */}
        {filterSlot ? (
          <>
            {/* Separator */}
            <div className="h-4 w-px bg-white/20 mx-2"></div>
            <div className="relative">{filterSlot}</div>
          </>
        ) : (
          showFilterSection && (
            <>
              {/* Separator */}
              <div className="h-4 w-px bg-white/20 mx-2"></div>

              {/* Filter Button */}
              <div className="relative">
                <CustomDropdown
                  label=""
                  value={filterValue}
                  onChange={onFilterChange}
                  options={filterOptions}
                  className="w-auto"
                  size={dropdownSize}
                />
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
