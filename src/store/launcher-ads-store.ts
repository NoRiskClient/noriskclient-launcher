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

interface LauncherAdsState {
  active: boolean;
  slots: Record<string, AdSize>;
  consent: AdConsentMode;
  refresh: () => Promise<void>;
  openConsent: () => void;
}

export const useLauncherAdsStore = create<LauncherAdsState>((set) => ({
  active: false,
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

void onFeatureFlagsUpdated(() => useLauncherAdsStore.getState().refresh());
void onAdConsentMode((consent) => useLauncherAdsStore.setState({ consent }));
