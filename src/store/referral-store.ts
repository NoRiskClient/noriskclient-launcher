import { create } from "zustand";
import type { ReferralInfo } from "../types/launcherConfig";
import { getReferralInfo } from "../services/referral-service";
import { translateApiError } from "../utils/nrc-error-translations";
import i18n from "../i18n/i18n";

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

export const useReferralStore = create<ReferralStoreState>((set, get) => {
  // Ignore an older lookup after dismissal, a changed code, or a newer lookup.
  let requestVersion = 0;
  let sessionDismissedCode: string | null = null;
  return {
    pendingCode: null,
    referrerInfo: null,
    isLoading: false,
    error: null,
    bannerVisible: false,

    setPendingCode: (code) => {
      requestVersion++;
      set({ pendingCode: code, referrerInfo: null, error: null, isLoading: false, bannerVisible: false });
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

      const version = ++requestVersion;
      set({ pendingCode: code, isLoading: true, error: null, referrerInfo: null, bannerVisible: true });
      const isCurrent = () => version === requestVersion && get().pendingCode === code && !get().checkIfDismissed(code);

      try {
        const info = await getReferralInfo(code);
        if (!isCurrent()) return;
        if (info.valid) {
          set({
            referrerInfo: info,
            bannerVisible: true,
            isLoading: false,
          });
        } else {
          set({
            referrerInfo: null,
            bannerVisible: true,
            isLoading: false,
            error: i18n.t("referral.invalidCode"),
          });
        }
      } catch (error) {
        if (!isCurrent()) return;
        console.error("[ReferralStore] Failed to fetch referral info:", error);
        set({
          referrerInfo: null,
          bannerVisible: true,
          isLoading: false,
          error: translateApiError(error, i18n.t("referral.fetchFailed")),
        });
      }
    },

    dismissBanner: () => {
      const code = get().pendingCode;
      requestVersion++;
      sessionDismissedCode = code;
      if (code) {
        // Remember that this code was dismissed
        try {
          localStorage.setItem(DISMISSED_KEY, code);
        } catch {
          // Dismiss still works in this session when storage is unavailable.
        }
      }
      set({ bannerVisible: false, error: null, isLoading: false, referrerInfo: null });
    },

    checkIfDismissed: (code) => {
      if (sessionDismissedCode === code) return true;
      try {
        return localStorage.getItem(DISMISSED_KEY) === code;
      } catch {
        return false;
      }
    },
  };
});
