import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { MinecraftSkinService } from "../services/minecraft-skin-service";
import { useMinecraftAuthStore } from "../store/minecraft-auth-store";
import { useSkinStore } from "../store/useSkinStore";

interface UsePlayerAvatarOptions {
  uuid: string | null | undefined;
  size?: number;
  overlay?: boolean;
}

const normalize = (uuid: string) => uuid.replace(/-/g, "").toLowerCase();

const avatarUrlCache = new Map<string, string>();
const cacheKey = (uuid: string, size: number, overlay: boolean) =>
  `${normalize(uuid)}:${size}:${overlay}`;

export function usePlayerAvatar({
  uuid,
  size = 64,
  overlay = true,
}: UsePlayerAvatarOptions): string | null {
  const activeAccountId = useMinecraftAuthStore((state) => state.activeAccount?.id);
  const skinRevision = useSkinStore((state) => state.skinRevision);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() =>
    uuid ? avatarUrlCache.get(cacheKey(uuid, size, overlay)) ?? null : null,
  );

  const isSelf = !!uuid && !!activeAccountId && normalize(uuid) === normalize(activeAccountId);

  useEffect(() => {
    if (!uuid) {
      setAvatarUrl(null);
      return;
    }

    const key = cacheKey(uuid, size, overlay);
    const cached = avatarUrlCache.get(key);
    if (cached) setAvatarUrl(cached);

    let cancelled = false;
    const load = async () => {
      try {
        const localPath = await MinecraftSkinService.getFaceAvatar(uuid, size, overlay);
        const url = convertFileSrc(localPath);
        avatarUrlCache.set(key, url);
        if (!cancelled) setAvatarUrl(url);
      } catch (error) {
        console.error("[usePlayerAvatar] Failed to load avatar:", error);
        if (!cancelled && !cached) setAvatarUrl(null);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [uuid, size, overlay, isSelf, isSelf ? skinRevision : 0]);

  return avatarUrl;
}
