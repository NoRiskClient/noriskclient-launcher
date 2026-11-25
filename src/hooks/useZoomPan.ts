import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const WHEEL_STEP = 0.15;
const BUTTON_STEP = 0.5;
const CLICK_ZOOM = 2;
const DRAG_THRESHOLD = 4;

interface View {
  zoom: number;
  x: number;
  y: number;
}

const FIT: View = { zoom: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function useZoomPan(resetKey: unknown) {
  const [view, setView] = useState<View>(FIT);
  const [dragging, setDragging] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const travelled = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => setView(FIT), [resetKey]);

  const zoomAt = useCallback((nextZoom: number, clientX?: number, clientY?: number) => {
    setView((current) => {
      const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      if (zoom === MIN_ZOOM) return FIT;
      const box = viewport.current?.getBoundingClientRect();
      if (!box || clientX === undefined || clientY === undefined) {
        return { zoom, x: (current.x * zoom) / current.zoom, y: (current.y * zoom) / current.zoom };
      }
      const px = clientX - box.left - box.width / 2;
      const py = clientY - box.top - box.height / 2;
      const ratio = zoom / current.zoom;
      return { zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
    });
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1 + WHEEL_STEP : 1 / (1 + WHEEL_STEP);
      zoomAt(viewRef.current.zoom * factor, event.clientX, event.clientY);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt, resetKey]);

  const handlers = {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      travelled.current = 0;
      if (viewRef.current.zoom > MIN_ZOOM) {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }
    },
    onPointerMove: (event: React.PointerEvent) => {
      const start = drag.current;
      if (!start || start.id !== event.pointerId || viewRef.current.zoom <= MIN_ZOOM) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      travelled.current += Math.abs(dx) + Math.abs(dy);
      drag.current = { ...start, x: event.clientX, y: event.clientY };
      setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    },
    onPointerUp: () => {
      drag.current = null;
      setDragging(false);
    },
    onPointerCancel: () => {
      drag.current = null;
      setDragging(false);
    },
  };

  return {
    viewport,
    handlers,
    zoom: view.zoom,
    dragging,
    canZoomIn: view.zoom < MAX_ZOOM,
    canZoomOut: view.zoom > MIN_ZOOM,
    zoomIn: () => zoomAt(viewRef.current.zoom + BUTTON_STEP),
    zoomOut: () => zoomAt(viewRef.current.zoom - BUTTON_STEP),
    reset: () => setView(FIT),
    toggleAt: (clientX: number, clientY: number) => {
      if (travelled.current > DRAG_THRESHOLD) return;
      if (viewRef.current.zoom > MIN_ZOOM) setView(FIT);
      else zoomAt(CLICK_ZOOM, clientX, clientY);
    },
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
  };
}
