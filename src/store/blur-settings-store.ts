import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface BlurSettingsStore {
  disableBlurInGame: boolean;
  setDisableBlurInGame: (value: boolean) => void;
}

export const useBlurSettingsStore = create<BlurSettingsStore>(
  persist(
    (set) => ({
      disableBlurInGame: false,
      setDisableBlurInGame: (value: boolean) => set({ disableBlurInGame: value }),
    }),
    {
      name: 'norisk-blur-settings-storage',
    }
  )
);
