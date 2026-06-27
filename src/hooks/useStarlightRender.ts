import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { MinecraftSkinService } from "../services/minecraft-skin-service";
import { useSkinStore } from "../store/useSkinStore";
import type { GetStarlightSkinRenderPayload } from "../types/localSkin";

const DEFAULT_FALLBACK_SKIN_URL = "/skins/default_steve_full.png";

export function useStarlightRender(
  enabled: boolean,
  playerName: string | null | undefined,
): string {
  const skinRevision = useSkinStore((state) => state.skinRevision);
  const [url, setUrl] = useState<string>(DEFAULT_FALLBACK_SKIN_URL);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    const run = async () => {
      if (!playerName) {
        setUrl(DEFAULT_FALLBACK_SKIN_URL);
        return;
      }
      try {
        const activeSkin = await MinecraftSkinService.getActiveSkin().catch(
          () => null,
        );
        const payload: GetStarlightSkinRenderPayload = {
          player_name: playerName,
          render_type: "default",
          render_view: "full",
          base64_skin_data: activeSkin?.base64_data ?? null,
        };
        const localPath =
          await MinecraftSkinService.getStarlightSkinRender(payload);
        if (!alive) return;
        setUrl(localPath ? convertFileSrc(localPath) : DEFAULT_FALLBACK_SKIN_URL);
      } catch {
        if (alive) setUrl(DEFAULT_FALLBACK_SKIN_URL);
      }
    };

    run();
    return () => {
      alive = false;
    };
  }, [enabled, playerName, skinRevision]);

  return url;
}
