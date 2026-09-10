import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ReducedMotionPreference = "on" | "off" | "system";

export interface ReducedMotionSettingsSnapshot {
  isBackgroundAnimationEnabled: boolean;
  staticBackground: boolean;
  cosmeticRenderer3d: boolean;
  snowEffectEnabled: boolean;
}

interface ReducedMotionState {
  preference: ReducedMotionPreference;
  systemPrefersReducedMotion: boolean;
  previousSettings: ReducedMotionSettingsSnapshot | null;
  setPreference: (preference: ReducedMotionPreference) => void;
  setSystemPrefersReducedMotion: (reduced: boolean) => void;
  setPreviousSettings: (settings: ReducedMotionSettingsSnapshot | null) => void;
}

const getSystemPreference = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export const useReducedMotionStore = create<ReducedMotionState>()(
  persist(
    (set) => ({
      preference: "system",
      systemPrefersReducedMotion: getSystemPreference(),
      previousSettings: null,
      setPreference: (preference) => set({ preference }),
      setSystemPrefersReducedMotion: (systemPrefersReducedMotion) =>
        set({ systemPrefersReducedMotion }),
      setPreviousSettings: (previousSettings) => set({ previousSettings }),
    }),
    {
      name: "norisk-reduced-motion-storage",
      partialize: ({ preference, previousSettings }) => ({
        preference,
        previousSettings,
      }),
    },
  ),
);

export const selectReducedMotionEnabled = (state: ReducedMotionState) =>
  state.preference === "on" ||
  (state.preference === "system" && state.systemPrefersReducedMotion);

export const useReducedMotionEnabled = () =>
  useReducedMotionStore(selectReducedMotionEnabled);

export const getMotionSafeScrollBehavior = (): ScrollBehavior =>
  selectReducedMotionEnabled(useReducedMotionStore.getState()) ? "auto" : "smooth";
