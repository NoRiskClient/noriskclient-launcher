import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SkinVisibilityState {
  isSkinVisible: boolean;
  toggleSkinVisibility: () => void;
  setSkinVisibility: (visible: boolean) => void;
}

export const useSkinVisibilityStore = create<SkinVisibilityState>()(
  persist(
    (set) => ({
      isSkinVisible: true,
      toggleSkinVisibility: () => set((state) => ({ isSkinVisible: !state.isSkinVisible })),
      setSkinVisibility: (visible) => set({ isSkinVisible: visible }),
    }),
    {
      name: "norisk-skin-visibility-storage",
    },
  ),
);
