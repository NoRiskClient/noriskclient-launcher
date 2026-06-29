import { useEffect, useState } from "react";

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { EmoteAssetUrls } from "@noriskclient/nrc-skin-renderer/core";

// Percent chance (0-100), rolled once per launcher open: play a random
// downloaded cosmetic emote instead of a launcher idle.
const RANDOM_LOCAL_EMOTE_CHANCE = 20;

const CALM_IDLES = [
  "/emotes/launcheridle.animation.json",
  "/emotes/launcheridle2.animation.json",
];
const SPECIAL_IDLE = "/emotes/launcheridle3.animation.json";

const SPECIAL_MIN = 25;
const SPECIAL_MAX = 50;

const OPEN_COUNT_KEY = "nrc-launcher-open-count";
const NEXT_SPECIAL_KEY = "nrc-launcher-next-special";
const LAST_IDLE_KEY = "nrc-launcher-last-idle";

interface LocalCosmetic {
  id: string;
  cosmetic_type: string;
  slug: string;
  geo_path?: string | null;
  animation_path?: string | null;
  texture_path?: string | null;
  mcmeta_path?: string | null;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function readInt(key: string): number {
  try {
    return Number.parseInt(localStorage.getItem(key) ?? "0", 10) || 0;
  } catch {
    return 0;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function computeSpecialThisOpen(): boolean {
  const count = readInt(OPEN_COUNT_KEY) + 1;
  write(OPEN_COUNT_KEY, String(count));

  let next = readInt(NEXT_SPECIAL_KEY);
  if (next <= 0) {
    write(NEXT_SPECIAL_KEY, String(count + randInt(SPECIAL_MIN, SPECIAL_MAX)));
    return false;
  }
  if (count >= next) {
    write(NEXT_SPECIAL_KEY, String(count + randInt(SPECIAL_MIN, SPECIAL_MAX)));
    return true;
  }
  return false;
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
    const all = await invoke<LocalCosmetic[]>("get_local_cosmetics");
    const emotes = all.filter((c) => c.cosmetic_type === "emote" && c.animation_path);
    if (emotes.length === 0) return null;
    const pick = emotes[Math.floor(Math.random() * emotes.length)];
    return {
      animation: assetUrl(pick.animation_path)!,
      geo: assetUrl(pick.geo_path),
      texture: assetUrl(pick.texture_path),
      mcmeta: assetUrl(pick.mcmeta_path),
    };
  } catch {
    return null;
  }
}

async function decideEmote(): Promise<EmoteAssetUrls> {
  if (Math.random() * 100 < RANDOM_LOCAL_EMOTE_CHANCE) {
    const local = await pickRandomLocalEmote();
    if (local) return local;
  }
  if (computeSpecialThisOpen()) return { animation: SPECIAL_IDLE };
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
