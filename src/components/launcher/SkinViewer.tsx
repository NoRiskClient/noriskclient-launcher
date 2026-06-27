"use client";

import React, { useEffect, useState } from "react";
import { cn } from "../../lib/utils";

const DEFAULT_RENDERED_SKIN_URL = "/skins/default_steve_full.png";

interface SkinViewerProps {
  skinUrl: string; // This will now be the direct URL (file:// or http:// or /path)
  playerName?: string;
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function SkinViewer({
  skinUrl, // Directly use this prop
  playerName,
  width = 300,
  height = 400,
  className,
  style,
}: SkinViewerProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  // Reset error state if skinUrl changes, to allow retrying if a new valid URL is provided
  useEffect(() => {
    setFailedUrl(null);
  }, [skinUrl]);

  const displaySkinUrl =
    skinUrl && failedUrl !== skinUrl ? skinUrl : DEFAULT_RENDERED_SKIN_URL;
  const hasFallbackFailed = failedUrl === DEFAULT_RENDERED_SKIN_URL;

  const handleError = () => {
    console.warn(
      `[SkinViewer] Error loading image from skinUrl: ${displaySkinUrl}`,
    );
    setFailedUrl(displaySkinUrl);
  };

  if (hasFallbackFailed) {
    // Show placeholder only if both the requested render and default fallback fail.
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-gray-700/50 rounded-md",
          className,
        )}
        style={{ width, height, ...style }}
      >
        <span className="text-gray-500 text-3xl">?</span>
      </div>
    );
  }

  return (
    <img
      src={displaySkinUrl}
      alt={playerName ? `${playerName}'s Skin` : "Minecraft Skin"}
      width={width}
      height={height}
      className={cn("object-contain rounded-md select-none", className)}
      style={{
        imageRendering: "pixelated",
        userSelect: "none",
        ...style,
      }}
      draggable={false}
      onError={handleError}
    />
  );
}
