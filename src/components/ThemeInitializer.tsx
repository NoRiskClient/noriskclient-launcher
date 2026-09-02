"use client";

import { useEffect, useRef } from "react";
import { useThemeStore } from "../store/useThemeStore";
import { useFontStore } from "../store/font-store";
import { useLauncherTheme } from "../hooks/useLauncherTheme";

export function ThemeInitializer() {
  const applyAccentColorToDOM = useThemeStore(
    (state) => state.applyAccentColorToDOM,
  );
  const applyBorderRadiusToDOM = useThemeStore(
    (state) => state.applyBorderRadiusToDOM,
  );
  const applyFontToDOM = useFontStore((state) => state.applyFontToDOM);
  const applyUIStylePresetToDOM = useThemeStore(
    (state) => state.applyUIStylePresetToDOM,
  );
  const uiStylePreset = useThemeStore((state) => state.uiStylePreset);
  const initialPresetRef = useRef(true);
  useLauncherTheme();

  useEffect(() => {
    applyAccentColorToDOM();
    applyBorderRadiusToDOM();
    applyFontToDOM();
    applyUIStylePresetToDOM();
  }, [
    applyAccentColorToDOM,
    applyBorderRadiusToDOM,
    applyFontToDOM,
    applyUIStylePresetToDOM,
  ]);

  useEffect(() => {
    if (initialPresetRef.current || uiStylePreset !== "fullrisk") {
      document.documentElement.classList.remove("theme-switching");
      initialPresetRef.current = false;
      return;
    }

    document.documentElement.classList.add("theme-switching");
    const timeout = window.setTimeout(() => {
      document.documentElement.classList.remove("theme-switching");
    }, 320);

    return () => window.clearTimeout(timeout);
  }, [uiStylePreset]);

  return null;
}
