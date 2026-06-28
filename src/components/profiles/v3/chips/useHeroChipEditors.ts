"use client";

/**
 * useHeroChipEditors — orchestrates fetch + save for the Hero inline-edit
 * chips (Group, Game Version, Loader, Loader Version). Picker components stay
 * presentational; this hook is the only place that touches Tauri + the
 * profile store.
 *
 * Fetches are lazy and session-cached via refs, keyed on the relevant deps
 * (loader+mc for the loader-version list). Mutations follow the same pattern
 * as `ProfileSettings.handleSave` at `ProfileSettings.tsx:114-151`: one-shot
 * updateProfile + store refresh + toast. No optimistic update — on error the
 * UI just stays on the old value, no rollback dance needed.
 *
 * Loader-version write strategy: flips the per-loader override map in
 * `settings.overwrite_loader_versions` (new backend field) rather than
 * writing the low-priority `profile.loader_version` directly. The map
 * outranks pack policies + profile defaults, so picks actually stick. The
 * legacy single-slot `settings.overwrite_loader_version` is nulled on every
 * write so it can't leak stale values across loader switches via the
 * backend's handler-sync. See `profile_state.rs` and `profile_command.rs`
 * for the backward-compat details.
 *
 * Loader-type switch additionally wipes `loader_version` to empty string as
 * a best-effort clear (the Rust handler has no dedicated clear flag; resolve
 * treats `""` as None in the ProfileDefault branch).
 */

import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";

import type { Profile, UpdateProfileParams } from "../../../../types/profile";
import type { MinecraftVersion } from "../../../../types/minecraft";
import * as ProfileService from "../../../../services/profile-service";
import { useProfileStore } from "../../../../store/profile-store";
import { parseErrorMessage } from "../../../../utils/error-utils";

export type LoaderKey = "vanilla" | "fabric" | "forge" | "quilt" | "neoforge";

// Fabric + Quilt backend commands return `{ loader: { version, stable } }[]`.
// We encode `stable` into the displayed/stored string — " (stable)" suffix —
// because the Wizard (ModLoaderStep.tsx:194, ProfileWizardV2Step2.tsx:92)
// already stores loader_version that way. Keeping the same convention lets
// us (a) match existing stored values for the current-highlight and (b) keep
// round-tripping consistent when the user picks a new one.
type FabricLikeVersionResponse = { loader: { version: string; stable?: boolean } }[];

const formatFabricLike = (r: FabricLikeVersionResponse): string[] =>
  r.map((v) => `${v.loader.version}${v.loader.stable ? " (stable)" : ""}`);

interface UseHeroChipEditorsResult {
  isLocked: boolean;
  lockReason: string | undefined;

  mcVersions: MinecraftVersion[] | null;
  mcLoading: boolean;
  loadMinecraftVersions: () => Promise<void>;

  loaderVersions: string[] | null;
  loaderLoading: boolean;
  loadLoaderVersions: (loader: string, mcVersion: string) => Promise<void>;

  saveGroup: (group: string | null) => Promise<void>;
  saveGameVersion: (version: string) => Promise<void>;
  saveLoader: (loader: LoaderKey) => Promise<void>;
  saveLoaderVersion: (version: string) => Promise<void>;
}

