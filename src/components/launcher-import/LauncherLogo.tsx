"use client";

import { Icon } from "@iconify/react";

import { launcherIcon } from "../../lib/launcher-meta";
import { useThemeStore } from "../../store/useThemeStore";
import type { ExternalLauncherId } from "../../types/launcherImport";

interface LauncherLogoProps {
  launcher: ExternalLauncherId;
  size?: "sm" | "md";
  className?: string;
}

export function LauncherLogo({ launcher, size = "md", className = "" }: LauncherLogoProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const box = size === "sm" ? "h-8 w-8" : "h-11 w-11";

  return (
    <div
      className={`${box} flex flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border ${className}`}
      style={{
        backgroundColor: `${accentColor.value}1a`,
        borderColor: `${accentColor.value}4d`,
      }}
    >
      <Icon
        icon={launcherIcon(launcher)}
        className="h-1/2 w-1/2"
        style={{ color: accentColor.value }}
      />
    </div>
  );
}
