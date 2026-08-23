import { create } from "zustand";

import { getLauncherConfig } from "../services/launcher-config-service";

interface ClipsState {
  enabled: boolean;
  loaded: boolean;
  refresh: () => Promise<void>;
  set: (enabled: boolean) => void;
}

export const useClipsStore = create<ClipsState>((set) => ({
  enabled: false,
  loaded: false,
  refresh: async () => {
    try {
      const config = await getLauncherConfig();
      set({ enabled: Boolean(config.clips?.enabled), loaded: true });
    } catch (e) {
      console.error("Could not read the clip settings", e);
      set({ loaded: true });
    }
  },
  set: (enabled) => set({ enabled, loaded: true }),
}));
