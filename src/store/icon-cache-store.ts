import { create } from "zustand";


const MAX_ARCHIVE_ICONS = 500;

interface IconCacheState {
  modrinthIcons: Record<string, string | null>;
  curseforgeIcons: Record<string, string | null>;
  archiveIcons: Record<string, string | null>;

  mergeModrinthIcons: (patch: Record<string, string | null>) => void;
  mergeCurseforgeIcons: (patch: Record<string, string | null>) => void;
  mergeArchiveIcons: (patch: Record<string, string | null>) => void;
}

export const useIconCacheStore = create<IconCacheState>((set) => ({
  modrinthIcons: {},
  curseforgeIcons: {},
  archiveIcons: {},

  mergeModrinthIcons: (patch) =>
    set((state) => ({ modrinthIcons: { ...state.modrinthIcons, ...patch } })),

  mergeCurseforgeIcons: (patch) =>
    set((state) => ({ curseforgeIcons: { ...state.curseforgeIcons, ...patch } })),

  mergeArchiveIcons: (patch) =>
    set((state) => {
      const archiveIcons = { ...state.archiveIcons, ...patch };
      let overflow = Object.keys(archiveIcons).length - MAX_ARCHIVE_ICONS;
      if (overflow <= 0) return { archiveIcons };

      for (const key of Object.keys(archiveIcons)) {
        if (overflow <= 0) break;
        if (key in patch) continue;
        delete archiveIcons[key];
        overflow--;
      }
      return { archiveIcons };
    }),
}));

export function archiveIconKey(item: {
  sha1_hash?: string | null;
  path: string;
}): string {
  return item.sha1_hash && item.sha1_hash !== "0" ? item.sha1_hash : item.path;
}
