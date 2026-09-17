import { create } from "zustand";
import type { LegalLocale } from "../config/legal";
import {
  acknowledgeLegalDocuments,
  getPendingLegalDocuments,
  type LegalPrompt,
} from "../services/legal-service";

interface LegalState {
  checked: boolean;
  prompt: LegalPrompt | null;
  load: (locale: LegalLocale, acceptedLegacyTerms: boolean) => Promise<void>;
  acknowledge: () => Promise<void>;
}

let latestRequest = 0;

export const useLegalStore = create<LegalState>((set) => ({
  checked: false,
  prompt: null,

  load: async (locale, acceptedLegacyTerms) => {
    const request = ++latestRequest;
    try {
      const prompt = await getPendingLegalDocuments(locale, acceptedLegacyTerms);
      if (request !== latestRequest) return;
      set({ checked: true, prompt: prompt.documents.length > 0 ? prompt : null });
    } catch (error) {
      if (request !== latestRequest) return;
      console.error("[LegalStore] Failed to load legal documents:", error);
      set({ checked: true, prompt: null });
    }
  },

  acknowledge: async () => {
    await acknowledgeLegalDocuments();
    latestRequest++;
    set({ prompt: null });
  },
}));
