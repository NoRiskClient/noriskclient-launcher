import { useCallback, useEffect, useRef, useState } from "react";

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

export interface IdleEmote {
  urls: EmoteAssetUrls | null;
  // false = play once, then `onEnd` should swap to a calm idle.
  loop: boolean;
  onEnd: () => void;
}

interface EmotePlan {
  // First emote of the session; `rest` (a calm idle, looping) takes over after
  // the one-shot finishes. rest === null means `first` already loops.
  first: EmoteAssetUrls;
  rest: EmoteAssetUrls | null;
}

const calmPlan = (): EmotePlan => ({ first: { animation: pickCalm() }, rest: null });

async function buildPlan(): Promise<EmotePlan> {
  const kind = rollKind();
  let first: EmoteAssetUrls | null = null;
  if (kind === "randomLocal") first = await pickRandomLocalEmote();
  else if (kind === "special") first = { animation: SPECIAL_IDLE };

  if (!first) return calmPlan();
  return { first, rest: { animation: pickCalm() } };
}

let planPromise: Promise<EmotePlan> | null = null;
// Set once the one-shot has played out; later mounts skip straight to calm.
let restingEmote: EmoteAssetUrls | null = null;

export function useIdleEmote(): IdleEmote {
  const [emote, setEmote] = useState<{ urls: EmoteAssetUrls | null; loop: boolean }>(
    restingEmote ? { urls: restingEmote, loop: true } : { urls: null, loop: true },
  );
  const restRef = useRef<EmoteAssetUrls | null>(null);

  useEffect(() => {
    if (restingEmote) {
      setEmote({ urls: restingEmote, loop: true });
      return;
    }
    let alive = true;
    if (!planPromise) planPromise = buildPlan();
    planPromise.then((plan) => {
      if (!alive) return;
      if (!plan.rest) {
        restingEmote = plan.first;
        setEmote({ urls: plan.first, loop: true });
      } else {
        restRef.current = plan.rest;
        setEmote({ urls: plan.first, loop: false });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const onEnd = useCallback(() => {
    const rest = restRef.current;
    if (!rest) return;
    restingEmote = rest;
    setEmote({ urls: rest, loop: true });
  }, []);

  return { urls: emote.urls, loop: emote.loop, onEnd };
}
