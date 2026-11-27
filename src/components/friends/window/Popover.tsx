import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement>;
  width: number;
  /** Preferred side; flips when there is no room. */
  side?: "top" | "bottom";
  align?: "start" | "end";
  children: ReactNode;
}

const GAP = 6;
const EDGE = 8;

export function Popover({ open, onClose, anchorRef, width, side = "bottom", align = "start", children }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const a = anchor.getBoundingClientRect();
    const h = panel.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const fitsBelow = a.bottom + GAP + h <= vh - EDGE;
    const fitsAbove = a.top - GAP - h >= EDGE;
    const below = side === "bottom" ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
    const top = below ? a.bottom + GAP : a.top - GAP - h;

    let left = align === "start" ? a.left : a.right - width;
    left = Math.max(EDGE, Math.min(left, vw - width - EDGE));
    setPos({ top: Math.max(EDGE, top), left });
  }, [anchorRef, side, align, width]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
    };
  }, [open, onClose, anchorRef, place]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="fw-portal fw-popover p-1"
      style={{
        width,
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
