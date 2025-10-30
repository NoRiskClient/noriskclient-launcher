"use client";

import { useEffect } from "react";
import { useThemeStore } from "../store/useThemeStore";

export function ThemeInitializer() {
  const applyAccentColorToDOM = useThemeStore(
    (state) => state.applyAccentColorToDOM,
  );
  const applyBorderRadiusToDOM = useThemeStore(
    (state) => state.applyBorderRadiusToDOM,
  );

  // Apply custom CSS/themes saved in localStorage. This mirrors the logic
  // used in SettingsTab so themes that are enabled there are applied on startup.
  const applyCustomCss = (css: string) => {
    try {
      const id = "nr-custom-css";
      let style = document.getElementById(id) as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement("style");
        style.id = id;
        document.head.appendChild(style);
      }
      style.innerHTML = css || "";
    } catch (err) {
      // swallow - not critical
      // eslint-disable-next-line no-console
      console.error("Failed to apply custom CSS on init:", err);
    }
  };

  useEffect(() => {
    applyAccentColorToDOM();
    applyBorderRadiusToDOM();

    try {
      // Load themes stored under 'nr_themes' (array of ThemeEntry) and apply enabled ones
      const raw = localStorage.getItem("nr_themes") || "[]";
      let enabledCss = "";
      try {
        const parsed = JSON.parse(raw || "[]");
        if (Array.isArray(parsed)) {
          enabledCss = parsed.filter((t: any) => t && t.enabled).map((t: any) => t.content || "").join("\n\n");
        }
      } catch (err) {
        // ignore JSON errors
      }

      // Fall back to single custom CSS stored under 'nr_custom_css'
      if (!enabledCss) {
        const saved = localStorage.getItem("nr_custom_css");
        if (saved) enabledCss = saved;
      }

      if (enabledCss) {
        applyCustomCss(enabledCss);
      }
    } catch (err) {
      // ignore failures related to localStorage or DOM
      // eslint-disable-next-line no-console
      console.error("Failed to initialize themes from storage:", err);
    }
  }, [applyAccentColorToDOM, applyBorderRadiusToDOM]);

  return null;
}
