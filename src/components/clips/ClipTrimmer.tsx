"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";

import { Button } from "../ui/buttons/Button";
import { Input } from "../ui/Input";
import { useThemeStore } from "../../store/useThemeStore";
import {
  exportVertical,
  samePath,
  type ClipDetails,
  type ClipOverlay,
  type ClipShape,
  type ExportProgress,
  type ExportedClip,
  type Span,
  type TrackLevel,
} from "../../services/clip-service";
import { TrackLevelControl, trackName } from "./ClipTimeline";
import { ClipIconButton } from "./ClipIconButton";
import { cn } from "../../lib/utils";
import { parseErrorMessage } from "../../utils/error-utils";
import { useTrimPreview } from "./useTrimPreview";
import { useEditHistory } from "./useEditHistory";
import {
  MIN_LENGTH,
  NUDGE,
  MIN_BOX,
  TICK_STEPS,
  MAX_TICKS,
  type NewOverlay,
  TOOLS,
  OVERLAY_NAME,
  OVERLAY_ICON,
  SHAPES,
  type Panel,
  FULL_EDITOR,
  OFFERED_PANELS,
  type LaneWindow,
  NO_WINDOW,
  type Translate,
  overlayTint,
  clamp,
  merged,
  hollowed,
  tidy,
  laneWindow,
  formatTime,
  formatTick,
} from "./editor/shared";
import { useFilmstrip } from "./editor/useFilmstrip";
import { useWindowDrag } from "./editor/useWindowDrag";
import { OverlayBox } from "./editor/OverlayPreview";
import { Lane, TrackLink, AudioLane, OverlayLane, Readout, Handle } from "./editor/Timeline";
import { PanelTitle, PropSlider, ShadeChoice, CornerChoice } from "./editor/Inspector";

