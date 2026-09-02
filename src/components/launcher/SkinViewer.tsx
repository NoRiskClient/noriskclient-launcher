"use client";

import React, { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";

const FALLBACK_SKIN_URL = "/skins/default_steve_full.png";

interface SkinViewerProps {
  skinUrl: string; // This will now be the direct URL (file:// or http:// or /path)
  playerName?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  fallbackUrl?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function SkinViewer({
  skinUrl, // Directly use this prop
  playerName,
  width = 300,
  height = 400,
  fill = false,
  fallbackUrl = FALLBACK_SKIN_URL,
  className,
  style,
}: SkinViewerProps) {
  const [hasError, setHasError] = useState(false);
  const uiStylePreset = useThemeStore((state) => state.uiStylePreset);
  const isFullRiskStyle = uiStylePreset === "fullrisk";

  // Reset error state if skinUrl changes, to allow retrying if a new valid URL is provided
  useEffect(() => {
    setHasError(false);
  }, [skinUrl]);

  const fillStyle: React.CSSProperties = fill
    ? { height: "100%", width: "auto", maxWidth: "none" }
    : {};

  const handleError = () => {
    console.warn(`[SkinViewer] Error loading image from skinUrl: ${skinUrl}`);
    setHasError(true);
  };

  if (hasError || !skinUrl) {
    return (
      <img
        src={fallbackUrl}
        alt={playerName ? `${playerName}'s Skin` : "Minecraft Skin"}
        width={width}
        height={height}
        className={cn("object-contain rounded-md select-none", className)}
        style={{
          imageRendering: "pixelated",
          userSelect: "none",
          ...fillStyle,
          ...style,
        }}
        draggable={false}
      />
    );
  }

  return (
    <img
      src={skinUrl}
      alt={playerName ? `${playerName}'s Skin` : "Minecraft Skin"}
      width={width}
      height={height}
      className={cn("object-contain rounded-md select-none", className)}
      style={{
        imageRendering: "pixelated",
        userSelect: "none",
        transform: isFullRiskStyle ? "translateY(10px)" : undefined,
        ...fillStyle,
        ...style,
      }}
      draggable={false}
      onError={handleError}
    />
  );
}
