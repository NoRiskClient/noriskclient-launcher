import { useEffect, useState } from "react";

import { MinecraftSkinService } from "../services/minecraft-skin-service";
import { useSkinStore } from "../store/useSkinStore";
import { useMinecraftAuthStore } from "../store/minecraft-auth-store";
import type { SkinVariant } from "../types/localSkin";

export interface ActiveSkinTexture {
  textureUrl: string | null;
  variant: SkinVariant;
  loading: boolean;
}

function toDataUrl(base64: string): string {
  return base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
}

export function useActiveSkinTexture(): ActiveSkinTexture {
  const { activeAccount } = useMinecraftAuthStore();
  const { skinRevision } = useSkinStore();
  const [state, setState] = useState<ActiveSkinTexture>({
    textureUrl: null,
    variant: "classic",
    loading: true,
  });

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));

    MinecraftSkinService.getActiveSkin()
      .then((skin) => {
        if (!alive) return;
        if (!skin?.base64_data) {
          setState({ textureUrl: null, variant: "classic", loading: false });
          return;
        }
        setState({
          textureUrl: toDataUrl(skin.base64_data),
          variant: skin.variant ?? "classic",
          loading: false,
        });
      })
      .catch(() => {
        if (!alive) return;
        setState({ textureUrl: null, variant: "classic", loading: false });
      });

    return () => {
      alive = false;
    };
  }, [activeAccount?.id, skinRevision]);

  return state;
}
