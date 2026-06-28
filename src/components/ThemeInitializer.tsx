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
  useLauncherTheme();

  useEffect(() => {
    applyAccentColorToDOM();
    applyBorderRadiusToDOM();
  }, [applyAccentColorToDOM, applyBorderRadiusToDOM]);

  return null;
}
