import { create } from "zustand";

import { getLauncherConfig } from "../services/launcher-config-service";
import { isWindows } from "../utils/platform";

interface ClipsState {
  enabled: boolean;
  loaded: boolean;
  applying: boolean;
  refresh: () => Promise<void>;
  set: (enabled: boolean) => void;
  setApplying: (applying: boolean) => void;
}

export const useClipsStore = create<ClipsState>((set) => ({
  enabled: false,
  loaded: false,
  applying: false,
  refresh: async () => {
    if (!isWindows()) {
      set({ enabled: false, loaded: true });
      return;
    }
    try {
      const config = await getLauncherConfig();
      set({ enabled: Boolean(config.clips?.enabled), loaded: true });
    } catch (e) {
      console.error("Could not read the clip settings", e);
      set({ loaded: true });
    }
  },
  set: (enabled) => set({ enabled: enabled && isWindows(), loaded: true }),
  setApplying: (applying) => set({ applying }),
}));
