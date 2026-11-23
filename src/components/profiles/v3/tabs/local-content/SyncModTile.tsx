"use client";

import { useRef } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  isSyncModLive,
  isSyncModLockedByPack,
  isSyncModOnHere,
  syncModKey,
  type ProfileSyncModStatus,
  type ProfileSyncPackMod,
} from "../../../../../types/syncPacks";
import type { UnifiedVersion } from "../../../../../types/unified";
import { useThemeStore } from "../../../../../store/useThemeStore";
import { Tooltip } from "../../../../ui/Tooltip";
import { CheckboxV2 } from "../../../../ui/CheckboxV2";
import { ToggleSwitch } from "../../../../ui/ToggleSwitch";
import { VersionSelectDropdown } from "../../shared/VersionSelectDropdown";
import { ThemedDropdown, ThemedDropdownDivider, ThemedDropdownItem } from "../../shared/ThemedDropdown";
import type { ProfileSyncMods } from "./useProfileSyncMods";

export interface SyncModVersionPicker {
  open: boolean;
  versions: UnifiedVersion[] | null;
  loading: boolean;
  error: string | null;
  onOpen: () => void;
  onClose: () => void;
}

interface SyncModTileProps {
  entry: ProfileSyncPackMod;
  sync: ProfileSyncMods;
  mcVersion: string;
  selectMode: boolean;
  versionPicker: SyncModVersionPicker;
  menuOpen: boolean;
  onMenuToggle: (open: boolean) => void;
  onNameClick?: () => void;
}

