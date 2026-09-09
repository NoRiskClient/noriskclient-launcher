import { useEffect } from "react";
import { useIconCacheStore } from "../store/icon-cache-store";
import { ModrinthService } from "../services/modrinth-service";
import { CurseForgeService } from "../services/curseforge-service";

export type IconPlatform = "modrinth" | "curseforge";

export interface ProjectIconRef {
  platform: IconPlatform;
  projectId: string;
}

export function useProjectIcons(refs: ProjectIconRef[]) {
  const modrinthIcons = useIconCacheStore((state) => state.modrinthIcons);
  const curseforgeIcons = useIconCacheStore((state) => state.curseforgeIcons);

  const key = refs
    .map((ref) => `${ref.platform}:${ref.projectId}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (!key) return;

    const entries = key.split("|").map((entry) => {
      const separator = entry.indexOf(":");
      return {
        platform: entry.slice(0, separator) as IconPlatform,
        projectId: entry.slice(separator + 1),
      };
    });

    const loadModrinth = async () => {
      const cached = useIconCacheStore.getState().modrinthIcons;
      const ids = [
        ...new Set(
          entries
            .filter(
              (entry) =>
                entry.platform === "modrinth" &&
                cached[entry.projectId] === undefined,
            )
            .map((entry) => entry.projectId),
        ),
      ];
      if (ids.length === 0) return;

      try {
        const details = await ModrinthService.getProjectDetails(ids);
        const patch: Record<string, string | null> = {};
        if (Array.isArray(details)) {
          details.forEach((detail) => {
            if (detail?.id) patch[detail.id] = detail.icon_url || null;
          });
        }
        useIconCacheStore.getState().mergeModrinthIcons(patch);
      } catch {
      }
    };

    const loadCurseForge = async () => {
      const cached = useIconCacheStore.getState().curseforgeIcons;
      const ids = [
        ...new Set(
          entries
            .filter(
              (entry) =>
                entry.platform === "curseforge" &&
                cached[entry.projectId] === undefined,
            )
            .map((entry) => entry.projectId),
        ),
      ];
      const numericIds = ids
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => !Number.isNaN(id));
      if (numericIds.length === 0) return;

      try {
        const response = await CurseForgeService.getModsByIds(numericIds);
        const patch: Record<string, string | null> = {};
        response?.data?.forEach((entry: { id: number; logo?: { url?: string } }) => {
          patch[String(entry.id)] = entry.logo?.url ?? null;
        });
        useIconCacheStore.getState().mergeCurseforgeIcons(patch);
      } catch {
      }
    };

    loadModrinth();
    loadCurseForge();
  }, [key]);

  return (platform: IconPlatform, projectId: string): string | null => {
    const source = platform === "modrinth" ? modrinthIcons : curseforgeIcons;
    return source[projectId] ?? null;
  };
}
