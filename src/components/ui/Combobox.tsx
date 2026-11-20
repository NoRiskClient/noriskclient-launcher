import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type React from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";

const LIST_MAX_HEIGHT = 256;
const LIST_GAP = 8;

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  selectOnly?: boolean;
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
  selectOnly,
  maxVisible = 60,
  optionStyle,
  inputStyle,
  className,
}: ComboboxProps) {
  const accentColor = useThemeStore((s) => s.accentColor);
  const [open, setOpenState] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<React.CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const box = rootRef.current?.getBoundingClientRect();
      if (!box) return;
      const below = window.innerHeight - box.bottom - LIST_GAP * 2;
      const above = box.top - LIST_GAP * 2;
      const down = below >= Math.min(LIST_MAX_HEIGHT, 160) || below >= above;
      setPlace({
        left: box.left,
        width: box.width,
        maxHeight: Math.min(LIST_MAX_HEIGHT, down ? below : above),
        ...(down ? { top: box.bottom + LIST_GAP } : { bottom: window.innerHeight - box.top + LIST_GAP }),
      });
    };
    measure();
    const frame = requestAnimationFrame(() => activeRef.current?.scrollIntoView({ block: "nearest" }));
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  const setOpen = (next: boolean | ((open: boolean) => boolean)) => {
    setOpenState(next);
    setSearch("");
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const shown = selectOnly ? (open ? search : value) : value;
  const query = (selectOnly ? search : value).trim().toLowerCase();
  const matching = query ? options.filter((o) => o.toLowerCase().includes(query)) : options;
  const filtered = matching.slice(0, maxVisible);
  if (!query && value && !filtered.includes(value) && options.includes(value)) filtered.push(value);

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      <input
        type="text"
        value={shown}
        onChange={(e) => {
          if (selectOnly) {
            setOpenState(true);
            setSearch(e.target.value);
          } else {
            onChange(e.target.value);
            setOpen(true);
          }
        }}
        onFocus={() => setOpen(true)}
        disabled={disabled}
        placeholder={selectOnly && open && value ? value : placeholder}
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
            <Icon icon="nrc:close" className="w-4 h-4" />
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

      {open && place && filtered.length > 0 && createPortal(
        <div
          ref={listRef}
          className="fixed z-[9999] overflow-y-auto custom-scrollbar rounded-lg border border-white/20 bg-black/90 backdrop-blur-sm shadow-xl py-1"
          style={place}
        >
          {filtered.map((opt) => {
            const active = opt === value;
            return (
              <button
                key={opt}
                ref={active ? activeRef : undefined}
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
                    style={{ color: accentColor.value }}
                  />
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
