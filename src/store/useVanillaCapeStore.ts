import { create } from "zustand";
import { persist } from "zustand/middleware";
import { VanillaCapeService } from "../services/vanilla-cape-service";
import type { VanillaCape, VanillaCapeInfo } from "../types/vanillaCapes";
import { toast } from "react-hot-toast";
import i18n from '../i18n/i18n';

interface VanillaCapeState {
  ownedCapes: VanillaCape[];
  equippedCape: VanillaCape | null;
  capeInfo: VanillaCapeInfo[];
  isLoading: boolean;
  error: string | null;
  lastFetchTime: number | null;

  fetchOwnedCapes: () => Promise<void>;
  fetchCapeInfo: () => Promise<void>;
  equipCape: (capeId: string | null) => Promise<void>;
  refreshData: () => Promise<void>;
  clearData: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const STORAGE_KEY = "norisk-vanilla-capes";

export const useVanillaCapeStore = create<VanillaCapeState>()(
  persist(
    (set, get) => ({
      ownedCapes: [],
      equippedCape: null,
      capeInfo: [],
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

      fetchCapeInfo: async () => {
        set({ isLoading: true, error: null });
        try {
          const capeInfo = await VanillaCapeService.getVanillaCapeInfo();
          set({ capeInfo, isLoading: false });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to fetch cape info";
          set({ error: errorMessage, isLoading: false });
          console.error("Failed to fetch vanilla cape info:", error);
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

      refreshData: async () => {
        set({ isLoading: true, error: null, lastFetchTime: null }); 
        try {
          await VanillaCapeService.refreshVanillaCapeData();
          const ownedCapes = await VanillaCapeService.getOwnedVanillaCapes();
          const equippedCape = await VanillaCapeService.getCurrentlyEquippedVanillaCape();
          
          set({ 
            ownedCapes, 
            equippedCape,
            isLoading: false,
            lastFetchTime: Date.now()
          });
          toast.success(i18n.t('capes.data_refreshed'));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Failed to refresh cape data";
          set({ error: errorMessage, isLoading: false });
          toast.error(`Failed to refresh cape data: ${errorMessage}`);
          console.error("Failed to refresh vanilla cape data:", error);
        }
      },

      clearData: () => {
        set({
          ownedCapes: [],
          equippedCape: null,
          capeInfo: [],
          isLoading: false,
          error: null,
          lastFetchTime: null
        });
      },

      setLoading: (loading: boolean) => {
        set({ isLoading: loading });
      },

      setError: (error: string | null) => {
        set({ error });
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        capeInfo: state.capeInfo,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.ownedCapes = [];
          state.equippedCape = null;
          state.isLoading = false;
          state.error = null;
          state.lastFetchTime = null;
        }
      },
    },
  ),
);