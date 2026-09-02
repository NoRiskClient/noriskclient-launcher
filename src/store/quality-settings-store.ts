import { create } from "zustand";
import { persist } from "zustand/middleware";

export type QualityLevel = "potato" | "low" | "medium" | "high";

interface QualitySettingsState {
  qualityLevel: QualityLevel;
  setQualityLevel: (level: QualityLevel) => void;
  cosmeticRenderer3d: boolean;
  setCosmeticRenderer3d: (enabled: boolean) => void;
}

export const useQualitySettingsStore = create<QualitySettingsState>()(
  persist(
    (set) => ({
      qualityLevel: "medium",
      setQualityLevel: (level) => set({ qualityLevel: level }),
      cosmeticRenderer3d: true,
      setCosmeticRenderer3d: (enabled) => set({ cosmeticRenderer3d: enabled }),
    }),
    {
      name: "norisk-quality-settings-storage",
    },
  ),
);
