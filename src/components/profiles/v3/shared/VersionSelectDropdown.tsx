"use client";

import type React from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import { useThemeStore } from "../../../../store/useThemeStore";
import type { UnifiedVersion } from "../../../../types/unified";
import { ThemedDropdown, ThemedDropdownHeader } from "./ThemedDropdown";

export interface VersionSelectDropdownProps {
  open: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  versions: UnifiedVersion[] | null;
  loading: boolean;
  error: string | null;
  currentVersionId?: string | null;
  onSelect: (version: UnifiedVersion) => void;
  latestOption?: {
    label: string;
    hint?: string;
    selected: boolean;
    onSelect: () => void;
  };
  align?: "left" | "right";
  width?: string;
}

export function VersionSelectDropdown({
  open,
  onClose,
  triggerRef,
  versions,
  loading,
  error,
  currentVersionId,
  onSelect,
  latestOption,
  align = "left",
  width = "w-72",
}: VersionSelectDropdownProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);

  return (
    <ThemedDropdown
      open={open}
      onClose={onClose}
      width={width}
      align={align}
      scrollable
      triggerRef={triggerRef}
    >
      <ThemedDropdownHeader>
        {t("profiles.v3.versions.selectVersion")}
      </ThemedDropdownHeader>

      {latestOption && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            if (!latestOption.selected) latestOption.onSelect();
          }}
          disabled={latestOption.selected}
          onMouseEnter={(event) => {
            if (!latestOption.selected)
              event.currentTarget.style.backgroundColor = `${accentColor.value}40`;
          }}
          onMouseLeave={(event) => {
            if (!latestOption.selected)
              event.currentTarget.style.backgroundColor = "transparent";
          }}
          className={`w-full flex items-center gap-2 border-b border-white/10 px-3 py-1.5 text-xs font-minecraft text-left transition-colors ${
            latestOption.selected
              ? "text-white/40 cursor-default"
              : "text-white/85 hover:text-white cursor-pointer"
          }`}
        >
          <Icon
            icon={
              latestOption.selected
                ? "solar:check-circle-bold"
                : "solar:refresh-circle-linear"
            }
            className="w-3.5 h-3.5 flex-shrink-0"
            style={
              latestOption.selected
                ? { color: accentColor.value }
                : { color: "rgba(255,255,255,0.4)" }
            }
          />
          <div className="flex-1 min-w-0">
            <div className="truncate">{latestOption.label}</div>
            {latestOption.hint && (
              <div className="text-[10px] text-white/35 truncate normal-case">
                {latestOption.hint}
              </div>
            )}
          </div>
        </button>
      )}

      {loading && (
        <div className="flex items-center justify-center py-6 text-white/50 text-xs font-minecraft gap-2">
          <Icon icon="svg-spinners:ring-resize" className="w-3.5 h-3.5" />
          {t("profiles.v3.versions.loading")}
        </div>
      )}

      {!loading && error && (
        <div className="px-3 py-4 text-xs text-rose-300 font-minecraft">
          {error}
        </div>
      )}

      {!loading && !error && versions && versions.length === 0 && (
        <div className="px-3 py-4 text-xs text-white/40 font-minecraft">
          {t("profiles.v3.versions.none")}
        </div>
      )}

      {!loading &&
        !error &&
        versions &&
        versions.map((version) => {
          const isCurrent = version.id === currentVersionId;
          return (
            <button
              key={version.id}
              onClick={(event) => {
                event.stopPropagation();
                if (!isCurrent) onSelect(version);
              }}
              disabled={isCurrent}
              onMouseEnter={(event) => {
                if (!isCurrent)
                  event.currentTarget.style.backgroundColor = `${accentColor.value}40`;
              }}
              onMouseLeave={(event) => {
                if (!isCurrent)
                  event.currentTarget.style.backgroundColor = "transparent";
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs font-minecraft text-left transition-colors ${
                isCurrent
                  ? "text-white/40 cursor-default"
                  : "text-white/85 hover:text-white cursor-pointer"
              }`}
            >
              {isCurrent ? (
                <Icon
                  icon="solar:check-circle-bold"
                  className="w-3.5 h-3.5 flex-shrink-0"
                  style={{ color: accentColor.value }}
                />
              ) : (
                <Icon
                  icon="solar:tag-linear"
                  className="w-3.5 h-3.5 flex-shrink-0 text-white/40"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="truncate">{version.version_number}</div>
                <div className="text-[10px] text-white/35 truncate normal-case">
                  {version.name}
                </div>
              </div>
              {version.release_type !== "release" && (
                <span
                  className={`text-[9px] uppercase px-1 py-0.5 rounded flex-shrink-0 ${
                    version.release_type === "beta"
                      ? "bg-amber-400/15 text-amber-200 border border-amber-400/25"
                      : version.release_type === "alpha"
                        ? "bg-rose-400/15  text-rose-200  border border-rose-400/25"
                        : "bg-white/10 text-white/60 border border-white/15"
                  }`}
                >
                  {version.release_type}
                </span>
              )}
            </button>
          );
        })}
    </ThemedDropdown>
  );
}
