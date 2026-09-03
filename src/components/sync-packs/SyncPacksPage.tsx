"use client";

import { toast } from "react-hot-toast";
import { parseErrorMessage } from "../../utils/error-utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";

import { preloadIcons } from "../../lib/icon-utils";
import { useThemeStore } from "../../store/useThemeStore";
import { useProjectIcons } from "../../hooks/useProjectIcons";
import type { ProjectIconRef } from "../../hooks/useProjectIcons";
import type { SyncPackModEntry } from "../../types/syncPacks";
import { BrowseContentSideSheetV3 } from "../profiles/v3/BrowseContentSideSheetV3";
import { AddPresetSourceModal } from "./AddPresetSourceModal";
import { AdoptPreviewModal } from "./AdoptPreviewModal";
import { DetachModeModal } from "./DetachModeModal";
import { SyncPackCard } from "./SyncPackCard";
import { parseSelectionKey, selectionKey } from "./SyncPackRow";
import * as SyncPackService from "../../services/sync-pack-service";
import type { SyncPackEntryRef } from "../../services/sync-pack-service";
import { FloatingActionBar, type FABActionConfig } from "../profiles/v3/shared/FloatingActionBar";
import { useSyncPacks } from "./useSyncPacks";
import { BetaNotice } from "../ui/BetaNotice";

const SYNC_PACKS_DISCORD_URL = "https://discord.norisk.gg";

preloadIcons([
  "solar:arrow-left-linear",
  "solar:trash-bin-trash-bold",
  "solar:alt-arrow-down-linear",
  "solar:folder-bold",
  "solar:file-text-bold",
  "solar:box-minimalistic-bold",
]);

