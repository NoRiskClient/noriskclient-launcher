"use client";

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";

interface ComboboxProps {
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
}: ComboboxProps) {
  const accentColor = useThemeStore((s) => s.accentColor);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
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
              setOpen(false);
            }}
            className="text-white/40 hover:text-white"
            tabIndex={-1}
            aria-label="Clear"
          >
            <Icon icon="solar:close-circle-bold" className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => !disabled && setOpen((o) => !o)}
          disabled={disabled}
          className="text-white/50 hover:text-white disabled:opacity-40"
          tabIndex={-1}
          aria-label="Toggle options"
        >
          <Icon
            icon="solar:alt-arrow-down-bold"
            className={cn("w-4 h-4 transition-transform", open && "rotate-180")}
          />
        </button>
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-2 max-h-64 overflow-y-auto custom-scrollbar rounded-lg border border-white/20 bg-black/90 backdrop-blur-sm shadow-xl z-50 py-1">
          {filtered.map((opt) => {
            const active = opt === value;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-base transition-colors",
                  active ? "text-white" : "text-white/80 hover:bg-white/5 hover:text-white",
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
                    style={{ color: accentColor.textValue || accentColor.value }}
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
