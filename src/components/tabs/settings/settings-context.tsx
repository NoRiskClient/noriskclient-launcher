"use client";

import { createContext, useCallback, useContext } from "react";
import { useTranslation } from "react-i18next";
import type { LauncherConfig } from "../../../types/launcherConfig";

interface SettingsConfigValue {
  config: LauncherConfig | null;
  tempConfig: LauncherConfig | null;
  setTempConfig: (config: LauncherConfig) => void;
  saving: boolean;
}

const SettingsConfigContext = createContext<SettingsConfigValue | null>(null);

export const SettingsConfigProvider = SettingsConfigContext.Provider;

export function useSettingsConfig(): SettingsConfigValue {
  const ctx = useContext(SettingsConfigContext);
  if (!ctx) throw new Error("useSettingsConfig must be used within SettingsConfigProvider");
  return ctx;
}

export function useSettingsKeywords() {
  const { i18n } = useTranslation();
  return useCallback(
    (key: string, ...extra: string[]) => [
      i18n.getFixedT("en")(key),
      i18n.getFixedT("de")(key),
      ...extra,
    ],
    [i18n],
  );
}
