"use client";

import { useEffect, useState } from "react";

import {
  disposeLoadedEmote,
  loadEmote,
  type EmoteAssetUrls,
  type EmoteRenderConfig,
  type LoadedEmote,
} from "../core/loadEmote";

export type EmoteState =
  | { status: "loading" }
  | { status: "ready"; data: LoadedEmote }
  | { status: "error"; error: Error };

/**
 * Load an emote from an `EmoteAssetUrls` bundle.
 *
 * Stable-reference the `urls`/`config` (e.g. `useMemo`) so the effect doesn't
 * fire on every parent render. The loaded emote is disposed when inputs
 * change or the component unmounts — owners must not retain references past
 * unmount, since the prop's GPU resources are released.
 */
export function useEmote(
  urls: EmoteAssetUrls,
  config?: EmoteRenderConfig
): EmoteState {
  const [state, setState] = useState<EmoteState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let local: LoadedEmote | null = null;
    setState({ status: "loading" });

    loadEmote(urls, config).then(
      (data) => {
        if (cancelled) {
          disposeLoadedEmote(data);
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
      if (local) disposeLoadedEmote(local);
    };
  }, [urls.animation, urls.geo, urls.texture, urls.mcmeta, config?.negateX]);

  return state;
}
