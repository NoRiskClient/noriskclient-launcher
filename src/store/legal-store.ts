import { create } from "zustand";
import type { LegalLocale } from "../config/legal";
import {
  acknowledgeLegalDocuments,
  acknowledgeLegalNotice,
  getLegalStatus,
  type LegalPrompt,
  type PendingLegalDocument,
} from "../services/legal-service";

interface LegalState {
  checked: boolean;
  prompt: LegalPrompt | null;
  notice: PendingLegalDocument | null;
  load: (locale: LegalLocale, acceptedLegacyTerms: boolean) => Promise<void>;
  acknowledge: () => Promise<void>;
  dismissNotice: () => Promise<void>;
}

let latestRequest = 0;

export const useLegalStore = create<LegalState>((set) => ({
  checked: false,
  prompt: null,
  notice: null,

  load: async (locale, acceptedLegacyTerms) => {
    const request = ++latestRequest;
    try {
      const { prompt, notice } = await getLegalStatus(locale, acceptedLegacyTerms);
      if (request !== latestRequest) return;
      set({ checked: true, prompt, notice });
    } catch (error) {
      if (request !== latestRequest) return;
      console.error("[LegalStore] Failed to load legal status:", error);
      set({ checked: true, prompt: null, notice: null });
    }
  },

  acknowledge: async () => {
    await acknowledgeLegalDocuments();
    latestRequest++;
    set({ prompt: null, notice: null });
  },

  dismissNotice: async () => {
    latestRequest++;
    set({ notice: null });
    await acknowledgeLegalNotice();
  },
}));
