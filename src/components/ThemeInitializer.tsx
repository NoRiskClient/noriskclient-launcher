"use client";

import { useEffect } from "react";
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
  useLauncherTheme();

  useEffect(() => {
    applyAccentColorToDOM();
    applyBorderRadiusToDOM();
    applyFontToDOM();
  }, [applyAccentColorToDOM, applyBorderRadiusToDOM, applyFontToDOM]);

  return null;
}
