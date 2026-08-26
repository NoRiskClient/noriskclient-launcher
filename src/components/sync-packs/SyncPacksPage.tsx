"use client";

import { useEffect, useRef, useState } from "react";
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
import { useSyncPacks } from "./useSyncPacks";

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
    isBusy,
    browsePack,
    setBrowsePack,
    presetPrompt,
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
          disabled={isBusy || isCreating}
          className="px-2 py-1 text-[11px] font-minecraft uppercase tracking-wider text-white/45 transition-colors hover:text-white disabled:opacity-25"
        >
          + {t("syncPacks.create")}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
        <div className="mb-4">
          <span className="font-minecraft text-xs normal-case text-white/40">
            {t("syncPacks.description")}
          </span>
        </div>

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
                disabled={!draftName.trim() || isBusy}
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
          busy={isBusy}
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
          profileName={profile.name}
          packName={detachPrompt.pack.name}
          busy={isBusy}
          onCancel={() => setDetachPrompt(null)}
          onConfirm={(mode) => {
            const pending = detachPrompt;
            setDetachPrompt(null);
            applyToggle(pending.pack, pending.packIds, false, mode);
          }}
        />
      )}

      {presetPrompt && (
        <AddPresetSourceModal
          preset={presetPrompt.preset}
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
    </div>
  );
}

export default SyncPacksPage;
