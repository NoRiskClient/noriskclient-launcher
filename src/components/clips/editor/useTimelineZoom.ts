import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { typing } from "../useEditHistory";
import { clamp } from "./shared";

const MAX_ZOOM = 32;
const STEP = 1.25;

export function useTimelineZoom(
  scroller: RefObject<HTMLDivElement | null>,
  track: RefObject<HTMLDivElement | null>,
) {
  const [zoom, setZoom] = useState(1);
  const anchor = useRef<{ share: number; clientX: number } | null>(null);

  const zoomBy = useCallback(
    (factor: number, clientX?: number) => {
      const lane = track.current?.getBoundingClientRect();
      const box = scroller.current?.getBoundingClientRect();
      if (!lane || !box || lane.width <= 0) return;
      const x = clientX ?? box.left + box.width / 2;
      anchor.current = { share: clamp((x - lane.left) / lane.width, 0, 1), clientX: x };
      setZoom((current) => clamp(current * factor, 1, MAX_ZOOM));
    },
    [scroller, track],
  );

  const fit = useCallback(() => {
    anchor.current = null;
    setZoom(1);
  }, []);

  useLayoutEffect(() => {
    const box = scroller.current;
    const lane = track.current?.getBoundingClientRect();
    const held = anchor.current;
    anchor.current = null;
    if (!box || !lane || !held) return;
    box.scrollLeft += lane.left + held.share * lane.width - held.clientX;
  }, [scroller, track, zoom]);

  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const sync = () => {
      box.style.setProperty("--timeline-scroll", `${box.scrollLeft}px`);
      box.dataset.scrolled = String(box.scrollLeft > 0);
    };
    sync();
    box.addEventListener("scroll", sync, { passive: true });
    return () => box.removeEventListener("scroll", sync);
  }, [scroller]);

  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const wheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomBy(event.deltaY < 0 ? STEP : 1 / STEP, event.clientX);
        return;
      }
      const room = box.scrollWidth - box.clientWidth;
      if (room <= 0 || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      const pages = event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? box.clientWidth : 1;
      box.scrollLeft += event.deltaY * lines * pages;
    };
    box.addEventListener("wheel", wheel, { passive: false });
    return () => box.removeEventListener("wheel", wheel);
  }, [scroller, zoomBy]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || typing()) return;
      if (event.key === "+" || event.key === "=") zoomBy(STEP);
      else if (event.key === "-") zoomBy(1 / STEP);
      else if (event.key === "0") fit();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [fit, zoomBy]);

  return {
    zoom,
    canZoomIn: zoom < MAX_ZOOM,
    canZoomOut: zoom > 1,
    zoomIn: useCallback(() => zoomBy(STEP), [zoomBy]),
    zoomOut: useCallback(() => zoomBy(1 / STEP), [zoomBy]),
    fit,
  };
}