export function SyncModTile({
  entry,
  sync,
  mcVersion,
  selectMode,
  versionPicker,
  menuOpen,
  onMenuToggle,
  onNameClick,
}: SyncModTileProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const versionButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const key = syncModKey(entry);
  const busy = sync.busyKey === key;
  const isSelected = sync.selection.has(key);
  const live = isSyncModLive(entry);
  const lockedByPack = isSyncModLockedByPack(entry);
  const onHere = isSyncModOnHere(entry);
  const isJar = entry.mod_id === null;
  const switchable = !isJar && !!entry.platform && !!entry.project_id;
  const offEverywhere = entry.status === "disabled";
  const status = statusBadge(entry, mcVersion, t);
  const iconUrl = sync.iconFor(entry);

  const dim = live ? "" : "opacity-55";
  const nameClass = `text-sm text-white font-minecraft truncate normal-case text-left ${live ? "" : "line-through"}`;
  const nameStyle = live ? undefined : { textDecorationColor: accentColor.value, textDecorationThickness: "2px" };

  const menuAction = (action: () => void) => () => {
    onMenuToggle(false);
    action();
  };

  return (
    <div
      style={isSelected ? { backgroundColor: `${accentColor.value}1a`, borderColor: `${accentColor.value}66` } : undefined}
      className={`group relative flex items-center gap-4 p-3 rounded-lg border transition-colors ${
        isSelected ? "" : "bg-black/20 border-white/10 hover:border-white/20 hover:bg-black/30"
      }`}
    >
      <div className={`flex-shrink-0 transition-opacity ${selectMode || isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        <CheckboxV2
          size="sm"
          checked={isSelected}
          onChange={() => sync.toggleSelected(entry)}
          tooltip={isSelected ? t("profiles.v3.tile.deselect") : t("profiles.v3.tile.select")}
        />
      </div>

      <div className={`w-14 h-14 flex-shrink-0 rounded-lg bg-white/5 ring-1 ring-white/10 flex items-center justify-center overflow-hidden ${dim}`}>
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <Icon
            icon={isJar ? "solar:box-minimalistic-bold" : "solar:bolt-bold-duotone"}
            className="w-6 h-6 text-white/50"
          />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className={`flex items-center gap-1.5 ${dim}`}>
          {onNameClick ? (
            <button
              onClick={onNameClick}
              className={`${nameClass} underline-offset-2 ${live ? "hover:underline decoration-white/40" : ""}`}
              style={nameStyle}
            >
              {entry.display_name}
            </button>
          ) : (
            <div className={nameClass} style={nameStyle}>
              {entry.display_name}
            </div>
          )}
          <Tooltip content={t("profiles.v3.syncMods.fromPackTooltip", { pack: entry.pack_name })}>
            <Icon icon="solar:link-round-bold" className="w-3 h-3 text-white/35 flex-shrink-0" />
          </Tooltip>
        </div>

        <div className="flex items-center gap-2 mt-1 text-xs font-minecraft min-w-0">
          {!isJar && (
            <div className="relative min-w-0">
              <button
                ref={versionButtonRef}
                onClick={(e) => {
                  e.stopPropagation();
                  if (switchable && !busy) versionPicker.onOpen();
                }}
                disabled={!switchable || busy}
                className={`inline-flex items-center gap-1 h-5 max-w-full px-1.5 rounded transition-colors ${
                  busy
                    ? "text-amber-200 bg-amber-400/10 cursor-wait"
                    : switchable
                      ? "text-white/70 hover:text-white hover:bg-white/5 cursor-pointer"
                      : "text-white/45 cursor-default"
                } ${dim}`}
              >
                {busy && <Icon icon="svg-spinners:ring-resize" className="w-3 h-3 flex-shrink-0" />}
                {!busy && entry.pinned && (
                  <Tooltip content={t("profiles.v3.syncMods.pinned")}>
                    <Icon icon="solar:pin-bold" className="w-3 h-3 flex-shrink-0 text-white/50" />
                  </Tooltip>
                )}
                <span className="truncate">{entry.version_name || "—"}</span>
                {switchable && !busy && (
                  <Icon icon="solar:alt-arrow-down-linear" className="w-3 h-3 flex-shrink-0 opacity-60" />
                )}
              </button>
              <VersionSelectDropdown
                open={versionPicker.open}
                onClose={versionPicker.onClose}
                triggerRef={versionButtonRef}
                versions={versionPicker.versions}
                loading={versionPicker.loading}
                error={versionPicker.error}
                currentVersionId={entry.pinned ? entry.version_id : null}
                onSelect={(version) => {
                  versionPicker.onClose();
                  sync.pinVersion(entry, version.id);
                }}
                latestOption={{
                  label: t("profiles.v3.syncMods.version.latest"),
                  hint: t("profiles.v3.syncMods.version.latestHint", { version: mcVersion }),
                  selected: !entry.pinned,
                  onSelect: () => {
                    versionPicker.onClose();
                    sync.pinVersion(entry, null);
                  },
                }}
              />
            </div>
          )}
          {status && (
            <Tooltip content={<span className="block max-w-[260px]">{status.hint}</span>}>
              <span className={`inline-flex items-center gap-1 h-5 flex-shrink-0 ${status.tone}`}>
                <Icon icon={status.icon} className="w-3 h-3 flex-shrink-0" />
                {status.label}
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      <Tooltip
        content={
          lockedByPack
            ? t("profiles.v3.syncMods.toggle.locked")
            : t(onHere ? "profiles.v3.syncMods.toggle.turnOff" : "profiles.v3.syncMods.toggle.turnOn")
        }
        wrapperClassName="flex-shrink-0"
      >
        <div>
          <ToggleSwitch
            checked={onHere}
            onChange={() => void sync.setHere([entry], !onHere)}
            disabled={busy || lockedByPack}
            size="sm"
          />
        </div>
      </Tooltip>

      <div className="relative flex-shrink-0">
        <button
          ref={menuButtonRef}
          onClick={(e) => {
            e.stopPropagation();
            onMenuToggle(!menuOpen);
          }}
          className={`p-1.5 rounded text-white/40 hover:text-white hover:bg-white/10 transition-opacity ${
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <Icon icon="solar:menu-dots-bold" className="w-4 h-4" />
        </button>
        <ThemedDropdown open={menuOpen} onClose={() => onMenuToggle(false)} width="w-64" triggerRef={menuButtonRef}>
          <div className="px-3 pb-1 pt-2 font-minecraft text-[10px] uppercase tracking-wider text-white/35">
            {t("profiles.v3.syncMods.menu.everywhereTitle", { pack: entry.pack_name })}
          </div>
          {!isJar && entry.pinned && (
            <ThemedDropdownItem icon="solar:refresh-bold" onClick={menuAction(() => sync.pinVersion(entry, null))}>
              {t("profiles.v3.syncMods.version.latest")}
            </ThemedDropdownItem>
          )}
          {!isJar && (
            <ThemedDropdownItem
              icon={offEverywhere ? "solar:play-bold" : "solar:pause-bold"}
              onClick={menuAction(() => sync.setEverywhere(entry, offEverywhere))}
            >
              {t(offEverywhere ? "profiles.v3.syncMods.menu.onEverywhere" : "profiles.v3.syncMods.menu.offEverywhere")}
            </ThemedDropdownItem>
          )}
          <ThemedDropdownItem icon="solar:pen-linear" onClick={menuAction(() => sync.openPack(entry.pack_id))}>
            {t("profiles.v3.syncMods.menu.editPack")}
          </ThemedDropdownItem>
          <ThemedDropdownDivider />
          <ThemedDropdownItem
            icon="solar:trash-bin-trash-linear"
            tone="danger"
            onClick={menuAction(() => void sync.remove(entry))}
          >
            {t("profiles.v3.syncMods.menu.remove")}
          </ThemedDropdownItem>
        </ThemedDropdown>
      </div>
    </div>
  );
}

const MUTED = "text-white/40";

const STATUS_BADGES: Record<Exclude<ProfileSyncModStatus, "active">, { label: string; icon: string; tone: string }> = {
  pending: { label: "pending", icon: "solar:clock-circle-bold", tone: MUTED },
  disabled: { label: "disabled", icon: "solar:close-circle-bold", tone: MUTED },
  excluded_here: { label: "excludedHere", icon: "solar:close-circle-bold", tone: MUTED },
  disabled_for_version: { label: "disabledForVersion", icon: "solar:close-circle-bold", tone: MUTED },
  shadowed: { label: "shadowed", icon: "solar:layers-minimalistic-bold", tone: "text-amber-300/80" },
};

function statusBadge(entry: ProfileSyncPackMod, mcVersion: string, t: TFunction) {
  if (entry.status === "active") return null;
  const badge = STATUS_BADGES[entry.status];
  const hintKey =
    entry.status === "shadowed"
      ? entry.shadowed_by_pack
        ? "shadowedByPack"
        : "shadowedByProfile"
      : badge.label;
  const vars = { version: mcVersion, pack: entry.shadowed_by_pack };
  return {
    label: t(`profiles.v3.syncMods.status.${badge.label}`, vars),
    hint: t(`profiles.v3.syncMods.hint.${hintKey}`, vars),
    icon: badge.icon,
    tone: badge.tone,
  };
}
