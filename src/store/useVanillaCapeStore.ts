import { create } from "zustand";
import { VanillaCapeService } from "../services/vanilla-cape-service";
import { invalidateEquippedCosmetics } from "../services/cosmetic-cache";
import type { VanillaCape } from "../types/vanillaCapes";

interface VanillaCapeState {
  ownedCapes: VanillaCape[];
  equippedCape: VanillaCape | null;
  isLoading: boolean;
  error: string | null;
  lastFetchTime: number | null;

  fetchOwnedCapes: () => Promise<void>;
  equipCape: (capeId: string | null) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useVanillaCapeStore = create<VanillaCapeState>()((set, get) => ({
  ownedCapes: [],
  equippedCape: null,
  isLoading: false,
  error: null,
  lastFetchTime: null,

  fetchOwnedCapes: async () => {
    const now = Date.now();
    const lastFetch = get().lastFetchTime;
    
    // Prevent multiple calls within 5 seconds
    if (lastFetch && now - lastFetch < 5000) {
      console.log("Skipping fetch - too soon since last call");
      return;
    }

    if (get().isLoading) {
      console.log("Skipping fetch - already loading");
      return;
    }

    set({ isLoading: true, error: null, lastFetchTime: now });
    try {
      const ownedCapes = await VanillaCapeService.getOwnedVanillaCapes();
      const equippedCape = await VanillaCapeService.getCurrentlyEquippedVanillaCape();
      
      set({ 
        ownedCapes, 
        equippedCape,
        isLoading: false 
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to fetch owned capes";
      set({ error: errorMessage, isLoading: false });
      console.error("Failed to fetch owned vanilla capes:", error);
    }
  },

  equipCape: async (capeId: string | null) => {
    const previousEquipped = get().equippedCape;
    
    try {
      if (capeId === null) {
        set({ equippedCape: null });
      } else {
        const cape = get().ownedCapes.find(c => c.id === capeId);
        if (cape) {
          set({ equippedCape: { ...cape, equipped: true } });
        }
      }

      await VanillaCapeService.equipVanillaCape(capeId);
      invalidateEquippedCosmetics();

      set(state => ({
        ownedCapes: state.ownedCapes.map(cape => ({
          ...cape,
          equipped: cape.id === capeId
        }))
      }));
    } catch (error) {
      set({ equippedCape: previousEquipped });

      const errorMessage = error instanceof Error ? error.message : "Failed to equip cape";
      set({ error: errorMessage });
      console.error("Failed to equip vanilla cape:", error);
      throw error; // Re-throw so the calling code can handle the error
    }
  },

  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },

  setError: (error: string | null) => {
    set({ error });
  },
}));