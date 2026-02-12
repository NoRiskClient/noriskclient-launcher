import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./translations/en.json";
import de from "./translations/de.json";
import pl from "./translations/pl.json";
import fr from "./translations/fr.json";
import it from "./translations/it.json";
import tr from "./translations/tr.json";
import pt from "./translations/pt.json";
import es from "./translations/es.json";
import ru from "./translations/ru.json";

export const SUPPORTED_LANGUAGES = ["en", "de", "pl", "fr", "it", "tr", "pt", "es", "ru"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_OPTIONS: {
  value: SupportedLanguage;
  label: string;
  flag: string;
}[] = [
  { value: "en", label: "English", flag: "circle-flags:gb" },
  { value: "de", label: "Deutsch", flag: "circle-flags:de" },
  { value: "pl", label: "Polski", flag: "circle-flags:pl" },
  { value: "fr", label: "Français", flag: "circle-flags:fr" },
  { value: "it", label: "Italiano", flag: "circle-flags:it" },
  { value: "tr", label: "Türkçe", flag: "circle-flags:tr" },
  { value: "pt", label: "Português", flag: "circle-flags:pt" },
  { value: "es", label: "Español", flag: "circle-flags:es" },
  { value: "ru", label: "Русский", flag: "circle-flags:ru" },
];

/**
 * Detect system language and map to a supported language.
 * e.g. "de-AT" → "de", "en-US" → "en"
 */
function getSystemLanguage(): SupportedLanguage {
  try {
    const browserLang = navigator.language || navigator.languages?.[0];
    if (browserLang) {
      // Try exact match first (e.g. "de")
      const exact = browserLang.toLowerCase() as SupportedLanguage;
      if ((SUPPORTED_LANGUAGES as readonly string[]).includes(exact)) {
        return exact as SupportedLanguage;
      }
      // Try base language (e.g. "de-AT" → "de")
      const base = browserLang.split("-")[0].toLowerCase();
      if ((SUPPORTED_LANGUAGES as readonly string[]).includes(base)) {
        return base as SupportedLanguage;
      }
    }
  } catch {
    // ignore
  }
  return "en";
}

function getStoredLanguage(): SupportedLanguage {
  try {
    const raw = localStorage.getItem("norisk-theme-storage");
    if (raw) {
      const parsed = JSON.parse(raw);
      const lang = parsed?.state?.language;
      if (lang && (SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) {
        return lang as SupportedLanguage;
      }
    }
  } catch {
    // ignore parse errors
  }
  // No stored preference — use system language
  return getSystemLanguage();
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
    pl: { translation: pl },
    fr: { translation: fr },
    it: { translation: it },
    tr: { translation: tr },
    pt: { translation: pt },
    es: { translation: es },
    ru: { translation: ru },
  },
  lng: getStoredLanguage(),
  fallbackLng: "en",
  supportedLngs: [...SUPPORTED_LANGUAGES],
  ns: ["translation"],
  defaultNS: "translation",
  interpolation: {
    escapeValue: false, // React handles XSS
  },
  react: {
    useSuspense: false, // Multi-window compatibility
  },
});

// Cross-window language sync via localStorage events
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === "norisk-theme-storage" && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        const lang = parsed?.state?.language;
        if (
          lang &&
          SUPPORTED_LANGUAGES.includes(lang) &&
          lang !== i18n.language
        ) {
          i18n.changeLanguage(lang);
        }
      } catch {
        // ignore
      }
    }
  });
}

export default i18n;
