"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import type { Profile } from "../../../../../types/profile";
import {
  isSyncModLockedByPack,
  isSyncModOnHere,
  overridesProfileMod,
  syncModKey,
  type ProfileSyncPackMod,
} from "../../../../../types/syncPacks";
import * as SyncPackService from "../../../../../services/sync-pack-service";
import { useProjectIcons, type ProjectIconRef } from "../../../../../hooks/useProjectIcons";
import { useConfirmDialog } from "../../../../../hooks/useConfirmDialog";

export type ProfileSyncMods = ReturnType<typeof useProfileSyncMods>;

export function useProfileSyncMods(profile: Profile, enabled: boolean) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { confirm, confirmDialog } = useConfirmDialog();

  const [mods, setMods] = useState<ProfileSyncPackMod[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const profileId = profile.id;
  const packKey = (profile.sync_pack_ids ?? []).join("|");
  const loadKey = `${profileId}|${packKey}`;
  const ready = !enabled || !packKey || loadedKey === loadKey;

  const reload = useCallback(async () => {
    if (!enabled || !packKey) {
      setMods([]);
      return;
    }
    try {
      setMods(await SyncPackService.getProfileSyncPackMods(profileId));
    } catch (err) {
      console.warn("[useProfileSyncMods] Failed to load sync pack mods:", err);
      setMods([]);
    } finally {
      setLoadedKey(loadKey);
    }
  }, [enabled, loadKey, packKey, profileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const iconRefs: ProjectIconRef[] = mods.flatMap<ProjectIconRef>((entry) =>
    entry.platform && entry.project_id
      ? [{ platform: entry.platform, projectId: entry.project_id }]
      : [],
  );
  const getIcon = useProjectIcons(iconRefs);
  const iconFor = useCallback(
    (entry: ProfileSyncPackMod) =>
      entry.platform && entry.project_id ? getIcon(entry.platform, entry.project_id) : null,
    [getIcon],
  );

  const overriddenPackByProject = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of mods) {
      if (overridesProfileMod(entry) && entry.project_id) map.set(entry.project_id, entry.pack_name);
    }
    return map;
  }, [mods]);

  const run = useCallback(
    async (key: string | null, action: () => Promise<unknown>): Promise<boolean> => {
      setBusyKey(key);
      try {
        await action();
        await reload();
        return true;
      } catch (err) {
        console.error("[useProfileSyncMods] Sync pack mod action failed:", err);
        toast.error(t("profiles.v3.syncMods.toggle.failed"));
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [reload, t],
  );

  const setHere = useCallback(
    async (entries: ProfileSyncPackMod[], on: boolean): Promise<number> => {
      const targets = entries.filter(
        (entry) => !isSyncModLockedByPack(entry) && isSyncModOnHere(entry) !== on,
      );
      if (targets.length === 0) return 0;
      const ok = await run(targets.length === 1 ? syncModKey(targets[0]) : null, () =>
        SyncPackService.setProfileSyncModsExcluded(
          profileId,
          targets.map((entry) => ({ pack_id: entry.pack_id, mod_key: entry.mod_key })),
          !on,
        ),
      );
      return ok ? targets.length : 0;
    },
    [profileId, run],
  );

  const pinVersion = useCallback(
    (entry: ProfileSyncPackMod, versionId: string | null) => {
      const modId = entry.mod_id;
      if (!modId) return;
      void run(syncModKey(entry), async () => {
        await SyncPackService.setSyncPackModVersionOverride(
          entry.pack_id,
          modId,
          profile.game_version,
          versionId ? { type: "pin", version_id: versionId } : null,
        );
        await SyncPackService.resolveSyncPackMod(entry.pack_id, modId, profile.game_version, profile.loader);
      });
    },
    [profile.game_version, profile.loader, run],
  );

  const setEverywhere = useCallback(
    (entry: ProfileSyncPackMod, on: boolean) => {
      const modId = entry.mod_id;
      if (!modId) return;
      void run(syncModKey(entry), () => SyncPackService.setSyncPackModEnabled(entry.pack_id, modId, on));
    },
    [run],
  );

  const remove = useCallback(
    async (entry: ProfileSyncPackMod) => {
      const confirmed = await confirm({
        title: t("profiles.v3.syncMods.remove.title", { name: entry.display_name }),
        message: t("profiles.v3.syncMods.remove.message", { pack: entry.pack_name }),
        confirmText: t("profiles.v3.syncMods.remove.confirm"),
        cancelText: t("common.cancel"),
        type: "danger",
      });
      if (!confirmed) return;
      void run(syncModKey(entry), () =>
        entry.mod_id
          ? SyncPackService.removeModFromSyncPack(entry.pack_id, entry.mod_id)
          : SyncPackService.removeSyncPackLocalJar(entry.pack_id, entry.filename ?? entry.display_name),
      );
    },
    [confirm, run, t],
  );

  const openPack = useCallback(
    (packId: string) => navigate("/sync-packs", { state: { fromProfileId: profileId, expandPackId: packId } }),
    [navigate, profileId],
  );

  const toggleSelected = useCallback((entry: ProfileSyncPackMod) => {
    const key = syncModKey(entry);
    setSelection((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback((entries: ProfileSyncPackMod[]) => {
    setSelection(new Set(entries.map(syncModKey)));
  }, []);

  const clearSelection = useCallback(() => setSelection(new Set()), []);

  const selectedMods = useMemo(
    () => mods.filter((entry) => selection.has(syncModKey(entry))),
    [mods, selection],
  );

  return {
    mods,
    ready,
    reload,
    iconFor,
    overriddenPackByProject,
    busyKey,
    setHere,
    pinVersion,
    setEverywhere,
    remove,
    openPack,
    selection,
    selectedMods,
    toggleSelected,
    selectAll,
    clearSelection,
    confirmDialog,
  };
}