export function SyncPacksPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accentColor = useThemeStore((state) => state.accentColor);
  const controller = useSyncPacks();

  const {
    packs,
    conflicts,
    profile,
    browseProfile,
    showBusy,
    browsePack,
    setBrowsePack,
    presetPrompt,
    targetRemovePrompt,
    setTargetRemovePrompt,
    applyTargetRemoval,
    setPresetPrompt,
    adoptPrompt,
    setAdoptPrompt,
    detachPrompt,
    setDetachPrompt,
    confirmDialog,
    refresh,
    addPreset,
    createPack,
    applyToggle,
  } = controller;

  const [isCreating, setIsCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating) inputRef.current?.focus();
  }, [isCreating]);

  const iconRefs: ProjectIconRef[] = packs.flatMap<ProjectIconRef>((pack) =>
    pack.mods.flatMap<ProjectIconRef>((entry) =>
      entry.source.type === "modrinth" || entry.source.type === "curseforge"
        ? [{ platform: entry.source.type, projectId: entry.source.project_id }]
        : [],
    ),
  );
  const getIcon = useProjectIcons(iconRefs);

  const iconFor = (entry: SyncPackModEntry): string | null =>
    entry.source.type === "modrinth" || entry.source.type === "curseforge"
      ? getIcon(entry.source.type, entry.source.project_id)
      : null;

  const closeDraft = () => {
    setIsCreating(false);
    setDraftName("");
  };

  const submitDraft = async () => {
    await createPack(draftName.trim());
    closeDraft();
  };

  const [selection, setSelection] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((key: string) => {
    setSelection((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const selectableKeys = useMemo(() => {
    const keys: string[] = [];
    for (const pack of controller.packs) {
      for (const target of pack.targets)
        keys.push(selectionKey(pack.id, "target", target.path));
      for (const entry of pack.mods)
        keys.push(selectionKey(pack.id, "mod", entry.id));
      for (const jar of controller.localJars[pack.id] ?? [])
        keys.push(selectionKey(pack.id, "jar", jar));
    }
    return keys;
  }, [controller.packs, controller.localJars]);

  useEffect(() => {
    setSelection((current) => {
      if (current.size === 0) return current;
      const valid = new Set(selectableKeys);
      const next = new Set(
        Array.from(current).filter((key) => valid.has(key)),
      );
      return next.size === current.size ? current : next;
    });
  }, [selectableKeys]);

  const selectedRefs = useCallback((): SyncPackEntryRef[] => {
    return Array.from(selection).flatMap((key): SyncPackEntryRef[] => {
      const { packId, kind, id } = parseSelectionKey(key);
      const pack = controller.packs.find((candidate) => candidate.id === packId);
      if (!pack) return [];
      if (kind === "target") {
        const target = pack.targets.find((candidate) => candidate.path === id);
        return target ? [{ packId, kind, id: target.id }] : [];
      }
      return [{ packId, kind, id }];
    });
  }, [selection, controller.packs]);

  const removeSelected = useCallback(async () => {
    const refs = selectedRefs();
    if (refs.length === 0) return;

    const confirmed = await controller.confirmDanger(
      {
        title: "syncPacks.selection.removeTitle",
        message: "syncPacks.selection.removeConfirm",
        confirm: "syncPacks.targets.remove",
      },
      { count: refs.length },
    );
    if (!confirmed) return;

    try {
      await SyncPackService.removeSyncPackEntries(refs);
    } catch (err) {
      toast.error(parseErrorMessage(err));
      await controller.refresh();
      return;
    }
    setSelection(new Set());
    await controller.refresh();
  }, [selectedRefs, controller, t]);

  const setSelectedModsEnabled = useCallback(
    async (enabled: boolean) => {
      const refs = selectedRefs().filter((ref) => ref.kind === "mod");
      if (refs.length === 0) return;
      try {
        await SyncPackService.setSyncPackModsEnabled(refs, enabled);
      } catch (err) {
        toast.error(parseErrorMessage(err));
        await controller.refresh();
        return;
      }
      setSelection(new Set());
      await controller.refresh();
    },
    [selectedRefs, controller],
  );

  const modsSelected = selectedRefs().some((ref) => ref.kind === "mod");

  const fabActions: FABActionConfig[] = [
    {
      icon: "solar:check-circle-bold",
      label: t("syncPacks.selection.enable"),
      onClick: () => void setSelectedModsEnabled(true),
      disabled: !modsSelected,
    },
    {
      icon: "solar:close-circle-bold",
      label: t("syncPacks.selection.disable"),
      onClick: () => void setSelectedModsEnabled(false),
      disabled: !modsSelected,
    },
    {
      icon: "solar:trash-bin-trash-bold",
      label: t("syncPacks.targets.remove"),
      onClick: () => void removeSelected(),
      tone: "danger",
    },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden relative select-none">
      <div className="flex items-center justify-between px-5 h-11 border-b border-white/5 flex-shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
        >
          <Icon icon="solar:arrow-left-linear" className="w-4 h-4" />
          <span className="text-xs font-minecraft uppercase tracking-wider">
            {t("profiles.back")}
          </span>
          <span className="text-white/30">/</span>
          <span className="text-xs font-minecraft uppercase tracking-wider text-white/80">
            {t("syncPacks.title")}
          </span>
        </button>

        <button
          onClick={() => setIsCreating(true)}
          disabled={showBusy || isCreating}
          className="px-2 py-1 text-[11px] font-minecraft uppercase tracking-wider text-white/45 transition-colors hover:text-white disabled:opacity-25"
        >
          + {t("syncPacks.create")}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
        <BetaNotice
          className="mb-4"
          tag={t("syncPacks.betaTag")}
          hint={t("syncPacks.description")}
          feedbackLabel={t("syncPacks.betaFeedbackLink")}
          feedbackUrl={SYNC_PACKS_DISCORD_URL}
        />

        {conflicts.length > 0 && (
          <div className="mb-3 space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3">
            <div className="font-minecraft text-xs uppercase tracking-wider text-amber-300/80">
              {t("syncPacks.conflicts.title")}
            </div>
            {conflicts.map((conflict) => (
              <div
                key={conflict.path + conflict.loser_pack_id}
                className="font-minecraft text-xs text-white/55"
              >
                {t("syncPacks.conflicts.line", {
                  path: conflict.path,
                  winner: conflict.winner_pack_name,
                  loser: conflict.loser_pack_name,
                })}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {packs.map((pack) => (
            <SyncPackCard
              key={pack.id}
              pack={pack}
              selection={selection}
              onToggleSelect={toggleSelect}
              controller={controller}
              iconFor={iconFor}
            />
          ))}

          {isCreating && (
            <div
              className="flex items-center gap-3 rounded-lg border bg-black/20 px-4 py-3"
              style={{ borderColor: `${accentColor.value}55` }}
            >
              <input
                ref={inputRef}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitDraft();
                  if (event.key === "Escape") closeDraft();
                }}
                placeholder={t("syncPacks.namePlaceholder")}
                className="min-w-0 flex-1 bg-transparent font-minecraft text-lg normal-case text-white outline-none placeholder:text-white/25"
              />
              <button
                onClick={submitDraft}
                disabled={!draftName.trim() || showBusy}
                className="px-2 py-1 font-minecraft text-[10px] uppercase tracking-wider transition-opacity disabled:opacity-30"
                style={{ color: accentColor.value }}
              >
                {t("syncPacks.create")}
              </button>
              <button
                onClick={closeDraft}
                className="px-2 py-1 font-minecraft text-[10px] uppercase tracking-wider text-white/35 transition-colors hover:text-white"
              >
                {t("common.cancel")}
              </button>
            </div>
          )}
        </div>
      </div>

      {adoptPrompt && profile && (
        <AdoptPreviewModal
          profileName={profile.name}
          packName={adoptPrompt.pack.name}
          entries={adoptPrompt.entries}
          busy={showBusy}
          onCancel={() => setAdoptPrompt(null)}
          onConfirm={() => {
            const pending = adoptPrompt;
            setAdoptPrompt(null);
            applyToggle(pending.pack, pending.packIds, true, "keep_copy");
          }}
        />
      )}

      {detachPrompt && profile && (
        <DetachModeModal
          title={t("syncPacks.detachDialog.title", {
            pack: detachPrompt.pack.name,
          })}
          subtitle={t("syncPacks.detachDialog.subtitle", {
            profile: profile.name,
          })}
          confirmLabel={t("syncPacks.detachDialog.confirm")}
          confirmLabels={{
            keep_copy: t("syncPacks.detachDialog.keep_copy.action"),
            drop: t("syncPacks.detachDialog.drop.action"),
          }}
          busy={showBusy}
          onCancel={() => setDetachPrompt(null)}
          onConfirm={(mode) => {
            const pending = detachPrompt;
            setDetachPrompt(null);
            applyToggle(pending.pack, pending.packIds, false, mode);
          }}
        />
      )}

      {targetRemovePrompt && (
        <DetachModeModal
          title={t("syncPacks.targetDetachDialog.title", {
            path: targetRemovePrompt.target.path,
          })}
          subtitle={t("syncPacks.targetDetachDialog.subtitle", {
            count: targetRemovePrompt.count,
          })}
          confirmLabel={t("syncPacks.targetDetachDialog.confirm")}
          confirmLabels={{
            keep_copy: t("syncPacks.targetDetachDialog.keep_copy.action"),
            drop: t("syncPacks.targetDetachDialog.drop.action"),
          }}
          choicePrefix="syncPacks.targetDetachDialog"
          busy={showBusy}
          onCancel={() => setTargetRemovePrompt(null)}
          onConfirm={(mode) => {
            const pending = targetRemovePrompt;
            setTargetRemovePrompt(null);
            applyTargetRemoval(pending.packId, pending.target, mode);
          }}
        />
      )}

      {presetPrompt && (
        <AddPresetSourceModal
          preset={presetPrompt.preset}
          currentProfileId={controller.profile?.id ?? null}
          onClose={() => setPresetPrompt(null)}
          onConfirm={(source) =>
            addPreset(presetPrompt.packId, presetPrompt.preset, source)
          }
        />
      )}

      {browseProfile && browsePack && (
        <BrowseContentSideSheetV3
          open
          profile={browseProfile}
          contentType="Mod"
          onClose={() => {
            setBrowsePack(null);
            refresh();
          }}
          onInstallSuccess={refresh}
          installTarget={{
            type: "syncPack",
            packId: browsePack.id,
            packName: browsePack.name,
          }}
          installedOverride={{
            projectIds: (
              packs.find((entry) => entry.id === browsePack.id)?.mods ?? []
            ).flatMap((entry) =>
              entry.source.type === "modrinth" ||
              entry.source.type === "curseforge"
                ? [entry.source.project_id]
                : [],
            ),
            versionIds: [],
          }}
        />
      )}

      {confirmDialog}
      <FloatingActionBar
        visible={selection.size > 0}
        count={selection.size}
        totalCount={selectableKeys.length}
        accent={accentColor.value}
        allSelected={selection.size > 0 && selection.size === selectableKeys.length}
        onSelectAll={() => setSelection(new Set(selectableKeys))}
        onClear={() => setSelection(new Set())}
        actions={fabActions}
      />

    </div>
  );
}

export default SyncPacksPage;
