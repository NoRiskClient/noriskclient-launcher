import { create } from "zustand";

export type WizardEntry = "source" | "version";

interface ProfileWizardState {
  isModalOpen: boolean;
  defaultGroup: string | null;
  entry: WizardEntry;
  openModal: (defaultGroup?: string | null, entry?: WizardEntry) => void;
  closeModal: () => void;
}

export const useProfileWizardStore = create<ProfileWizardState>((set) => ({
  isModalOpen: false,
  defaultGroup: null,
  entry: "source",
  openModal: (defaultGroup = null, entry = "source") =>
    set({ isModalOpen: true, defaultGroup, entry }),
  closeModal: () => set({ isModalOpen: false, defaultGroup: null, entry: "source" }),
}));
