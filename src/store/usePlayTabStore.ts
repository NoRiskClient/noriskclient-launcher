import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PlayTabState {
  isNewsSectionVisible: boolean;
  toggleNewsSection: () => void;
}

export const usePlayTabStore = create<PlayTabState>()(
  persist(
    (set) => ({
      isNewsSectionVisible: true,
      toggleNewsSection: () =>
        set((state) => ({ isNewsSectionVisible: !state.isNewsSectionVisible })),
    }),
    {
      name: "play-tab-storage",
    },
  ),
);
