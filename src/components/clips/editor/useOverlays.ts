import { useCallback, useRef, useState, type RefObject } from "react";

import type { ClipCorner, ClipOverlay } from "../../../services/clip-service";
import { MIN_BOX, MIN_LENGTH, clamp, type NewOverlay, type TimeView } from "./shared";
import { useWindowDrag } from "./useWindowDrag";

interface BoxDrag {
  index: number;
  mode: "move" | "resize";
  fromX: number;
  fromY: number;
  left: number;
  top: number;
  width: number;
  height: number;
  towards: ClipCorner | null;
}

interface BarDrag {
  index: number;
  mode: "move" | "start" | "end";
  fromX: number;
  startSeconds: number;
  endSeconds: number;
}

const MIRRORED: Record<ClipCorner, { x: ClipCorner; y: ClipCorner }> = {
  top_left: { x: "top_right", y: "bottom_left" },
  top_right: { x: "top_left", y: "bottom_right" },
  bottom_left: { x: "bottom_right", y: "top_left" },
  bottom_right: { x: "bottom_left", y: "top_right" },
  top: { x: "top", y: "bottom" },
  right: { x: "left", y: "right" },
  bottom: { x: "bottom", y: "top" },
  left: { x: "right", y: "left" },
};

function mirrored(corner: ClipCorner, flipX: boolean, flipY: boolean): ClipCorner {
  const across = flipX ? MIRRORED[corner].x : corner;
  return flipY ? MIRRORED[across].y : across;
}

function span(from: number, to: number): { start: number; size: number; flipped: boolean } {
  if (to < from && from >= MIN_BOX) {
    const start = clamp(to, 0, from - MIN_BOX);
    return { start, size: from - start, flipped: true };
  }
  const reach = clamp(to, from + MIN_BOX, 1);
  return { start: from, size: Math.max(reach - from, MIN_BOX), flipped: false };
}

interface Stage {
  start: number;
  end: number;
  view: TimeView;
  frameRef: RefObject<HTMLDivElement | null>;
  scaleRef: RefObject<HTMLDivElement | null>;
}

export function useOverlays({ start, end, view, frameRef, scaleRef }: Stage) {
  const [overlays, setOverlays] = useState<ClipOverlay[]>([]);
  const latest = useRef<ClipOverlay[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [boxDrag, setBoxDrag] = useState<BoxDrag | null>(null);
  const [barDrag, setBarDrag] = useState<BarDrag | null>(null);

  const commit = useCallback((next: ClipOverlay[]) => {
    latest.current = next;
    setOverlays(next);
  }, []);

  const editOverlay = useCallback(
    (index: number, patch: Partial<ClipOverlay>) => {
      commit(
        latest.current.map((overlay, at) =>
          at === index ? ({ ...overlay, ...patch } as ClipOverlay) : overlay,
        ),
      );
    },
    [commit],
  );

  const addOverlay = useCallback(
    (seed: NewOverlay) => {
      const next = [
        ...latest.current,
        {
          ...seed,
          left: 0.25,
          top: 0.25,
          width: 0.5,
          height: 0.5,
          startSeconds: start,
          endSeconds: end,
        },
      ];
      commit(next);
      setChosen(next.length - 1);
    },
    [commit, end, start],
  );

  const dropOverlay = useCallback(
    (index: number) => {
      commit(latest.current.filter((_, at) => at !== index));
      setChosen(null);
    },
    [commit],
  );

  const restore = useCallback(
    (saved: ClipOverlay[]) => {
      commit(saved);
      setChosen((current) =>
        current === null || saved.length === 0 ? null : Math.min(current, saved.length - 1),
      );
    },
    [commit],
  );

  const grabBox = (index: number, mode: BoxDrag["mode"], event: { clientX: number; clientY: number }) => {
    const overlay = overlays[index];
    if (!overlay) return;
    setChosen(index);
    setBoxDrag({
      index,
      mode,
      fromX: event.clientX,
      fromY: event.clientY,
      left: overlay.left,
      top: overlay.top,
      width: overlay.width,
      height: overlay.height,
      towards: overlay.kind === "arrow" ? overlay.towards : null,
    });
  };

  const grabBar = (index: number, mode: BarDrag["mode"], event: { clientX: number }) => {
    const overlay = overlays[index];
    if (!overlay) return;
    setChosen(index);
    setBarDrag({
      index,
      mode,
      fromX: event.clientX,
      startSeconds: overlay.startSeconds,
      endSeconds: overlay.endSeconds,
    });
  };

  useWindowDrag(
    boxDrag,
    (event, boxDrag) => {
      const rect = frameRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const byX = (event.clientX - boxDrag.fromX) / rect.width;
      const byY = (event.clientY - boxDrag.fromY) / rect.height;
      if (boxDrag.mode === "move") {
        editOverlay(boxDrag.index, {
          left: clamp(boxDrag.left + byX, 0, 1 - boxDrag.width),
          top: clamp(boxDrag.top + byY, 0, 1 - boxDrag.height),
        });
      } else {
        const across = span(boxDrag.left, boxDrag.left + boxDrag.width + byX);
        const down = span(boxDrag.top, boxDrag.top + boxDrag.height + byY);
        editOverlay(boxDrag.index, {
          left: across.start,
          top: down.start,
          width: across.size,
          height: down.size,
          ...(boxDrag.towards && {
            towards: mirrored(boxDrag.towards, across.flipped, down.flipped),
          }),
        });
      }
    },
    () => setBoxDrag(null),
  );

  useWindowDrag(
    barDrag,
    (event, barDrag) => {
      const rect = scaleRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || view.length <= 0) return;
      const by = ((event.clientX - barDrag.fromX) / rect.width) * view.length;
      const from = view.toView(barDrag.startSeconds);
      const to = view.toView(barDrag.endSeconds);
      if (barDrag.mode === "move") {
        const at = clamp(from + by, 0, view.length - (to - from));
        editOverlay(barDrag.index, { startSeconds: view.fromView(at), endSeconds: view.fromView(at + to - from) });
      } else if (barDrag.mode === "start") {
        editOverlay(barDrag.index, {
          startSeconds: view.fromView(clamp(from + by, 0, to - MIN_LENGTH)),
        });
      } else {
        editOverlay(barDrag.index, {
          endSeconds: view.fromView(clamp(to + by, from + MIN_LENGTH, view.length)),
        });
      }
    },
    () => setBarDrag(null),
  );

  const picked = chosen === null ? null : (overlays[chosen] ?? null);

  return {
    overlays,
    chosen,
    setChosen,
    picked,
    editOverlay,
    addOverlay,
    dropOverlay,
    grabBox,
    grabBar,
    restore,
  };
}
