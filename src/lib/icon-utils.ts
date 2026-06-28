import { loadIcons as iconifyLoadIcons } from "@iconify/react";

export function preloadIcons(iconNames: string[]): void {
  if (iconNames.length === 0) return;
  iconifyLoadIcons(iconNames);
}
