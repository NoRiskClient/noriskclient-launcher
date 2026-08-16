import { useMemo } from "react";
import type { SnapshotCosmetic } from "@noriskclient/nrc-skin-renderer/snapshot";

import { getSkinPreview } from "../lib/skin-preview";
import { useSkinStore } from "../store/useSkinStore";
import type { SkinVariant } from "../types/localSkin";
import { useAsyncResource } from "./useAsyncResource";

const DEFAULT_FALLBACK_SKIN_URL = "/skins/default_steve_full.png";
const NO_COSMETICS: SnapshotCosmetic[] = [];

export interface SkinPreviewInput {
  textureUrl: string | null | undefined;
  variant?: SkinVariant;
  cosmetics?: SnapshotCosmetic[];
  width?: number;
  height?: number;
}

export interface SkinPreview {
  url: string;
  loading: boolean;
}

export function useSkinPreview(
  enabled: boolean,
  input: SkinPreviewInput,
): SkinPreview {
  const skinRevision = useSkinStore((state) => state.skinRevision);
  const {
    textureUrl,
    variant = "classic",
    cosmetics = NO_COSMETICS,
    width,
    height,
  } = input;
  const active = enabled && !!textureUrl;

  const cosmeticIds = useMemo(
    () => cosmetics.map((c) => c.id).sort().join(","),
    [cosmetics],
  );

  const { data, loading } = useAsyncResource<string>(
    active
      ? () =>
          getSkinPreview(
            { textureUrl, variant, cosmetics },
            width && height
              ? { width: width * 2, height: height * 2 }
              : undefined,
          )
      : null,
    [active, textureUrl, variant, cosmeticIds, width, height, skinRevision],
    DEFAULT_FALLBACK_SKIN_URL,
  );

  return { url: data, loading: active && loading };
}
