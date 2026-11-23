import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";

interface PermissionState {
  revision: number;
}

export const usePermissionStore = create<PermissionState>(() => ({ revision: 0 }));

listen("permissions:changed", () => {
  usePermissionStore.setState((state) => ({ revision: state.revision + 1 }));
}).catch((error) => console.error("[PermissionStore] Failed to listen for permission changes:", error));
