"use client";

/**
 * EditableChipV3 — Inline-edit chip built on top of `ThemedDropdown` so it
 * inherits the V3 accent-tinted popover recipe used everywhere else
 * (Filter/Sort/NoriskPack/Version dropdowns in LocalContentTabV3).
 *
 * Visually identical to the local `Chip` atom in ProfileDetailViewV3 plus:
 *  · hover pen-icon + subtle white/10 bg when active
 *  · click → ThemedDropdown panel (accent-blur shell)
 *  · optional Save/Cancel footer for text-editors (disable for list-pickers
 *    that commit on click)
 *  · `onOpen` fires once when the popover opens — used for lazy-fetching
 *    picker data on demand instead of on mount
 */

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../../../store/useThemeStore";
import { ThemedDropdown } from "../shared/ThemedDropdown";

interface EditableChipV3Props {
  icon?: string;
  children: React.ReactNode;
  renderEditor: (ctx: { close: () => void; commit: () => void }) => React.ReactNode;
  onSave?: () => void;
  onCancel?: () => void;
  onOpen?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  /** Render Save/Cancel footer. Default true. Set false for list-pickers. */
  withSaveCancel?: boolean;
  /** Tailwind width class understood by `ThemedDropdown` (w-48 … w-72). */
  width?: string;
}

export function EditableChipV3({
  icon,
  children,
  renderEditor,
  onSave,
  onCancel,
  onOpen,
  disabled,
  disabledReason,
  withSaveCancel = true,
  width = "w-56",
}: EditableChipV3Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const accent = useThemeStore((s) => s.accentColor);

  // Fire onOpen exactly when the popover transitions closed → open
  useEffect(() => {
    if (open) onOpen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = () => {
    onSave?.();
    setOpen(false);
  };

  const close = () => {
    setOpen(false);
    onCancel?.();
  };

  return (
    <div className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        title={disabled ? disabledReason : undefined}
        className={`group inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-minecraft-ten transition-colors
          ${disabled
            ? "bg-black/20 border-white/5 text-white/30 cursor-not-allowed"
            : open
              ? "bg-black/40 border-white/25 text-white cursor-pointer"
              : "bg-black/30 border-white/10 text-white/75 hover:bg-black/40 hover:border-white/20 hover:text-white cursor-pointer"}`}
      >
        {icon && <Icon icon={icon} className="w-4 h-4 flex-shrink-0" />}
        <span>{children}</span>
        {disabled ? (
          <Icon icon="solar:lock-keyhole-minimalistic-bold" className="w-3.5 h-3.5 text-white/30 ml-0.5 flex-shrink-0" />
        ) : (
          <Icon
            icon="solar:pen-linear"
            className={`w-3.5 h-3.5 ml-0.5 flex-shrink-0 transition-opacity ${
              open ? "opacity-80" : "opacity-40 group-hover:opacity-80"
            }`}
          />
        )}
      </button>

      <ThemedDropdown
        open={open && !disabled}
        onClose={close}
        width={width}
        align="left"
        triggerRef={triggerRef}
      >
        {renderEditor({ close, commit })}
        {withSaveCancel && (
          <>
            <div className="my-1 border-t border-white/10" />
            <div className="flex items-center justify-end gap-1 px-2 py-1">
              <button
                onClick={close}
                className="px-2.5 py-1 rounded text-[10px] uppercase tracking-wider font-minecraft-ten text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                {t("profiles.v3.chips.cancel")}
              </button>
              <button
                onClick={commit}
                style={{
                  backgroundColor: `${accent.value}40`,
                  borderColor: `${accent.value}80`,
                  color: accent.light,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${accent.value}66`; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${accent.value}40`; }}
                className="px-2.5 py-1 rounded border text-[10px] uppercase tracking-wider font-minecraft-ten transition-colors"
              >
                {t("profiles.v3.chips.save")}
              </button>
            </div>
          </>
        )}
      </ThemedDropdown>
    </div>
  );
}
