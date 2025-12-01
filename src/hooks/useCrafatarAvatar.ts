import { useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { MinecraftSkinService } from "../services/minecraft-skin-service";

const DEFAULT_STEVE_UUID = "8667ba71b85a4004af54457a9734eed7";

interface UseCrafatarAvatarOptions {
  uuid: string | null | undefined;
  size?: number;
  overlay?: boolean;
  fallbackToDefault?: boolean;
}

/**
 * Hook to load and cache Crafatar avatars.
 * Handles loading, caching, and error fallback automatically.
 * 
 * @param options - Configuration options for the avatar
 * @returns The avatar URL (local cached path converted to file src) or null if not loaded yet
 */
export function useCrafatarAvatar({
  uuid,
  size,
  overlay = true,
  fallbackToDefault = true,
}: UseCrafatarAvatarOptions): string | null {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!uuid) {
      setAvatarUrl(null);
      return;
    }

    const loadAvatar = async () => {
      try {
        const localPath = await MinecraftSkinService.getCrafatarAvatar({
          uuid,
          size: size ?? undefined,
          overlay,
        });
        setAvatarUrl(convertFileSrc(localPath));
      } catch (error) {
        console.error("[useCrafatarAvatar] Failed to load avatar:", error);
        
        if (fallbackToDefault) {
          // Fallback to default Steve avatar
          const sizeParam = size ? `&size=${size}` : "";
          setAvatarUrl(
            `https://crafatar.com/avatars/${DEFAULT_STEVE_UUID}?overlay=true${sizeParam}`
          );
        } else {
          setAvatarUrl(null);
        }
      }
    };

    loadAvatar();
  }, [uuid, size, overlay, fallbackToDefault]);

  return avatarUrl;
}

