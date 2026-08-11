import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CosmeticCape } from '../types/noriskCapes';

interface RecentCapesState {
  recentCapes: CosmeticCape[];
  addRecentCape: (cape: CosmeticCape) => void;
  removeRecentCape: (capeId: string) => void;
  clearRecentCapes: () => void;
}

export const useRecentCapesStore = create<RecentCapesState>()(
  persist(
    (set) => ({
      recentCapes: [],
      addRecentCape: (cape) =>
        set((state) => {
          // Remove if it already exists to move it to the front
          const filtered = state.recentCapes.filter((c) => c._id !== cape._id);
          return {
            // Keep only the last 15 capes
            recentCapes: [cape, ...filtered].slice(0, 15),
          };
        }),
      removeRecentCape: (capeId) =>
        set((state) => ({
          recentCapes: state.recentCapes.filter((c) => c._id !== capeId),
        })),
      clearRecentCapes: () => set({ recentCapes: [] }),
    }),
    {
      name: 'recent-capes-storage',
    }
  )
);
