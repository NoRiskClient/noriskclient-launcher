"use client";

import React, { useCallback, useId, useLayoutEffect, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useThemeStore } from "../../store/useThemeStore";
import { getModalPortalZIndex, useModalScope } from "./ModalScope";
import { getTopDialogId, subscribeDialogLayer } from "./modal-focus";

interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactNode;
  delay?: number;
  className?: string;
  wrapperClassName?: string;
  position?: "cursor" | "top" | "bottom";
  dismissKey?: string;
}

export function Tooltip({ content, children, delay = 300, className = "", wrapperClassName = "", position = "cursor", dismissKey }: TooltipProps) {
  const id = useId();
  const owner = useModalScope();
  const accentColor = useThemeStore(state => state.accentColor);
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState<HTMLElement | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [point, setPoint] = useState({ x: 8, y: 8 });
  const [layer, setLayer] = useState(1100);
  const trigger = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const hovering = useRef(false);
  const pointerFocus = useRef(false);
  const cursor = useRef({ x: 0, y: 0 });

  const clearTimer = useCallback(() => { if (timer.current !== undefined) clearTimeout(timer.current); timer.current = undefined; }, []);
  const dismiss = useCallback(() => {
    clearTimer(); hovering.current = false; setFocused(null); setVisible(false); setEngaged(false);
  }, [clearTimer]);
  const canShow = useCallback(() => Boolean(trigger.current?.isConnected &&
    !trigger.current.closest('[inert], [hidden], [aria-hidden="true"]') &&
    (getTopDialogId() ?? undefined) === owner), [owner]);
  useEffect(() => () => { hovering.current = false; clearTimer(); }, [clearTimer]);
  // Route changes dismiss without remounting or blurring the native action.
  useLayoutEffect(() => { dismiss(); }, [dismissKey, dismiss]);
  useLayoutEffect(() => {
    let previousTop = getTopDialogId();
    return subscribeDialogLayer(() => {
      const nextTop = getTopDialogId();
      if (nextTop !== previousTop || !canShow()) dismiss();
      previousTop = nextTop;
    });
  }, [canShow, dismiss]);
  useLayoutEffect(() => {
    if (!canShow() || (focused && (!focused.isConnected || !trigger.current?.contains(focused) ||
      focused.matches(':disabled, [aria-disabled="true"]') || focused.closest('[inert], [hidden], [aria-hidden="true"]')))) dismiss();
  });
  useEffect(() => {
    if (!engaged) return;
    // Hover hints also close when Escape is pressed on a different control.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing && canShow() &&
        (visible || timer.current !== undefined)) {
        event.preventDefault(); event.stopPropagation(); dismiss();
      }
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [engaged, visible, canShow, dismiss]);
  useLayoutEffect(() => {
    setStandalone(!trigger.current?.querySelector('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])'));
  }, [children]);

  const place = useCallback(() => {
    const tip = tooltip.current, rect = trigger.current?.getBoundingClientRect();
    if (!tip || !rect) return;
    setLayer(getModalPortalZIndex(owner, 1100));
    const width = tip.offsetWidth, height = tip.offsetHeight, margin = 8;
    const anchored = position !== "cursor" || focused !== null;
    let x = anchored ? rect.left + (rect.width - width) / 2 : cursor.current.x + margin;
    let y = anchored ? (position === "bottom" ? rect.bottom + margin : rect.top - height - margin) : cursor.current.y + margin;
    if (anchored && y < margin) y = rect.bottom + margin;
    else if (y + height > window.innerHeight - margin) y = anchored ? rect.top - height - margin : cursor.current.y - height - margin;
    if (!anchored && x + width > window.innerWidth - margin) x = cursor.current.x - width - margin;
    x = Math.max(margin, Math.min(x, window.innerWidth - width - margin));
    y = Math.max(margin, Math.min(y, window.innerHeight - height - margin));
    setPoint(previous => previous.x === x && previous.y === y ? previous : { x, y });
  }, [position, focused, owner]);

  useLayoutEffect(() => {
    if (!visible) return;
    place();
    const observer = new ResizeObserver(place);
    if (trigger.current) observer.observe(trigger.current);
    if (tooltip.current) observer.observe(tooltip.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true);
    };
  }, [visible, place, content]);

  useLayoutEffect(() => {
    if (!focused || !visible) return;
    const previous = focused.getAttribute("aria-describedby");
    const ids = new Set((previous ?? "").split(/\s+/).filter(Boolean)); ids.add(id);
    focused.setAttribute("aria-describedby", [...ids].join(" "));
    return () => {
      // Preserve descriptions another consumer may have added while shown.
      const current = (focused.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(value => value && value !== id);
      if (current.length) focused.setAttribute("aria-describedby", current.join(" "));
      else focused.removeAttribute("aria-describedby");
    };
  }, [focused, visible, id]);

  return <>
    <div ref={trigger} tabIndex={standalone ? 0 : undefined}
      className={`inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${wrapperClassName}`}
      onMouseEnter={event => {
        if (!canShow()) return;
        hovering.current = true; cursor.current = { x: event.clientX, y: event.clientY }; clearTimer();
        setEngaged(true);
        timer.current = setTimeout(() => {
          timer.current = undefined;
          if (hovering.current && canShow()) setVisible(true); else dismiss();
        }, delay);
      }}
      onMouseMove={event => { cursor.current = { x: event.clientX, y: event.clientY }; if (visible) place(); }}
      onMouseLeave={() => { hovering.current = false; clearTimer(); if (!focused) { setVisible(false); setEngaged(false); } }}
      onPointerDownCapture={() => { pointerFocus.current = true; dismiss(); }}
      onClickCapture={dismiss}
      onFocusCapture={event => {
        clearTimer();
        const target = event.target as HTMLElement;
        if (!pointerFocus.current && target.matches(":focus-visible") && canShow()) {
          setFocused(target); setEngaged(true); setVisible(true);
        } else { setFocused(null); if (!hovering.current) { setVisible(false); setEngaged(false); } }
      }}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          pointerFocus.current = false; setFocused(null);
          if (!hovering.current) { setVisible(false); setEngaged(false); }
        }
      }}
      onKeyDownCapture={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Tab") pointerFocus.current = false;
        if (event.key === "Enter" || event.key === " ") dismiss();
        if (canShow() && (visible || timer.current !== undefined) && event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); dismiss();
        }
      }}>
      {children}
    </div>
    {visible && canShow() && createPortal(<div ref={tooltip} id={id} role="tooltip" data-modal-owner={owner ?? undefined}
      className={`fixed z-[1100] px-3 py-2 text-xs font-minecraft text-white border-2 pointer-events-none rounded-lg backdrop-blur-md ${className}`}
      style={{ left: point.x, top: point.y, zIndex: layer, backgroundColor: `${accentColor.value}20`, borderColor: `${accentColor.value}60`,
        maxWidth: "min(300px, calc(100vw - 16px))", maxHeight: "calc(100dvh - 16px)", overflow: "hidden", overflowWrap: "anywhere",
        textAlign: position !== "cursor" || focused ? "center" : undefined }}>
      {content}
    </div>, document.body)}
  </>;
}

export function SimpleTooltip(props: TooltipProps) { return <Tooltip {...props} />; }
export function StaticTooltip(props: Omit<TooltipProps, "position">) { return <Tooltip {...props} position="top" />; }
