import { createContext, useCallback, useContext, useEffect, useState } from "react";
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

const KEYWORD_LANGUAGE = "de";

export function useSettingsKeywords() {
  const { i18n } = useTranslation();
  const [keywordLanguageLoaded, setKeywordLanguageLoaded] = useState(() =>
    i18n.hasResourceBundle(KEYWORD_LANGUAGE, "translation"),
  );

  useEffect(() => {
    if (keywordLanguageLoaded) return;
    let active = true;
    i18n.loadLanguages(KEYWORD_LANGUAGE).then(() => {
      if (active) setKeywordLanguageLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [i18n, keywordLanguageLoaded]);

  return useCallback(
    (key: string, ...extra: string[]) => [
      i18n.getFixedT("en")(key),
      i18n.getFixedT(KEYWORD_LANGUAGE)(key),
      ...extra,
    ],
    [i18n, keywordLanguageLoaded],
  );
}
