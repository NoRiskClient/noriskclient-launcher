"use client";

import { useEffect, useState } from "react";

import {
  disposeLoadedCosmetic,
  loadCosmetic,
  type CosmeticAssetUrls,
  type LoadedCosmetic,
  type RenderConfig,
} from "../core/loadCosmetic";

export type CosmeticGeoState =
  | { status: "loading" }
  | { status: "ready"; data: LoadedCosmetic }
  | { status: "error"; error: Error };

/**
 * Loads a Bedrock cosmetic from a CosmeticAssetUrls bundle and gives back a
 * ready-to-render result.
 *
 * The bundle is disposed when the input changes or the component unmounts, so
 * each viewer instance owns its own three.js resources (a single THREE
 * Object3D can only have one parent — sharing would break tile previews).
 *
 * Stable-reference your `urls`/`config` (e.g. `useMemo`) — a fresh object on
 * every render will trigger reload loops.
 */
export function useCosmeticGeo(
  urls: CosmeticAssetUrls,
  config?: RenderConfig
): CosmeticGeoState {
  const [state, setState] = useState<CosmeticGeoState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let local: LoadedCosmetic | null = null;
    setState({ status: "loading" });

    loadCosmetic(urls, config).then(
      (data) => {
        if (cancelled) {
          disposeLoadedCosmetic(data);
          return;
        }
        local = data;
        setState({ status: "ready", data });
      },
      (err: unknown) => {
        if (cancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ status: "error", error });
      }
    );

    return () => {
      cancelled = true;
      if (local) disposeLoadedCosmetic(local);
    };
  }, [
    urls.geo,
    urls.texture,
    urls.animation,
    urls.metadata,
    urls.metadataJson,
    urls.mcmeta,
    urls.mcmetaJson,
    config?.negateX,
    config?.armorOnly,
  ]);

  return state;
}
