import { useEffect, useState } from "react";

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { EmoteAssetUrls } from "@noriskclient/nrc-skin-renderer/core";

import type { EmoteAssetUrlsDto } from "../types/cosmetic";

type EmoteKind = "randomLocal" | "special" | "calm";

// Relative weights, rolled once per launcher open. Don't need to sum to 100 —
// the pick is proportional to the weights.
const PROBABILITY: Record<EmoteKind, number> = {
  randomLocal: 20,
  special: 10,
  calm: 70,
};

const CALM_IDLES = [
  "/emotes/launcheridle.animation.json",
  "/emotes/launcheridle2.animation.json",
];
const SPECIAL_IDLE = "/emotes/launcheridle3.animation.json";

const LAST_IDLE_KEY = "nrc-launcher-last-idle";

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function rollKind(): EmoteKind {
  const entries = Object.entries(PROBABILITY) as [EmoteKind, number][];
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  if (total <= 0) return "calm";
  let r = Math.random() * total;
  for (const [kind, weight] of entries) {
    r -= Math.max(0, weight);
    if (r < 0) return kind;
  }
  return "calm";
}

function pickCalm(): string {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_IDLE_KEY);
  } catch {
    last = null;
  }
  const pool = CALM_IDLES.filter((u) => u !== last);
  const choices = pool.length > 0 ? pool : CALM_IDLES;
  const pick = choices[Math.floor(Math.random() * choices.length)];
  write(LAST_IDLE_KEY, pick);
  return pick;
}

function assetUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  return /^https?:\/\//.test(u) ? u : convertFileSrc(u);
}

async function pickRandomLocalEmote(): Promise<EmoteAssetUrls | null> {
  try {
    const dto = await invoke<EmoteAssetUrlsDto | null>("get_random_local_emote");
    if (!dto) return null;
    return {
      animation: assetUrl(dto.animation)!,
      geo: assetUrl(dto.geo),
      texture: assetUrl(dto.texture),
      mcmeta: assetUrl(dto.mcmeta),
    };
  } catch {
    return null;
  }
}

async function decideEmote(): Promise<EmoteAssetUrls> {
  const kind = rollKind();
  if (kind === "randomLocal") {
    const local = await pickRandomLocalEmote();
    if (local) return local;
  }
  if (kind === "special") return { animation: SPECIAL_IDLE };
  return { animation: pickCalm() };
}

let sessionEmote: EmoteAssetUrls | null = null;
let sessionPromise: Promise<EmoteAssetUrls> | null = null;

export function useIdleEmote(): EmoteAssetUrls | null {
  const [emote, setEmote] = useState<EmoteAssetUrls | null>(sessionEmote);
  useEffect(() => {
    if (sessionEmote) {
      setEmote(sessionEmote);
      return;
    }
    let alive = true;
    if (!sessionPromise) sessionPromise = decideEmote();
    sessionPromise.then((e) => {
      sessionEmote = e;
      if (alive) setEmote(e);
    });
    return () => {
      alive = false;
    };
  }, []);
  return emote;
}
