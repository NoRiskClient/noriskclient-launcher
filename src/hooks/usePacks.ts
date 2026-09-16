import { useEffect, useMemo, useState } from "react";
import * as ProfileService from "../services/profile-service";
import { PERMISSION } from "../constants/permissions";
import { usePermission } from "./usePermission";
import { hasPermission } from "../services/permission-service";
import { DEV_PACK_PREFIX, visiblePacks, type Packs } from "../utils/pack-listing";
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
  const staff = usePermission(PERMISSION.STAFF);
  const [granted, setGranted] = useState<ReadonlySet<string>>(new Set());

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

  useEffect(() => {
    const devPacks = staff ? [] : Object.keys(packs).filter((id) => id.startsWith(DEV_PACK_PREFIX));
    if (devPacks.length === 0) return;
    let active = true;
    Promise.all(devPacks.map((id) =>
      hasPermission(PERMISSION.DEV_PACK + id.slice(DEV_PACK_PREFIX.length))
        .then((ok) => (ok ? id : null))
        .catch(() => null),
    )).then((ids) => {
      if (active) setGranted(new Set(ids.filter((id) => id !== null)));
    });
    return () => { active = false; };
  }, [packs, staff]);

  const allowed = useMemo(() => visiblePacks(packs, staff, granted), [packs, staff, granted]);

  return { packs: allowed, loading };
}
