import { useEffect, useState } from "react";

import { resolveEmoteBySlug } from "../lib/cosmetics/cosmeticPack";
import type { EmoteAssetUrls } from "../lib/cosmetic-renderer/core";

export const IDLE_EMOTE_SLUGS: string[] = [];

export function useIdleEmote(): EmoteAssetUrls | null {
  const [urls, setUrls] = useState<EmoteAssetUrls | null>(null);

  useEffect(() => {
    if (IDLE_EMOTE_SLUGS.length === 0) {
      setUrls(null);
      return;
    }
    const slug =
      IDLE_EMOTE_SLUGS[Math.floor(Math.random() * IDLE_EMOTE_SLUGS.length)];
    let alive = true;
    resolveEmoteBySlug(slug).then((u) => {
      if (alive) setUrls(u);
    });
    return () => {
      alive = false;
    };
  }, []);

  return urls;
}
