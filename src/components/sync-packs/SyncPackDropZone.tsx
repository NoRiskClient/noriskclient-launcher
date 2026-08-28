"use client";

import { useTranslation } from "react-i18next";

import { useThemeStore } from "../../store/useThemeStore";
import type { SyncPack, SyncTargetPreset } from "../../types/syncPacks";
import { SYNC_TARGET_PRESETS } from "../../types/syncPacks";
import { Tooltip } from "../ui/Tooltip";

export interface SyncPackDropZoneProps {
  pack: SyncPack;
  isDragOver: boolean;
  isBusy: boolean;
  canBrowse: boolean;
  onPickPaths: (directory: boolean) => void;
  onPickPreset: (preset: SyncTargetPreset) => void;
  onBrowseMods: () => void;
}

const ADD_BUTTON =
  "rounded px-2 py-1 font-minecraft text-[10px] uppercase tracking-wider transition-colors hover:bg-white/10 disabled:opacity-30";

function missingPresets(pack: SyncPack): SyncTargetPreset[] {
  const taken = new Set(pack.targets.map((target) => target.path.toLowerCase()));
  return SYNC_TARGET_PRESETS.filter(
    (preset) =>
      preset.kindType !== "mods" && !taken.has(preset.path.toLowerCase()),
  );
}

export function SyncPackDropZone({
  pack,
  isDragOver,
  isBusy,
  canBrowse,
  onPickPaths,
  onPickPreset,
  onBrowseMods,
}: SyncPackDropZoneProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const presets = missingPresets(pack);

  return (
    <div
      className="m-3 flex flex-col items-center justify-center gap-2 border border-dashed py-3 text-center transition-colors"
      style={{
        borderColor: isDragOver ? accentColor.value : "rgba(255,255,255,0.12)",
        backgroundColor: isDragOver ? `${accentColor.value}12` : "transparent",
      }}
    >
      <span className="font-minecraft text-[11px] text-white/35">
        {isDragOver ? t("syncPacks.drop.overlay") : t("syncPacks.drop.hint")}
      </span>

      {!isDragOver && presets.length > 0 && (
        <div className="flex max-w-[560px] flex-wrap items-center justify-center gap-1.5">
          {presets.map((preset) => (
            <Tooltip
              key={preset.path}
              content={
                preset.warn
                  ? t("syncPacks.targets.savesWarning")
                  : t(`syncPacks.kinds.${preset.kindType}`)
              }
              position="top"
            >
              <button
                onClick={() => onPickPreset(preset)}
                disabled={isBusy}
                className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 font-minecraft text-xs text-white/50 transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-white/90 disabled:opacity-30"
              >
                + {preset.path}
              </button>
            </Tooltip>
          ))}
        </div>
      )}

      {!isDragOver && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPickPaths(true)}
            disabled={isBusy}
            className={`${ADD_BUTTON} text-white/45 hover:text-white`}
          >
            + {t("syncPacks.add.folder")}
          </button>
          <span className="text-white/15">|</span>
          <button
            onClick={() => onPickPaths(false)}
            disabled={isBusy}
            className={`${ADD_BUTTON} text-white/45 hover:text-white`}
          >
            + {t("syncPacks.add.file")}
          </button>
          <span className="text-white/15">|</span>
          <Tooltip
            content={
              canBrowse ? t("syncPacks.add.mods") : t("syncPacks.noProfile")
            }
            position="top"
          >
            <button
              onClick={onBrowseMods}
              disabled={isBusy || !canBrowse}
              className={ADD_BUTTON}
              style={{ color: accentColor.value }}
            >
              + {t("syncPacks.add.mods")}
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
