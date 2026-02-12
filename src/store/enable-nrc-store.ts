import { create } from 'zustand';

interface EnableNrcState {
  pendingProfileId: string | null;
  openModal: (profileId: string) => void;
  closeModal: () => void;
}

export const useEnableNrcStore = create<EnableNrcState>((set) => ({
  pendingProfileId: null,
  openModal: (profileId: string) => set({ pendingProfileId: profileId }),
  closeModal: () => set({ pendingProfileId: null }),
}));
