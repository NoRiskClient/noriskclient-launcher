import { create } from "zustand";
import type { UnifiedVersion } from "../types/unified";


const MAX_ENTRIES = 50;

export interface ContentCacheEntry<T = any> {
  items: T[];
  contentUpdates: Record<string, UnifiedVersion>;
  cachedAt: number;
}

export function contentCacheKey(
  profileId: string,
  contentType: string,
): string {
  return `${profileId}:${contentType}`;
}

interface ContentCacheState {
  entries: Record<string, ContentCacheEntry>;
  getEntry: <T>(key: string) => ContentCacheEntry<T> | undefined;
  setEntry: <T>(key: string, patch: Partial<ContentCacheEntry<T>>) => void;
  invalidate: (key: string) => void;
  invalidateProfile: (profileId: string) => void;

}

const emptyEntry = (): ContentCacheEntry => ({
  items: [],
  contentUpdates: {},
  cachedAt: 0,
});

export const useContentCacheStore = create<ContentCacheState>((set, get) => ({
  entries: {},

  getEntry: <T,>(key: string) =>
    get().entries[key] as ContentCacheEntry<T> | undefined,

  setEntry: (key, patch) =>
    set((state) => {
      const existing = state.entries[key] ?? emptyEntry();
      const entries = {
        ...state.entries,
        [key]: { ...existing, ...patch, cachedAt: Date.now() },
      };

      const keys = Object.keys(entries);
      if (keys.length > MAX_ENTRIES) {
        const oldest = keys.reduce((a, b) =>
          entries[a].cachedAt <= entries[b].cachedAt ? a : b,
        );
        delete entries[oldest];
      }

      return { entries };
    }),

  invalidate: (key) =>
    set((state) => {
      if (!state.entries[key]) return state;
      const entries = { ...state.entries };
      delete entries[key];
      return { entries };
    }),

  invalidateProfile: (profileId) =>
    set((state) => {
      const entries = { ...state.entries };
      for (const key of Object.keys(entries)) {
        if (key.startsWith(`${profileId}:`)) delete entries[key];
      }
      return { entries };
    }),

}));
