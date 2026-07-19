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
}

interface BackgroundEffectState {
  currentEffect: string;
  customMediaUrl: string | null;
  customMediaType: "image" | "video" | null;
  customMediaOpacity: number;
  customMediaBlur: number;
  customMediaQuality: "low" | "medium" | "high";
  customMediaOnlyOnPlay: boolean;
  customMediaHideEffects: boolean;
  setCurrentEffect: (effect: string) => void;
  setCustomMedia: (url: string | null, type: "image" | "video" | null) => void;
  setCustomMediaOpacity: (opacity: number) => void;
  setCustomMediaBlur: (blur: number) => void;
  setCustomMediaQuality: (quality: "low" | "medium" | "high") => void;
  setCustomMediaOnlyOnPlay: (onlyOnPlay: boolean) => void;
  setCustomMediaHideEffects: (hideEffects: boolean) => void;
}

export const useBackgroundEffectStore = create<BackgroundEffectState>()(
  persist(
    (set) => ({
      currentEffect: BACKGROUND_EFFECTS.RETRO_GRID,
      customMediaUrl: null,
      customMediaType: null,
      customMediaOpacity: 0.25,
      customMediaBlur: 0,
      customMediaQuality: "high",
      customMediaOnlyOnPlay: true,
      customMediaHideEffects: false,
      setCurrentEffect: (effect) => set({ currentEffect: effect }),
      setCustomMedia: (url, type) => set({ customMediaUrl: url, customMediaType: type }),
      setCustomMediaOpacity: (opacity) => set({ customMediaOpacity: opacity }),
      setCustomMediaBlur: (blur) => set({ customMediaBlur: blur }),
      setCustomMediaQuality: (quality) => set({ customMediaQuality: quality }),
      setCustomMediaOnlyOnPlay: (onlyOnPlay) => set({ customMediaOnlyOnPlay: onlyOnPlay }),
      setCustomMediaHideEffects: (hideEffects) => set({ customMediaHideEffects: hideEffects }),
    }),
    {
      name: "norisk-background-effect-storage",
    },
  ),
);
