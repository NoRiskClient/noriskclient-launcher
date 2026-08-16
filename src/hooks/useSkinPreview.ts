import { useMemo } from "react";
import type {
  NametagOptions,
  SkinSnapshotRequest,
  SnapshotCosmetic,
} from "@noriskclient/nrc-skin-renderer/snapshot";

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
  nametag?: NametagOptions | null;
  emote?: SkinSnapshotRequest["emote"];
  fit?: boolean | number;
  crop?: boolean | number;
  width?: number;
  height?: number;
  dpr?: number;
  fallbackUrl?: string | null;
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
    nametag = null,
    emote,
    fit,
    crop,
    width,
    height,
    dpr = 2,
    fallbackUrl = DEFAULT_FALLBACK_SKIN_URL,
  } = input;
  const active = enabled && !!textureUrl;

  const cosmeticIds = useMemo(
    () => cosmetics.map((c) => c.id).sort().join(","),
    [cosmetics],
  );
  const nametagKey = nametag
    ? `${nametag.text}|${nametag.iconUrl ?? ""}|${nametag.iconPlus ?? false}`
    : "";

  const { data, loading } = useAsyncResource<string>(
    active
      ? () =>
          getSkinPreview(
            { textureUrl, variant, cosmetics, nametag, emote, fit, crop },
            width && height
              ? { width: Math.round(width * dpr), height: Math.round(height * dpr) }
              : undefined,
          )
      : null,
    [
      active,
      textureUrl,
      variant,
      cosmeticIds,
      nametagKey,
      emote?.animation ?? "",
      fit,
      crop,
      width,
      height,
      dpr,
      skinRevision,
    ],
    fallbackUrl ?? "",
  );

  return { url: data, loading: active && loading };
}
