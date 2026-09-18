import { create } from "zustand";

interface PermissionState {
  revision: number;
  bump: () => void;
}

export const usePermissionStore = create<PermissionState>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));
