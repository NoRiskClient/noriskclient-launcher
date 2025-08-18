"use client";

import { ReactNode, useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import { Button } from "./buttons/Button";
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
    <div className="h-full flex flex-col select-none p-4">
      <div
        className="flex items-center justify-between mb-3 p-3 rounded-lg border backdrop-blur-sm flex-wrap gap-y-2 gap-x-4"
        style={{
          backgroundColor: `${accentColor}10`,
          borderColor: `${accentColor}30`,
        }}
      >        <div className="flex items-center gap-3 flex-grow min-w-0">
          {primaryLeftActions}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {primaryRightActions}
          {!primaryRightActions && onRefreshData && (
            <Button
              onClick={onRefreshData}
              disabled={isLoading}
              variant="secondary"
              size="sm"
              icon={isLoading ? <Icon icon={GENERIC_CONTENT_TAB_DEFAULT_ICONS[0]} className="w-4 h-4 animate-spin" /> : <Icon icon="solar:refresh-outline" className="w-4 h-4" />}
              title="Refresh"
            />
          )}
        </div>
      </div>      {(showSecondaryActionsBar || secondaryLeftActions || secondaryRightActions) && showSecondaryActionsBar !== false && (
        <>
          <div 
            className="h-px my-2"
            style={{ backgroundColor: `${accentColor}30` }}
          />
          <div
            className="flex items-center justify-between mb-4 p-3 rounded-lg border backdrop-blur-sm flex-wrap gap-y-2 gap-x-4"
            style={{              backgroundColor: `${accentColor}08`,
              borderColor: `${accentColor}20`,
            }}
          >
            <div className="flex items-center gap-3 flex-grow min-w-0">
              {secondaryLeftActions}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {secondaryRightActions}
            </div>
          </div>
        </>
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