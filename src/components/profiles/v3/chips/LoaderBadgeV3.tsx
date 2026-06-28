"use client";

/**
 * LoaderBadgeV3 — the loader icon sitting on the bottom-right corner of the
 * profile picture, a clickable trigger for LoaderPickerV3. Frameless: the
 * icon itself is the affordance, with a strong drop-shadow for legibility
 * on any profile background. Hover scales it up, open state adds an accent
 * halo via `filter: drop-shadow`.
 *
 * Locked mode (for `is_standard_version`): small lock glyph overlayed at
 * the icon corner + no hover effects, click is suppressed.
 */

import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../../../store/useThemeStore";
import { ThemedDropdown } from "../shared/ThemedDropdown";
import { LoaderPickerV3 } from "./LoaderPickerV3";
import type { LoaderKey } from "./useHeroChipEditors";

interface LoaderBadgeV3Props {
  loader: string | null | undefined;
  onChange: (loader: LoaderKey) => void;
  disabled?: boolean;
  disabledReason?: string;
}

const ICON_MAP: Record<string, string> = {
  fabric:   "/icons/fabric.png",
  forge:    "/icons/forge.png",
  quilt:    "/icons/quilt.png",
  neoforge: "/icons/neoforge.png",
};

export function LoaderBadgeV3({ loader, onChange, disabled, disabledReason }: LoaderBadgeV3Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const accent = useThemeStore((s) => s.accentColor);

  const icon = ICON_MAP[loader ?? ""] ?? "/icons/minecraft.png";
  const label = loader ?? "vanilla";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        title={disabled ? disabledReason : t("profiles.v3.chips.loader.changeTitle")}
        className={`absolute -bottom-1 -right-1 p-0.5 flex items-center justify-center transition-transform
          ${disabled
            ? "cursor-not-allowed"
            : open
              ? "scale-110"
              : "hover:scale-110 cursor-pointer"}`}
      >
        <img
          src={icon}
          alt={label}
          className={`w-6 h-6 ${disabled ? "opacity-50" : ""}`}
          style={{
            imageRendering: !loader ? "pixelated" : undefined,
            // Legibility on any profile background: a tight dark shadow for
            // edge contrast + a soft diffuse fallback. On open we add a
            // themed accent glow on top.
            filter: !disabled && open
              ? `drop-shadow(0 1px 2px rgba(0,0,0,0.9)) drop-shadow(0 0 6px rgba(0,0,0,0.5)) drop-shadow(0 0 8px ${accent.shadowValue})`
              : "drop-shadow(0 1px 2px rgba(0,0,0,0.9)) drop-shadow(0 0 6px rgba(0,0,0,0.5))",
          }}
        />
        {disabled && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-black/90 flex items-center justify-center">
            <Icon icon="solar:lock-keyhole-minimalistic-bold" className="w-2 h-2 text-white/60" />
          </span>
        )}
      </button>

      <ThemedDropdown
        open={open && !disabled}
        onClose={() => setOpen(false)}
        width="w-56"
        align="left"
        triggerRef={triggerRef}
      >
        <LoaderPickerV3
          currentLoader={loader}
          onSelect={(l) => {
            onChange(l);
            setOpen(false);
          }}
        />
      </ThemedDropdown>
    </>
  );
}
