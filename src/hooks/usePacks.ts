import { useEffect, useMemo, useState } from "react";
import * as ProfileService from "../services/profile-service";
import { PERMISSION } from "../constants/permissions";
import { usePermissionStore } from "../store/permission-store";
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
  const revision = usePermissionStore((s) => s.revision);
  const [allowedDevPacks, setAllowedDevPacks] = useState<ReadonlySet<string>>(new Set());

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
    const devPacks = Object.keys(packs).filter((id) => id.startsWith(DEV_PACK_PREFIX));
    let active = true;
    const mayView = (id: string) =>
      hasPermission(PERMISSION.DEV_PACK + id.slice(DEV_PACK_PREFIX.length)).catch(() => false);
    hasPermission(PERMISSION.STAFF)
      .catch(() => false)
      .then(async (staff) => {
        const checks = await Promise.all(devPacks.map(async (id) => (staff || (await mayView(id)) ? id : null)));
        if (active) setAllowedDevPacks(new Set(checks.filter((id) => id !== null)));
      });
    return () => { active = false; };
  }, [packs, revision]);

  const allowed = useMemo(() => visiblePacks(packs, allowedDevPacks), [packs, allowedDevPacks]);

  return { packs: allowed, loading };
}
