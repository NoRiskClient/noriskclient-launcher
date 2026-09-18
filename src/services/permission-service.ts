import { invoke } from "@tauri-apps/api/core";
import { usePermissionStore } from "../store/permission-store";

export interface PermissionCacheState {
  nodes: string[];
  last_fetched: string | null;
  last_account_id: string | null;
}

export const refreshPermissions = (): Promise<void> =>
  invoke<void>("refresh_permissions").finally(() => usePermissionStore.getState().bump());

export const getCachedPermissions = (): Promise<PermissionCacheState> =>
  invoke("get_cached_permissions");

export const hasPermission = (node: string): Promise<boolean> =>
  invoke("has_permission", { node });
