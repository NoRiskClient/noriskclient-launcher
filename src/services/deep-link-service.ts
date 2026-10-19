import { invoke } from "@tauri-apps/api/core";

type DeepLinkHandler = (payload: unknown) => void;

export interface PendingDeepLink {
  event: string;
  payload: unknown;
}

const handlers = new Map<string, DeepLinkHandler>();
let drained = false;

export function registerDeepLinkHandler(event: string, handler: DeepLinkHandler): () => void {
  handlers.set(event, handler);
  return () => {
    if (handlers.get(event) === handler) handlers.delete(event);
  };
}

export function dispatchPendingDeepLinks(pending: PendingDeepLink[]): void {
  for (const { event, payload } of pending) {
    const handler = handlers.get(event);
    if (!handler) {
      console.warn("[deep-link] No handler for pending deep link:", event);
      continue;
    }
    try {
      handler(payload);
    } catch (e) {
      console.error("[deep-link] Handler failed for", event, e);
    }
  }
}

export async function drainPendingDeepLinks(): Promise<void> {
  if (drained) return;
  drained = true;
  try {
    dispatchPendingDeepLinks((await invoke<PendingDeepLink[]>("take_pending_deep_links")) ?? []);
  } catch (e) {
    console.error("[deep-link] take_pending_deep_links failed:", e);
  }
}
