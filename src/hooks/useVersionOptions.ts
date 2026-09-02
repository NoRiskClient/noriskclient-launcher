"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import UnifiedService from "../services/unified-service";
import type { ModPlatform, UnifiedVersion } from "../types/unified";

export interface VersionQuery {
  platform: ModPlatform;
  projectId: string;
  loaders?: string[];
  gameVersions?: string[];
}

export function useVersionOptions() {
  const { t } = useTranslation();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, UnifiedVersion[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const close = useCallback(() => setOpenKey(null), []);

  const toggle = useCallback(
    async (key: string, query: VersionQuery | null) => {
      const willOpen = openKey !== key;
      setOpenKey(willOpen ? key : null);
      if (!willOpen) return;

      if (!query) {
        setErrors((prev) => ({
          ...prev,
          [key]: t("profiles.v3.versions.noProject"),
        }));
        return;
      }
      if (cache[key]) return;

      setLoading((prev) => ({ ...prev, [key]: true }));
      setErrors((prev) => ({ ...prev, [key]: null }));
      try {
        const response = await UnifiedService.getModVersions({
          source: query.platform,
          project_id: query.projectId,
          loaders: query.loaders,
          game_versions: query.gameVersions,
        });
        setCache((prev) => ({ ...prev, [key]: response.versions }));
      } catch (err) {
        console.error("Failed to load versions:", err);
        setErrors((prev) => ({
          ...prev,
          [key]: t("profiles.v3.versions.loadFailed"),
        }));
      } finally {
        setLoading((prev) => ({ ...prev, [key]: false }));
      }
    },
    [cache, openKey, t],
  );

  const invalidate = useCallback((key: string) => {
    setCache((prev) => {
      const { [key]: _dropped, ...rest } = prev;
      return rest;
    });
  }, []);

  return {
    openKey,
    close,
    toggle,
    invalidate,
    versionsFor: (key: string) => cache[key] ?? null,
    loadingFor: (key: string) => !!loading[key],
    errorFor: (key: string) => errors[key] ?? null,
  };
}
