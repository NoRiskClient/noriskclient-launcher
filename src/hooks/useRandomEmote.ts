import { useEffect, useState } from "react";

import { resolveRandomEmote } from "../lib/cosmetics/cosmeticPack";
import type { EmoteAssetUrls } from "../lib/cosmetic-renderer/core";

export function useRandomEmote(enabled: boolean): EmoteAssetUrls | null {
  const [urls, setUrls] = useState<EmoteAssetUrls | null>(null);

  useEffect(() => {
    if (!enabled) {
      setUrls(null);
      return;
    }
    let alive = true;
    resolveRandomEmote().then((u) => {
      if (alive) setUrls(u);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return urls;
}
