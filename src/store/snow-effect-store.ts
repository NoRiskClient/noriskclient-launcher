import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SnowEffectState {
  isEnabled: boolean;
  toggleSnowEffect: () => void;
  setSnowEffect: (enabled: boolean) => void;
}

// Snow effect is a seasonal feature (December only)
// Set to false to allow users to enable it manually via settings
const SNOW_EFFECT_FORCE_DISABLED = false;

// Check if current month is December (month index 11, since months are 0-indexed)
const isDecember = () => {
  const currentMonth = new Date().getMonth();
  return currentMonth === 11; // December is month 11 (0-indexed)
};

// Get default value: true if December, false otherwise
// But respect force disable flag
const getDefaultSnowEffect = () => {
  if (SNOW_EFFECT_FORCE_DISABLED) return false;
  return isDecember();
};

export const useSnowEffectStore = create<SnowEffectState>()(
  persist(
    (set) => ({
      isEnabled: getDefaultSnowEffect(),
      toggleSnowEffect: () => {
        // If force disabled, don't allow toggling
        if (SNOW_EFFECT_FORCE_DISABLED) return;
        set((state) => ({ isEnabled: !state.isEnabled }));
      },
      setSnowEffect: (enabled) => {
        // If force disabled, always set to false
        if (SNOW_EFFECT_FORCE_DISABLED) {
          set({ isEnabled: false });
          return;
        }
        set({ isEnabled: enabled });
      },
    }),
    {
      name: "norisk-snow-effect-storage",
      // On rehydration, force disable if flag is set
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Force disable if flag is set
        if (SNOW_EFFECT_FORCE_DISABLED) {
          state.isEnabled = false;
          return;
        }

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

