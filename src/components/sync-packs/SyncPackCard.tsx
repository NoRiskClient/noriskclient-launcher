"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";

import { useThemeStore } from "../../store/useThemeStore";
import type { SyncPack, SyncPackModEntry } from "../../types/syncPacks";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { Tooltip } from "../ui/Tooltip";
import { RowAction, SyncPackRow, prettyPath, selectionKey, targetIcon } from "./SyncPackRow";
import { SyncPackModRow } from "./SyncPackModRow";
import { SyncPackDropZone } from "./SyncPackDropZone";
import type { SyncPacksController } from "./useSyncPacks";
import {
  ThemedDropdown,
  ThemedDropdownDivider,
  ThemedDropdownItem,
} from "../profiles/v3/shared/ThemedDropdown";

export interface SyncPackCardProps {
  pack: SyncPack;
  controller: SyncPacksController;
  iconFor: (entry: SyncPackModEntry) => string | null;
  selection: Set<string>;
  onToggleSelect: (key: string) => void;
}

export function SyncPackCard({
  pack,
  controller,
  iconFor,
  selection,
  onToggleSelect,
}: SyncPackCardProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);

  const {
    profile,
    browseProfile,
    subscribedIds,
    expandedPack,
    setExpandedPack,
    localJars,
    matrix,
    isBusy,
    isDragOver,
    resolvingMod,
    setBrowsePack,
    setPresetPrompt,
    pickPaths,
    togglePack,
    deletePack,
    openFolder,
    removeTarget,
    removeMod,
    removeJar,
    setModEnabled,
    setOverride,
    resolveMod,
  } = controller;

  const inUse = subscribedIds.has(pack.id);
  const isOpen = expandedPack === pack.id;
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const jars = localJars[pack.id] ?? [];
  const packMatrix = matrix[pack.id] ?? [];
  const isEmpty =
    pack.targets.length === 0 && pack.mods.length === 0 && jars.length === 0;

  const summary = [
    pack.targets.length > 0 &&
      t("syncPacks.targetCount", { count: pack.targets.length }),
    pack.mods.length > 0 && t("syncPacks.modCount", { count: pack.mods.length }),
    jars.length > 0 && t("syncPacks.drop.localJars", { count: jars.length }),
  ]
    .filter(Boolean)
    .join("  |  ");

  return (
    <div
      className="group overflow-hidden rounded-lg border bg-black/20 transition-all duration-200"
      style={{
        borderColor: inUse ? `${accentColor.value}45` : "rgba(255,255,255,0.1)",
      }}
    >
      <div
        onClick={() => setExpandedPack(isOpen ? null : pack.id)}
        className="group/head flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
      >
        <div className="min-w-0 flex-1">
          <Tooltip
            content={pack.name}
            position="top"
            wrapperClassName="min-w-0 max-w-full"
          >
            <h3
              className="w-full truncate font-minecraft text-lg normal-case text-white"
              style={{ textShadow: "0 2px 4px rgba(0,0,0,0.7)" }}
            >
              {pack.name}
            </h3>
          </Tooltip>
          <div className="truncate font-minecraft text-xs text-white/45">
            {isEmpty ? t("syncPacks.targets.empty") : summary}
          </div>
        </div>

        {profile && (
          <Tooltip
            content={t("syncPacks.activeForProfile", { profile: profile.name })}
            position="top"
            wrapperClassName="flex-shrink-0"
          >
            <div onClick={(event) => event.stopPropagation()}>
              <ToggleSwitch
                checked={inUse}
                onChange={(next) => togglePack(pack, next)}
                disabled={isBusy}
                size="sm"
              />
            </div>
          </Tooltip>
        )}

        <div
          className="relative flex-shrink-0"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            ref={menuRef}
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={t("common.actions")}
            className={`flex h-6 w-6 items-center justify-center rounded text-white/40 transition-all duration-200 hover:bg-white/10 hover:text-white ${
              menuOpen ? "opacity-100" : "opacity-0 group-hover/head:opacity-100"
            }`}
          >
            <Icon icon="solar:menu-dots-bold" className="h-4 w-4" />
          </button>
          <ThemedDropdown
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            width="w-52"
            triggerRef={menuRef}
          >
            <ThemedDropdownItem
              icon="solar:folder-linear"
              onClick={() => {
                setMenuOpen(false);
                openFolder(pack.id);
              }}
            >
              {t("syncPacks.openFolder")}
            </ThemedDropdownItem>
            <ThemedDropdownDivider />
            <ThemedDropdownItem
              icon="solar:trash-bin-trash-linear"
              tone="danger"
              onClick={() => {
                setMenuOpen(false);
                deletePack(pack);
              }}
            >
              {t("syncPacks.delete")}
            </ThemedDropdownItem>
          </ThemedDropdown>
        </div>

        <Icon
          icon="solar:alt-arrow-down-linear"
          className="h-4 w-4 flex-shrink-0 text-white/20 transition-all group-hover/head:text-white/50"
          style={{ transform: isOpen ? "rotate(180deg)" : undefined }}
        />
      </div>

      {isOpen && (
        <div className="border-t border-white/[0.07]">
          {!isEmpty && (
            <div className="space-y-2 p-2">
              {pack.targets.map((target) => (
                <SyncPackRow
                  key={target.id}
                  selectable
                  selected={selection.has(selectionKey(pack.id, "target", target.path))}
                  onToggleSelect={() =>
                    onToggleSelect(selectionKey(pack.id, "target", target.path))
                  }
                  icon={targetIcon(target.kind)}
                  title={target.path}
                  subtitle={
                    target.external_path
                      ? prettyPath(target.external_path)
                      : undefined
                  }
                  subtitleTitle={
                    target.external_path
                      ? prettyPath(target.external_path)
                      : undefined
                  }
                  actions={
                    <>
                      <RowAction
                        label={t("syncPacks.openFolder")}
                        icon="solar:folder-open-bold"
                        onClick={() => openFolder(pack.id, target.path)}
                      />
                      <RowAction
                        label={t("syncPacks.targets.remove")}
                      icon="solar:trash-bin-trash-bold"
                        onClick={() => removeTarget(pack.id, target)}
                        danger
                      />
                    </>
                  }
                />
              ))}

              {pack.mods.map((entry) => (
                <SyncPackModRow
                  key={entry.id}
                  selectable
                  selected={selection.has(selectionKey(pack.id, "mod", entry.id))}
                  onToggleSelect={() =>
                    onToggleSelect(selectionKey(pack.id, "mod", entry.id))
                  }
                  entry={entry}
                  matrix={packMatrix.find((row) => row.mod_id === entry.id)}
                  iconUrl={iconFor(entry)}
                  resolving={resolvingMod === entry.id}
                  onToggleEnabled={(enabled) =>
                    setModEnabled(pack.id, entry, enabled)
                  }
                  onRemove={() => removeMod(pack.id, entry)}
                  onResolve={(mcVersion, loader) =>
                    resolveMod(pack.id, entry, mcVersion, loader)
                  }
                  onSetOverride={(mcVersion, value, resolveAfter) =>
                    setOverride(pack.id, entry, mcVersion, value, resolveAfter)
                  }
                />
              ))}

              {jars.map((fileName) => (
                <SyncPackRow
                  key={fileName}
                  selectable
                  selected={selection.has(selectionKey(pack.id, "jar", fileName))}
                  onToggleSelect={() =>
                    onToggleSelect(selectionKey(pack.id, "jar", fileName))
                  }
                  icon="solar:box-minimalistic-bold"
                  title={fileName}
                  actions={
                    <RowAction
                      label={t("syncPacks.targets.remove")}
                      icon="solar:trash-bin-trash-bold"
                      onClick={() => removeJar(pack.id, fileName)}
                      danger
                    />
                  }
                />
              ))}
            </div>
          )}

          <SyncPackDropZone
            pack={pack}
            isDragOver={isDragOver}
            isBusy={isBusy}
            canBrowse={!!browseProfile}
            onPickPaths={(directory) => pickPaths(pack.id, directory)}
            onPickPreset={(preset) => setPresetPrompt({ packId: pack.id, preset })}
            onBrowseMods={() => setBrowsePack(pack)}
          />
        </div>
      )}
    </div>
  );
}
