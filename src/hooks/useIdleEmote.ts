import { useMemo } from "react";

import type { EmoteAssetUrls } from "../lib/cosmetic-renderer/core";

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

let sessionDecided = false;
let specialThisOpen = false;
let specialConsumed = false;

export function useIdleEmote(): EmoteAssetUrls | null {
  return useMemo(() => {
    if (!sessionDecided) {
      sessionDecided = true;
      specialThisOpen = computeSpecialThisOpen();
    }
    if (specialThisOpen && !specialConsumed) {
      specialConsumed = true;
      return { animation: SPECIAL_IDLE };
    }
    return { animation: pickCalm() };
  }, []);
}
