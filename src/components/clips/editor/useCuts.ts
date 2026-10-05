import { useCallback, useMemo, useState } from "react";

import type { Span } from "../../../services/clip-service";
import { MIN_LENGTH, NUDGE, clamp, hollowed, laneWindow, merged, tidy, type LaneWindow } from "./shared";

export type PartLane = "all" | "video" | number;

export type MarkEdge = "start" | "end" | "move";

export interface CutState {
  removed: Span[];
  blanked: Span[];
  muted: Record<number, Span[]>;
}

interface Timing {
  playhead: number;
  separate: boolean;
  start: number;
  end: number;
  shot: { from: number; to: number };
  windows: Record<number, LaneWindow>;
}

interface Room {
  from: number;
  to: number;
}

const MARK_SHARE = 0.15;
const MARK_MIN = 0.3;

function fit(span: Span, room: Room): Span | null {
  const longest = room.to - room.from;
  if (longest < NUDGE) return null;
  const length = clamp(span.endSeconds - span.startSeconds, NUDGE, longest);
  const from = clamp(span.startSeconds, room.from, room.to - length);
  return { startSeconds: from, endSeconds: from + length };
}

export function useCuts({ playhead, separate, start, end, shot, windows }: Timing) {
  const [removed, setRemoved] = useState<Span[]>([]);
  const [blanked, setBlanked] = useState<Span[]>([]);
  const [muted, setMuted] = useState<Record<number, Span[]>>({});
  const [lane, setLane] = useState<PartLane | null>(null);
  const [draft, setDraft] = useState<Span | null>(null);

  const snapshot = useMemo((): CutState => ({ removed, blanked, muted }), [blanked, muted, removed]);
  const restore = useCallback((saved: CutState) => {
    setRemoved(saved.removed);
    setBlanked(saved.blanked);
    setMuted(saved.muted);
  }, []);

  const kept = Math.max(0, shot.to - shot.from - hollowed(removed, shot.from, shot.to));
  const target: PartLane = separate ? (lane ?? "all") : "all";
  const room = useMemo(
    (): Room =>
      typeof target === "number" ? laneWindow(windows[target], start, end) : { from: shot.from, to: shot.to },
    [end, shot.from, shot.to, start, target, windows],
  );

  const mark = useMemo(() => (draft ? fit(draft, room) : null), [draft, room]);

  const beginMark = useCallback((): boolean => {
    const size = Math.max(MARK_MIN, kept * MARK_SHARE);
    const placed = fit({ startSeconds: playhead - size / 2, endSeconds: playhead + size / 2 }, room);
    setDraft(placed);
    return placed !== null;
  }, [kept, playhead, room]);

  const cancelMark = useCallback(() => setDraft(null), []);

  const reshapeMark = useCallback(
    (edge: MarkEdge, at: number) => {
      if (!mark) return;
      if (edge === "move") {
        const length = mark.endSeconds - mark.startSeconds;
        const from = clamp(at, room.from, room.to - length);
        setDraft({ startSeconds: from, endSeconds: from + length });
      } else if (edge === "start") {
        const from = clamp(at, room.from, mark.endSeconds - NUDGE);
        setDraft({ startSeconds: from, endSeconds: mark.endSeconds });
      } else {
        const to = clamp(at, mark.startSeconds + NUDGE, room.to);
        setDraft({ startSeconds: mark.startSeconds, endSeconds: to });
      }
    },
    [mark, room],
  );

  const applyMark = useCallback((): boolean => {
    if (!mark) return false;
    const span = { startSeconds: tidy(mark.startSeconds), endSeconds: tidy(mark.endSeconds) };
    if (target === "all") {
      const next = merged([...removed, span]);
      if (shot.to - shot.from - hollowed(next, shot.from, shot.to) < MIN_LENGTH) return false;
      setRemoved(next);
    } else if (target === "video") {
      setBlanked((current) => merged([...current, span]));
    } else {
      setMuted((current) => ({ ...current, [target]: merged([...(current[target] ?? []), span]) }));
    }
    setDraft(null);
    return true;
  }, [mark, removed, shot.from, shot.to, target]);

  const hushed = useMemo(
    () =>
      Object.entries(muted).flatMap(([stream, spans]) =>
        spans.map((span) => ({ stream: Number(stream), ...span })),
      ),
    [muted],
  );

  const unremove = useCallback(
    (index: number) => setRemoved((current) => current.filter((_, at) => at !== index)),
    [],
  );
  const unblank = useCallback(
    (index: number) => setBlanked((current) => current.filter((_, at) => at !== index)),
    [],
  );
  const unmute = useCallback(
    (stream: number, index: number) =>
      setMuted((current) => ({
        ...current,
        [stream]: (current[stream] ?? []).filter((_, at) => at !== index),
      })),
    [],
  );

  return {
    removed,
    blanked,
    muted,
    lane,
    setLane,
    target,
    kept,
    mark,
    beginMark,
    cancelMark,
    reshapeMark,
    applyMark,
    hushed,
    unremove,
    unblank,
    unmute,
    snapshot,
    restore,
  };
}
