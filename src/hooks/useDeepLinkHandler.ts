import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useLatest } from "./useLatest";
import { registerDeepLinkHandler } from "../services/deep-link-service";

export function useDeepLinkHandler<T>(event: string, handler: (payload: T) => void) {
  const handlerRef = useLatest(handler);

  useEffect(() => {
    const unregister = registerDeepLinkHandler(event, (payload) =>
      handlerRef.current(payload as T),
    );
    const unlisten = listen<T>(event, (e) => handlerRef.current(e.payload));
    return () => {
      unregister();
      unlisten.then((fn) => fn());
    };
  }, [event, handlerRef]);
}
