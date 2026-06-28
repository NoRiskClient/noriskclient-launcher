import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface LogSettingsState {
  // Display settings
  showThreadPrefix: boolean; // Show [Thread/LEVEL] prefix or hide brackets

  // Actions
  setShowThreadPrefix: (show: boolean) => void;
  toggleShowThreadPrefix: () => void;
}

export const useLogSettingsStore = create<LogSettingsState>()(
  persist(
    (set) => ({
      // Default: hide thread prefix brackets (makes logs narrower)
      showThreadPrefix: false,

      setShowThreadPrefix: (show) => set({ showThreadPrefix: show }),
      toggleShowThreadPrefix: () =>
        set((state) => ({ showThreadPrefix: !state.showThreadPrefix })),
    }),
    {
      name: "log-settings",
    }
  )
);
