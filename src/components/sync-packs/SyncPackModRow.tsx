"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";

import { useThemeStore } from "../../store/useThemeStore";
import { useVersionOptions } from "../../hooks/useVersionOptions";
import { ModPlatform } from "../../types/unified";
import type {
  SyncPackModEntry,
  SyncPackModMatrix,
  VersionOverride,
} from "../../types/syncPacks";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { Tooltip } from "../ui/Tooltip";
import { RowAction, SyncPackRow } from "./SyncPackRow";
import { SyncPackVersionRow } from "./SyncPackVersionRow";

export interface SyncPackModRowProps {
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  entry: SyncPackModEntry;
  matrix?: SyncPackModMatrix;
  iconUrl: string | null;
  resolving: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onRemove: () => void;
  onResolve: (mcVersion?: string, loader?: string) => void;
  onSetOverride: (
    mcVersion: string,
    value: VersionOverride | null,
    resolveAfter?: { mcVersion: string; loader: string },
  ) => void;
}

export function SyncPackModRow({
  selectable,
  selected,
  onToggleSelect,
  entry,
  matrix,
  iconUrl,
  resolving,
  onToggleEnabled,
  onRemove,
  onResolve,
  onSetOverride,
}: SyncPackModRowProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const [isExpanded, setIsExpanded] = useState(false);
  const versionOptions = useVersionOptions();

  const enabled = entry.enabled !== false;

  const platform =
    entry.source.type === "modrinth"
      ? ModPlatform.Modrinth
      : entry.source.type === "curseforge"
        ? ModPlatform.CurseForge
        : null;
  const projectId =
    entry.source.type === "modrinth" || entry.source.type === "curseforge"
      ? entry.source.project_id
      : null;

  const sourceLabel =
    entry.source.type === "modrinth"
      ? "Modrinth"
      : entry.source.type === "curseforge"
        ? "CurseForge"
        : t("syncPacks.entries.mod");

  return (
    <div>
      <SyncPackRow
        selectable={selectable}
        selected={selected}
        onToggleSelect={onToggleSelect}
        iconUrl={iconUrl}
        fallbackLetter={(entry.display_name ?? "?").trim().charAt(0)}
        title={entry.display_name ?? entry.id}
        subtitle={[
          sourceLabel,
          enabled
            ? t("syncPacks.entries.autoVersion")
            : t("syncPacks.entries.modOff"),
        ]
          .filter(Boolean)
          .join("  ·  ")}
        dimmed={!enabled}
        onClick={() => setIsExpanded((open) => !open)}
        actions={
          <>
            <Tooltip
              content={
                enabled
                  ? t("syncPacks.entries.disableEverywhere")
                  : t("syncPacks.entries.enableEverywhere")
              }
              position="top"
              wrapperClassName="flex-shrink-0"
            >
              <div onClick={(event) => event.stopPropagation()}>
                <ToggleSwitch
                  checked={enabled}
                  onChange={onToggleEnabled}
                  size="sm"
                />
              </div>
            </Tooltip>
            <RowAction
              label={t("syncPacks.targets.remove")}
                        icon="solar:trash-bin-trash-bold"
              onClick={onRemove}
              danger
            />
          </>
        }
        trailing={
          <Icon
            icon="solar:alt-arrow-down-linear"
            className="h-4 w-4 flex-shrink-0 text-white/15 transition-all group-hover/row:text-white/40"
            style={{ transform: isExpanded ? "rotate(180deg)" : undefined }}
          />
        }
      />

      {isExpanded && (
        <div className="mt-2 rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-minecraft text-[10px] uppercase tracking-wider text-white/35">
              {t("syncPacks.entries.overridesTitle")}
            </span>
            <Tooltip
              content={t("syncPacks.entries.resolveAll")}
              position="top"
              wrapperClassName="flex-shrink-0"
            >
              <button
                onClick={() => onResolve()}
                disabled={resolving}
                aria-label={t("syncPacks.entries.resolveAll")}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-black/40 text-white/45 transition-colors hover:border-white/20 hover:bg-black/60 hover:!text-white disabled:opacity-30"
              >
                <Icon
                  icon="solar:refresh-bold"
                  className={`h-3.5 w-3.5 ${resolving ? "animate-spin" : ""}`}
                />
              </button>
            </Tooltip>
          </div>

          {!matrix || matrix.rows.length === 0 ? (
            <div className="py-2 font-minecraft text-xs text-white/40">
              {t("syncPacks.entries.noVersions")}
            </div>
          ) : (
            <div className="space-y-1">
              {matrix.rows.map((row) => {
                const key = `${row.mc_version}:${row.loader}`;
                return (
                  <SyncPackVersionRow
                    key={key}
                    row={row}
                    override={entry.version_overrides[row.mc_version]}
                    platform={platform}
                    dropdownOpen={versionOptions.openKey === key}
                    versions={versionOptions.versionsFor(key)}
                    loadingVersions={versionOptions.loadingFor(key)}
                    versionError={versionOptions.errorFor(key)}
                    resolving={resolving}
                    onOpenDropdown={() =>
                      versionOptions.toggle(
                        key,
                        platform && projectId
                          ? {
                              platform,
                              projectId,
                              loaders: [row.loader],
                              gameVersions: [row.mc_version],
                            }
                          : null,
                      )
                    }
                    onCloseDropdown={versionOptions.close}
                    onSelectVersion={(version) => {
                      versionOptions.close();
                      onSetOverride(
                        row.mc_version,
                        { type: "pin", version_id: version.id },
                        { mcVersion: row.mc_version, loader: row.loader },
                      );
                    }}
                    onUseLatest={() => {
                      versionOptions.close();
                      versionOptions.invalidate(key);
                      onSetOverride(row.mc_version, null, {
                        mcVersion: row.mc_version,
                        loader: row.loader,
                      });
                    }}
                    onDisable={() =>
                      onSetOverride(row.mc_version, { type: "disabled" })
                    }
                    onEnable={() => onSetOverride(row.mc_version, null)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
