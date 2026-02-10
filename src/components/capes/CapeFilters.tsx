"use client";

import { useState } from "react";
import { SearchInput } from "../ui/SearchInput";
import { Select, type SelectOption } from "../ui/Select";
import { Icon } from "@iconify/react";
import { Button } from "../ui/buttons/Button";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";

export interface CapeFiltersData {
  sortBy?: string;
  timeFrame?: string;
  showOwnedOnly?: boolean;
  showFavoritesOnly?: boolean;
  showVanillaOnly?: boolean;
}

interface CapeFiltersProps {
  onFilterChange: (filters: CapeFiltersData) => void;
  currentFilters: CapeFiltersData;
  onSearchSubmit?: (term: string) => void;
}

export function CapeFilters({
  onFilterChange,
  currentFilters,
  onSearchSubmit,
}: CapeFiltersProps) {
  const [searchInputValue, setSearchInputValue] = useState<string>("");
  const { activeAccount } = useMinecraftAuthStore();

  const handleSearchChange = (value: string) => {
    setSearchInputValue(value);
  };

  const handleSearch = (searchTerm: string) => {
    if (currentFilters.showOwnedOnly) {
      onFilterChange({ ...currentFilters, showOwnedOnly: false });
    }
    if (onSearchSubmit) {
      onSearchSubmit(searchTerm.trim());
    }
  };

  const handleSortChange = (value: string) => {
    onFilterChange({ ...currentFilters, sortBy: value || undefined });
  };

  const handleTimeFrameChange = (value: string) => {
    onFilterChange({ ...currentFilters, timeFrame: value || undefined });
  };

  const handleOwnedToggle = () => {
    onFilterChange({
      ...currentFilters,
      showOwnedOnly: !currentFilters.showOwnedOnly,
    });
  };

  const sortOptions: SelectOption[] = [
    {
      value: "mostUsed",
      label: "Most Used",
      icon: <Icon icon="solar:heart-bold" className="w-5 h-5" />,
    },
    {
      value: "newest",
      label: "Newest",
      icon: <Icon icon="solar:sort-by-time-linear" className="w-5 h-5" />,
    },
    {
      value: "oldest",
      label: "Oldest",
      icon: (
        <Icon icon="mdi:arrow-up-bold-circle-outline" className="w-5 h-5" />
      ),
    },
  ];

  const timeFrameOptions: SelectOption[] = [
    {
      value: "",
      label: "All Time",
      icon: <Icon icon="solar:calendar-mark-linear" className="w-5 h-5" />,
    },
    {
      value: "weekly",
      label: "Weekly",
      icon: <Icon icon="mdi:calendar-week-outline" className="w-5 h-5" />,
    },
    {
      value: "monthly",
      label: "Monthly",
      icon: <Icon icon="solar:calendar-date-linear" className="w-5 h-5" />,
    },
  ];

  return (
    <div className="flex w-full items-center gap-2">
      <SearchInput
        value={searchInputValue}
        onChange={handleSearchChange}
        onSearch={handleSearch}
        placeholder="Search capes..."
        variant="flat"
        className="w-full md:w-auto flex-grow md:flex-grow-0 h-[42px]"
      />

      <Select
        value={currentFilters.sortBy || ""}
        onChange={handleSortChange}
        options={sortOptions}
        variant="flat"
        aria-label="Sort by"
        className="w-full md:w-52 h-[42px]"
      />

      <Select
        value={currentFilters.timeFrame || ""}
        onChange={handleTimeFrameChange}
        options={timeFrameOptions}
        variant="flat"
        aria-label="Filter by period"
        className="w-full md:w-52 h-[42px]"
      />

      <Button
        onClick={handleOwnedToggle}
        variant={currentFilters.showOwnedOnly ? "flat" : "flat-secondary"}
        size="md"
        icon={<Icon icon="solar:user-id-broken" className="w-5 h-5" />}
        className="min-w-0 h-[42px]"
        disabled={!activeAccount}
        title={
          !activeAccount
            ? "No active Minecraft account"
            : currentFilters.showOwnedOnly
              ? "Show All Capes"
              : "Show My Capes"
        }
      >
        My Capes
      </Button>
    </div>
  );
}
