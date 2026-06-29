import { convertFileSrc } from "@tauri-apps/api/core";

import { MinecraftSkinService } from "../services/minecraft-skin-service";
import { useSkinStore } from "../store/useSkinStore";
import type { GetStarlightSkinRenderPayload } from "../types/localSkin";
import { useAsyncResource } from "./useAsyncResource";

const DEFAULT_FALLBACK_SKIN_URL = "/skins/default_steve_full.png";

export function useStarlightRender(
  enabled: boolean,
  playerName: string | null | undefined,
): string {
  const skinRevision = useSkinStore((state) => state.skinRevision);

  const { data } = useAsyncResource<string>(
    enabled && playerName
      ? async () => {
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
          return localPath
            ? convertFileSrc(localPath)
            : DEFAULT_FALLBACK_SKIN_URL;
        }
      : null,
    [enabled, playerName, skinRevision],
    DEFAULT_FALLBACK_SKIN_URL,
  );

  return data;
}
