"use client";

import { ReactNode, useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import { Button } from "./buttons/Button";
import { ActionButton } from "./ActionButton";
import { GenericList } from "./GenericList";
import { useThemeStore } from "../../store/useThemeStore";
import { preloadIcons } from "../../lib/icon-utils";

const GENERIC_CONTENT_TAB_DEFAULT_ICONS = [
  "solar:refresh-circle-bold-duotone",
  "solar:refresh-outline",
];

interface GenericContentTabProps<T> {
  items: T[];
  renderListItem: (item: T, index: number) => ReactNode;
  isLoading?: boolean;
  error?: string | null;
  onRefreshData?: () => void;
  searchQuery?: string;
  
  primaryLeftActions?: ReactNode;
  primaryRightActions?: ReactNode;
  secondaryLeftActions?: ReactNode;
  secondaryRightActions?: ReactNode;
  showSecondaryActionsBar?: boolean;

  emptyStateIcon?: string;
  emptyStateMessage?: string;
  emptyStateDescription?: string;
  emptyStateAction?: ReactNode;
  loadingItemCount?: number;
  showSkeletons?: boolean;
  accentColorOverride?: string; 
}

export function GenericContentTab<T>({
  items,
  renderListItem,
  isLoading = false,
  error = null,
  onRefreshData,
  searchQuery,
  primaryLeftActions,
  primaryRightActions,
  secondaryLeftActions,
  secondaryRightActions,
  showSecondaryActionsBar = false,
  emptyStateIcon,
  emptyStateMessage,
  emptyStateDescription,
  emptyStateAction,
  loadingItemCount,
  showSkeletons = true,
  accentColorOverride,
}: GenericContentTabProps<T>) {
  const themeAccentColor = useThemeStore((state) => state.accentColor.value);
  const accentColor = accentColorOverride || themeAccentColor;

  useEffect(() => {
    if (GENERIC_CONTENT_TAB_DEFAULT_ICONS.length > 0 && onRefreshData) { 
        preloadIcons([GENERIC_CONTENT_TAB_DEFAULT_ICONS[0]]);
    }
  }, [onRefreshData]);
  const effectiveLoadingItemCount = showSkeletons ? loadingItemCount : 0;

  return (
    <div className="flex flex-col select-none pt-[7px] flex-1 min-h-0">
      {/* Header with search, actions etc. */}
      <div className="flex items-center justify-between mb-1 gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 flex-grow min-w-0">
          {primaryLeftActions}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {primaryRightActions}
          {!primaryRightActions && onRefreshData && (
            <ActionButton
              onClick={onRefreshData}
              disabled={isLoading}
              variant="text"
              size="sm"
              icon={isLoading ? GENERIC_CONTENT_TAB_DEFAULT_ICONS[0] : "solar:refresh-outline"}
              tooltip="Refresh"
            />
          )}
        </div>
      </div>

      {/* Secondary actions bar */}
      {(showSecondaryActionsBar || secondaryLeftActions || secondaryRightActions) && showSecondaryActionsBar !== false && (
        <div className="flex items-center justify-between mb-1 px-1 py-1 gap-2 flex-shrink-0">
          <div className="flex items-center gap-2 flex-grow min-w-0">
            {secondaryLeftActions}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {secondaryRightActions}
          </div>
        </div>
      )}

      <GenericList<T>
        items={items}
        renderItem={renderListItem}
        isLoading={isLoading}
        error={error}
        searchQuery={searchQuery}
        accentColor={accentColor}
        emptyStateIcon={emptyStateIcon}
        emptyStateMessage={emptyStateMessage}
        emptyStateDescription={emptyStateDescription}
        emptyStateAction={emptyStateAction}
        loadingItemCount={effectiveLoadingItemCount}
      />
    </div>
  );
}