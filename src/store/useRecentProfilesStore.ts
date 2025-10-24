import { create } from "zustand";
import { persist } from "zustand/middleware";

interface RecentProfile {
  id: string;
  name: string;
  lastLaunched: number;
  launchCount: number;
}

interface RecentProfilesState {
  recentProfiles: RecentProfile[];
  addRecentProfile: (profileId: string, profileName: string) => void;
  getRecentProfiles: (limit?: number) => RecentProfile[];
  clearRecentProfiles: () => void;
  removeRecentProfile: (profileId: string) => void;
}

const STORAGE_KEY = "norisk-recent-profiles";

export const useRecentProfilesStore = create<RecentProfilesState>()(
  persist(
    (set, get) => ({
      recentProfiles: [],

      addRecentProfile: (profileId: string, profileName: string) => {
        set((state) => {
          const existingIndex = state.recentProfiles.findIndex(p => p.id === profileId);
          const now = Date.now();
          
          if (existingIndex >= 0) {
            // Update existing profile
            const updated = [...state.recentProfiles];
            updated[existingIndex] = {
              ...updated[existingIndex],
              lastLaunched: now,
              launchCount: updated[existingIndex].launchCount + 1
            };
            return { recentProfiles: updated };
          } else {
            // Add new profile
            const newProfile: RecentProfile = {
              id: profileId,
              name: profileName,
              lastLaunched: now,
              launchCount: 1
            };
            return { 
              recentProfiles: [newProfile, ...state.recentProfiles].slice(0, 10) // Keep max 10
            };
          }
        });
      },

      getRecentProfiles: (limit = 5) => {
        const { recentProfiles } = get();
        return recentProfiles
          .sort((a, b) => b.lastLaunched - a.lastLaunched)
          .slice(0, limit);
      },

      clearRecentProfiles: () => {
        set({ recentProfiles: [] });
      },

      removeRecentProfile: (profileId: string) => {
        set((state) => ({
          recentProfiles: state.recentProfiles.filter(p => p.id !== profileId)
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (!Array.isArray(state.recentProfiles)) {
            state.recentProfiles = [];
          }
        }
      },
    },
  ),
);
