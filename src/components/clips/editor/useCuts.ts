import { useCallback, useMemo, useState } from "react";

import type { Span } from "../../../services/clip-service";
import { MIN_LENGTH, NUDGE, hollowed, laneWindow, merged, tidy, type LaneWindow } from "./shared";

export type PartLane = "all" | "video" | number;

export interface CutState {
  removed: Span[];
  splits: number[];
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

export function useCuts({ playhead, separate, start, end, shot, windows }: Timing) {
  const [removed, setRemoved] = useState<Span[]>([]);
  const [splits, setSplits] = useState<number[]>([]);
  const [blanked, setBlanked] = useState<Span[]>([]);
  const [muted, setMuted] = useState<Record<number, Span[]>>({});
  const [pick, setPick] = useState<{ lane: PartLane; at: number } | null>(null);

  const snapshot = useMemo(
    (): CutState => ({ removed, splits, blanked, muted }),
    [blanked, muted, removed, splits],
  );
  const restore = useCallback((saved: CutState) => {
    setRemoved(saved.removed);
    setSplits(saved.splits);
    setBlanked(saved.blanked);
    setMuted(saved.muted);
  }, []);

  const inside = useCallback(
    (at: number) => removed.some((span) => at >= span.startSeconds && at < span.endSeconds),
    [removed],
  );

  const kept = Math.max(0, shot.to - shot.from - hollowed(removed, shot.from, shot.to));

  const canSplit =
    playhead > shot.from + NUDGE &&
    playhead < shot.to - NUDGE &&
    !inside(playhead) &&
    splits.every((at) => Math.abs(at - playhead) >= NUDGE);

  const split = useCallback(() => {
    if (!canSplit) return;
    setSplits((current) => [...current, tidy(playhead)].sort((a, b) => a - b));
  }, [canSplit, playhead]);

  const part = useMemo((): { lane: PartLane; span: Span } | null => {
    if (!pick) return null;
    const lane: PartLane = separate ? pick.lane : "all";
    const range =
      typeof lane === "number" ? laneWindow(windows[lane], start, end) : { from: shot.from, to: shot.to };
    const own = lane === "video" ? blanked : typeof lane === "number" ? (muted[lane] ?? []) : [];
    if (inside(pick.at) || own.some((span) => pick.at >= span.startSeconds && pick.at < span.endSeconds)) {
      return null;
    }
    const edges = [range.from, ...splits.filter((at) => at > range.from && at < range.to), range.to];
    for (let i = 1; i < edges.length; i++) {
      if (pick.at >= edges[i - 1] && pick.at < edges[i]) {
        return { lane, span: { startSeconds: edges[i - 1], endSeconds: edges[i] } };
      }
    }
    return null;
  }, [blanked, end, inside, muted, pick, separate, shot.from, shot.to, splits, start, windows]);

  const cuttable =
    part !== null &&
    (part.lane !== "all" || kept - (part.span.endSeconds - part.span.startSeconds) >= MIN_LENGTH);

  const cutPart = useCallback(() => {
    if (!part || !cuttable) return;
    const { lane, span } = part;
    if (lane === "all") setRemoved((current) => merged([...current, span]));
    else if (lane === "video") setBlanked((current) => merged([...current, span]));
    else setMuted((current) => ({ ...current, [lane]: merged([...(current[lane] ?? []), span]) }));
  }, [cuttable, part]);

  const hushed = useMemo(
    () =>
      Object.entries(muted).flatMap(([stream, spans]) =>
        spans.map((span) => ({ stream: Number(stream), ...span })),
      ),
    [muted],
  );

  const unsplit = useCallback(
    (at: number) => setSplits((current) => current.filter((other) => other !== at)),
    [],
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
    splits,
    blanked,
    muted,
    pick,
    setPick,
    part,
    kept,
    canSplit,
    split,
    cuttable,
    cutPart,
    hushed,
    unsplit,
    unremove,
    unblank,
    unmute,
    snapshot,
    restore,
  };
}
