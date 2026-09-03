"use client";

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import { CheckboxV2 } from "../ui/CheckboxV2";
import { Tooltip } from "../ui/Tooltip";
import { LauncherLogo } from "./LauncherLogo";
import { LauncherInstanceRow } from "./LauncherInstanceRow";
import { useThemeStore } from "../../store/useThemeStore";
import { isSelectable } from "../../types/launcherImport";
import type { DetectedLauncher, ExternalInstanceRef } from "../../types/launcherImport";

export interface LauncherGroupSectionProps {
  launcher: DetectedLauncher;
  instances: ExternalInstanceRef[];
  visibleInstances: ExternalInstanceRef[];
  collapsed: boolean;
  phase: "idle" | "loading" | "ready" | "error";
  error: string | null;
  selected: string[];
  importedThisSession: Record<string, string>;
  onToggleCollapsed: () => void;
  onToggleLauncher: () => void;
  onToggleInstance: (instanceDir: string) => void;
  onOpenProfile: (profileId: string) => void;
  onRemove?: () => void;
  onRetry: () => void;
}

export function LauncherGroupSection({
  launcher,
  instances,
  visibleInstances,
  collapsed,
  phase,
  error,
  selected,
  importedThisSession,
  onToggleCollapsed,
  onToggleLauncher,
  onToggleInstance,
  onOpenProfile,
  onRemove,
  onRetry,
}: LauncherGroupSectionProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);

  const selectable = visibleInstances.filter((instance) =>
    isSelectable(instance, importedThisSession),
  );
  const selectedHere = selectable.filter((instance) =>
    selected.includes(instance.instanceDir),
  ).length;
  const allSelected = selectable.length > 0 && selectedHere === selectable.length;

  return (
    <div
      className="overflow-hidden rounded-lg border bg-black/20 transition-colors"
      style={{
        borderColor: selectedHere > 0 ? `${accentColor.value}45` : "rgba(255,255,255,0.1)",
      }}
    >
      <div
        onClick={onToggleCollapsed}
        className="group/head flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
      >
        <Icon
          icon="solar:alt-arrow-right-linear"
          className="h-4 w-4 flex-shrink-0 text-white/30 transition-transform group-hover/head:text-white/60"
          style={{ transform: collapsed ? undefined : "rotate(90deg)" }}
        />

        <div onClick={(event) => event.stopPropagation()} className="flex-shrink-0">
          <CheckboxV2
            size="sm"
            checked={allSelected}
            indeterminate={selectedHere > 0 && !allSelected}
            onChange={onToggleLauncher}
            disabled={phase === "error" || selectable.length === 0}
          />
        </div>

        <Tooltip content={launcher.instancesDir} position="top" wrapperClassName="flex-shrink-0">
          <LauncherLogo launcher={launcher.launcher} size="sm" />
        </Tooltip>

        <div className="min-w-0 flex-1">
          <span className="truncate font-minecraft text-base normal-case text-white">
            {launcher.displayName}
          </span>
          {!launcher.autoDetected && (
            <span className="ml-2 font-minecraft text-[10px] uppercase tracking-wider text-white/35">
              {t("profiles.launcherImport.added_by_you")}
            </span>
          )}
        </div>

        <span className="flex-shrink-0 font-minecraft text-xs text-white/40">
          {t("profiles.launcherImport.instance_count", { count: launcher.instanceCount })}
        </span>

        {onRemove && (
          <Tooltip
            content={t("profiles.launcherImport.manual.remove")}
            position="top"
            wrapperClassName="flex-shrink-0"
          >
            <button
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-white/40 opacity-0 transition-all hover:bg-white/10 hover:text-white group-hover/head:opacity-100"
            >
              <Icon icon="solar:close-circle-linear" className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>

      {!collapsed && (
        <div className="border-t border-white/[0.07]">
          {phase === "loading" && (
            <div className="flex items-center gap-2 px-4 py-3 font-minecraft text-xs text-white/45">
              <Icon icon="svg-spinners:ring-resize" className="h-3.5 w-3.5" />
              {t("profiles.launcherImport.loading_instances")}
            </div>
          )}

          {phase === "error" && (
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 truncate font-minecraft text-xs text-amber-300/80">
                {t("profiles.launcherImport.instances_failed", {
                  launcher: launcher.displayName,
                  error: error ?? "",
                })}
              </span>
              <button
                onClick={onRetry}
                className="flex-shrink-0 px-2 py-1 font-minecraft text-[10px] uppercase tracking-wider text-white/45 transition-colors hover:text-white"
              >
                {t("profiles.launcherImport.retry")}
              </button>
            </div>
          )}

          {phase === "ready" && visibleInstances.length === 0 && (
            <div className="px-4 py-3 font-minecraft text-xs text-white/35">
              {instances.length === 0
                ? t("profiles.launcherImport.launcher_empty")
                : t("profiles.launcherImport.no_match_in_launcher")}
            </div>
          )}

          {visibleInstances.length > 0 && (
            <div className="space-y-1.5 p-2">
              {visibleInstances.map((instance) => (
                <LauncherInstanceRow
                  key={instance.instanceDir}
                  instance={instance}
                  selected={selected.includes(instance.instanceDir)}
                  importedProfileId={importedThisSession[instance.instanceDir]}
                  onToggle={() => onToggleInstance(instance.instanceDir)}
                  onOpenProfile={onOpenProfile}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
