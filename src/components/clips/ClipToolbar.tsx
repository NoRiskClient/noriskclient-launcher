"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";

import { Tooltip } from "../ui/Tooltip";
import { cn } from "../../lib/utils";
import type { ClipSort } from "./ClipGallery";

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
}

export function ClipSearchField({ value, onChange, placeholder, clearLabel }: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="group relative">
      <Icon
        icon="solar:magnifer-linear"
        className={cn(
          "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors",
          value ? "text-white/50" : "text-white/25 group-focus-within:text-white/50",
        )}
      />
      <input
        ref={input}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.stopPropagation();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          "h-9 w-52 rounded-lg border border-white/10 bg-white/[0.04] pl-9 pr-8",
          "text-sm text-white/85 placeholder:text-white/25",
          "transition-[width,background-color,border-color] duration-200",
          "hover:border-white/20 focus:w-64 focus:border-white/30 focus:bg-white/[0.07] focus:outline-none",
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          title={clearLabel}
          aria-label={clearLabel}
          className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-white/35 transition-colors hover:bg-white/10 hover:text-white/80"
        >
          <Icon icon="solar:close-circle-bold" className="h-4 w-4" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-white/10 px-1.5 text-[10px] leading-4 text-white/25 group-focus-within:opacity-0">
          /
        </kbd>
      )}
    </div>
  );
}

interface SortSwitchProps {
  value: ClipSort;
  onChange: (value: ClipSort) => void;
  options: { value: ClipSort; label: string }[];
}

export function ClipSortSwitch({ value, onChange, options }: SortSwitchProps) {
  return (
    <div
      role="group"
      className="flex h-9 items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.04] p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
              active
                ? "bg-white/[0.12] text-white"
                : "text-white/40 hover:bg-white/[0.06] hover:text-white/75",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface GameFilterProps {
  value: string | null;
  onChange: (game: string | null) => void;
  games: string[];
  allLabel: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function ClipGameFilter({ value, onChange, games, allLabel, t }: GameFilterProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (game: string | null) => {
    onChange(game);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
          value
            ? "border-white/25 bg-white/[0.08] text-white"
            : "border-white/10 bg-white/[0.04] text-white/55 hover:border-white/20 hover:bg-white/[0.08] hover:text-white",
        )}
      >
        <Icon icon="solar:gamepad-bold" className="h-4 w-4 shrink-0" />
        <span className="max-w-[9rem] truncate">{value ?? allLabel}</span>
        <Icon
          icon="solar:alt-arrow-down-linear"
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute right-0 z-30 mt-1.5 max-h-72 w-56 overflow-y-auto rounded-lg p-1",
            "border border-white/10 bg-[#141414]/95 shadow-xl backdrop-blur-md",
          )}
        >
          <Option label={allLabel} selected={value === null} onSelect={() => choose(null)} />
          {games.map((game) => (
            <Option
              key={game}
              label={game}
              selected={value === game}
              onSelect={() => choose(game)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Option({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
        selected ? "bg-white/[0.1] text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
      )}
    >
      <Icon
        icon="solar:check-circle-bold"
        className={cn("h-4 w-4 shrink-0", selected ? "text-white/80" : "text-transparent")}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

interface ToolButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
}

export function ClipToolButton({ icon, label, onClick, active }: ToolButtonProps) {
  return (
    <Tooltip content={label} position="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
          active
            ? "border-amber-300/40 bg-amber-300/15 text-amber-300"
            : "border-white/10 bg-white/[0.04] text-white/55 hover:border-white/20 hover:bg-white/[0.08] hover:text-white",
        )}
      >
        <Icon icon={icon} className="h-4 w-4" />
      </button>
    </Tooltip>
  );
}
