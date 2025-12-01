import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SnowEffectState {
  isEnabled: boolean;
  toggleSnowEffect: () => void;
  setSnowEffect: (enabled: boolean) => void;
}

// Check if current month is December (month index 11, since months are 0-indexed)
const isDecember = () => {
  const currentMonth = new Date().getMonth();
  return currentMonth === 11; // December is month 11 (0-indexed)
};

// Get default value: true if December, false otherwise
const getDefaultSnowEffect = () => {
  return isDecember();
};

export const useSnowEffectStore = create<SnowEffectState>()(
  persist(
    (set) => ({
      isEnabled: getDefaultSnowEffect(),
      toggleSnowEffect: () => set((state) => ({ isEnabled: !state.isEnabled })),
      setSnowEffect: (enabled) => set({ isEnabled: enabled }),
    }),
    {
      name: "norisk-snow-effect-storage",
      // On rehydration, check if we should use month-based default
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Check if this is the first time loading (no previous value)
        // If so, use default based on current month
        const stored = typeof window !== "undefined" 
          ? localStorage.getItem("norisk-snow-effect-storage")
          : null;
        
        // If no stored value or if it's the first load, use month-based default
        if (!stored) {
          state.isEnabled = getDefaultSnowEffect();
        }
      },
    },
  ),
);

