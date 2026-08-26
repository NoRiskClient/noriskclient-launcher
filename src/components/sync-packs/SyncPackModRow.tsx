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

const SUBTLE_BUTTON =
  "px-1.5 py-0.5 font-minecraft text-[10px] uppercase tracking-wider text-white/40 transition-colors disabled:opacity-30";

export function SyncPackModRow({
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
        <div className="border-t border-white/[0.06] bg-black/20 px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-minecraft text-[10px] uppercase tracking-wider text-white/35">
              {t("syncPacks.entries.overridesTitle")}
            </span>
            <button
              onClick={() => onResolve()}
              disabled={resolving}
              className={`${SUBTLE_BUTTON} px-2 text-white/45 hover:text-white`}
            >
              {t("syncPacks.entries.resolveAll")}
            </button>
          </div>

          {!matrix || matrix.rows.length === 0 ? (
            <div className="py-2 font-minecraft text-[11px] text-white/25">
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
