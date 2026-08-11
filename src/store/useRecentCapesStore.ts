import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CosmeticCape } from '../types/noriskCapes';

interface RecentCapesState {
  capesByAccount: Record<string, CosmeticCape[]>;
  addRecentCape: (accountId: string, cape: CosmeticCape) => void;
  removeRecentCape: (accountId: string, capeId: string) => void;
  clearRecentCapes: (accountId: string) => void;
}

export const useRecentCapesStore = create<RecentCapesState>()(
  persist(
    (set) => ({
      capesByAccount: {},
      addRecentCape: (accountId, cape) =>
        set((state) => {
          const accountCapes = state.capesByAccount[accountId] || [];
          const filtered = accountCapes.filter((c) => c._id !== cape._id);
          return {
            capesByAccount: {
              ...state.capesByAccount,
              [accountId]: [cape, ...filtered].slice(0, 15),
            },
          };
        }),
      removeRecentCape: (accountId, capeId) =>
        set((state) => {
          const accountCapes = state.capesByAccount[accountId] || [];
          return {
            capesByAccount: {
              ...state.capesByAccount,
              [accountId]: accountCapes.filter((c) => c._id !== capeId),
            },
          };
        }),
      clearRecentCapes: (accountId) =>
        set((state) => ({
          capesByAccount: {
            ...state.capesByAccount,
            [accountId]: [],
          },
        })),
    }),
    {
      name: 'recent-capes-storage-v2', // bump version to reset old structure
    }
  )
);
