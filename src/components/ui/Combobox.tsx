"use client";

import { useEffect, useId, useRef, useState } from "react";
import type React from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { useSettingControl } from "./settings/SettingControlContext";
import { useTranslation } from "react-i18next";

interface ComboboxProps extends React.AriaAttributes {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  maxVisible?: number;
  optionStyle?: (option: string) => React.CSSProperties;
  inputStyle?: React.CSSProperties;
  className?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  allowClear,
  maxVisible = 60,
  optionStyle,
  inputStyle,
  className,
  ...ariaProps
}: ComboboxProps) {
  const id = useId();
  const row = useSettingControl();
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const query = value.trim().toLowerCase();
  const filtered = (query ? options.filter((o) => o.toLowerCase().includes(query)) : options).slice(
    0,
    maxVisible,
  );
  const activeOptionId = open && filtered[activeIndex] !== undefined ? `${id}-option-${activeIndex}` : undefined;
  const choose = (option: string) => {
    onChange(option); inputRef.current?.focus({ preventScroll: true }); setOpen(false); setActiveIndex(-1);
  };
  useEffect(() => {
    if (activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId]);
  const navigate = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.isDefaultPrevented() || event.nativeEvent.isComposing || disabled) return;
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActiveIndex(-1); }
    else if (event.key === "Tab") { setOpen(false); setActiveIndex(-1); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true);
      if (filtered.length) setActiveIndex(index => index < 0 || !open ? (event.key === "ArrowDown" ? 0 : filtered.length - 1) :
        (index + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length);
    } else if (open && activeIndex >= 0 && (event.key === "Home" || event.key === "End")) {
      event.preventDefault(); setActiveIndex(event.key === "Home" ? 0 : filtered.length - 1);
    } else if (open && event.key === "Enter") {
      event.preventDefault(); event.stopPropagation();
      if (filtered[activeIndex] !== undefined) choose(filtered[activeIndex]); else setOpen(false);
    }
  };

  return (
    <div className={cn("relative", className)} ref={rootRef}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { setOpen(false); setActiveIndex(-1); } }}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? id : undefined}
        aria-activedescendant={activeOptionId}
        aria-label={!row.labelId ? placeholder : undefined}
        aria-labelledby={row.labelId}
        aria-describedby={row.descriptionId}
        {...ariaProps}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => !disabled && setOpen(true)}
        onKeyDown={navigate}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        className="w-full rounded-lg border-2 border-[#ffffff20] bg-black/40 px-3 py-2 pr-16 text-base text-white placeholder:text-white/30 outline-none focus:border-white/40 disabled:opacity-40"
        style={inputStyle}
      />

      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {allowClear && value && !disabled && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus({ preventScroll: true });
              setOpen(false);
              setActiveIndex(-1);
            }}
            className="text-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded"
            aria-label={t("common.clear_search")}
          >
            <Icon icon="solar:close-circle-bold" className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => { if (!disabled) { const next = !open; inputRef.current?.focus({ preventScroll: true }); setOpen(next); setActiveIndex(-1); } }}
          disabled={disabled}
          className="text-white/50 hover:text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded"
          aria-label={t("common.toggle_options")}
          aria-expanded={open && !disabled}
          aria-controls={open && !disabled ? id : undefined}
        >
          <Icon
            icon="solar:alt-arrow-down-bold"
            className={cn("w-4 h-4 transition-transform", open && "rotate-180")}
          />
        </button>
      </div>

      {open && !disabled && (
        <div id={id} role="listbox" aria-label={ariaProps["aria-label"] || placeholder} className="absolute left-0 right-0 top-full mt-2 max-h-64 overflow-y-auto custom-scrollbar rounded-lg border border-white/20 bg-black/90 backdrop-blur-sm shadow-xl z-50 py-1">
          {filtered.length === 0 && <div role="status" className="px-3 py-2 text-sm text-white/60">{t("common.no_options")}</div>}
          {filtered.map((opt, index) => {
            const active = opt === value;
            return (
              <button
                key={opt}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={active}
                tabIndex={-1}
                type="button"
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(opt)}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-base transition-colors",
                  active ? "text-white" : "text-white/80 hover:bg-white/5 hover:text-white",
                    index === activeIndex && "ring-2 ring-inset ring-[var(--accent)]",
                )}
                style={{
                  ...(optionStyle?.(opt) ?? {}),
                  backgroundColor: active ? `${accentColor.value}20` : undefined,
                }}
              >
                <span className="truncate">{opt}</span>
                {active && (
                  <Icon
                    icon="solar:check-circle-bold"
                    className="w-4 h-4 shrink-0"
                    style={{ color: accentColor.value }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
