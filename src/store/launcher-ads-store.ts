import { create } from "zustand";
import {
  hideAd,
  onAdConsentMode,
  refreshAds,
  showAdConsent,
  type AdConsentMode,
  type AdSize,
} from "../services/ads-service";
import { onFeatureFlagsUpdated } from "../services/feature-flags-service";
import { log } from "../utils/logging-utils";

interface LauncherAdsState {
  active: boolean;
  slots: Record<string, AdSize>;
  consent: AdConsentMode;
  epoch: number;
  release: () => Promise<void>;
  refresh: () => Promise<void>;
  openConsent: () => void;
}

const RELEASE_TIMEOUT_MS = 150;

export const useLauncherAdsStore = create<LauncherAdsState>((set, get) => ({
  active: false,
  slots: {},
  consent: "closed",
  epoch: 0,
  release: async () => {
    const { active, slots } = get();
    if (!active) return;
    const hidden = Promise.all(Object.keys(slots).map((slot) => hideAd(slot))).catch(() => {});
    await Promise.race([hidden, new Promise((resolve) => setTimeout(resolve, RELEASE_TIMEOUT_MS))]);
    set((state) => ({ epoch: state.epoch + 1 }));
  },
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

void onFeatureFlagsUpdated(() => useLauncherAdsStore.getState().refresh());
void onAdConsentMode((consent) => useLauncherAdsStore.setState({ consent }));
