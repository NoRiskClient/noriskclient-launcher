"use client";

import { useState, useRef, useEffect } from "react";
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
  const accentColor = useThemeStore((state) => state.accentColor);

  const isActive = selected.length > 0;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative w-auto" ref={ref}>
      {/* Trigger button (icon-only, accent-tinted while a filter is active) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 rounded-md px-2 py-1 text-white font-minecraft transition-all duration-200 focus:outline-none ${
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
          className="w-4 h-4"
          style={{ color: isActive ? accentColor.value : "rgba(255, 255, 255, 0.7)" }}
        />
        {isActive && (
          <span
            className="min-w-[1rem] text-center text-xs font-minecraft rounded-full px-1"
            style={{ backgroundColor: `${accentColor.value}30`, color: accentColor.value }}
          >
            {selected.length}
          </span>
        )}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-56 bg-black/90 backdrop-blur-sm border border-white/20 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-white/60 font-minecraft text-xs lowercase">{t("profiles.filter.versions")}</span>
            {isActive && (
              <button
                onClick={onClear}
                className="text-white/60 hover:text-white font-minecraft text-xs lowercase transition-colors"
              >
                {t("profiles.filter.clear")}
              </button>
            )}
          </div>
          <div className="py-1 max-h-72 overflow-y-auto no-scrollbar">
            {options.length === 0 && (
              <div className="px-3 py-2 text-white/40 font-minecraft text-xs">{t("profiles.filter.noVersions")}</div>
            )}
            {options.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <button
                  key={option.value}
                  onClick={() => onToggle(option.value)}
                  className={`w-full flex items-center gap-2.5 text-left font-minecraft transition-colors duration-150 ${
                    isSm ? "px-3 py-1.5 text-xs" : "px-3 py-2 text-sm"
                  } ${checked ? "text-white" : "text-white/80 hover:bg-white/5 hover:text-white"}`}
                  style={{ backgroundColor: checked ? `${accentColor.value}20` : undefined }}
                >
                  {/* checkbox */}
                  <span
                    className="w-4 h-4 rounded-sm border flex items-center justify-center flex-shrink-0"
                    style={{
                      borderColor: checked ? accentColor.value : "rgba(255,255,255,0.3)",
                      backgroundColor: checked ? accentColor.value : "transparent",
                    }}
                  >
                    {checked && <Icon icon="solar:check-circle-bold" className="w-3 h-3 text-black" />}
                  </span>
                  <span className="flex-1">{option.value}</span>
                  <span className="text-white/40 text-xs">{option.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
