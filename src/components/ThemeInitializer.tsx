"use client";

import { useEffect } from "react";
import { useThemeStore } from "../store/useThemeStore";
import { useLauncherTheme } from "../hooks/useLauncherTheme";

export function ThemeInitializer() {
  const applyAccentColorToDOM = useThemeStore(
    (state) => state.applyAccentColorToDOM,
  );
  const applyBorderRadiusToDOM = useThemeStore(
    (state) => state.applyBorderRadiusToDOM,
  );
  const applyFontFamilyToDOM = useThemeStore(
    (state) => state.applyFontFamilyToDOM,
  );
  useLauncherTheme();

  useEffect(() => {
    applyAccentColorToDOM();
    applyBorderRadiusToDOM();
    applyFontFamilyToDOM();
  }, [applyAccentColorToDOM, applyBorderRadiusToDOM, applyFontFamilyToDOM]);

  return null;
}
