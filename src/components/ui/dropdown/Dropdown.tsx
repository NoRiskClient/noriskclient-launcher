"use client";

import type React from "react";
import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../../lib/utils";
import { useThemeStore } from "../../../store/useThemeStore";
import { getModalPortalZIndex, useModalScope } from "../ModalScope";
import { getVariantColors, getBorderRadiusClass, createRadiusStyle } from "../design-system";
import { PopupScope, type PopupRole } from "./PopupScope";
import { usePopupNavigation } from "./usePopupNavigation";
import { useAnimationsEnabled } from "../../../hooks/useEntranceAnimation";

interface DropdownProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  width?: number;
  className?: string;
  children: React.ReactNode;
  position?: "bottom" | "top" | "left" | "right";
  role?: PopupRole;
  id?: string;
  ariaLabel?: string;
  align?: "center" | "start";
  offset?: number;
}

export const Dropdown = forwardRef<HTMLDivElement, DropdownProps>(function Dropdown(
  { isOpen, onClose, triggerRef, width = 300, className, children, position = "bottom",
    role = "menu", id, ariaLabel, align = "center", offset = 12 }, ref,
) {
  const panelRef = useRef<HTMLDivElement>(null);
  const modalOwner = useModalScope();
  const [present, setPresent] = useState(isOpen);
  const [entered, setEntered] = useState(false);
  const [coordinates, setCoordinates] = useState({ top: 0, left: 0, zIndex: 1001 });
  const accentColor = useThemeStore(state => state.accentColor);
  const borderRadius = useThemeStore(state => state.borderRadius);
  const animate = useAnimationsEnabled();
  const colors = getVariantColors("default", accentColor);
  const panelWidth = Math.max(0, Math.min(width, typeof window === "undefined" ? width : window.innerWidth - 32));

  useLayoutEffect(() => {
    if (isOpen) {
      setPresent(true);
      const frame = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(frame);
    }
    setEntered(false);
    if (!animate) { setPresent(false); return; }
    const timeout = setTimeout(() => setPresent(false), 200);
    return () => clearTimeout(timeout);
  }, [isOpen, animate]);

  // Actual height is measured before paint, never replaced by an estimated-height position.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!isOpen || !panel || !trigger) return;
    const place = () => {
      const r = trigger.getBoundingClientRect();
      const h = panel.offsetHeight;
      const w = panel.offsetWidth;
      const padding = 16;
      let side = position;
      if (side === "bottom" && window.innerHeight - r.bottom - offset < h && r.top - offset >= h) side = "top";
      if (side === "top" && r.top - offset < h && window.innerHeight - r.bottom - offset >= h) side = "bottom";
      let top = side === "top" ? r.top - h - offset : r.bottom + offset;
      let left = align === "start" ? r.left : r.left + (r.width - w) / 2;
      if (side === "left" || side === "right") {
        top = r.top + (r.height - h) / 2;
        left = side === "left" ? r.left - w - offset : r.right + offset;
      }
      left = Math.max(padding, Math.min(left, window.innerWidth - w - padding));
      top = Math.max(padding, Math.min(top, window.innerHeight - h - padding));
      const zIndex = getModalPortalZIndex(modalOwner, 1001);
      setCoordinates(previous => previous.top === top && previous.left === left && previous.zIndex === zIndex ? previous : { top, left, zIndex });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel); observer.observe(trigger);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect(); window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [isOpen, triggerRef, position, align, offset, panelWidth, children, modalOwner]);
  usePopupNavigation(isOpen, panelRef, triggerRef, onClose);

  if ((!isOpen && !present) || typeof document === "undefined") return null;
  const slide = position === "top" ? "translate-y-2" : position === "left" ? "translate-x-2" :
    position === "right" ? "-translate-x-2" : "-translate-y-2";
  return createPortal(
    <PopupScope.Provider value={role}>
      <div
        ref={node => {
          panelRef.current = node;
          if (node) node.inert = !isOpen;
          if (typeof ref === "function") ref(node); else if (ref) ref.current = node;
        }}
        id={id}
        role={role}
        aria-label={ariaLabel}
        aria-hidden={!isOpen || undefined}
        data-modal-owner={modalOwner}
        className={cn(
          "fixed font-smallcaps backdrop-blur-md z-[1001] overflow-y-auto custom-scrollbar text-white",
          "border-2 border-b-4 shadow-[0_8px_0_rgba(0,0,0,0.3),0_10px_15px_rgba(0,0,0,0.35)]",
          getBorderRadiusClass(borderRadius), animate && "transition-[opacity,transform] duration-200",
          entered && isOpen ? "opacity-100 translate-x-0 translate-y-0" : cn("opacity-0", animate && slide),
          !isOpen && "pointer-events-none", className,
        )}
        style={{
          ...coordinates, width: panelWidth, maxHeight: "calc(100vh - 32px)",
          backgroundColor: `${colors.main}60`, borderColor: `${colors.main}80`,
          borderBottomColor: `${colors.dark}80`, ...createRadiusStyle(borderRadius),
        }}
      >
        <div className="relative z-10 py-1">{children}</div>
      </div>
    </PopupScope.Provider>, document.body,
  );
});
