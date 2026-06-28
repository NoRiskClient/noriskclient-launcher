"use client";

/**
 * LoaderPickerV3 — presentational picker for the mod loader type.
 *
 * Fixed 5-option set (vanilla + 4 loaders). Click = commit.
 */

import { Icon } from "@iconify/react";
import { useThemeStore } from "../../../../store/useThemeStore";
import type { LoaderKey } from "./useHeroChipEditors";

interface LoaderOption {
  key: LoaderKey;
  icon: string;
  name: string;
}

const LOADERS: LoaderOption[] = [
  { key: "vanilla",  icon: "/icons/minecraft.png", name: "Vanilla" },
  { key: "fabric",   icon: "/icons/fabric.png",    name: "Fabric" },
  { key: "forge",    icon: "/icons/forge.png",     name: "Forge" },
  { key: "quilt",    icon: "/icons/quilt.png",     name: "Quilt" },
  { key: "neoforge", icon: "/icons/neoforge.png",  name: "NeoForge" },
];

interface LoaderPickerV3Props {
  currentLoader: string | null | undefined;
  onSelect: (loader: LoaderKey) => void;
}

export function LoaderPickerV3({ currentLoader, onSelect }: LoaderPickerV3Props) {
  const accent = useThemeStore((s) => s.accentColor);
  const normalized = (currentLoader ?? "vanilla").toLowerCase();

  return (
    <div className="py-1">
      {LOADERS.map((l) => {
        const isCurrent = l.key === normalized;
        return (
          <button
            key={l.key}
            onClick={() => onSelect(l.key)}
            style={isCurrent ? { backgroundColor: `${accent.value}33` } : undefined}
            onMouseEnter={(e) => {
              if (!isCurrent) e.currentTarget.style.backgroundColor = `${accent.value}40`;
            }}
            onMouseLeave={(e) => {
              if (!isCurrent) e.currentTarget.style.backgroundColor = "transparent";
            }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors"
          >
            <img
              src={l.icon}
              alt={l.name}
              className="w-4 h-4 flex-shrink-0"
              style={{ imageRendering: l.key === "vanilla" ? "pixelated" : undefined }}
            />
            <span className={`flex-1 text-xs font-minecraft-ten ${isCurrent ? "text-white" : "text-white/85"}`}>
              {l.name}
            </span>
            {isCurrent && (
              <Icon
                icon="solar:check-circle-bold"
                className="w-3.5 h-3.5 flex-shrink-0"
                style={{ color: accent.light }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
