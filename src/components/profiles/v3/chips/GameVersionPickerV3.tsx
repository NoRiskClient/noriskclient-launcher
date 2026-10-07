"use client";

/**
 * GameVersionPickerV3 — presentational command-palette picker for a Minecraft
 * version. Data and mutation are owned by `useHeroChipEditors`; this
 * component just renders what it's given.
 *
 * Filters `versions` locally by release/snapshot (MC API returns "release",
 * "snapshot", "old_beta", "old_alpha" — we only surface release/snapshot).
 */

import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../../../store/useThemeStore";
import type { MinecraftVersion } from "../../../../types/minecraft";

interface GameVersionPickerV3Props {
  currentVersion: string;
  versions: MinecraftVersion[] | null;
  isLoading: boolean;
  error?: string | null;
  isSaving?: boolean;
  onRetry?: () => void;
  onSelect: (version: string) => void;
}

export function GameVersionPickerV3({
  currentVersion,
  versions,
  isLoading,
  error,
  isSaving,
  onRetry,
  onSelect,
}: GameVersionPickerV3Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [showSnapshots, setShowSnapshots] = useState(false);
  const accent = useThemeStore((s) => s.accentColor);

  const filtered = useMemo(() => {
    if (!versions) return [];
    const q = query.trim().toLowerCase();
    const wantedType = showSnapshots ? "snapshot" : "release";
    return versions.filter((v) => {
      if (v.type !== wantedType) return false;
      if (!q) return true;
      return v.id.toLowerCase().includes(q);
    });
  }, [versions, query, showSnapshots]);

  return (
    <div className="flex flex-col">
      {/* Search — same recipe as LocalContentTabV3 toolbar */}
      <div className="p-2">
        <div className="relative">
          <Icon icon="solar:magnifer-linear" className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 pointer-events-none" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("profiles.v3.chips.gameVersion.search")}
            aria-label={t("profiles.v3.chips.gameVersion.search")}
            className="w-full h-7 pl-7 pr-2 rounded bg-white/5 border border-white/10 focus:border-white/25 outline-none focus:outline focus:outline-2 focus:[outline-style:solid] focus:-outline-offset-2 focus:outline-white/70 text-xs text-white placeholder:text-white/30 font-minecraft"
          />
        </div>
      </div>

      {/* Segmented: Releases / Snapshots */}
      <div className="flex items-center gap-0.5 px-2 pb-2">
        {(["release", "snapshot"] as const).map((seg) => {
          const active = seg === "release" ? !showSnapshots : showSnapshots;
          return (
            <button
              key={seg}
              onClick={() => setShowSnapshots(seg === "snapshot")}
              style={active ? { backgroundColor: `${accent.value}33`, color: accent.light } : undefined}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.backgroundColor = `${accent.value}1a`;
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.backgroundColor = "transparent";
              }}
              className={`flex-1 h-6 rounded text-[10px] uppercase tracking-wider font-minecraft transition-colors ${
                active ? "" : "text-white/50"
              }`}
            >
              {seg === "release"
                ? t("profiles.v3.chips.gameVersion.releases")
                : t("profiles.v3.chips.gameVersion.snapshots")}
            </button>
          );
        })}
      </div>

      <div className="border-t border-white/10" />
      {isSaving && <p role="status" className="px-3 py-2 text-xs text-white/80 font-minecraft">{t('common.saving', { defaultValue: 'Saving...' })}</p>}

      {/* List */}
      <div className="max-h-[220px] overflow-y-auto py-1 custom-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-white/40 font-minecraft">
            <Icon icon="svg-spinners:ring-resize" className="w-3.5 h-3.5" />
            {t("profiles.v3.chips.gameVersion.loading")}
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-center text-xs font-minecraft">
            <p role="alert" className="text-red-200 break-words">{error}</p>
            {onRetry && <button type="button" onClick={onRetry}
              className="mt-2 px-2 py-1 rounded text-white/90 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
              {t('common.retry', { defaultValue: 'Retry' })}
            </button>}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-white/30 font-minecraft">
            {t("profiles.v3.chips.gameVersion.empty")}
          </div>
        ) : (
          filtered.map((v) => {
            const isCurrent = v.id === currentVersion;
            return (
              <button
                key={v.id}
                disabled={isSaving}
                onClick={() => onSelect(v.id)}
                style={isCurrent ? { backgroundColor: `${accent.value}33` } : undefined}
                onMouseEnter={(e) => {
                  if (!isCurrent) e.currentTarget.style.backgroundColor = `${accent.value}40`;
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) e.currentTarget.style.backgroundColor = "transparent";
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:opacity-50"
              >
                <span className={`flex-1 text-xs font-minecraft ${isCurrent ? "text-white" : "text-white/80"}`}>
                  {v.id}
                </span>
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
