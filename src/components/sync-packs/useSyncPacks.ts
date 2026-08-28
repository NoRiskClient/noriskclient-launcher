"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { UnlistenFn, Event as TauriEvent } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "react-hot-toast";

import { useAppDragDropStore } from "../../store/appStore";
import { useProfileStore } from "../../store/profile-store";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { parseErrorMessage } from "../../utils/error-utils";
import * as SyncPackService from "../../services/sync-pack-service";
import type {
  DetachMode,
  SyncConflict,
  SyncPack,
  SyncPackModEntry,
  SyncPackModMatrix,
  SyncPreviewEntry,
  SyncTarget,
  SyncTargetPreset,
  VersionOverride,
} from "../../types/syncPacks";
import {
  defaultKindFor,
  needsAdoptConfirm,
  needsDetachConfirm,
} from "../../types/syncPacks";

interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

interface AdoptPrompt {
  pack: SyncPack;
  packIds: string[];
  entries: SyncPreviewEntry[];
}

interface DetachPrompt {
  pack: SyncPack;
  packIds: string[];
}

interface PresetPrompt {
  packId: string;
  preset: SyncTargetPreset;
}

export function useSyncPacks() {
  const { t } = useTranslation();
  const location = useLocation();
  const { confirm, confirmDialog } = useConfirmDialog();
  const setSyncPacksDropActive = useAppDragDropStore(
    (state) => state.setSyncPacksDropActive,
  );

  const fromProfileId = (location.state as { fromProfileId?: string } | null)
    ?.fromProfileId;
  const profiles = useProfileStore((state) => state.profiles);
  const fetchProfiles = useProfileStore((state) => state.fetchProfiles);
  const selectedProfile = useProfileStore((state) => state.selectedProfile);
  const profile = profiles.find((entry) => entry.id === fromProfileId) ?? null;
  const browseProfile = profile ?? selectedProfile ?? profiles[0] ?? null;

  const [packs, setPacks] = useState<SyncPack[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [localJars, setLocalJars] = useState<Record<string, string[]>>({});
  const [matrix, setMatrix] = useState<Record<string, SyncPackModMatrix[]>>({});
  const [expandedPack, setExpandedPack] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [resolvingMod, setResolvingMod] = useState<string | null>(null);
  const [browsePack, setBrowsePack] = useState<SyncPack | null>(null);
  const [presetPrompt, setPresetPrompt] = useState<PresetPrompt | null>(null);
  const [adoptPrompt, setAdoptPrompt] = useState<AdoptPrompt | null>(null);
  const [detachPrompt, setDetachPrompt] = useState<DetachPrompt | null>(null);
  const [pendingToggle, setPendingToggle] = useState<Record<string, boolean>>(
    {},
  );

  const expandedRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  expandedRef.current = expandedPack;
  busyRef.current = isBusy;

  const load = useCallback(async () => {
    const [loaded, detected] = await Promise.all([
      SyncPackService.getSyncPacks().catch((err) => {
        toast.error(t("syncPacks.loadError", { error: parseErrorMessage(err) }));
        return null;
      }),
      profile
        ? SyncPackService.getProfileSyncConflicts(profile.id).catch(() => [])
        : Promise.resolve([]),
    ]);
    if (loaded) setPacks(loaded);
    setConflicts(detected);
  }, [profile, t]);

  const loadPackDetails = useCallback(async (packId: string) => {
    const [jars, modMatrix] = await Promise.all([
      SyncPackService.getSyncPackLocalJars(packId).catch(() => [] as string[]),
      SyncPackService.getSyncPackModMatrix(packId).catch(
        () => [] as SyncPackModMatrix[],
      ),
    ]);
    setLocalJars((prev) => ({ ...prev, [packId]: jars }));
    setMatrix((prev) => ({ ...prev, [packId]: modMatrix }));
  }, []);

  const refresh = useCallback(async () => {
    await load();
    const current = expandedRef.current;
    if (current) await loadPackDetails(current);
  }, [load, loadPackDetails]);

  const busy = useCallback(async (action: () => Promise<void>) => {
    setIsBusy(true);
    try {
      await action();
    } finally {
      setIsBusy(false);
    }
  }, []);

  const run = useCallback(
    async (action: () => Promise<unknown>, errorKey: string) => {
      try {
        await action();
        await refresh();
      } catch (err) {
        toast.error(t(errorKey, { error: parseErrorMessage(err) }));
      }
    },
    [refresh, t],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (expandedPack) loadPackDetails(expandedPack);
  }, [expandedPack, loadPackDetails]);

  useEffect(() => {
    setSyncPacksDropActive(true);
    return () => setSyncPacksDropActive(false);
  }, [setSyncPacksDropActive]);

  const subscribedIds = useMemo(() => {
    const ids = new Set(profile?.sync_pack_ids ?? []);
    for (const [packId, active] of Object.entries(pendingToggle)) {
      if (active) ids.add(packId);
      else ids.delete(packId);
    }
    return ids;
  }, [pendingToggle, profile]);

  const addPaths = useCallback(
    async (packId: string, paths: string[]) => {
      if (paths.length === 0) return;
      await busy(async () => {
        for (const path of paths) {
          const name = path.split(/[/\\]/).pop() ?? path;
          try {
            const outcome = await SyncPackService.addDroppedSyncTarget(
              packId,
              path,
            );
            if (outcome.target) {
              toast.success(
                t("syncPacks.targets.addSuccess", { path: outcome.target.path }),
              );
            } else if (outcome.identified_mods.length > 0) {
              toast.success(
                t("syncPacks.drop.modsIdentified", {
                  count: outcome.identified_mods.length,
                  names: outcome.identified_mods.join(", "),
                }),
              );
            } else if (outcome.local_jars.length > 0) {
              toast.success(
                t("syncPacks.drop.localJars", {
                  count: outcome.local_jars.length,
                }),
              );
            }
          } catch (err) {
            toast.error(
              t("syncPacks.drop.error", { name, error: parseErrorMessage(err) }),
            );
          }
        }
        await refresh();
      });
    },
    [busy, refresh, t],
  );

  const pickPaths = useCallback(
    async (packId: string, directory: boolean) => {
      const selection = await openDialog({ directory, multiple: true });
      if (!selection) return;
      await addPaths(packId, Array.isArray(selection) ? selection : [selection]);
    },
    [addPaths],
  );

  const handleDrop = useCallback(
    async (paths: string[]) => {
      const packId = expandedRef.current;
      if (!packId) {
        toast(t("syncPacks.drop.needsPack"));
        return;
      }
      if (busyRef.current) return;
      await addPaths(packId, paths);
    },
    [addPaths, t],
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
          handleDrop(payload.paths ?? []);
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
  }, [handleDrop]);

  const addPreset = useCallback(
    async (
      packId: string,
      preset: SyncTargetPreset,
      source: { seedFrom?: string | null; externalPath?: string | null },
    ) => {
      await busy(async () => {
        try {
          await SyncPackService.addSyncPackTarget(
            packId,
            preset.path,
            defaultKindFor(preset.kindType),
            source,
          );
          toast.success(
            t("syncPacks.targets.addSuccess", { path: preset.path }),
          );
          await refresh();
        } catch (err) {
          toast.error(
            t("syncPacks.drop.error", {
              name: preset.path,
              error: parseErrorMessage(err),
            }),
          );
        }
      });
    },
    [busy, refresh, t],
  );

  const createPack = useCallback(
    async (name: string) => {
      if (!name || isBusy) return;
      await busy(async () => {
        try {
          const created = await SyncPackService.createSyncPack({ name });
          await load();
          setExpandedPack(created.id);
        } catch (err) {
          toast.error(
            t("syncPacks.createError", { error: parseErrorMessage(err) }),
          );
        }
      });
    },
    [busy, isBusy, load, t],
  );

  const applyToggle = useCallback(
    async (
      pack: SyncPack,
      packIds: string[],
      next: boolean,
      detach: DetachMode,
    ) => {
      if (!profile) return;
      setPendingToggle((prev) => ({ ...prev, [pack.id]: next }));

      await busy(async () => {
        try {
          await SyncPackService.setProfileSyncPacks(profile.id, packIds, detach);

          if (next && pack.targets.length > 0) {
            await SyncPackService.syncProfileNow(profile.id);
          }
          if (next) toast.success(t("syncPacks.applySuccess"));

          await Promise.all([fetchProfiles(), refresh()]);

          if (next && pack.targets.length === 0 && pack.mods.length > 0) {
            SyncPackService.syncProfileNow(profile.id)
              .then(refresh)
              .catch(() => undefined);
          }
        } catch (err) {
          toast.error(
            t("syncPacks.subscribeError", { error: parseErrorMessage(err) }),
          );
        } finally {
          setPendingToggle((prev) => {
            const { [pack.id]: _dropped, ...rest } = prev;
            return rest;
          });
        }
      });
    },
    [busy, fetchProfiles, profile, refresh, t],
  );

  const togglePack = useCallback(
    async (pack: SyncPack, next: boolean) => {
      if (!profile || isBusy) return;

      const existing = profile.sync_pack_ids ?? [];
      const packIds = next
        ? Array.from(new Set([...existing, pack.id]))
        : existing.filter((id) => id !== pack.id);

      if (pack.targets.length === 0) {
        await applyToggle(pack, packIds, next, "keep_copy");
        return;
      }

      let preview: SyncPreviewEntry[];
      try {
        preview = await SyncPackService.previewProfileSync(profile.id, [
          pack.id,
        ]);
      } catch (err) {
        toast.error(
          t("syncPacks.adoptDialog.previewFailed", {
            error: parseErrorMessage(err),
          }),
        );
        return;
      }

      if (next) {
        const adopting = preview.filter(needsAdoptConfirm);
        if (adopting.length > 0) {
          setAdoptPrompt({ pack, packIds, entries: adopting });
          return;
        }
        await applyToggle(pack, packIds, true, "keep_copy");
        return;
      }

      if (preview.some(needsDetachConfirm)) {
        setDetachPrompt({ pack, packIds });
        return;
      }
      await applyToggle(pack, packIds, false, "keep_copy");
    },
    [applyToggle, isBusy, profile, t],
  );

  const deletePack = useCallback(
    async (pack: SyncPack) => {
      const confirmed = await confirm({
        title: t("syncPacks.deleteTitle"),
        message: t("syncPacks.deleteConfirm", { name: pack.name }),
        confirmText: t("syncPacks.delete"),
        cancelText: t("common.cancel"),
        type: "danger",
      });
      if (!confirmed) return;

      try {
        await SyncPackService.deleteSyncPack(pack.id, "keep_copy");
        toast.success(t("syncPacks.deleteSuccess", { name: pack.name }));
        if (expandedRef.current === pack.id) setExpandedPack(null);
        await load();
      } catch (err) {
        toast.error(
          t("syncPacks.deleteError", { error: parseErrorMessage(err) }),
        );
      }
    },
    [confirm, load, t],
  );

  const openFolder = useCallback(
    async (packId: string, targetPath?: string) => {
      try {
        await SyncPackService.openSyncPackFolder(packId, targetPath);
      } catch (err) {
        toast.error(
          t("syncPacks.openFolderError", { error: parseErrorMessage(err) }),
        );
      }
    },
    [t],
  );

  const removeTarget = useCallback(
    async (packId: string, target: SyncTarget) => {
      const confirmed = await confirm({
        title: t("syncPacks.targets.removeTitle"),
        message: t("syncPacks.targets.removeConfirm", { path: target.path }),
        confirmText: t("syncPacks.targets.remove"),
        cancelText: t("common.cancel"),
        type: "danger",
      });
      if (!confirmed) return;

      await run(async () => {
        await SyncPackService.removeSyncPackTarget(packId, target.id);
        toast.success(
          t("syncPacks.targets.removeSuccess", { path: target.path }),
        );
      }, "syncPacks.targets.removeError");
    },
    [confirm, run, t],
  );

  const removeMod = useCallback(
    async (packId: string, entry: SyncPackModEntry) => {
      const name = entry.display_name;
      const confirmed = await confirm({
        title: t("syncPacks.mods.removeTitle"),
        message: t("syncPacks.mods.removeConfirm", { name }),
        confirmText: t("syncPacks.mods.remove"),
        cancelText: t("common.cancel"),
        type: "danger",
      });
      if (!confirmed) return;

      await run(async () => {
        await SyncPackService.removeModFromSyncPack(packId, entry.id);
        toast.success(t("syncPacks.mods.removeSuccess", { name }));
      }, "syncPacks.mods.removeError");
    },
    [confirm, run, t],
  );

  const removeJar = useCallback(
    async (packId: string, fileName: string) => {
      const confirmed = await confirm({
        title: t("syncPacks.mods.removeJarTitle"),
        message: t("syncPacks.mods.removeJarConfirm", { name: fileName }),
        confirmText: t("syncPacks.mods.removeJar"),
        cancelText: t("common.cancel"),
        type: "danger",
      });
      if (!confirmed) return;

      await run(async () => {
        await SyncPackService.removeSyncPackLocalJar(packId, fileName);
        toast.success(t("syncPacks.mods.removeJarSuccess", { name: fileName }));
      }, "syncPacks.mods.removeJarError");
    },
    [confirm, run, t],
  );

  const setModEnabled = useCallback(
    (packId: string, entry: SyncPackModEntry, enabled: boolean) =>
      run(
        () => SyncPackService.setSyncPackModEnabled(packId, entry.id, enabled),
        "syncPacks.targets.updateError",
      ),
    [run],
  );

  const setOverride = useCallback(
    (
      packId: string,
      entry: SyncPackModEntry,
      mcVersion: string,
      value: VersionOverride | null,
      resolveAfter?: { mcVersion: string; loader: string },
    ) =>
      run(async () => {
        await SyncPackService.setSyncPackModVersionOverride(
          packId,
          entry.id,
          mcVersion,
          value,
        );
        if (resolveAfter) {
          setResolvingMod(entry.id);
          try {
            await SyncPackService.resolveSyncPackMod(
              packId,
              entry.id,
              resolveAfter.mcVersion,
              resolveAfter.loader,
            );
          } finally {
            setResolvingMod(null);
          }
        }
      }, "syncPacks.targets.updateError"),
    [run],
  );

  const resolveMod = useCallback(
    async (
      packId: string,
      entry: SyncPackModEntry,
      mcVersion?: string,
      loader?: string,
    ) => {
      setResolvingMod(entry.id);
      try {
        await run(
          () =>
            SyncPackService.resolveSyncPackMod(
              packId,
              entry.id,
              mcVersion,
              loader,
            ),
          "syncPacks.entries.resolveFailed",
        );
      } finally {
        setResolvingMod(null);
      }
    },
    [run],
  );

  return {
    packs,
    conflicts,
    localJars,
    matrix,
    profile,
    browseProfile,
    subscribedIds,
    expandedPack,
    setExpandedPack,
    isBusy,
    isDragOver,
    resolvingMod,
    browsePack,
    setBrowsePack,
    presetPrompt,
    setPresetPrompt,
    adoptPrompt,
    setAdoptPrompt,
    detachPrompt,
    setDetachPrompt,
    confirm,
    confirmDialog,
    refresh,
    pickPaths,
    addPreset,
    createPack,
    applyToggle,
    togglePack,
    deletePack,
    openFolder,
    removeTarget,
    removeMod,
    removeJar,
    setModEnabled,
    setOverride,
    resolveMod,
  };
}

export type SyncPacksController = ReturnType<typeof useSyncPacks>;
