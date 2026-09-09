import { MinecraftSkinService } from "../services/minecraft-skin-service";
import { useSkinStore } from "../store/useSkinStore";
import { useMinecraftAuthStore } from "../store/minecraft-auth-store";
import type { SkinVariant } from "../types/localSkin";
import { cosmeticCacheKeys } from "../services/cosmetic-cache";
import { useAsyncResource } from "./useAsyncResource";

export interface ActiveSkinTexture {
  textureUrl: string | null;
  variant: SkinVariant;
  loading: boolean;
}

type SkinTexture = Omit<ActiveSkinTexture, "loading">;

const EMPTY: SkinTexture = { textureUrl: null, variant: "classic" };

function toDataUrl(base64: string): string {
  return base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
}

export function useActiveSkinTexture(): ActiveSkinTexture {
  const { activeAccount } = useMinecraftAuthStore();
  const { skinRevision } = useSkinStore();

  const { data, loading } = useAsyncResource<SkinTexture>(
    async () => {
      const skin = await MinecraftSkinService.getActiveSkin();
      if (!skin?.base64_data) return EMPTY;
      return {
        textureUrl: toDataUrl(skin.base64_data),
        variant: skin.variant ?? "classic",
      };
    },
    [activeAccount?.id, skinRevision],
    EMPTY,
    { cacheKey: activeAccount?.id ? cosmeticCacheKeys.activeSkin(activeAccount.id) : undefined },
  );

  return { ...data, loading };
}
