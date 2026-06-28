"use client";

/**
 * LoaderVersionPickerV3 — presentational picker for loader versions.
 *
 * `currentVersion` is the effectively-in-use version (override / pack /
 * profile-default / API-resolved latest). `resolvedSource` tells us where
 * that value came from; we surface a muted badge on the highlighted row only
 * for non-default sources (pack / user_overwrite) so the user understands
 * WHY that row is active and that picking *any* version here promotes it to
 * an explicit per-loader override.
 */

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../../../store/useThemeStore";
import type { LoaderVersionReason } from "../../../../types/profile";

// Only surface a badge when the effective version comes from something OTHER
// than the plain stored loader_version — pack policy or explicit override —
// because those tell the user "this isn't just your default, something is
// influencing it".
const SOURCE_LABEL_KEY: Record<LoaderVersionReason, string | null> = {
  profile_default: null,
  norisk_pack:     "profiles.v3.chips.loaderVersion.source.pack",
  user_overwrite:  "profiles.v3.chips.loaderVersion.source.override",
  not_resolved:    null,
};

interface LoaderVersionPickerV3Props {
  loader: string;
  /** Effectively-in-use version (stored OR resolved). Null when nothing set. */
  currentVersion: string | null;
  /** Source label shown on the current row when the version comes from resolution, not storage. */
  resolvedSource?: LoaderVersionReason;
  versions: string[] | null;
  isLoading: boolean;
  onSelect: (version: string) => void;
}

// Fabric/Quilt list items carry a " (stable)" suffix (matches the wizard's
// stored format, see useHeroChipEditors.formatFabricLike). Resolved values
// that come from norisk_pack don't carry it — normalize on both sides so the
// highlight still lights up the right row.
const stripStable = (v: string | null | undefined): string | null =>
  v ? v.replace(/\s*\(stable\)\s*$/i, "") : null;

export function LoaderVersionPickerV3({
  loader,
  currentVersion,
  resolvedSource,
  versions,
  isLoading,
  onSelect,
}: LoaderVersionPickerV3Props) {
  const { t } = useTranslation();
  const accent = useThemeStore((s) => s.accentColor);
  const sourceKey = resolvedSource ? SOURCE_LABEL_KEY[resolvedSource] : null;
  const currentNormalized = stripStable(currentVersion);

  return (
    <div className="flex flex-col">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.15em] text-white/40 font-minecraft-ten border-b border-white/10">
        {t("profiles.v3.chips.loaderVersion.header", { loader })}
      </div>

      <div className="py-1 max-h-[220px] overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-white/40 font-minecraft-ten">
            <Icon icon="solar:refresh-bold" className="w-3.5 h-3.5 animate-spin" />
            {t("profiles.v3.chips.loaderVersion.loading")}
          </div>
        ) : !versions || versions.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-white/30 font-minecraft-ten">
            {t("profiles.v3.chips.loaderVersion.empty")}
          </div>
        ) : (
          versions.map((v) => {
            const isCurrent = stripStable(v) === currentNormalized;
            return (
              <button
                key={v}
                onClick={() => onSelect(v)}
                style={isCurrent ? { backgroundColor: `${accent.value}33` } : undefined}
                onMouseEnter={(e) => {
                  if (!isCurrent) e.currentTarget.style.backgroundColor = `${accent.value}40`;
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) e.currentTarget.style.backgroundColor = "transparent";
                }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors"
              >
                <span className={`flex-1 text-xs font-minecraft-ten ${isCurrent ? "text-white" : "text-white/80"}`}>
                  {v}
                </span>
                {isCurrent && sourceKey && (
                  <span
                    className="text-[9px] uppercase tracking-[0.1em] font-minecraft-ten px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: `${accent.value}22`,
                      color: accent.light,
                    }}
                  >
                    {t(sourceKey)}
                  </span>
                )}
                {isCurrent && (
                  <Icon
                    icon="solar:check-circle-bold"
                    className="w-3.5 h-3.5 flex-shrink-0"
                    style={{ color: accent.light }}
                  />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
