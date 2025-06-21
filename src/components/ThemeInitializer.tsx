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

  useEffect(() => {
    applyAccentColorToDOM();
    applyBorderRadiusToDOM();
  }, [applyAccentColorToDOM, applyBorderRadiusToDOM]);

  return null;
}
