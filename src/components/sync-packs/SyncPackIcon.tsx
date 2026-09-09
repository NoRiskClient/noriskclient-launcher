"use client";

import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";
import { handleIconImgLoad } from "../profiles/IconPicker";
import { BLOCK_ICONS } from "../../data/block-icons";

function fallbackBlockUrl(packId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < packId.length; i++) {
    hash ^= packId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return BLOCK_ICONS[Math.abs(hash) % BLOCK_ICONS.length].url;
}

interface SyncPackIconProps {
  packId: string;
  icon: string | null;
  size?: "sm" | "md";
  className?: string;
}

export function SyncPackIcon({
  packId,
  icon,
  size = "md",
  className = "",
}: SyncPackIconProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const [failed, setFailed] = useState(false);

  const src = icon
    ? /^https?:\/\//i.test(icon)
      ? icon
      : convertFileSrc(icon)
    : fallbackBlockUrl(packId);

  useEffect(() => setFailed(false), [src]);

  const box = size === "sm" ? "h-8 w-8" : "h-11 w-11";

  return (
    <div
      className={`${box} flex flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border ${className}`}
      style={{
        backgroundColor: `${accentColor.value}1a`,
        borderColor: `${accentColor.value}4d`,
      }}
    >
      {failed ? (
        <Icon
          icon="solar:folder-with-files-bold"
          className="h-1/2 w-1/2"
          style={{ color: accentColor.value }}
        />
      ) : (
        <img
          src={src}
          alt=""
          onLoad={handleIconImgLoad}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}
