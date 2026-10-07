"use client";

import { useState, useRef, useEffect, useId } from "react";
import type { KeyboardEvent } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../store/useThemeStore";

export interface VersionFilterOption {
  value: string;
  count: number;
}

interface MultiVersionFilterProps {
  options: VersionFilterOption[];
  /** Currently selected version values. Empty = no filter (all shown). */
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  size?: "sm" | "md";
}

export function MultiVersionFilter({
  options,
  selected,
  onToggle,
  onClear,
  size = "md",
}: MultiVersionFilterProps) {
  const { t } = useTranslation();
  const isSm = size === "sm";
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const initialFocus = useRef<"first" | "last">("first");
  const menuId = useId();
  const accentColor = useThemeStore((state) => state.accentColor);

  const isActive = selected.length > 0;
  const optionValues = JSON.stringify(options.map((option) => option.value));
  const menuItems = () => [clearRef.current, ...optionRefs.current.slice(0, options.length)]
    .filter((item): item is HTMLButtonElement => item !== null);
  const close = (restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isOpen) return;
    const items = menuItems();
    (initialFocus.current === "last" ? items.at(-1) : items[0])?.focus();
    if (!items.length) menuRef.current?.focus();
    initialFocus.current = "first";
    const handleClickOutside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const handleFocusOutside = (event: FocusEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("focusin", handleFocusOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("focusin", handleFocusOutside);
    };
  }, [isOpen, optionValues]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      close(true);
      return;
    }
    const items = menuItems();
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      items[next]?.focus();
    }
    // Forward Tab follows document order; focusin outside dismisses without trapping it.
  };

  return (
    <div className="relative w-auto" ref={ref}>
      {/* Trigger button (icon-only, accent-tinted while a filter is active) */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("profiles.filter.title")}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-describedby={isActive ? `${menuId}-selected` : undefined}
        onClick={() => { initialFocus.current = "first"; setIsOpen(!isOpen); }}
        onKeyDown={(event) => {
          if (isOpen && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close(true);
            return;
          }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          event.stopPropagation();
          initialFocus.current = event.key === "ArrowUp" ? "last" : "first";
          if (isOpen) {
            const items = menuItems();
            (initialFocus.current === "last" ? items.at(-1) : items[0])?.focus();
          } else setIsOpen(true);
        }}
        className={`flex items-center gap-2 rounded-md px-2 py-1 text-white font-minecraft transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 ${
          isSm ? "text-sm" : "text-xl"
        }`}
        style={{
          boxShadow: isOpen ? `0 0 0 1px ${accentColor.value}40` : "none",
          backgroundColor: isActive ? `${accentColor.value}15` : "transparent",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = `${accentColor.value}25`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = isActive
            ? `${accentColor.value}15`
            : "transparent";
        }}
        title={isActive ? selected.join(", ") : t("profiles.filter.title")}
      >
        <Icon
          icon="solar:gamepad-bold"
          aria-hidden="true"
          className="w-4 h-4"
          style={{ color: isActive ? accentColor.value : "rgba(255, 255, 255, 0.7)" }}
        />
        {isActive && (
          <span
            aria-hidden="true"
            className="min-w-[1rem] text-center text-xs font-minecraft rounded-full px-1"
            style={{ backgroundColor: `${accentColor.value}30`, color: accentColor.value }}
          >
            {selected.length}
          </span>
        )}
      </button>
      {isActive && <span id={`${menuId}-selected`} className="sr-only">{selected.join(", ")}</span>}

      {/* Dropdown menu */}
      {isOpen && (
        <div ref={menuRef} id={menuId} role="menu" aria-label={t("profiles.filter.versions")} tabIndex={-1} onKeyDown={onMenuKeyDown}
          className="absolute top-full left-0 mt-2 w-56 bg-black/90 backdrop-blur-sm border border-white/20 rounded-lg shadow-xl z-50 overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/80">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-white/60 font-minecraft text-xs lowercase">{t("profiles.filter.versions")}</span>
            {isActive && (
              <button
                ref={clearRef} type="button" role="menuitem" tabIndex={-1}
                onClick={() => { onClear(); (optionRefs.current[0] ?? menuRef.current)?.focus(); }}
                className="text-white/60 hover:text-white font-minecraft text-xs lowercase transition-colors focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/80"
              >
                {t("profiles.filter.clear")}
              </button>
            )}
          </div>
          <div className="py-1 max-h-72 overflow-y-auto no-scrollbar">
            {options.length === 0 && (
              <div className="px-3 py-2 text-white/40 font-minecraft text-xs">{t("profiles.filter.noVersions")}</div>
            )}
            {options.map((option, index) => {
              const checked = selected.includes(option.value);
              return (
                <button
                  key={option.value}
                  ref={(node) => { optionRefs.current[index] = node; }}
                  type="button" role="menuitemcheckbox" tabIndex={-1}
                  aria-label={option.value} aria-checked={checked}
                  aria-describedby={`${menuId}-count-${index}`}
                  onClick={() => onToggle(option.value)}
                  className={`w-full flex items-center gap-2.5 text-left font-minecraft transition-colors duration-150 ${
                    isSm ? "px-3 py-1.5 text-xs" : "px-3 py-2 text-sm"
                  } ${checked ? "text-white" : "text-white/80 hover:bg-white/5 hover:text-white"} focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/80`}
                  style={{ backgroundColor: checked ? `${accentColor.value}20` : undefined }}
                >
                  {/* checkbox */}
                  <span
                    aria-hidden="true"
                    className="w-4 h-4 rounded-sm border flex items-center justify-center flex-shrink-0"
                    style={{
                      borderColor: checked ? accentColor.value : "rgba(255,255,255,0.3)",
                      backgroundColor: checked ? accentColor.value : "transparent",
                    }}
                  >
                    {checked && <Icon icon="solar:check-circle-bold" className="w-3 h-3 text-black" />}
                  </span>
                  <span className="flex-1">{option.value}</span>
                  <span id={`${menuId}-count-${index}`} className="text-white/40 text-xs">{option.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
