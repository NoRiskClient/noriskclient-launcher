import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { UnifiedVersion } from "../../types/unified";
import { Tooltip } from "../ui/Tooltip";
import { openExternalUrl } from "../../services/tauri-service";
import { loaderIconSrc } from "../../lib/loader-icons";
import { formatCompactNumber } from "../../utils/format-number";
import { formatShortAge } from "../../utils/format-relative-time";
import { ChannelBadge } from "./ChannelBadge";
import { GameVersionPill } from "./GameVersionPill";

const OPTIMISTIC_INSTALL_MS = 1500;
const TOOLTIP_DELAY_MS = 600;

export interface VersionRowState {
  installed?: boolean;
  enabled?: boolean;
  inPack?: boolean;
  blocked?: boolean;
}

interface VersionTableProps {
  versions: UnifiedVersion[];
  installingIds?: Record<string, boolean>;
  onInstall: (version: UnifiedVersion) => void;
  stateFor?: (version: UnifiedVersion) => VersionRowState | null;
  onToggleEnabled?: (version: UnifiedVersion, enabled: boolean) => void;
  onDelete?: (version: UnifiedVersion) => void;
  remaining?: number;
  onLoadMore?: () => void;
}

function IconAction({ icon, title, onClick, disabled, tone = "neutral" }: { icon: string; title: string; onClick: () => void; disabled?: boolean; tone?: "neutral" | "install" | "danger" }) {
  const toneClass =
    tone === "install"
      ? "text-emerald-300 hover:bg-emerald-500/15"
      : tone === "danger"
        ? "text-white/40 hover:text-rose-300 hover:bg-rose-500/15"
        : "text-white/40 hover:text-white hover:bg-white/5";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors disabled:opacity-40 disabled:pointer-events-none ${toneClass}`}
    >
      <Icon icon={icon} className="w-4 h-4" />
    </button>
  );
}

export function VersionTable({ versions, installingIds = {}, onInstall, stateFor, onToggleEnabled, onDelete, remaining = 0, onLoadMore }: VersionTableProps) {
  const { t } = useTranslation();
  const [clicked, setClicked] = useState<Record<string, true>>({});

  useEffect(() => {
    if (Object.keys(clicked).length === 0) return;
    const timer = window.setTimeout(() => setClicked({}), OPTIMISTIC_INSTALL_MS);
    return () => window.clearTimeout(timer);
  }, [clicked]);

  const install = (version: UnifiedVersion) => {
    if (clicked[version.id] || installingIds[version.id]) return;
    setClicked((prev) => ({ ...prev, [version.id]: true }));
    onInstall(version);
  };

  const cols = "grid grid-cols-[minmax(0,1fr)_minmax(0,9.5rem)_minmax(0,6rem)_3rem_3.75rem_4.25rem] items-center gap-3";

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 overflow-hidden">
      <div className={`${cols} px-4 py-2.5 border-b border-white/10 font-minecraft text-xs text-white/40`}>
        <span className="truncate pl-9">{t("mod_detail.versions.col_version")}</span>
        <span className="truncate">{t("mod_detail.versions.col_game_version")}</span>
        <span className="truncate">{t("mod_detail.versions.col_platform")}</span>
        <span className="truncate">{t("mod_detail.versions.col_published")}</span>
        <span className="truncate">{t("mod_detail.versions.col_downloads")}</span>
        <span />
      </div>
      {versions.map((version) => {
        const state = stateFor?.(version) ?? null;
        const installing = !!installingIds[version.id] || (!!clicked[version.id] && !state?.installed);
        const blocked = version.isBlocked || state?.blocked;
        const loaders = version.loaders.map((loader) => loader.charAt(0).toUpperCase() + loader.slice(1));
        return (
          <div
            key={version.id}
            className={`${cols} px-4 py-2.5 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] transition-colors`}
          >
            <span className="min-w-0 flex items-center gap-2">
              <ChannelBadge releaseType={version.release_type} />
              {blocked && (
                <Tooltip position="top" delay={TOOLTIP_DELAY_MS} content={t("modrinth.blocked_mod_tooltip")}>
                  <Icon icon="solar:danger-triangle-bold" className="w-4 h-4 shrink-0 text-red-500" />
                </Tooltip>
              )}
              <span className="font-minecraft text-sm text-white normal-case truncate" title={version.name}>
                {version.version_number}
              </span>
              {state?.installed && (
                <Tooltip position="top" delay={TOOLTIP_DELAY_MS} content={state.enabled === false ? t("common.disabled") : t("common.installed")}>
                  <Icon
                    icon={state.enabled === false ? "solar:close-circle-bold" : "solar:check-circle-bold"}
                    className={`w-4 h-4 shrink-0 ${state.enabled === false ? "text-white/35" : "text-emerald-400"}`}
                  />
                </Tooltip>
              )}
              {state?.inPack && (
                <Tooltip position="top" delay={TOOLTIP_DELAY_MS} content={t("modrinth.in_norisk_pack")}>
                  <Icon icon="solar:bolt-circle-bold" className="w-4 h-4 shrink-0 text-sky-400" />
                </Tooltip>
              )}
            </span>
            <GameVersionPill versions={version.game_versions} />
            <span className="min-w-0 flex items-center gap-1" title={loaders.join(", ")}>
              {version.loaders[0] && (
                <span className="min-w-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 font-minecraft text-xs text-white/75">
                  <img src={loaderIconSrc(version.loaders[0])} alt="" className="w-3 h-3 shrink-0 object-contain" />
                  <span className="truncate">{loaders[0]}</span>
                </span>
              )}
              {loaders.length > 1 && <span className="shrink-0 font-minecraft text-xs text-white/35">+{loaders.length - 1}</span>}
            </span>
            <span className="truncate font-minecraft text-xs text-white/45" title={new Date(version.date_published).toLocaleString()}>{formatShortAge(version.date_published)}</span>
            <span className="font-minecraft text-xs text-white/45 tabular-nums">{formatCompactNumber(version.downloads)}</span>
            <span className="flex items-center justify-end gap-0.5">
              {version.url && (
                <IconAction
                  icon="solar:arrow-right-up-bold"
                  title={t("mod_detail.versions.open_page")}
                  onClick={() => void openExternalUrl(version.url).catch(() => {})}
                />
              )}
              {state?.installed && onToggleEnabled && typeof state.enabled === "boolean" && (
                <IconAction
                  icon={state.enabled ? "solar:pause-bold" : "solar:play-bold"}
                  title={state.enabled ? t("common.disable") : t("common.enable")}
                  onClick={() => onToggleEnabled(version, !state.enabled)}
                />
              )}
              {state?.installed && onDelete && !state.inPack && (
                <IconAction
                  icon="solar:trash-bin-trash-bold"
                  title={t("common.delete")}
                  tone="danger"
                  onClick={() => onDelete(version)}
                />
              )}
              {!state?.installed && (
                <IconAction
                  icon={installing ? "svg-spinners:ring-resize" : "solar:download-minimalistic-bold"}
                  title={t("modrinth.install")}
                  tone="install"
                  disabled={installing}
                  onClick={() => install(version)}
                />
              )}
            </span>
          </div>
        );
      })}
      {remaining > 0 && onLoadMore && (
        <button
          type="button"
          onClick={onLoadMore}
          className="w-full flex items-center justify-center gap-2 py-3 border-t border-white/5 font-minecraft text-sm text-white/50 hover:text-white hover:bg-white/[0.03] transition-colors"
        >
          <Icon icon="solar:alt-arrow-down-bold" className="w-4 h-4" />
          {t("mod_detail.versions.load_more", { count: remaining })}
        </button>
      )}
    </div>
  );
}
