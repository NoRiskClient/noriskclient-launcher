import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "react-hot-toast";

interface SkinFavoritesState {
  favoriteSkinIds: string[];
  isFavorite: (skinId: string) => boolean;
  addFavorite: (skinId: string) => void;
  removeFavorite: (skinId: string) => void;
  toggleFavorite: (skinId: string) => void;
  clearFavorites: () => void;
}

const STORAGE_KEY = "norisk-skin-favorites";

export const useSkinFavoritesStore = create<SkinFavoritesState>()(
  persist(
    (set, get) => ({
      favoriteSkinIds: [],

      isFavorite: (skinId: string) => {
        return get().favoriteSkinIds.includes(skinId);
      },

      addFavorite: (skinId: string) => {
        set((state) => {
          if (state.favoriteSkinIds.includes(skinId)) return state;
          return { favoriteSkinIds: [skinId, ...state.favoriteSkinIds] };
        });
        toast.success("Skin added to favorites!");
      },

      removeFavorite: (skinId: string) => {
        set((state) => ({
          favoriteSkinIds: state.favoriteSkinIds.filter((id) => id !== skinId),
        }));
        toast.success("Skin removed from favorites!");
      },

      toggleFavorite: (skinId: string) => {
        const { isFavorite, addFavorite, removeFavorite } = get();
        if (isFavorite(skinId)) {
          removeFavorite(skinId);
        } else {
          addFavorite(skinId);
        }
      },

      clearFavorites: () => {
        set({ favoriteSkinIds: [] });
        toast.success("All favorites cleared!");
      },
    }),
    {
      name: STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (!Array.isArray(state.favoriteSkinIds)) {
            state.favoriteSkinIds = [];
          }
        }
      },
    },
  ),
);
