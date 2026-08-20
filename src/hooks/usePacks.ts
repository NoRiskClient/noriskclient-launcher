import { useEffect, useState } from "react";
import * as ProfileService from "../services/profile-service";
import type { Packs } from "../utils/pack-listing";
import { logError } from "../utils/logging-utils";

let cache: Packs | null = null;
let inFlight: Promise<Packs> | null = null;

export function loadPacks(): Promise<Packs> {
  if (cache) return Promise.resolve(cache);
  if (!inFlight) {
    inFlight = ProfileService.getNoriskPacksResolved()
      .then((config) => {
        cache = config?.packs ?? {};
        return cache;
      })
      .catch((err) => {
        logError(`Failed to load NoRisk packs: ${err}`);
        return {} as Packs;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function usePacks(): { packs: Packs; loading: boolean } {
  const [packs, setPacks] = useState<Packs>(() => cache ?? {});
  const [loading, setLoading] = useState(() => cache === null);

  useEffect(() => {
    if (cache) return;
    let active = true;
    loadPacks().then((p) => {
      if (!active) return;
      setPacks(p);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  return { packs, loading };
}
