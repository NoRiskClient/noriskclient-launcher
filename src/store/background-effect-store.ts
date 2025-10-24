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
  CUSTOM_IMAGE = "custom-image",
}

interface BackgroundEffectState {
  currentEffect: string;
  setCurrentEffect: (effect: string) => void;
  customBackgroundImage: string | null;
  setCustomBackgroundImage: (imagePath: string | null) => void;
  backgroundImageOpacity: number;
  setBackgroundImageOpacity: (opacity: number) => void;
  backgroundImageBlur: number;
  setBackgroundImageBlur: (blur: number) => void;
  backgroundImageScale: number;
  setBackgroundImageScale: (scale: number) => void;
}

export const useBackgroundEffectStore = create<BackgroundEffectState>()(
  persist(
    (set) => ({
      currentEffect: BACKGROUND_EFFECTS.RETRO_GRID,
      setCurrentEffect: (effect) => set({ currentEffect: effect }),
      customBackgroundImage: null,
      setCustomBackgroundImage: (imagePath) => set({ customBackgroundImage: imagePath }),
      backgroundImageOpacity: 0.8,
      setBackgroundImageOpacity: (opacity) => set({ backgroundImageOpacity: opacity }),
      backgroundImageBlur: 0,
      setBackgroundImageBlur: (blur) => set({ backgroundImageBlur: blur }),
      backgroundImageScale: 1.0,
      setBackgroundImageScale: (scale) => set({ backgroundImageScale: scale }),
    }),
    {
      name: "norisk-background-effect-storage",
    },
  ),
);