interface BoxDrag {
  index: number;
  mode: "move" | "resize";
  fromX: number;
  fromY: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface BarDrag {
  index: number;
  mode: "move" | "start" | "end";
  fromX: number;
  startSeconds: number;
  endSeconds: number;
}

interface LaneTrim {
  stream: number;
  edge: "start" | "end";
}

type PartLane = "all" | "video" | number;

interface RenderProgress {
  done: number;
  total: number;
}

interface CaptureError {
  code: string;
}

interface Props {
  src: string;
  path: string;
  name: string;
  duration: number;
  busy: boolean;
  details: ClipDetails | null;
  onCancel: () => void;
  onSave: (
    startSeconds: number,
    endSeconds: number,
    levels: TrackLevel[],
    videoStartSeconds: number | null,
    videoEndSeconds: number | null,
  ) => void;
  t: Translate;
}

export function ClipTrimmer({
  src,
  path,
  name,
  duration,
  busy: saving,
  details,
  onCancel,
  onSave,
  t,
}: Props) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef<HTMLDivElement>(null);

  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [ratio, setRatio] = useState(16 / 9);
  const [overlays, setOverlays] = useState<ClipOverlay[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [shape, setShape] = useState<ClipShape>("original");
  const [panel, setPanel] = useState<Panel>(OFFERED_PANELS[0].id);
  const [boxDrag, setBoxDrag] = useState<BoxDrag | null>(null);
  const [barDrag, setBarDrag] = useState<BarDrag | null>(null);
  const [laneTrim, setLaneTrim] = useState<LaneTrim | null>(null);
  const [removed, setRemoved] = useState<Span[]>([]);
  const [splits, setSplits] = useState<number[]>([]);
  const [blanked, setBlanked] = useState<Span[]>([]);
  const [muted, setMuted] = useState<Record<number, Span[]>>({});
  const [pick, setPick] = useState<{ lane: PartLane; at: number } | null>(null);
  const [rendering, setRendering] = useState<RenderProgress | null>(null);
  const renderingRef = useRef(false);
  const leave = useRef(onCancel);
  useEffect(() => {
    leave.current = onCancel;
  }, [onCancel]);
  const busy = saving || rendering !== null;

  const lanes = useMemo(() => details?.audioTracks ?? [], [details]);
  const adjustable = useMemo(() => lanes.filter((track) => track.adjustable), [lanes]);
  const movable = useMemo(
    () => lanes.filter((track) => track.adjustable || lanes.length === 1),
    [lanes],
  );

  const [separate, setSeparate] = useState(false);
  const [picture, setPicture] = useState<LaneWindow>(NO_WINDOW);
  const [volumes, setVolumes] = useState<Record<number, number>>({});
  const [windows, setWindows] = useState<Record<number, LaneWindow>>({});

  const doc = useMemo(
    () => ({
      overlays,
      start,
      end,
      picture,
      windows,
      volumes,
      shape,
      separate,
      removed,
      splits,
      blanked,
      muted,
    }),
    [
      blanked,
      end,
      muted,
      overlays,
      picture,
      removed,
      separate,
      shape,
      splits,
      start,
      volumes,
      windows,
    ],
  );
  const restore = useCallback((saved: typeof doc) => {
    setOverlays(saved.overlays);
    setRemoved(saved.removed);
    setSplits(saved.splits);
    setBlanked(saved.blanked);
    setMuted(saved.muted);
    setStart(saved.start);
    setEnd(saved.end);
    setPicture(saved.picture);
    setWindows(saved.windows);
    setVolumes(saved.volumes);
    setShape(saved.shape);
    setSeparate(saved.separate);
  }, []);
  const history = useEditHistory(doc, restore, !busy);
  const { rebase } = history;

  useEffect(() => {
    setVolumes(Object.fromEntries(adjustable.map((track) => [track.stream, 100])));
    setWindows(Object.fromEntries(movable.map((track) => [track.stream, NO_WINDOW])));
    rebase();
  }, [adjustable, movable, rebase]);

  const shot = laneWindow(picture, start, end);

  const levels: TrackLevel[] = useMemo(
    () =>
      movable.map((track) => {
        const own = laneWindow(windows[track.stream], start, end);
        return {
          stream: track.stream,
          volume: volumes[track.stream] ?? 100,
          offsetSeconds: 0,
          startSeconds: own.start,
          endSeconds: own.end,
        };
      }),
    [end, movable, start, volumes, windows],
  );
  const rebalanced = levels.some(
    (level) =>
      level.volume !== 100 ||
      level.startSeconds !== null ||
      level.endSeconds !== null,
  );

  const previewState = useTrimPreview({
    path,
    video: videoRef,
    levels,
    muted,
    active: adjustable.length > 0,
  });

  const drawn = movable.length > 0 ? movable : lanes;

  const link = useCallback(
    (apart: boolean) => {
      setSeparate(apart);
      if (apart) {
        setPicture({ start: tidy(start), end: tidy(end) });
        setStart(0);
        setEnd(duration);
        return;
      }
      setStart(shot.from);
      setEnd(shot.to);
      setPicture(NO_WINDOW);
      setWindows(Object.fromEntries(movable.map((track) => [track.stream, NO_WINDOW])));
    },
    [duration, end, movable, shot.from, shot.to, start],
  );

  useEffect(() => {
    if (duration > 0) setEnd((current) => (current === 0 ? duration : Math.min(current, duration)));
    rebase();
  }, [duration, rebase]);

  const filmstrip = useFilmstrip(src, duration);

  const percent = useCallback(
    (seconds: number) => (duration > 0 ? (seconds / duration) * 100 : 0),
    [duration],
  );

  const ticks = useMemo(() => {
    if (duration <= 0) return [];
    const step = TICK_STEPS.find((entry) => duration / entry <= MAX_TICKS) ?? 600;
    const out: number[] = [];
    for (let at = 0; at <= duration + 0.001; at += step) out.push(at);
    return out;
  }, [duration]);

  const seek = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (video) video.currentTime = Math.max(0, Math.min(seconds, duration));
    },
    [duration],
  );

  const secondsAt = useCallback(
    (clientX: number) => {
      const scale = scaleRef.current;
      if (!scale || duration <= 0) return 0;
      const rect = scale.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
    },
    [duration],
  );

  const scrubTo = useCallback(
    (clientX: number) => {
      const seconds = secondsAt(clientX);
      seek(seconds);
      setPlayhead(seconds);
    },
    [secondsAt, seek],
  );

  useWindowDrag(
    scrubbing,
    (event) => scrubTo(event.clientX),
    () => setScrubbing(false),
  );

  const moveHandle = useCallback(
    (which: "start" | "end", seconds: number) => {
      if (separate) {
        const next =
          which === "start"
            ? clamp(seconds, start, shot.to - MIN_LENGTH)
            : clamp(seconds, shot.from + MIN_LENGTH, end);
        setPicture(
          which === "start"
            ? { start: tidy(next), end: shot.end }
            : { start: shot.start, end: tidy(next) },
        );
        seek(next);
        return;
      }
      if (which === "start") {
        const next = Math.max(0, Math.min(seconds, end - MIN_LENGTH));
        setStart(next);
        seek(next);
      } else {
        const next = Math.min(duration, Math.max(seconds, start + MIN_LENGTH));
        setEnd(next);
        seek(next);
      }
    },
    [duration, end, seek, separate, shot.end, shot.from, shot.start, shot.to, start],
  );

  useWindowDrag(
    dragging,
    (event, dragging) => moveHandle(dragging, secondsAt(event.clientX)),
    () => setDragging(null),
  );

  const editOverlay = useCallback((index: number, patch: Partial<ClipOverlay>) => {
    setOverlays((current) =>
      current.map((overlay, at) =>
        at === index ? ({ ...overlay, ...patch } as ClipOverlay) : overlay,
      ),
    );
  }, []);

  const addOverlay = useCallback(
    (seed: NewOverlay) => {
      setOverlays((current) => [
        ...current,
        {
          ...seed,
          left: 0.25,
          top: 0.25,
          width: 0.5,
          height: 0.5,
          startSeconds: start,
          endSeconds: end,
        },
      ]);
      setChosen(overlays.length);
    },
    [end, overlays.length, start],
  );

  const dropOverlay = useCallback((index: number) => {
    setOverlays((current) => current.filter((_, at) => at !== index));
    setChosen(null);
  }, []);

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
        editOverlay(boxDrag.index, {
          width: clamp(boxDrag.width + byX, MIN_BOX, 1 - boxDrag.left),
          height: clamp(boxDrag.height + byY, MIN_BOX, 1 - boxDrag.top),
        });
      }
    },
    () => setBoxDrag(null),
  );

  useWindowDrag(
    barDrag,
    (event, barDrag) => {
      const rect = scaleRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || duration <= 0) return;
      const by = ((event.clientX - barDrag.fromX) / rect.width) * duration;
      if (barDrag.mode === "move") {
        const span = barDrag.endSeconds - barDrag.startSeconds;
        const from = clamp(barDrag.startSeconds + by, 0, duration - span);
        editOverlay(barDrag.index, { startSeconds: from, endSeconds: from + span });
      } else if (barDrag.mode === "start") {
        editOverlay(barDrag.index, {
          startSeconds: clamp(barDrag.startSeconds + by, 0, barDrag.endSeconds - MIN_LENGTH),
        });
      } else {
        editOverlay(barDrag.index, {
          endSeconds: clamp(barDrag.endSeconds + by, barDrag.startSeconds + MIN_LENGTH, duration),
        });
      }
    },
    () => setBarDrag(null),
  );

  const trimTrack = useCallback(
    (stream: number, edge: "start" | "end", seconds: number) => {
      setWindows((current) => {
        const own = laneWindow(current[stream], start, end);
        return {
          ...current,
          [stream]:
            edge === "start"
              ? { start: tidy(clamp(seconds, start, own.to - MIN_LENGTH)), end: own.end }
              : { start: own.start, end: tidy(clamp(seconds, own.from + MIN_LENGTH, end)) },
        };
      });
    },
    [end, start],
  );

  useWindowDrag(
    laneTrim,
    (event, laneTrim) => trimTrack(laneTrim.stream, laneTrim.edge, secondsAt(event.clientX)),
    () => setLaneTrim(null),
  );

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

  useEffect(() => {
    const video = videoRef.current;
    const quiet = previewState === "live" ? [] : hushed;
    if (!video || (removed.length === 0 && quiet.length === 0)) return;
    let frame = 0;
    const hop = () => {
      const now = video.currentTime;
      const hole = removed.find((span) => now >= span.startSeconds && now < span.endSeconds);
      if (hole) video.currentTime = hole.endSeconds;
      if (quiet.length > 0) {
        video.muted = quiet.some((span) => now >= span.startSeconds && now < span.endSeconds);
      }
      if (!video.paused) frame = requestAnimationFrame(hop);
    };
    const onPlay = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(hop);
    };
    video.addEventListener("play", onPlay);
    if (!video.paused) onPlay();
    return () => {
      video.removeEventListener("play", onPlay);
      cancelAnimationFrame(frame);
      if (quiet.length > 0) video.muted = false;
    };
  }, [hushed, previewState, removed]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let alive = true;

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stops = await Promise.all([
        listen<ExportProgress>("clip_export_progress", (event) => {
          if (!renderingRef.current || !samePath(event.payload.source, path)) return;
          setRendering({ done: event.payload.done, total: event.payload.total });
        }),
        listen<ExportedClip>("clip_exported", (event) => {
          if (!renderingRef.current || !samePath(event.payload.source, path)) return;
          renderingRef.current = false;
          setRendering(null);
          toast.success(t("clips.trim.saved"));
          leave.current();
        }),
        listen<CaptureError>("clip_error", (event) => {
          if (!renderingRef.current) return;
          if (event.payload.code !== "clip_write" && event.payload.code !== "protocol") return;
          renderingRef.current = false;
          setRendering(null);
          toast.error(t("clips.trim.failed"));
        }),
      ]);
      if (!alive) {
        stops.forEach((off) => off());
        return;
      }
      stop = () => stops.forEach((off) => off());
    })();

    return () => {
      alive = false;
      stop?.();
    };
  }, [path, t]);

  const save = useCallback(async () => {
    if (
      overlays.length === 0 &&
      shape === "original" &&
      removed.length === 0 &&
      blanked.length === 0 &&
      hushed.length === 0
    ) {
      onSave(start, end, levels, shot.start, shot.end);
      return;
    }
    renderingRef.current = true;
    setRendering({ done: 0, total: 0 });
    try {
      await exportVertical(path, shape, overlays, {
        startSeconds: start,
        endSeconds: end,
        levels,
        videoStartSeconds: shot.start,
        videoEndSeconds: shot.end,
        removed,
        blanked,
        muted: hushed,
      });
    } catch (e) {
      console.error("Could not render the clip", e);
      renderingRef.current = false;
      setRendering(null);
      toast.error(parseErrorMessage(e));
    }
  }, [
    blanked,
    end,
    hushed,
    levels,
    onSave,
    overlays,
    path,
    removed,
    shape,
    shot.end,
    shot.start,
    start,
  ]);

  const guide = useMemo(() => {
    const target = SHAPES.find((entry) => entry.choice === shape)?.ratio;
    if (!target || ratio <= 0) return null;
    return ratio > target
      ? { width: target / ratio, height: 1 }
      : { width: 1, height: ratio / target };
  }, [ratio, shape]);

  const picked = chosen === null ? null : (overlays[chosen] ?? null);

  const exportPercent =
    rendering && rendering.total > 0
      ? Math.round((rendering.done / rendering.total) * 100)
      : null;

  const preview = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (video.currentTime < start || video.currentTime >= end - 0.05) video.currentTime = start;
    void video.play().catch(() => {});
  }, [end, start]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setPlayhead(video.currentTime);
      if (!video.paused && video.currentTime >= end) video.pause();
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [end]);

  const shapeLabel = SHAPES.find((entry) => entry.choice === shape)?.label ?? SHAPES[0].label;

  const clipMasks = (from: number, to: number) => (
    <>
      <div
        className="absolute inset-y-0 left-0 bg-black/70"
        style={{ width: `${percent(from)}%` }}
      />
      <div
        className="absolute inset-y-0 right-0 bg-black/70"
        style={{ width: `${100 - percent(to)}%` }}
      />
      <div
        className="absolute inset-y-0 border-x-2"
        style={{
          left: `${percent(from)}%`,
          width: `${percent(Math.max(0, to - from))}%`,
          borderColor: accentColor.value,
        }}
      />
    </>
  );

  const clipHandles = (from: number, to: number) => (
    <>
      <Handle
        left={percent(from)}
        active={dragging === "start"}
        time={formatTime(from)}
        label={t("clips.trim.handle_start")}
        color={accentColor.value}
        onGrab={() => setDragging("start")}
        onNudge={(by) => moveHandle("start", from + by)}
      />
      <Handle
        left={percent(to)}
        active={dragging === "end"}
        time={formatTime(to)}
        label={t("clips.trim.handle_end")}
        color={accentColor.value}
        onGrab={() => setDragging("end")}
        onNudge={(by) => moveHandle("end", to + by)}
      />
    </>
  );

  const highlight = (span: Span) => (
    <div
      className="absolute inset-y-0 rounded-md border-2"
      style={{
        left: `${percent(span.startSeconds)}%`,
        width: `${percent(span.endSeconds - span.startSeconds)}%`,
        borderColor: accentColor.value,
        backgroundColor: `${accentColor.value}1f`,
      }}
    />
  );

  const gapBlock = (span: Span, key: number, onRestore: () => void) => (
    <div
      key={key}
      className="absolute inset-y-0 border-x border-dashed border-white/30 bg-[#08080b]/90"
      style={{
        left: `${percent(span.startSeconds)}%`,
        width: `${percent(span.endSeconds - span.startSeconds)}%`,
      }}
    >
      <button
        type="button"
        aria-label={t("clips.editor.remove.restore")}
        title={t("clips.editor.remove.restore")}
        disabled={busy}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onRestore}
        className="pointer-events-auto absolute left-1/2 top-0.5 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full text-white/40 transition-colors hover:text-white"
      >
        <Icon icon="solar:restart-bold" className="h-3 w-3" />
      </button>
    </div>
  );

  const laneMarks = (lane: PartLane, gaps: Span[], restore: (index: number) => void) => (
    <div className="pointer-events-none absolute inset-0">
      {part?.lane === lane && highlight(part.span)}
      {gaps.map((span, index) => gapBlock(span, index, () => restore(index)))}
    </div>
  );

  const darkened = blanked.some((span) => playhead >= span.startSeconds && playhead < span.endSeconds);

  return (
    <div className="fixed inset-0 z-[1000] flex bg-black/70 p-4 backdrop-blur-md-anyos">
      <div
        className="relative flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-b-2"
        style={{
          backgroundColor: `${accentColor.value}20`,
          borderColor: `${accentColor.value}80`,
          borderBottomColor: accentColor.value,
        }}
      >
      <header
        className="relative flex shrink-0 items-center gap-3 border-b-2 px-5 py-3.5"
        style={{
          borderColor: `${accentColor.value}60`,
          backgroundColor: `${accentColor.value}30`,
        }}
      >
        <Icon
          icon="solar:videocamera-record-bold"
          className="h-6 w-6 shrink-0"
          style={{ color: accentColor.value }}
        />
        <span
          title={name}
          className="max-w-[20rem] truncate font-minecraft text-lg normal-case text-white"
        >
          {name}
        </span>

        <span className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1 font-smallcaps text-xs uppercase tracking-wider text-white/50">
          {t("clips.editor.shape.label")}: {t(shapeLabel)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={busy}
            icon={<Icon icon="solar:close-circle-bold" className="w-4 h-4" />}
          >
            {t("clips.editor.exit")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => void save()}
            disabled={busy || kept < MIN_LENGTH}
            icon={
              <Icon
                icon={busy ? "svg-spinners:ring-resize" : "solar:scissors-bold"}
                className="w-4 h-4"
              />
            }
          >
            {t("clips.trim.save")}
          </Button>
        </div>

        {rendering && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
            <span
              className={cn(
                "block h-full transition-[width] duration-200",
                exportPercent === null && "w-1/3 animate-pulse",
              )}
              style={{
                backgroundColor: accentColor.value,
                width: exportPercent === null ? undefined : `${Math.max(2, exportPercent)}%`,
              }}
            />
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[5rem] shrink-0 flex-col gap-2 border-r border-white/10 bg-black/20 p-3">
          {OFFERED_PANELS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setPanel(entry.id)}
              aria-pressed={panel === entry.id}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 transition-colors",
                panel === entry.id
                  ? "text-white"
                  : "border-white/10 bg-black/20 text-white/50 hover:border-white/20 hover:text-white",
              )}
              style={
                panel === entry.id
                  ? { borderColor: accentColor.value, backgroundColor: `${accentColor.value}25` }
                  : undefined
              }
            >
              <Icon icon={entry.icon} className="h-5 w-5" />
              <span className="font-smallcaps text-[0.6rem] uppercase tracking-wider">
                {t(entry.label)}
              </span>
            </button>
          ))}
        </nav>

        <aside className="custom-scrollbar flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/10 bg-black/20 p-4">
          {panel === "tools" && (
            <>
              <PanelTitle color={accentColor.value}>{t("clips.editor.tools")}</PanelTitle>
              <div className="flex flex-col gap-2">
                {TOOLS.map((tool) => (
                  <button
                    key={tool.seed.kind}
                    type="button"
                    onClick={() => addOverlay(tool.seed)}
                    disabled={busy}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-left font-minecraft text-sm text-white/80 transition-colors hover:border-white/20 hover:text-white",
                      busy && "cursor-not-allowed opacity-40",
                    )}
                  >
                    <Icon icon={tool.icon} className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{t(tool.label)}</span>
                    <Icon icon="solar:add-circle-bold" className="h-4 w-4 shrink-0 text-white/30" />
                  </button>
                ))}
              </div>
              <p className="font-minecraft text-xs leading-relaxed text-white/50">
                {t("clips.editor.tools.hint")}
              </p>
            </>
          )}

          {panel === "audio" && (
            <>
              <PanelTitle color={accentColor.value}>{t("clips.editor.audio")}</PanelTitle>
              {adjustable.length === 0 ? (
                <p className="font-minecraft text-xs leading-relaxed text-white/50">
                  {t("clips.editor.audio.none")}
                </p>
              ) : (
                <>
                  {adjustable.map((track) => (
                    <TrackLevelControl
                      key={track.stream}
                      track={track}
                      name={trackName(track.label, t)}
                      volume={volumes[track.stream] ?? 100}
                      onChange={(volume) =>
                        setVolumes((current) => ({ ...current, [track.stream]: volume }))
                      }
                      disabled={busy}
                      t={t}
                    />
                  ))}
                  <p className="font-minecraft text-xs leading-relaxed text-white/50">
                    {previewState === "live"
                      ? t("clips.trim.levels.live")
                      : previewState === "loading"
                        ? t("clips.trim.levels.preparing")
                        : rebalanced
                          ? t("clips.trim.levels.rebuilt")
                          : t("clips.trim.levels.untouched")}
                  </p>
                </>
              )}
              <p className="font-minecraft text-xs leading-relaxed text-white/40">
                {t("clips.editor.audio.shift")}
              </p>
            </>
          )}

          {panel === "format" && (
            <>
              <PanelTitle color={accentColor.value}>{t("clips.editor.shape.label")}</PanelTitle>
              <div className="grid grid-cols-2 gap-2">
                {SHAPES.map((entry) => (
                  <button
                    key={entry.choice}
                    type="button"
                    onClick={() => setShape(entry.choice)}
                    disabled={busy}
                    className={cn(
                      "rounded-lg border px-2 py-2.5 font-minecraft text-xs transition-colors",
                      shape === entry.choice
                        ? "text-white"
                        : "border-white/10 bg-black/20 text-white/60 hover:border-white/20 hover:text-white",
                      busy && "cursor-not-allowed opacity-40",
                    )}
                    style={
                      shape === entry.choice
                        ? { borderColor: accentColor.value, backgroundColor: `${accentColor.value}30` }
                        : undefined
                    }
                  >
                    {t(entry.label)}
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-6">
          <div
            ref={frameRef}
            className="relative w-full overflow-hidden rounded-lg border border-white/10 bg-black shadow-2xl"
            style={{
              aspectRatio: `${ratio}`,
              maxWidth: `calc(48vh * ${ratio})`,
              containerType: "size",
            }}
          >
            <video
              ref={videoRef}
              src={src}
              className="block h-full w-full object-contain"
              onClick={preview}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                  setRatio(video.videoWidth / video.videoHeight);
                }
              }}
            />

            {!playing && (
              <button
                type="button"
                onClick={preview}
                aria-label={t("clips.trim.preview")}
                className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[2px] transition-colors hover:bg-black/40"
              >
                <span
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-white/20"
                  style={{ backgroundColor: `${accentColor.value}40` }}
                >
                  <Icon icon="solar:play-bold" className="h-7 w-7 text-white" />
                </span>
              </button>
            )}

            {darkened && <div className="pointer-events-none absolute inset-0 bg-black" />}

            {guide && (
              <div
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-2"
                style={{
                  width: `${guide.width * 100}%`,
                  height: `${guide.height * 100}%`,
                  borderColor: accentColor.value,
                  boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
                }}
              />
            )}

            {overlays.map((overlay, index) => (
              <OverlayBox
                key={index}
                overlay={overlay}
                ratio={ratio}
                active={chosen === index}
                visible={playhead >= overlay.startSeconds && playhead <= overlay.endSeconds}
                color={accentColor.value}
                label={t(OVERLAY_NAME[overlay.kind], { index: index + 1 })}
                onPick={() => setChosen(index)}
                onGrab={(mode, event) => {
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
                  });
                }}
              />
            ))}
          </div>
        </main>

        <aside className="custom-scrollbar flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-black/20 p-4">
          <PanelTitle color={accentColor.value}>{t("clips.editor.inspector")}</PanelTitle>

          {picked === null || chosen === null ? (
            <p className="font-minecraft text-xs leading-relaxed text-white/50">
              {t("clips.editor.inspector.empty")}
            </p>
          ) : (
            <>
              <div
                className="flex items-center gap-2 rounded-lg border px-3 py-2.5"
                style={{
                  borderColor: `${accentColor.value}80`,
                  backgroundColor: `${accentColor.value}20`,
                }}
              >
                <Icon
                  icon={OVERLAY_ICON[picked.kind]}
                  className="h-4 w-4 shrink-0"
                  style={{ color: overlayTint(picked, accentColor.value) }}
                />
                <span className="min-w-0 flex-1 truncate font-minecraft text-sm text-white">
                  {t(OVERLAY_NAME[picked.kind], { index: chosen + 1 })}
                </span>
                <ClipIconButton
                  icon="solar:trash-bin-trash-bold"
                  label={t("clips.editor.overlay.remove")}
                  tone="danger"
                  tooltipPosition="bottom"
                  onClick={() => dropOverlay(chosen)}
                  disabled={busy}
                />
              </div>

              <p className="font-minecraft text-xs text-white/50">
                {t("clips.editor.overlay.window", {
                  from: formatTime(picked.startSeconds),
                  to: formatTime(picked.endSeconds),
                })}
              </p>

              {picked.kind === "blur" && (
                <PropSlider
                  label={t("clips.editor.overlay.strength")}
                  value={picked.strength}
                  min={1}
                  max={64}
                  disabled={busy}
                  onChange={(strength) => editOverlay(chosen, { strength })}
                />
              )}

              {picked.kind === "box" && (
                <ShadeChoice
                  label={t("clips.editor.overlay.colour")}
                  value={picked.colour}
                  disabled={busy}
                  onChange={(colour) => editOverlay(chosen, { colour })}
                  t={t}
                />
              )}

              {picked.kind === "arrow" && (
                <>
                  <ShadeChoice
                    label={t("clips.editor.overlay.colour")}
                    value={picked.colour}
                    disabled={busy}
                    onChange={(colour) => editOverlay(chosen, { colour })}
                    t={t}
                  />
                  <PropSlider
                    label={t("clips.editor.overlay.thickness")}
                    value={picked.thickness}
                    min={1}
                    max={32}
                    disabled={busy}
                    onChange={(thickness) => editOverlay(chosen, { thickness })}
                  />
                  <CornerChoice
                    label={t("clips.editor.overlay.towards")}
                    value={picked.towards}
                    color={accentColor.value}
                    disabled={busy}
                    onChange={(towards) => editOverlay(chosen, { towards })}
                    t={t}
                  />
                </>
              )}

              {picked.kind === "text" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="font-minecraft text-sm text-white/80">
                      {t("clips.editor.overlay.text")}
                    </span>
                    <Input
                      size="sm"
                      value={picked.content}
                      disabled={busy}
                      placeholder={t("clips.editor.overlay.text_placeholder")}
                      aria-label={t("clips.editor.overlay.text")}
                      onChange={(event) => editOverlay(chosen, { content: event.target.value })}
                    />
                  </div>
                  <PropSlider
                    label={t("clips.editor.overlay.size")}
                    value={picked.size}
                    min={8}
                    max={240}
                    disabled={busy}
                    onChange={(size) => editOverlay(chosen, { size })}
                  />
                  <ShadeChoice
                    label={t("clips.editor.overlay.colour")}
                    value={picked.colour}
                    disabled={busy}
                    onChange={(colour) => editOverlay(chosen, { colour })}
                    t={t}
                  />
                  {picked.content.trim() === "" && (
                    <p className="flex items-start gap-2 font-minecraft text-xs leading-relaxed text-amber-300">
                      <Icon icon="solar:danger-triangle-bold" className="mt-0.5 h-4 w-4 shrink-0" />
                      {t("clips.editor.overlay.text_empty")}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </aside>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-white/10 bg-black/20 px-5 py-3">
        <ClipIconButton
          icon="solar:restart-bold"
          label={t("clips.editor.transport.to_start")}
          tooltipPosition="top"
          onClick={() => {
            seek(start);
            setPlayhead(start);
          }}
        />
        <ClipIconButton
          icon={playing ? "solar:pause-bold" : "solar:play-bold"}
          label={playing ? t("clips.editor.transport.pause") : t("clips.trim.preview")}
          tooltipPosition="top"
          onClick={preview}
        />
        <ClipIconButton
          icon="solar:undo-left-bold"
          label={t("clips.editor.transport.undo")}
          tooltipPosition="top"
          onClick={history.undo}
          disabled={!history.canUndo}
        />
        <ClipIconButton
          icon="solar:undo-right-bold"
          label={t("clips.editor.transport.redo")}
          tooltipPosition="top"
          onClick={history.redo}
          disabled={!history.canRedo}
        />
        {FULL_EDITOR && (
          <>
            <ClipIconButton
              icon="solar:scissors-square-bold"
              label={t("clips.editor.transport.split")}
              tooltipPosition="top"
              onClick={split}
              disabled={busy || !canSplit}
            />
            <ClipIconButton
              icon="solar:trash-bin-trash-bold"
              label={t("clips.editor.transport.remove")}
              tooltipPosition="top"
              onClick={cutPart}
              disabled={busy || !cuttable}
            />
          </>
        )}

        <span className="ml-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1 font-minecraft text-sm tabular-nums text-white/90">
          {formatTime(playhead)}
          <span className="text-white/40"> / {formatTime(duration)}</span>
        </span>

        <div className="ml-auto flex items-center gap-6">
          <Readout label={t("clips.trim.from")} value={formatTime(shot.from)} />
          <Readout
            label={t("clips.trim.kept_label")}
            value={`${kept.toFixed(1)} s`}
            strong
          />
          <Readout label={t("clips.trim.to")} value={formatTime(shot.to)} />
        </div>
      </div>

      <div className="custom-scrollbar max-h-[34vh] shrink-0 overflow-y-auto border-t border-white/10 bg-black/20 px-5 py-3">
        {FULL_EDITOR && movable.length > 0 && (
          <div className="mb-2.5 flex items-center gap-3">
            <TrackLink
              separate={separate}
              color={accentColor.value}
              disabled={busy}
              onChange={link}
              t={t}
            />
            {separate && (
              <p className="min-w-0 truncate font-minecraft text-xs text-white/50">
                {t("clips.editor.link.hint")}
              </p>
            )}
          </div>
        )}

        <div className="relative flex select-none flex-col gap-1.5">
          <div className="flex">
            <div className="w-44 shrink-0" />
            <div
              ref={scaleRef}
              role="presentation"
              onPointerDown={(event) => {
                scrubTo(event.clientX);
                setScrubbing(true);
              }}
              className="relative h-5 flex-1 cursor-ew-resize"
            >
              {ticks.map((at) => (
                <span
                  key={at}
                  className="absolute bottom-0 top-0 border-l border-white/20 pl-1 font-minecraft text-[0.6rem] leading-5 text-white/40"
                  style={{ left: `${percent(at)}%` }}
                >
                  {formatTick(at)}
                </span>
              ))}
            </div>
          </div>

          <Lane
            icon="solar:videocamera-bold"
            name={t("clips.editor.timeline.video")}
            tint={accentColor.value}
            height="h-14"
            active={pick?.lane === "video"}
            onPick={() => setPick({ lane: "video", at: playhead })}
            onScrub={(clientX) => {
              scrubTo(clientX);
              setScrubbing(true);
              setPick({ lane: "video", at: secondsAt(clientX) });
            }}
          >
            {filmstrip ? (
              <img
                src={filmstrip}
                alt=""
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-90"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Icon icon="svg-spinners:ring-resize" className="h-4 w-4 text-white/40" />
              </div>
            )}

            {laneMarks("video", blanked, (index) =>
              setBlanked((current) => current.filter((_, at) => at !== index)),
            )}

            {separate && (
              <div className="pointer-events-none absolute inset-0 z-10">
                {clipMasks(shot.from, shot.to)}
                {clipHandles(shot.from, shot.to)}
              </div>
            )}
          </Lane>

          {drawn.map((track) => {
            const own = laneWindow(windows[track.stream], start, end);
            const apart = separate && (track.adjustable || lanes.length === 1);
            return (
              <AudioLane
                key={track.stream}
                track={track}
                name={trackName(track.label, t)}
                movable={apart}
                volume={track.adjustable ? (volumes[track.stream] ?? 100) : 100}
                duration={duration}
                tone={accentColor.light}
                disabled={busy}
                clipFrom={start}
                clipTo={end}
                from={own.from}
                to={own.to}
                trimmed={own.start !== null || own.end !== null}
                trimming={laneTrim?.stream === track.stream ? laneTrim.edge : null}
                onChange={(volume) =>
                  setVolumes((current) => ({ ...current, [track.stream]: volume }))
                }
                active={pick?.lane === track.stream}
                onSelect={() => setPick({ lane: track.stream, at: playhead })}
                onPick={(clientX) => {
                  scrubTo(clientX);
                  setScrubbing(true);
                  setPick({ lane: track.stream, at: secondsAt(clientX) });
                }}
                marks={laneMarks(track.stream, muted[track.stream] ?? [], (index) =>
                  setMuted((current) => ({
                    ...current,
                    [track.stream]: (current[track.stream] ?? []).filter((_, at) => at !== index),
                  })),
                )}
                onTrim={(edge) => setLaneTrim({ stream: track.stream, edge })}
                onTrimNudge={(edge, by) =>
                  trimTrack(track.stream, edge, (edge === "start" ? own.from : own.to) + by)
                }
                onTrimReset={() =>
                  setWindows((current) => ({ ...current, [track.stream]: NO_WINDOW }))
                }
                t={t}
              />
            );
          })}

          {overlays.map((overlay, index) => (
            <OverlayLane
              key={index}
              overlay={overlay}
              duration={duration}
              active={chosen === index}
              accent={accentColor.value}
              name={t(OVERLAY_NAME[overlay.kind], { index: index + 1 })}
              onPick={() => setChosen(index)}
              onGrab={(mode, event) => {
                setChosen(index);
                setBarDrag({
                  index,
                  mode,
                  fromX: event.clientX,
                  startSeconds: overlay.startSeconds,
                  endSeconds: overlay.endSeconds,
                });
              }}
            />
          ))}

          <div className="pointer-events-none absolute inset-y-0 left-44 right-0">
            {!separate && clipMasks(start, end)}
            {part?.lane === "all" && highlight(part.span)}
            {removed.map((span, index) =>
              gapBlock(span, index, () =>
                setRemoved((current) => current.filter((_, at) => at !== index)),
              ),
            )}
            {splits.map((at) => (
              <div
                key={at}
                className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/70"
                style={{ left: `${percent(at)}%` }}
              >
                <button
                  type="button"
                  aria-label={t("clips.editor.split.remove")}
                  title={t("clips.editor.split.remove")}
                  disabled={busy}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setSplits((current) => current.filter((other) => other !== at))}
                  className="group pointer-events-auto absolute left-1/2 top-0 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full border border-white/30 bg-black/80 text-white/70 transition-colors hover:text-white"
                >
                  <Icon icon="solar:scissors-bold" className="h-2.5 w-2.5 group-hover:hidden" />
                  <Icon icon="solar:close-circle-bold" className="hidden h-3.5 w-3.5 group-hover:block" />
                </button>
              </div>
            ))}
            <div
              className="absolute inset-y-0 w-px bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]"
              style={{ left: `${percent(playhead)}%` }}
            />

            {!separate && clipHandles(start, end)}
          </div>
        </div>

        <p className="mt-2.5 min-h-[1.25rem] font-minecraft text-xs text-white/50">
          {removed.length > 0 || splits.length > 0
            ? t("clips.editor.remove.hint")
            : overlays.length > 0
              ? t("clips.editor.overlay.hint")
              : t("clips.trim.hint")}
        </p>
      </div>
      </div>
    </div>
  );
}
