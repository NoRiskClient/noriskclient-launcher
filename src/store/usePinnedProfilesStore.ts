import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PinnedProfilesState {
  pinnedProfileIds: string[];
  isPinned: (profileId: string) => boolean;
  togglePin: (profileId: string) => void;
}

const STORAGE_KEY = "norisk-pinned-profiles";

export const usePinnedProfilesStore = create<PinnedProfilesState>()(
  persist(
    (set, get) => ({
      pinnedProfileIds: [],

      isPinned: (profileId: string) => {
        return get().pinnedProfileIds.includes(profileId);
      },

      togglePin: (profileId: string) => {
        set((state) => {
          if (state.pinnedProfileIds.includes(profileId)) {
            return {
              pinnedProfileIds: state.pinnedProfileIds.filter(
                (id) => id !== profileId,
              ),
            };
          }
          return {
            pinnedProfileIds: [profileId, ...state.pinnedProfileIds],
          };
        });
      },
    }),
    {
      name: STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (!Array.isArray(state.pinnedProfileIds)) {
            state.pinnedProfileIds = [];
          }
        }
      },
    },
  ),
);
