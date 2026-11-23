import { create } from "zustand";
import {
  onAdConsentMode,
  refreshAds,
  showAdConsent,
  type AdConsentMode,
  type AdSize,
} from "../services/ads-service";
import { onFeatureFlagsUpdated } from "../services/feature-flags-service";
import { log } from "../utils/logging-utils";

const PAUSE_KEY = "nrc.ads.pausedUntil";

function readPausedUntil(): number | null {
  try {
    const value = Number(localStorage.getItem(PAUSE_KEY));
    return value > Date.now() ? value : null;
  } catch {
    return null;
  }
}

function writePausedUntil(value: number | null) {
  try {
    if (value) localStorage.setItem(PAUSE_KEY, String(value));
    else localStorage.removeItem(PAUSE_KEY);
  } catch {
    return;
  }
}

let resumeTimer: ReturnType<typeof setTimeout> | undefined;

interface LauncherAdsState {
  active: boolean;
  pausedUntil: number | null;
  pause: (until: number) => void;
  resume: () => void;
  slots: Record<string, AdSize>;
  consent: AdConsentMode;
  refresh: () => Promise<void>;
  openConsent: () => void;
}

export const useLauncherAdsStore = create<LauncherAdsState>((set) => ({
  active: false,
  pausedUntil: readPausedUntil(),
  pause: (until) => {
    writePausedUntil(until);
    set({ pausedUntil: until });
    scheduleResume(until);
  },
  resume: () => {
    writePausedUntil(null);
    clearTimeout(resumeTimer);
    set({ pausedUntil: null });
  },
  slots: {},
  consent: "closed",
  refresh: async () => {
    try {
      const slots = await refreshAds();
      const active = Object.keys(slots).length > 0;
      set(active ? { active, slots } : { active, slots, consent: "closed" });
    } catch (error) {
      log("error", `Failed to update launcher ads: ${error}`);
      set({ active: false, slots: {}, consent: "closed" });
    }
  },
  openConsent: () => {
    showAdConsent().catch((error) => log("error", `Failed to open the ad privacy dialog: ${error}`));
  },
}));

function scheduleResume(until: number) {
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => useLauncherAdsStore.getState().resume(), Math.min(until - Date.now(), 2_147_483_647));
}

const initialPause = useLauncherAdsStore.getState().pausedUntil;
if (initialPause) scheduleResume(initialPause);

void onFeatureFlagsUpdated(() => useLauncherAdsStore.getState().refresh());
void onAdConsentMode((consent) => useLauncherAdsStore.setState({ consent }));
