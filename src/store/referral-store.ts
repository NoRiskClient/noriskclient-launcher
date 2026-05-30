import { create } from "zustand";
import type { ReferralInfo } from "../types/launcherConfig";
import { getReferralInfo } from "../services/referral-service";
import { translateApiError } from "../utils/nrc-error-translations";

const DISMISSED_KEY = "referral_banner_dismissed_code";

interface ReferralStoreState {
  pendingCode: string | null;
  referrerInfo: ReferralInfo | null;
  isLoading: boolean;
  error: string | null;
  bannerVisible: boolean;

  // Actions
  setPendingCode: (code: string | null) => void;
  fetchReferralInfo: (code: string) => Promise<void>;
  dismissBanner: () => void;
  checkIfDismissed: (code: string) => boolean;
}

export const useReferralStore = create<ReferralStoreState>((set, get) => ({
  pendingCode: null,
  referrerInfo: null,
  isLoading: false,
  error: null,
  bannerVisible: false,

  setPendingCode: (code) => {
    set({ pendingCode: code });
    // Check if this code was already dismissed
    if (code && !get().checkIfDismissed(code)) {
      get().fetchReferralInfo(code);
    }
  },

  fetchReferralInfo: async (code) => {
    // Don't fetch if already dismissed
    if (get().checkIfDismissed(code)) {
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const info = await getReferralInfo(code);
      if (info.valid) {
        set({
          referrerInfo: info,
          bannerVisible: true,
          isLoading: false,
        });
      } else {
        set({
          referrerInfo: null,
          bannerVisible: false,
          isLoading: false,
          error: "Referral code is no longer valid",
        });
      }
    } catch (error) {
      console.error("[ReferralStore] Failed to fetch referral info:", error);
      set({
        referrerInfo: null,
        bannerVisible: false,
        isLoading: false,
        error: translateApiError(error, "Failed to fetch referral info"),
      });
    }
  },

  dismissBanner: () => {
    const code = get().pendingCode;
    if (code) {
      // Remember that this code was dismissed
      localStorage.setItem(DISMISSED_KEY, code);
    }
    set({ bannerVisible: false });
  },

  checkIfDismissed: (code) => {
    const dismissedCode = localStorage.getItem(DISMISSED_KEY);
    return dismissedCode === code;
  },
}));
