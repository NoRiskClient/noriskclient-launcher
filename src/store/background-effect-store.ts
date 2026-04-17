import { create } from "zustand";
import { persist } from "zustand/middleware";

export enum BACKGROUND_EFFECTS {
  NONE = "none",
  MATRIX_RAIN = "matrix-rain",
  ENCHANTMENT_PARTICLES = "enchantment-particles",
  NEBULA_WAVES = "nebula-waves",
  NEBULA_PARTICLES = "nebula-particles",
  NEBULA_GRID = "nebula-grid",
  NEBULA_VOXELS = "nebula-voxels",
  NEBULA_LIGHTNING = "nebula-lightning",
  NEBULA_LIQUID_CHROME = "nebula-liquid-chrome",
  RETRO_GRID = "retro-grid",
  PLAIN_BACKGROUND = "plain-background",
  CUSTOM_MEDIA = "custom-media",
}

interface BackgroundEffectState {
  currentEffect: string;
  customBackgroundPath: string | null;
  customBackgroundBlur: number;
  customBackgroundSize: number;
  setCurrentEffect: (effect: string) => void;
  setCustomBackgroundPath: (path: string | null) => void;
  clearCustomBackgroundPath: () => void;
  setCustomBackgroundBlur: (blur: number) => void;
  setCustomBackgroundSize: (size: number) => void;
}

export const useBackgroundEffectStore = create<BackgroundEffectState>()(
  persist(
    (set) => ({
      currentEffect: BACKGROUND_EFFECTS.RETRO_GRID,
      customBackgroundPath: null,
      customBackgroundBlur: 0,
      customBackgroundSize: 100,
      setCurrentEffect: (effect) => set({ currentEffect: effect }),
      setCustomBackgroundPath: (path) => set({ customBackgroundPath: path }),
      clearCustomBackgroundPath: () => set({ customBackgroundPath: null }),
      setCustomBackgroundBlur: (blur) =>
        set({ customBackgroundBlur: Math.max(0, Math.min(40, blur)) }),
      setCustomBackgroundSize: (size) =>
        set({ customBackgroundSize: Math.max(50, Math.min(200, size)) }),
    }),
    {
      name: "norisk-background-effect-storage",
    },
  ),
);
