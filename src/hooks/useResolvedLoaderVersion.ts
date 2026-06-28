import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Profile, ResolvedLoaderVersion } from "../types/profile";

export function useResolvedLoaderVersion(
  profile: Pick<
    Profile,
    | "id"
    | "game_version"
    | "loader"
    | "loader_version"
    | "settings"
    | "selected_norisk_pack_id"
  > | null | undefined,
  refreshKey?: unknown,
): ResolvedLoaderVersion | null {
  const [resolved, setResolved] = useState<ResolvedLoaderVersion | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!profile || !profile.game_version || profile.loader === "vanilla") {
      setResolved(null);
      return;
    }
    invoke<ResolvedLoaderVersion>("resolve_loader_version", {
      profileId: profile.id,
      minecraftVersion: profile.game_version,
    })
      .then((r) => { if (!cancelled) setResolved(r); })
      .catch((err) => {
        console.error("Failed to resolve loader version:", err);
        if (!cancelled) setResolved(null);
      });
    return () => { cancelled = true; };
  }, [
    profile?.id,
    profile?.game_version,
    profile?.loader,
    profile?.loader_version,
    profile?.settings?.use_overwrite_loader_version,
    profile?.settings?.overwrite_loader_version,
    // Per-loader override map — serialise so primitive-equality catches
    // nested changes (entry added/removed/updated for current loader).
    profile?.settings?.overwrite_loader_versions
      ? JSON.stringify(profile.settings.overwrite_loader_versions)
      : "",
    profile?.selected_norisk_pack_id,
    refreshKey,
  ]);

  return resolved;
}
