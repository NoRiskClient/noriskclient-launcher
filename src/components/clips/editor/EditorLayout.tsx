"use client";

import { useRef, useState, type RefObject } from "react";
import { Separator, type LayoutStorage, type PanelImperativeHandle } from "react-resizable-panels";

import { cn } from "../../../lib/utils";

const LAYOUT_PREFIX = "react-resizable-panels:clip-editor";

export const COLUMNS_ID = "clip-editor-columns";
export const ROWS_ID = "clip-editor-rows";

export const SIDE = { default: 256, min: 220, max: 420 };
export const INSPECTOR = { default: 288, min: 240, max: 460 };
export const TIMELINE = { default: 256, min: 192, max: "60%", collapsed: 46 };
export const STAGE_MIN = 240;
export const MAIN_MIN = "30%";

export const HIT_AREA = { fine: 12, coarse: 28 };

export const CARD =
  "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--border-radius)] border border-white/10 bg-black/30";

export const PANEL_HEAD =
  "relative flex h-11 shrink-0 items-center gap-3 border-b border-white/10 bg-black/20 px-3";

export const layoutStorage: LayoutStorage = {
  getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      return;
    }
  },
};

export function clearSavedLayout() {
  try {
    const storage = window.localStorage;
    const saved: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(LAYOUT_PREFIX)) saved.push(key);
    }
    saved.forEach((key) => storage.removeItem(key));
  } catch {
    return;
  }
}

export function ResizeBar({
  orientation,
  label,
  color,
  disabled = false,
}: {
  orientation: "vertical" | "horizontal";
  label: string;
  color: string;
  disabled?: boolean;
}) {
  const across = orientation === "vertical";
  return (
    <Separator
      aria-label={label}
      disabled={disabled}
      className={cn(
        "group relative z-20 shrink-0 outline-none",
        across ? (disabled ? "w-0" : "w-1.5") : "h-1.5",
        disabled && "invisible",
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute opacity-0 transition-opacity duration-150",
          "group-data-[separator=hover]:opacity-100 group-data-[separator=active]:opacity-100 group-data-[separator=focus]:opacity-100",
          across
            ? "inset-y-1 left-1/2 w-0.5 -translate-x-1/2 rounded-full"
            : "inset-x-1 top-1/2 h-0.5 -translate-y-1/2 rounded-full",
        )}
        style={{ backgroundColor: color }}
      />
    </Separator>
  );
}

export function EdgeGrip({
  panel,
  label,
  color,
  onGrab,
}: {
  panel: RefObject<PanelImperativeHandle | null>;
  label: string;
  color: string;
  onGrab: () => void;
}) {
  const start = useRef<{ y: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const stop = () => {
    start.current = null;
    setDragging(false);
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      onPointerDown={(event) => {
        const handle = panel.current;
        if (!handle || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { y: event.clientY, size: handle.getSize().inPixels };
        setDragging(true);
        onGrab();
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        panel.current?.resize(start.current.size - (event.clientY - start.current.y));
      }}
      onPointerUp={stop}
      onLostPointerCapture={stop}
      className="group absolute inset-x-0 -bottom-1.5 z-20 h-3 cursor-row-resize"
    >
      <span
        className={cn(
          "pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100",
          dragging && "opacity-100",
        )}
        style={{ backgroundColor: color }}
      />
    </div>
  );
}
