import { ReactNode } from "react";
import { create } from "zustand";

interface GlobalModalState {
  modals: Array<{
    id: string;
    component: ReactNode;
    zIndex?: number;
  }>;
  openModal: (id: string, component: ReactNode, zIndex?: number) => void;
  closeModal: (id: string) => void;
  closeAllModals: () => void;
}

export const useGlobalModalStore = create<GlobalModalState>((set) => ({
  modals: [],
  
  openModal: (id: string, component: ReactNode, zIndex = 1000) =>
    set((state) => ({
      modals: [
        ...state.modals.filter((modal) => modal.id !== id), // Remove existing modal with same ID
        { id, component, zIndex },
      ],
    })),
  
  closeModal: (id: string) =>
    set((state) => ({
      modals: state.modals.filter((modal) => modal.id !== id),
    })),
  
  closeAllModals: () =>
    set(() => ({
      modals: [],
    })),
}));

/**
 * Hook for easy modal management from any component
 */
export function useGlobalModal() {
  const { openModal, closeModal, closeAllModals } = useGlobalModalStore();

  const showModal = (id: string, component: ReactNode, zIndex?: number) => {
    openModal(id, component, zIndex);
  };

  const hideModal = (id: string) => {
    closeModal(id);
  };

  return {
    showModal,
    hideModal,
    closeAllModals,
  };
}
