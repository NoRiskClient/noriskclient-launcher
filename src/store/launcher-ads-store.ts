import { create } from "zustand";
import {
  onAdConsentMode,
  getAdStatus,
  refreshAds,
  showAdConsent,
  type AdConsentMode,
  type AdSize,
} from "../services/ads-service";
import { onFeatureFlagsUpdated } from "../services/feature-flags-service";
import { log } from "../utils/logging-utils";
import { readStored, writeStored } from "../utils/local-storage";

const PAUSE_KEY = "nrc.ads.pausedUntil";
const SLOTS_KEY = "nrc.ads.lastSlots";

const readLastSlots = (): Record<string, AdSize> =>
  readStored(
    SLOTS_KEY,
    (raw) => {
      const value = JSON.parse(raw ?? "{}");
      return value && typeof value === "object" ? value : {};
    },
    {},
  );

const writeLastSlots = (slots: Record<string, AdSize>) =>
  writeStored(SLOTS_KEY, Object.keys(slots).length > 0 ? JSON.stringify(slots) : null);

const readPausedUntil = () =>
  readStored(
    PAUSE_KEY,
    (raw) => {
      const value = Number(raw);
      return value > Date.now() ? value : null;
    },
    null,
  );

const writePausedUntil = (value: number | null) => writeStored(PAUSE_KEY, value ? String(value) : null);

const lastSlots = readLastSlots();

let resumeTimer: ReturnType<typeof setTimeout> | undefined;

interface LauncherAdsState {
  active: boolean;
  synced: boolean;
  pausedUntil: number | null;
  pause: (until: number) => void;
  resume: () => void;
  slots: Record<string, AdSize>;
  consent: AdConsentMode;
  refresh: () => Promise<void>;
  openConsent: () => void;
}

export const useLauncherAdsStore = create<LauncherAdsState>((set) => ({
  active: Object.keys(lastSlots).length > 0,
  synced: false,
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
  slots: lastSlots,
  consent: "closed",
  refresh: async () => {
    try {
      const slots = await refreshAds();
      const active = Object.keys(slots).length > 0;
      const consent = active ? (await getAdStatus()).consent : "closed";
      writeLastSlots(slots);
      set({ active, slots, consent, synced: true });
    } catch (error) {
      log("error", `Failed to update launcher ads: ${error}`);
      writeLastSlots({});
      set({ active: false, slots: {}, consent: "closed", synced: true });
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