export function useHeroChipEditors(
  profile: Profile,
  onProfileUpdated: (profile: Profile) => void,
): UseHeroChipEditorsResult {
  const { t } = useTranslation();
  const fetchProfiles = useProfileStore((s) => s.fetchProfiles);

  const isLocked = !!profile.is_standard_version;
  const lockReason = isLocked ? t("profiles.cannotEditStandard") : undefined;

  // ── MC versions cache ────────────────────────────────────────────────────
  const [mcVersions, setMcVersions] = useState<MinecraftVersion[] | null>(null);
  const [mcLoading, setMcLoading] = useState(false);
  const mcLoadedRef = useRef(false);

  const loadMinecraftVersions = useCallback(async () => {
    if (mcLoadedRef.current || mcLoading) return;
    mcLoadedRef.current = true;
    setMcLoading(true);
    try {
      const result = await invoke<{ versions: MinecraftVersion[] }>(
        "get_minecraft_versions",
      );
      setMcVersions(result.versions);
    } catch (err) {
      console.error("[HeroChips] Failed to fetch Minecraft versions:", err);
      // Allow retry on next open
      mcLoadedRef.current = false;
    } finally {
      setMcLoading(false);
    }
  }, [mcLoading]);

  // ── Loader versions cache (keyed on `${loader}|${mcVersion}`) ────────────
  const [loaderVersions, setLoaderVersions] = useState<string[] | null>(null);
  const [loaderLoading, setLoaderLoading] = useState(false);
  const loaderKeyRef = useRef<string | null>(null);

  const loadLoaderVersions = useCallback(
    async (loader: string, mcVersion: string) => {
      if (!loader || loader === "vanilla" || !mcVersion) {
        setLoaderVersions([]);
        loaderKeyRef.current = null;
        return;
      }
      const key = `${loader}|${mcVersion}`;
      if (loaderKeyRef.current === key && loaderVersions !== null) return;
      loaderKeyRef.current = key;
      setLoaderLoading(true);
      try {
        let versions: string[] = [];
        switch (loader) {
          case "fabric": {
            const r = await invoke<FabricLikeVersionResponse>(
              "get_fabric_loader_versions",
              { minecraftVersion: mcVersion },
            );
            versions = formatFabricLike(r);
            break;
          }
          case "forge":
            versions = await invoke<string[]>("get_forge_versions", {
              minecraftVersion: mcVersion,
            });
            break;
          case "quilt": {
            const r = await invoke<FabricLikeVersionResponse>(
              "get_quilt_loader_versions",
              { minecraftVersion: mcVersion },
            );
            versions = formatFabricLike(r);
            break;
          }
          case "neoforge":
            versions = await invoke<string[]>("get_neoforge_versions", {
              minecraftVersion: mcVersion,
            });
            break;
        }
        setLoaderVersions(versions);
      } catch (err) {
        console.error(`[HeroChips] Failed to fetch ${loader} versions:`, err);
        setLoaderVersions([]);
        // Allow retry on next open by clearing the key
        loaderKeyRef.current = null;
      } finally {
        setLoaderLoading(false);
      }
    },
    [loaderVersions],
  );

  // ── Shared save helper ───────────────────────────────────────────────────
  const save = useCallback(
    async (params: UpdateProfileParams): Promise<void> => {
      try {
        await ProfileService.updateProfile(profile.id, params);
        await fetchProfiles();
        const fresh = useProfileStore
          .getState()
          .profiles.find((p) => p.id === profile.id);
        if (fresh) onProfileUpdated(fresh);
        toast.success(t("profiles.settings.saveSuccess"));
      } catch (err) {
        const msg = parseErrorMessage(err);
        toast.error(t("profiles.settings.saveError", { error: msg }));
        throw err;
      }
    },
    [profile.id, fetchProfiles, onProfileUpdated, t],
  );

  // ── Mutations ────────────────────────────────────────────────────────────
  const saveGroup = useCallback(
    async (group: string | null) => {
      const trimmed = group?.trim() ?? "";
      const current = profile.group ?? "";
      if (trimmed === current) return;
      if (trimmed) {
        await save({ group: trimmed });
      } else {
        await save({ clear_group: true });
      }
    },
    [profile.group, save],
  );

  const saveGameVersion = useCallback(
    async (version: string) => {
      if (version === profile.game_version) return;
      await save({ game_version: version });
    },
    [profile.game_version, save],
  );

  const saveLoader = useCallback(
    async (loader: LoaderKey) => {
      const current = profile.loader ?? "vanilla";
      if (loader === current) return;
      // Invalidate our loader-versions cache — next picker-open refetches
      // against the new loader type.
      loaderKeyRef.current = null;
      setLoaderVersions(null);

      const settings = profile.settings;
      const existingMap = settings.overwrite_loader_versions ?? {};

      // Preserve the current loader's active override in the per-loader map
      // under the OLD loader key, so switching back restores the pick. The
      // active override lives in the legacy field (written by settings modal
      // or older profiles) OR may already be mirrored in the map.
      const preservedMap: Record<string, string> = { ...existingMap };
      if (
        current !== "vanilla" &&
        settings.use_overwrite_loader_version &&
        settings.overwrite_loader_version
      ) {
        if (!preservedMap[current]) {
          preservedMap[current] = settings.overwrite_loader_version;
        }
      }

      // Check if the new loader has a preserved override — if so, re-activate
      // it. Otherwise turn overwrite off (no pinned choice for this loader
      // yet). Legacy field is cleared so it can't leak across loader types.
      const hasOverrideForNew = !!preservedMap[loader] && preservedMap[loader] !== "";

      // Also wipe the wizard-stored `loader_version` (e.g. "0.16.0 (stable)"
      // for fabric) — that string belongs to the OLD loader and would leak
      // into the ProfileDefault fallback for the new loader (mod.rs:138-146).
      // Backend has no `clear_loader_version` API, so we send the empty
      // string: the resolve at mod.rs:140 explicitly treats "" as "no value"
      // and falls through to NotResolved → chip renders "latest".
      await save({
        loader,
        loader_version: "",
        settings: {
          ...settings,
          use_overwrite_loader_version: hasOverrideForNew,
          overwrite_loader_version: null,
          overwrite_loader_versions: preservedMap,
        },
      });
    },
    [profile.loader, profile.settings, save],
  );

  const saveLoaderVersion = useCallback(
    async (version: string) => {
      // Writing to `loader_version` alone is a lie when a pack policy or an
      // existing overwrite outranks it (see mod.rs:37-60). The correct write
      // is the per-loader override map keyed by the profile's current loader,
      // with the master toggle flipped on. Legacy field is also nulled so it
      // can't leak across loader switches via the backend's handler-sync.
      const loaderKey = profile.loader;
      if (!loaderKey || loaderKey === "vanilla") return;

      const settings = profile.settings;
      const existingMap = settings.overwrite_loader_versions ?? {};
      const alreadyActive =
        !!settings.use_overwrite_loader_version &&
        existingMap[loaderKey] === version;
      if (alreadyActive) return;

      await save({
        settings: {
          ...settings,
          use_overwrite_loader_version: true,
          overwrite_loader_version: null,
          overwrite_loader_versions: { ...existingMap, [loaderKey]: version },
        },
      });
    },
    [profile.loader, profile.settings, save],
  );

  return {
    isLocked,
    lockReason,
    mcVersions,
    mcLoading,
    loadMinecraftVersions,
    loaderVersions,
    loaderLoading,
    loadLoaderVersions,
    saveGroup,
    saveGameVersion,
    saveLoader,
    saveLoaderVersion,
  };
}
