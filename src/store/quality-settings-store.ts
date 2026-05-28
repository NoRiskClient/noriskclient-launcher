import { create } from "zustand";
import { persist } from "zustand/middleware";

export type QualityLevel = "potato" | "low" | "medium" | "high";

interface QualitySettingsState {
  qualityLevel: QualityLevel;
  setQualityLevel: (level: QualityLevel) => void;
}

export const useQualitySettingsStore = create<QualitySettingsState>()(
  persist(
    (set) => ({
      qualityLevel: "medium",
      setQualityLevel: (level) => set({ qualityLevel: level }),
    }),
    {
      name: "norisk-quality-settings-storage",
    },
  ),
);
