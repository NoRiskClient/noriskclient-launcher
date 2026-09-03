import { create } from "zustand";

interface OpenOptions {
  only?: boolean;
}

interface SettingsModalState {
  isOpen: boolean;
  tab: string | null;
  only: boolean;
  open: (tab?: string, options?: OpenOptions) => void;
  close: () => void;
}

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  isOpen: false,
  tab: null,
  only: false,
  open: (tab, options) =>
    set({ isOpen: true, tab: tab ?? null, only: Boolean(tab) && Boolean(options?.only) }),
  close: () => set({ isOpen: false, tab: null, only: false }),
}));
