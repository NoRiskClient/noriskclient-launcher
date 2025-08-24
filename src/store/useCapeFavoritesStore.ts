import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setCapeFavorite } from "../services/cape-service";
import { toast } from "react-hot-toast";

interface CapeFavoritesState {
  favoriteCapeIds: string[];
  isFavorite: (capeId: string) => boolean;
  addFavorite: (capeId: string) => void;
  removeFavorite: (capeId: string) => void;
  toggleFavorite: (capeId: string) => void;
  clearFavorites: () => void;
  setFavoriteOptimistic: (capeId: string, favorite: boolean, noriskToken?: string) => Promise<void>;
  toggleFavoriteOptimistic: (capeId: string, noriskToken?: string) => Promise<void>;
}

const STORAGE_KEY = "norisk-cape-favorites";

export const useCapeFavoritesStore = create<CapeFavoritesState>()(
  persist(
    (set, get) => ({
      favoriteCapeIds: [],

      isFavorite: (capeId: string) => {
        return get().favoriteCapeIds.includes(capeId);
      },

      addFavorite: (capeId: string) => {
        set((state) => {
          if (state.favoriteCapeIds.includes(capeId)) return state;
          return { favoriteCapeIds: [capeId, ...state.favoriteCapeIds] };
        });
      },

      removeFavorite: (capeId: string) => {
        set((state) => ({
          favoriteCapeIds: state.favoriteCapeIds.filter((id) => id !== capeId),
        }));
      },

      toggleFavorite: (capeId: string) => {
        const { isFavorite, addFavorite, removeFavorite } = get();
        if (isFavorite(capeId)) {
          removeFavorite(capeId);
        } else {
          addFavorite(capeId);
        }
      },

      clearFavorites: () => set({ favoriteCapeIds: [] }),

      setFavoriteOptimistic: async (capeId: string, favorite: boolean, noriskToken?: string) => {
        // Apply local change first and keep it regardless of server outcome
        const prev = get().favoriteCapeIds;
        const alreadyFavorite = prev.includes(capeId);
        let next: string[] = prev;
        if (favorite && !alreadyFavorite) {
          next = [capeId, ...prev];
        } else if (!favorite && alreadyFavorite) {
          next = prev.filter((id) => id !== capeId);
        }
        if (next !== prev) {
          set({ favoriteCapeIds: next });
        }

        try {
          // Fire-and-forget server sync; do not overwrite local state with response
          await setCapeFavorite(capeId, favorite, noriskToken);
        } catch (err) {
          const message = err instanceof Error ? err.message : String((err as any)?.message ?? err);
          toast.error(`Failed to sync favorite: ${message}`);
          // Intentionally do not revert local state
        }
      },

      toggleFavoriteOptimistic: async (capeId: string, noriskToken?: string) => {
        const nextFavorite = !get().isFavorite(capeId);
        await get().setFavoriteOptimistic(capeId, nextFavorite, noriskToken);
      },
    }),
    {
      name: STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (!Array.isArray(state.favoriteCapeIds)) {
            state.favoriteCapeIds = [];
          }
        }
      },
    },
  ),
); 