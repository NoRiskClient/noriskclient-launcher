import { create } from "zustand";

interface SettingsModalState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
