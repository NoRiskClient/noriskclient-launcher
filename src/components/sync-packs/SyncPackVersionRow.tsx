"use client";

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";

import { useThemeStore } from "../../store/useThemeStore";
import { ModPlatform } from "../../types/unified";
import type { UnifiedVersion } from "../../types/unified";
import { loaderIconSrc, loaderLabel } from "../../lib/loader-icons";
import { Tooltip } from "../ui/Tooltip";
import { VersionSelectDropdown } from "../profiles/v3/shared/VersionSelectDropdown";
import type { SyncPackModMatrixRow, VersionOverride } from "../../types/syncPacks";

export interface SyncPackVersionRowProps {
  row: SyncPackModMatrixRow;
  override?: VersionOverride;
  platform: ModPlatform | null;
  dropdownOpen: boolean;
  versions: UnifiedVersion[] | null;
  loadingVersions: boolean;
  versionError: string | null;
  resolving: boolean;
  onOpenDropdown: () => void;
  onCloseDropdown: () => void;
  onSelectVersion: (version: UnifiedVersion) => void;
  onUseLatest: () => void;
  onDisable: () => void;
  onEnable: () => void;
}

type Mode = "latest" | "pinned" | "off";

export function SyncPackVersionRow({
  row,
  override,
  platform,
  dropdownOpen,
  versions,
  loadingVersions,
  versionError,
  resolving,
  onOpenDropdown,
  onCloseDropdown,
  onSelectVersion,
  onUseLatest,
  onDisable,
  onEnable,
}: SyncPackVersionRowProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const mode: Mode =
    override?.type === "disabled"
      ? "off"
      : override?.type === "pin"
        ? "pinned"
        : "latest";

  const marker: Record<Mode, { icon: string; color: string; tip: string }> = {
    latest: {
      icon: "solar:refresh-circle-linear",
      color: "rgba(255,255,255,0.4)",
      tip: t("syncPacks.entries.modeLatestTip"),
    },
    pinned: {
      icon: "solar:pin-bold",
      color: accentColor.value,
      tip: t("syncPacks.entries.modePinnedTip"),
    },
    off: {
      icon: "solar:forbidden-circle-bold",
      color: "rgba(248,113,113,0.8)",
      tip: t("syncPacks.entries.modeOffTip"),
    },
  };

  const resolvedLabel = row.resolved_version_name ?? row.resolved_filename;
  const chipLabel =
    mode === "off"
      ? t("syncPacks.entries.statusDisabled")
      : (resolvedLabel ?? t(`syncPacks.entries.status.${row.status}`));
  const unresolved = row.status === "unresolved";
  const canSwitch = !!platform && mode !== "off";

  return (
    <div className="group/version flex items-center gap-3 rounded border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
      <span className="w-[92px] flex-shrink-0 truncate font-mono text-[11px] text-white/70">
        {row.mc_version}
      </span>
      <Tooltip content={loaderLabel(row.loader)} position="top">
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <img
            src={loaderIconSrc(row.loader)}
            alt={loaderLabel(row.loader)}
            className="h-4 w-4 object-contain opacity-70"
          />
        </span>
      </Tooltip>

      <Tooltip content={marker[mode].tip} position="top">
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <Icon
            icon={marker[mode].icon}
            className="h-3.5 w-3.5"
            style={{ color: marker[mode].color }}
          />
        </span>
      </Tooltip>

      <div className="relative min-w-0 flex-1">
        <Tooltip
          content={row.resolved_filename ?? chipLabel}
          position="top"
          wrapperClassName="max-w-full"
        >
        <button
          ref={triggerRef}
          onClick={(event) => {
            event.stopPropagation();
            if (canSwitch) onOpenDropdown();
          }}
          disabled={!canSwitch}
          className={`inline-flex h-5 max-w-full items-center gap-1 truncate rounded px-1.5 font-mono text-[11px] transition-colors ${
            canSwitch ? "cursor-pointer hover:bg-white/5" : "cursor-default"
          }`}
          style={{
            color: unresolved
              ? "#fbbf24"
              : mode === "off"
                ? "rgba(255,255,255,0.2)"
                : "rgba(255,255,255,0.75)",
          }}
        >
          {resolving && (
            <Icon
              icon="svg-spinners:ring-resize"
              className="h-3 w-3 flex-shrink-0"
            />
          )}
          <span className="truncate">{chipLabel}</span>
          {canSwitch && !resolving && (
            <Icon
              icon="solar:alt-arrow-down-linear"
              className="h-3 w-3 flex-shrink-0 opacity-50"
            />
          )}
        </button>
        </Tooltip>

        <VersionSelectDropdown
          open={dropdownOpen}
          onClose={onCloseDropdown}
          triggerRef={triggerRef}
          versions={versions}
          loading={loadingVersions}
          error={versionError}
          currentVersionId={mode === "pinned" ? row.resolved_version_id : null}
          onSelect={onSelectVersion}
          latestOption={{
            label: t("syncPacks.entries.modeLatest"),
            hint: t("syncPacks.entries.modeLatestHint"),
            selected: mode === "latest",
            onSelect: onUseLatest,
          }}
        />
      </div>

      <Tooltip
        content={
          mode === "off"
            ? t("syncPacks.entries.enableForVersion")
            : t("syncPacks.entries.disableForVersion")
        }
        position="top"
        wrapperClassName="flex-shrink-0"
      >
        <button
          onClick={() => (mode === "off" ? onEnable() : onDisable())}
          className={`px-1.5 py-0.5 font-minecraft text-[10px] uppercase tracking-wider transition-colors ${
            mode === "off"
              ? "text-white/45 hover:text-white"
              : "text-white/0 group-hover/version:text-white/35 hover:!text-red-400"
          }`}
        >
          {mode === "off"
            ? t("syncPacks.entries.enable")
            : t("syncPacks.entries.disable")}
        </button>
      </Tooltip>
    </div>
  );
}
