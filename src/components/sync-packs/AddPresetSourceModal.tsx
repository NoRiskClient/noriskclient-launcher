"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { UnlistenFn, Event as TauriEvent } from "@tauri-apps/api/event";

import { Modal } from "../ui/Modal";
import { ProfileIconV2 } from "../profiles/ProfileIconV2";
import { useProfileStore } from "../../store/profile-store";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { useThemeStore } from "../../store/useThemeStore";
import { parseErrorMessage } from "../../utils/error-utils";
import { formatRelativeTime } from "../../utils/format-relative-time";
import * as SyncPackService from "../../services/sync-pack-service";
import type { SeedCandidate, SyncTargetPreset } from "../../types/syncPacks";
import { Tooltip } from "../ui/Tooltip";

function shortPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 3) return path;
  return ["...", ...parts.slice(-3)].join("\\");
}

interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

export interface AddPresetSourceModalProps {
  preset: SyncTargetPreset;
  currentProfileId?: string | null;
  onClose: () => void;
  onConfirm: (source: {
    seedFrom?: string | null;
    externalPath?: string | null;
  }) => Promise<void>;
}

export function AddPresetSourceModal({
  preset,
  currentProfileId,
  onClose,
  onConfirm,
}: AddPresetSourceModalProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const profiles = useProfileStore((state) => state.profiles);

  const [query, setQuery] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const busyRef = useRef(false);

  busyRef.current = isBusy;

  const { data: candidates, loading: isLoading } = useAsyncResource<SeedCandidate[]>(
    () =>
      SyncPackService.listSyncSeedCandidates(preset.path).then((list) =>
        list.filter((entry) => entry.exists),
      ),
    [preset.path],
    [],
    { cacheKey: `sync-seed:${preset.path}` },
  );

  const run = useCallback(
    async (source: { seedFrom?: string | null; externalPath?: string | null }) => {
      if (busyRef.current) return;
      setIsBusy(true);
      try {
        await onConfirm(source);
        onClose();
      } catch (err) {
        toast.error(
          t("syncPacks.drop.error", {
            name: preset.path,
            error: parseErrorMessage(err),
          }),
        );
      } finally {
        setIsBusy(false);
      }
    },
    [onClose, onConfirm, preset.path, t],
  );

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;

    getCurrentWebviewWindow()
      .onDragDropEvent((event: TauriEvent<unknown>) => {
        const payload = event.payload as DragDropPayload;
        if (payload.type === "enter" || payload.type === "over") {
          setIsDragOver(true);
        } else if (payload.type === "leave") {
          setIsDragOver(false);
        } else if (payload.type === "drop") {
          setIsDragOver(false);
          const first = payload.paths?.[0];
          if (first) run({ externalPath: first });
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [run]);

  const isFolder = preset.kindType === "dir_link";

  const needle = query.trim().toLowerCase();
  const matching = needle
    ? candidates.filter(
        (candidate) =>
          candidate.profile_name.toLowerCase().includes(needle) ||
          candidate.path.toLowerCase().includes(needle),
      )
    : candidates;

  const currentIndex = currentProfileId
    ? matching.findIndex(
        (candidate) => candidate.profile_id === currentProfileId,
      )
    : -1;

  const visible =
    currentIndex > 0
      ? [matching[currentIndex], ...matching.filter((_, i) => i !== currentIndex)]
      : matching;

  const handlePick = useCallback(async () => {
    const selection = await openDialog({ directory: isFolder, multiple: false });
    if (typeof selection === "string") {
      await run({ externalPath: selection });
    }
  }, [isFolder, run]);

  return (
    <Modal
      title={t("syncPacks.seed.title", { path: preset.path })}
      titleSubtitle={t("syncPacks.seed.subtitle")}
      onClose={onClose}
      width="lg"
    >
      <div className="flex h-[560px] flex-col gap-5 px-6 pb-6 pt-2">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-3 flex flex-shrink-0 items-center gap-3">
            <div className="min-w-0">
              <div className="font-minecraft text-[11px] uppercase tracking-wider text-white/40">
                {t("syncPacks.seed.fromProfile")}
              </div>
              {isFolder && (
                <div className="mt-0.5 font-minecraft text-[11px] text-white/25">
                  {t("syncPacks.seed.fromProfileHint")}
                </div>
              )}
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("syncPacks.seed.searchPlaceholder")}
              disabled={isLoading}
              className="ml-auto w-[260px] rounded border border-white/10 bg-black/30 px-3 py-2 font-minecraft text-sm text-white/80 outline-none transition-colors placeholder:text-white/25 focus:border-white/25 disabled:opacity-40"
            />
          </div>

          {isLoading ? (
            <div className="min-h-0 flex-1 space-y-2 overflow-hidden pr-2">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="flex w-full items-center gap-4 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3.5 text-left"
                >
                  <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded border border-white/10 bg-white/[0.06]" />

                  <div className="min-w-0 flex-1">
                    <div className="w-1/3 truncate rounded bg-white/[0.07] font-minecraft text-base text-transparent">
                      &nbsp;
                    </div>
                    <div className="mt-0.5 w-2/3 truncate rounded bg-white/[0.04] font-minecraft text-xs text-transparent">
                      &nbsp;
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 flex-col items-end">
                    <span className="w-16 rounded bg-white/[0.06] font-minecraft text-xs text-transparent">
                      &nbsp;
                    </span>
                    <span className="w-20 rounded bg-white/[0.04] font-minecraft text-[11px] text-transparent">
                      &nbsp;
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-4 font-minecraft text-sm text-white/30">
              {candidates.length === 0
                ? t("syncPacks.seed.noProfiles")
                : t("syncPacks.seed.noMatch")}
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto custom-scrollbar pr-2">
              {visible.map((candidate) => {
                const profile = profiles.find(
                  (entry) => entry.id === candidate.profile_id,
                );
                return (
                  <button
                    key={candidate.profile_id}
                    onClick={() =>
                      run(
                        isFolder
                          ? { externalPath: candidate.path }
                          : { seedFrom: candidate.path },
                      )
                    }
                    disabled={isBusy}
                    className="flex w-full items-center gap-4 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3.5 text-left transition-colors hover:border-white/25 hover:bg-white/[0.06] disabled:opacity-30"
                  >
                    <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded border border-white/10 bg-black/30">
                      {profile ? (
                        <ProfileIconV2
                          profile={profile}
                          size="sm"
                          className="h-full w-full"
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-minecraft text-base text-white/90">
                          {candidate.profile_name}
                        </span>
                        {candidate.profile_id === currentProfileId && (
                          <span
                            style={{
                              color: accentColor.value,
                              borderColor: `${accentColor.value}59`,
                              backgroundColor: `${accentColor.value}1a`,
                            }}
                            className="flex-shrink-0 rounded border px-1.5 py-0.5 font-minecraft text-[10px] uppercase tracking-wider"
                          >
                            {t("syncPacks.seed.currentProfile")}
                          </span>
                        )}
                      </div>
                      <Tooltip
                        content={candidate.path}
                        position="top"
                        wrapperClassName="mt-0.5 min-w-0 max-w-full"
                      >
                        <div className="w-full truncate font-minecraft text-xs text-white/25">
                          {shortPath(candidate.path)}
                        </div>
                      </Tooltip>
                    </div>

                    <div className="flex flex-shrink-0 flex-col items-end">
                      {isFolder && (
                        <span className="font-minecraft text-xs text-white/40">
                          {t("syncPacks.seed.entryCount", {
                            count: candidate.entries,
                          })}
                        </span>
                      )}
                      <span className="font-minecraft text-[11px] text-white/25">
                        {formatRelativeTime(candidate.last_played)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          onClick={handlePick}
          disabled={isBusy}
          className="flex flex-shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors disabled:opacity-30"
          style={{
            borderColor: isDragOver
              ? accentColor.value
              : "rgba(255,255,255,0.12)",
            backgroundColor: isDragOver
              ? `${accentColor.value}12`
              : "transparent",
          }}
        >
          <span className="font-minecraft text-base text-white/75">
            {isFolder ? t("syncPacks.add.folder") : t("syncPacks.add.file")}
          </span>
          <span className="font-minecraft text-xs text-white/30">
            {isDragOver
              ? t("syncPacks.drop.overlay")
              : isFolder
                ? t("syncPacks.seed.dropFolder")
                : t("syncPacks.seed.dropFile")}
          </span>
        </button>

        {!isFolder && (
        <button
          onClick={() => run({})}
          disabled={isBusy}
          className="flex-shrink-0 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-4 text-left transition-colors hover:border-white/25 hover:bg-white/[0.05] disabled:opacity-30"
        >
          <div className="font-minecraft text-base text-white/75">
            {t("syncPacks.seed.empty")}
          </div>
          <div className="mt-0.5 font-minecraft text-xs text-white/30">
            {t("syncPacks.seed.emptyHint")}
          </div>
        </button>
        )}
      </div>
    </Modal>
  );
}

export default AddPresetSourceModal;
