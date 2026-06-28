"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SkinState {
  selectedSkinId: string | null;
  setSelectedSkinId: (id: string | null) => void;
  skinRevision: number;
  bumpSkinRevision: () => void;
}

export const useSkinStore = create<SkinState>()(
  persist(
    (set) => ({
      selectedSkinId: null,
      setSelectedSkinId: (id) => set({ selectedSkinId: id }),
      skinRevision: 0,
      bumpSkinRevision: () => set((state) => ({ skinRevision: state.skinRevision + 1 })),
    }),
    {
      name: "skin-store",
      partialize: (state) => ({ selectedSkinId: state.selectedSkinId }),
    },
  ),
);
