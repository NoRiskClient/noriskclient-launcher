"use client";

import { useEffect } from "react";
import { useThemeStore } from "../../store/useThemeStore";
import { getVariantColors } from "./design-system";

export function ScrollbarProvider() {
  const accentColor = useThemeStore((state) => state.accentColor);
  const borderRadius = useThemeStore((state) => state.borderRadius);

  useEffect(() => {
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? `${Number.parseInt(result[1], 16)}, ${Number.parseInt(result[2], 16)}, ${Number.parseInt(result[3], 16)}`
        : null;
    };

    const colors = getVariantColors("default", accentColor);
    const root = document.documentElement;
    
    root.style.setProperty("--scrollbar-thumb-color", colors.main);
    root.style.setProperty("--scrollbar-thumb-hover-color", colors.light);
    root.style.setProperty("--scrollbar-radius", `${Math.max(2, Math.round(borderRadius * 0.5))}px`);

    const rgbValue = hexToRgb(colors.main);
    if (rgbValue) {
      root.style.setProperty("--scrollbar-thumb-rgb", rgbValue);
    }
  }, [accentColor, borderRadius]);

  return null;
}
