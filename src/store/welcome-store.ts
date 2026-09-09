import { create } from "zustand";

interface WelcomeState {
  /** True once the user chose to browse without signing in. */
  skipped: boolean;
  skip: () => void;
}

/**
 * Deliberately not persisted: the welcome screen is meant to greet every
 * launcher start that has no account. Skipping gets the user into the app for
 * this run only — the next start asks again.
 */
export const useWelcomeStore = create<WelcomeState>((set) => ({
  skipped: false,
  skip: () => set({ skipped: true }),
}));
