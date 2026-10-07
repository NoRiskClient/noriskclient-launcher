"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "react-hot-toast";
import { Group, Panel as LayoutPanel, useDefaultLayout, usePanelRef } from "react-resizable-panels";

import { Button } from "../ui/buttons/Button";
import { WindowFrame } from "../ui/WindowFrame";
import { useThemeStore } from "../../store/useThemeStore";
import {
  type ClipDetails,
  type ClipShape,
  type Span,
  type TrackLevel,
  revealClip,
} from "../../services/clip-service";
import { TrackLevelControl, trackName } from "./ClipTimeline";
import { ClipIconButton } from "./ClipIconButton";
import { cn } from "../../lib/utils";
import { useTrimPreview } from "./useTrimPreview";
import { usePlayback } from "./usePlayback";
import { typing, useEditHistory } from "./useEditHistory";
import { parseErrorMessage } from "../../utils/error-utils";
import { useGlobalModalStore } from "../../hooks/useGlobalModal";
import { useClipRender } from "./useClipRender";
import {
  MIN_LENGTH,
  TOOLS,
  OVERLAY_NAME,
  SHAPES,
  type Panel,
  FULL_EDITOR,
  OFFERED_PANELS,
  type LaneWindow,
  NO_WINDOW,
  type Translate,
  clamp,
  tidy,
  laneWindow,
  formatTime,
  timeView,
} from "./editor/shared";
import { useFilmstrip } from "./editor/useFilmstrip";
import { useWindowDrag } from "./editor/useWindowDrag";
import { BlankCover, PlayheadClock, PlayheadMark, usePlayhead } from "./editor/Playhead";
import { useCuts, type MarkEdge, type PartLane } from "./editor/useCuts";
import { useOverlays } from "./editor/useOverlays";
import { OverlayBox } from "./editor/OverlayPreview";
import { EditorHelpModal, EditorMenuBar, shortcutText, type MenuDef } from "./editor/EditorMenuBar";
import {
  Ruler,
  Lane,
  TrackLink,
  AudioLane,
  OverlayLane,
  Readout,
  ClipMasks,
  ClipHandles,
  CutRange,
  GapBlock,
  JoinMark,
  Pieces,
} from "./editor/Timeline";
import { PanelTitle, OverlayInspector } from "./editor/Inspector";
import {
  COLUMNS_ID,
  ROWS_ID,
  SIDE,
  INSPECTOR,
  TIMELINE,
  STAGE_MIN,
  MAIN_MIN,
  HIT_AREA,
  CARD,
  PANEL_HEAD,
  layoutStorage,
  clearSavedLayout,
  ResizeBar,
  EdgeGrip,
} from "./editor/EditorLayout";

interface LaneTrim {
  stream: number;
  edge: "start" | "end";
}

interface Props {
  src: string;
  path: string;
  name: string;
  duration: number;
  busy: boolean;
  paused?: boolean;
  details: ClipDetails | null;
  detailsStatus?: "loading" | "ready" | "error";
  onRetryDetails?: () => void;
  onCancel: () => void;
  onStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
  onSave: (
    startSeconds: number,
    endSeconds: number,
    levels: TrackLevel[],
    videoStartSeconds: number | null,
    videoEndSeconds: number | null,
  ) => Promise<boolean>;
  t: Translate;
}

const STEP_SECONDS = 1 / 30;

const CONTROLS = "button, input, select, a[href], [role=button], [role=slider], [role=separator], [role=menuitem]";

export function ClipTrimmer({
  src,
  path,
  name,
  duration,
  busy: saving,
  paused = false,
  details,
  detailsStatus = details ? "ready" : "loading",
  onRetryDetails,
  onCancel,
  onStateChange,
  onSave,
  t,
}: Props) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const videoRef = useRef<HTMLVideoElement>(null);
  const standbyRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const { playhead, live, moveTo, follow } = usePlayhead(videoRef);

  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(() => (Number.isFinite(duration) && duration > 0 ? duration : 0));
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const [ratio, setRatio] = useState(16 / 9);
  const [shape, setShape] = useState<ClipShape>("original");
  const [panel, setPanel] = useState<Panel>(OFFERED_PANELS[0].id);
  const activePanel = OFFERED_PANELS.find((entry) => entry.id === panel) ?? OFFERED_PANELS[0];
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [laneTrim, setLaneTrim] = useState<LaneTrim | null>(null);
  const [markDrag, setMarkDrag] = useState<{ edge: MarkEdge; offset: number } | null>(null);
  const markSavedRef = useRef<() => void>(() => {});
  const markSaved = useCallback(() => markSavedRef.current(), []);
  const render = useClipRender({ path, onDone: markSaved, onTrim: onSave, t });
  const busy = saving || render.rendering;

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

  const shot = laneWindow(picture, start, end);
  const cuts = useCuts({ playhead, separate, start, end, shot, windows });
  const {
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
  } = cuts;

  const view = useMemo(() => timeView(removed, duration), [duration, removed]);
  const overlayEdit = useOverlays({ start, end, view, frameRef, scaleRef });
  const {
    overlays,
    chosen,
    setChosen,
    picked,
    editOverlay,
    addOverlay,
    dropOverlay,
    grabBox,
    grabBar,
  } = overlayEdit;

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
      cuts: cuts.snapshot,
    }),
    [cuts.snapshot, end, overlays, picture, separate, shape, start, volumes, windows],
  );
  const restore = useCallback((saved: typeof doc) => {
    overlayEdit.restore(saved.overlays);
    cuts.restore(saved.cuts);
    setStart(saved.start);
    setEnd(saved.end);
    setPicture(saved.picture);
    setWindows(saved.windows);
    setVolumes(saved.volumes);
    setShape(saved.shape);
    setSeparate(saved.separate);
  }, [cuts.restore, overlayEdit.restore]);
  const held = paused || helpOpen;
  const history = useEditHistory(doc, restore, !busy, held);
  const { rebase } = history;

  useEffect(() => {
    onStateChange?.({ dirty: history.dirty, busy });
  }, [busy, history.dirty, onStateChange]);

  useEffect(() => {
    markSavedRef.current = history.markSaved;
  }, [history.markSaved]);

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
    standby: standbyRef,
    levels,
    muted,
    active: adjustable.length > 0,
  });

  const { playing, buffering, toggle: preview, settle } = usePlayback({
    video: videoRef,
    standby: standbyRef,
    start,
    end,
    removed,
    quiet: hushed,
    ownsSound: previewState !== "live",
    onTime: follow,
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

  const seek = useCallback(
    (seconds: number) => {
      settle();
      const video = videoRef.current;
      if (video) video.currentTime = Math.max(0, Math.min(seconds, duration));
    },
    [duration, settle],
  );

  const jump = useCallback(
    (to: number) => {
      const at = Math.min(Math.max(to, start), end);
      seek(at);
      moveTo(at);
    },
    [end, moveTo, seek, start],
  );

  const viewAt = useCallback(
    (clientX: number) => {
      const scale = scaleRef.current;
      if (!scale || view.length <= 0) return 0;
      const rect = scale.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * view.length;
    },
    [view],
  );

  const secondsAt = useCallback((clientX: number) => view.fromView(viewAt(clientX)), [view, viewAt]);

  const scrubTo = useCallback(
    (clientX: number) => {
      const seconds = secondsAt(clientX);
      seek(seconds);
      moveTo(seconds);
    },
    [moveTo, secondsAt, seek],
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

  useWindowDrag(
    markDrag,
    (event, markDrag) => reshapeMark(markDrag.edge, view.fromView(viewAt(event.clientX) - markDrag.offset)),
    () => setMarkDrag(null),
  );

  const grabMark = useCallback(
    (edge: MarkEdge, clientX: number) =>
      setMarkDrag({ edge, offset: edge === "move" && mark ? viewAt(clientX) - view.toView(mark.startSeconds) : 0 }),
    [mark, view, viewAt],
  );

  const save = useCallback(
    () =>
      render.save({
        overlays,
        shape,
        start,
        end,
        levels,
        videoStart: shot.start,
        videoEnd: shot.end,
        removed,
        blanked,
        hushed,
      }),
    [blanked, end, hushed, levels, overlays, removed, render.save, shape, shot.end, shot.start, start],
  );

  const keyboardFocus = useRef(false);

  useEffect(() => {
    const pointer = () => {
      keyboardFocus.current = false;
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Tab") keyboardFocus.current = true;
      if (event.key !== " " || event.ctrlKey || event.metaKey || event.altKey) return;
      if (held || typing() || useGlobalModalStore.getState().modals.length > 0) return;
      if (keyboardFocus.current && event.target instanceof Element && event.target.closest(CONTROLS)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) preview();
    };
    window.addEventListener("pointerdown", pointer, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [held, preview]);

  const cutHint = useCallback(() => toast(t("clips.editor.cut.too_little"), { id: "clip-cut-hint" }), [t]);

  const toggleMark = useCallback(() => {
    if (mark) cancelMark();
    else if (!beginMark()) cutHint();
  }, [beginMark, cancelMark, cutHint, mark]);

  const removeMark = useCallback(() => {
    if (!applyMark()) cutHint();
  }, [applyMark, cutHint]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (busy || held || typing() || useGlobalModalStore.getState().modals.length > 0) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        if (FULL_EDITOR && mark) {
          event.preventDefault();
          removeMark();
        } else if (chosen !== null) {
          event.preventDefault();
          dropOverlay(chosen);
        }
        return;
      }
      if (event.key === "Escape") {
        if (FULL_EDITOR && mark) {
          event.preventDefault();
          cancelMark();
        } else if (chosen !== null) {
          event.preventDefault();
          setChosen(null);
        }
        return;
      }
      if (!FULL_EDITOR) return;
      if (event.key.toLowerCase() !== "s" || event.shiftKey || event.repeat) return;
      event.preventDefault();
      toggleMark();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, cancelMark, chosen, dropOverlay, held, mark, removeMark, setChosen, toggleMark]);

  const canSave = !busy && kept >= MIN_LENGTH;

  const [timelineShown, setTimelineShown] = useState(true);
  const sidePanel = usePanelRef();
  const inspectorPanel = usePanelRef();
  const timelinePanel = usePanelRef();
  const columnsLayout = useDefaultLayout({
    id: COLUMNS_ID,
    storage: layoutStorage,
    onlySaveAfterUserInteractions: true,
  });
  const rowsLayout = useDefaultLayout({
    id: ROWS_ID,
    storage: layoutStorage,
    onlySaveAfterUserInteractions: true,
  });

  const timelineCard = useRef<HTMLElement>(null);
  const timelineHeader = useRef<HTMLDivElement>(null);
  const timelineBody = useRef<HTMLDivElement>(null);
  const timelineContent = useRef<HTMLDivElement>(null);
  const timelineSized = useRef(rowsLayout.defaultLayout !== undefined);
  const gripping = useRef(false);
  const timelineFitting = useRef(false);

  const fitTimeline = useCallback(() => {
    if (timelineFitting.current) return;
    const handle = timelinePanel.current;
    const card = timelineCard.current;
    const body = timelineBody.current;
    const content = timelineContent.current;
    if (!handle || !card || !body || !content) return;
    const heights = [card.offsetHeight, body.offsetHeight, content.offsetHeight];
    if (heights.some((height) => !Number.isFinite(height) || height <= 0)) return;
    const group = card.closest("[data-group]");
    if (group?.id !== ROWS_ID || group.querySelector(':scope > [data-separator="active"]')) return;

    let current: number;
    try {
      // Panel refs exist before their group/constraints are necessarily registered.
      current = handle.getSize().inPixels;
      if (handle.isCollapsed()) return;
    } catch {
      return;
    }
    if (!Number.isFinite(current) || current <= 0) return;
    const target = Math.max(TIMELINE.min, heights[0] - heights[1] + heights[2]);
    if (Math.abs(current - target) <= 1) return;
    timelineFitting.current = true;
    try {
      handle.resize(target);
    } finally {
      timelineFitting.current = false;
    }
  }, [timelinePanel]);

  useLayoutEffect(() => {
    const content = timelineContent.current;
    if (!content) return;
    let alive = true;
    if (!timelineSized.current) fitTimeline();
    const observer = new ResizeObserver(() => {
      if (alive && !timelineSized.current) fitTimeline();
    });
    observer.observe(content);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [fitTimeline]);

  const inspecting = picked !== null;

  useLayoutEffect(() => {
    const handle = inspectorPanel.current;
    if (!handle) return;
    if (inspecting) handle.expand();
    else handle.collapse();
  }, [inspecting, inspectorPanel]);

  const resetLayout = useCallback(() => {
    clearSavedLayout();
    timelineSized.current = false;
    if (timelinePanel.current?.isCollapsed()) timelinePanel.current.expand();
    sidePanel.current?.resize(SIDE.default);
    if (inspecting) inspectorPanel.current?.resize(INSPECTOR.default);
    fitTimeline();
  }, [fitTimeline, inspecting, inspectorPanel, sidePanel, timelinePanel]);

  const toggleTimeline = useCallback(() => {
    const handle = timelinePanel.current;
    if (!handle) return;
    if (!handle.isCollapsed()) {
      handle.collapse();
      return;
    }
    handle.expand();
    if (!timelineSized.current) fitTimeline();
  }, [fitTimeline, timelinePanel]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (!canSave || held || typing() || useGlobalModalStore.getState().modals.length > 0) return;
      void save();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [canSave, held, save]);

  const menus: MenuDef[] = [
    {
      id: "file",
      label: t("clips.editor.menu.file"),
      sections: [
        [
          {
            id: "save",
            label: t("clips.trim.save"),
            icon: "solar:check-circle-bold",
            shortcut: shortcutText("S", t),
            disabled: !canSave,
            onSelect: () => void save(),
          },
          {
            id: "reveal",
            label: t("clips.gallery.reveal"),
            icon: "solar:folder-with-files-bold",
            onSelect: () =>
              void revealClip(path).catch((e) => toast.error(parseErrorMessage(e))),
          },
        ],
        [
          {
            id: "close",
            label: t("common.close"),
            icon: "solar:close-circle-bold",
            disabled: busy,
            onSelect: onCancel,
          },
        ],
      ],
    },
    {
      id: "edit",
      label: t("clips.editor.menu.edit"),
      sections: [
        [
          {
            id: "undo",
            label: t("clips.editor.transport.undo"),
            icon: "solar:undo-left-bold",
            shortcut: shortcutText("Z", t),
            disabled: !history.canUndo,
            onSelect: history.undo,
          },
          {
            id: "redo",
            label: t("clips.editor.transport.redo"),
            icon: "solar:undo-right-bold",
            shortcut: shortcutText("Y", t),
            disabled: !history.canRedo,
            onSelect: history.redo,
          },
        ],
        FULL_EDITOR
          ? [
              {
                id: "mark",
                label: t("clips.editor.cut.start"),
                icon: "solar:scissors-square-bold",
                shortcut: "S",
                disabled: busy,
                onSelect: toggleMark,
              },
            ]
          : [],
      ],
    },
    {
      id: "view",
      label: t("clips.editor.menu.view"),
      sections: [
        OFFERED_PANELS.map((entry) => ({
          id: entry.id,
          label: t(entry.label),
          checked: panel === entry.id,
          onSelect: () => setPanel(entry.id),
        })),
        [
          {
            id: "timeline",
            label: t("clips.editor.menu.show_timeline"),
            checked: timelineShown,
            onSelect: toggleTimeline,
          },
        ],
        [
          {
            id: "reset",
            label: t("clips.editor.menu.reset_layout"),
            icon: "solar:restart-bold",
            onSelect: resetLayout,
          },
        ],
      ],
    },
    {
      id: "help",
      label: t("clips.editor.menu.help"),
      sections: [
        [
          {
            id: "how",
            label: t("clips.editor.menu.how"),
            icon: "solar:question-circle-bold",
            onSelect: () => setHelpOpen(true),
          },
        ],
      ],
    },
  ];

  const guide = useMemo(() => {
    const target = SHAPES.find((entry) => entry.choice === shape)?.ratio;
    if (!target || ratio <= 0) return null;
    return ratio > target
      ? { width: target / ratio, height: 1 }
      : { width: 1, height: ratio / target };
  }, [ratio, shape]);

  const exportPercent = render.percent;

  const clipMasks = (from: number, to: number) => (
    <ClipMasks from={from} to={to} color={accentColor.value} view={view} />
  );

  const clipHandles = (from: number, to: number) => (
    <ClipHandles
      from={from}
      to={to}
      dragging={dragging}
      color={accentColor.value}
      disabled={busy}
      view={view}
      onGrab={setDragging}
      onMove={moveHandle}
      t={t}
    />
  );

  const cutRange = (inset: string) =>
    mark && (
      <CutRange
        span={mark}
        color={accentColor.value}
        dragging={markDrag?.edge ?? null}
        view={view}
        label={t("clips.editor.cut.label")}
        startLabel={t("clips.editor.cut.handle_start")}
        endLabel={t("clips.editor.cut.handle_end")}
        className={inset}
        onGrab={grabMark}
        onNudge={(edge, by) => reshapeMark(edge, view.shift(edge === "start" ? mark.startSeconds : mark.endSeconds, by))}
      />
    );

  const gapBlock = (span: Span, key: number, onRestore: () => void) => (
    <GapBlock
      key={key}
      span={span}
      disabled={busy}
      view={view}
      onRestore={onRestore}
      t={t}
    />
  );

  const laneMarks = (owner: PartLane, gaps: Span[], restore: (index: number) => void) => (
    <div className="pointer-events-none absolute inset-0">
      {gaps.map((span, index) => gapBlock(span, index, () => restore(index)))}
      {target === owner && cutRange("inset-y-0")}
    </div>
  );

  return (
    <WindowFrame className="select-none [&_button_svg]:pointer-events-none [&_input]:select-text [&_textarea]:select-text">
      <style>{`
        .clip-editor-transport { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; }
        .clip-editor-transport-buttons { order: 1; }
        .clip-editor-duration { order: 2; margin-left: auto; }
        @container clip-preview (max-width: 480px) {
          .clip-editor-transport-buttons { order: 3; flex-basis: 100%; justify-content: center; }
          .clip-editor-duration { order: 1; }
        }
      `}</style>
      <header
        data-tauri-drag-region
        className="relative flex h-11 shrink-0 select-none items-center gap-3 border-b border-white/5 bg-black/40 pl-4 pr-2"
      >
        <Icon
          icon="solar:videocamera-record-bold"
          className="pointer-events-none h-4 w-4 shrink-0"
          style={{ color: accentColor.value }}
        />
        <EditorMenuBar menus={menus} open={menuOpen} onOpenChange={setMenuOpen} />
        <div
          data-tauri-drag-region
          className="pointer-events-none flex h-full min-w-0 flex-1 items-center"
        >
          <span
            className="truncate font-minecraft text-xs normal-case tracking-wider"
            style={{ color: accentColor.value }}
          >
            {name}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <WindowButton
            icon="mdi:minus"
            label={t("window.minimize")}
            onClick={() => void getCurrentWindow().minimize()}
          />
          <WindowButton
            icon="mdi:checkbox-blank-outline"
            iconClassName="h-3.5 w-3.5"
            label={t("window.maximize")}
            onClick={() => void getCurrentWindow().toggleMaximize()}
          />
          <WindowButton
            icon="mdi:close"
            label={t("window.close")}
            danger
            disabled={busy}
            onClick={onCancel}
          />
        </div>

        {render.rendering && (
          <span
            role="progressbar"
            aria-label={t("clips.editor.save_progress", { defaultValue: "Saving clip" })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={exportPercent ?? undefined}
            aria-valuetext={exportPercent === null
              ? t("common.saving", { defaultValue: "Saving…" })
              : `${exportPercent}%`}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-white/10"
          >
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

      {helpOpen && <EditorHelpModal onClose={() => setHelpOpen(false)} t={t} />}

      <div className="flex min-h-0 flex-1 flex-col p-1.5">
        <Group
          id={ROWS_ID}
          orientation="vertical"
          className="min-h-0 flex-1"
          defaultLayout={rowsLayout.defaultLayout}
          onLayoutChanged={(layout, meta) => {
            const byUser = meta.isUserInteraction || gripping.current;
            if (byUser) timelineSized.current = true;
            rowsLayout.onLayoutChanged(layout, { ...meta, isUserInteraction: byUser });
            if (!byUser && !timelineSized.current && !timelineFitting.current) fitTimeline();
          }}
          resizeTargetMinimumSize={HIT_AREA}
        >
          <LayoutPanel id="stage" minSize={STAGE_MIN} className="flex flex-col" style={{ overflow: "hidden" }}>
            <div className="flex min-h-0 flex-1 gap-1.5">
              <nav className="flex w-[6.5rem] shrink-0 flex-col gap-1 overflow-hidden rounded-[var(--border-radius)] border border-white/10 bg-black/30 p-1">
                {OFFERED_PANELS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setPanel(entry.id)}
                    aria-pressed={panel === entry.id}
                    className={cn(
                      "flex w-full flex-col items-center gap-1.5 rounded border px-0.5 py-2.5 transition-colors",
                      panel === entry.id
                        ? "border-white/20 bg-white/10 text-white"
                        : "border-transparent text-white/60 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon
                      icon={entry.icon}
                      className="h-5 w-5"
                      style={panel === entry.id ? { color: accentColor.value } : undefined}
                    />
                    <span className="w-full text-center font-minecraft text-[10px] leading-tight [overflow-wrap:anywhere]">
                      {t(entry.label)}
                    </span>
                  </button>
                ))}
              </nav>

              <Group
                id={COLUMNS_ID}
                orientation="horizontal"
                className="min-w-0 flex-1"
                defaultLayout={columnsLayout.defaultLayout}
                onLayoutChanged={columnsLayout.onLayoutChanged}
                resizeTargetMinimumSize={HIT_AREA}
              >
                <LayoutPanel
                  id="panel"
                  panelRef={sidePanel}
                  defaultSize={SIDE.default}
                  minSize={SIDE.min}
                  maxSize={SIDE.max}
                  groupResizeBehavior="preserve-pixel-size"
                  className="flex"
                  style={{ overflow: "hidden" }}
                >
                  <aside className={CARD}>
                    <PanelTitle color={accentColor.value}>{t(activePanel.label)}</PanelTitle>
                    <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                      <p className="font-minecraft text-xs leading-relaxed text-white/50">
                        {t(activePanel.hint)}
                      </p>
                      {!FULL_EDITOR && (
                        <div className="flex items-start gap-2.5 rounded border border-white/10 bg-black/30 px-3 py-2.5">
                          <Icon
                            icon="solar:info-circle-bold"
                            className="mt-0.5 h-4 w-4 shrink-0"
                            style={{ color: accentColor.value }}
                          />
                          <div className="flex min-w-0 flex-col gap-1">
                            <span className="font-minecraft text-sm text-white">{t("clips.editor.mac_notice.title")}</span>
                            <span className="font-minecraft text-xs leading-relaxed text-white/60">
                              {t("clips.editor.mac_notice.message")}
                            </span>
                          </div>
                        </div>
                      )}
                      {panel === "tools" && (
                        <div className="flex flex-col gap-2">
                          {TOOLS.map((tool) => (
                            <button
                              key={tool.seed.kind}
                              type="button"
                              onClick={() =>
                                addOverlay(
                                  tool.seed.kind === "text"
                                    ? { ...tool.seed, content: t("clips.editor.overlay.text_default") }
                                    : tool.seed,
                                )
                              }
                              disabled={busy}
                              className={cn(
                                "group flex items-center gap-2 rounded border border-white/10 bg-black/30 px-2.5 py-2 text-left font-minecraft text-xs leading-tight text-white/80 transition-colors",
                                busy ? "cursor-not-allowed opacity-40" : "hover:border-white/20 hover:bg-white/5 hover:text-white",
                              )}
                            >
                              <Icon icon={tool.icon} className="h-4 w-4 shrink-0 text-white/60" />
                              <span className="min-w-0 flex-1 break-words">{t(tool.label)}</span>
                              <Icon
                                icon="solar:add-circle-bold"
                                className={cn("h-4 w-4 shrink-0 text-white/30", !busy && "group-hover:text-white/70")}
                              />
                            </button>
                          ))}
                        </div>
                      )}

                      {panel === "audio" && (
                        <>
                          {detailsStatus === "loading" ? (
                            <p role="status" className="font-minecraft text-xs leading-relaxed text-white/50">
                              {t("clips.editor.audio.loading", { defaultValue: "Reading audio tracks…" })}
                            </p>
                          ) : detailsStatus === "error" ? (
                            <div className="flex flex-col items-start gap-2">
                              <p role="status" className="font-minecraft text-xs leading-relaxed text-red-300">
                                {t("clips.editor.audio.failed", { defaultValue: "Audio track details could not be read. Preview remains available." })}
                              </p>
                              {onRetryDetails && (
                                <Button variant="secondary" size="sm" onClick={onRetryDetails} disabled={busy}>
                                  {t("common.retry", { defaultValue: "Retry" })}
                                </Button>
                              )}
                            </div>
                          ) : adjustable.length === 0 ? (
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
                        <div className="grid grid-cols-2 gap-2">
                          {SHAPES.map((entry) => (
                            <button
                              key={entry.choice}
                              type="button"
                              onClick={() => setShape(entry.choice)}
                              disabled={busy}
                              className={cn(
                                "rounded border px-2 py-2.5 font-minecraft text-xs leading-tight transition-colors",
                                shape === entry.choice
                                  ? "border-white/20 bg-white/10 text-white"
                                  : "border-white/10 bg-black/30 text-white/60",
                                busy
                                  ? "cursor-not-allowed opacity-40"
                                  : shape !== entry.choice && "hover:border-white/20 hover:bg-white/5 hover:text-white",
                              )}
                            >
                              {t(entry.label)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </aside>
                </LayoutPanel>

                <ResizeBar orientation="vertical" label={t("clips.editor.menu.resize")} color={accentColor.value} />

                <LayoutPanel id="main" minSize={MAIN_MIN} className="flex" style={{ overflow: "hidden" }}>
                  <main className={CARD} style={{ containerType: "inline-size", containerName: "clip-preview" }}>
                    <div className="min-h-0 flex-1 px-4 pb-2 pt-4" onPointerDown={() => setChosen(null)}>
                      <div className="flex h-full w-full items-center justify-center" style={{ containerType: "size" }}>
                        <div
                          ref={frameRef}
                          className="group relative overflow-hidden rounded border border-white/10 bg-black shadow-2xl"
                          style={{
                            width: `min(100cqw, calc(100cqh * ${ratio}))`,
                            height: `min(100cqh, calc(100cqw / ${ratio}))`,
                            containerType: "size",
                          }}
                        >
                          <video
                            ref={videoRef}
                            src={src}
                            className="block h-full w-full cursor-pointer object-contain"
                            onClick={preview}
                            onLoadedMetadata={(event) => {
                              const video = event.currentTarget;
                              if (video.videoWidth > 0 && video.videoHeight > 0) {
                                setRatio(video.videoWidth / video.videoHeight);
                              }
                            }}
                          />
                          <video
                            ref={standbyRef}
                            src={src}
                            muted
                            preload="auto"
                            aria-hidden="true"
                            className="pointer-events-none invisible absolute inset-0 block h-full w-full object-contain"
                          />

                          {buffering && (
                            <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/50">
                              <Icon icon="svg-spinners:ring-resize" className="h-6 w-6" style={{ color: accentColor.value }} />
                            </span>
                          )}

                          {!playing && !buffering && (
                            <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 opacity-0 transition-opacity duration-150 group-hover:opacity-70">
                              <Icon icon="solar:play-bold" className="h-5 w-5 text-white" />
                            </span>
                          )}

                          <BlankCover live={live} blanked={blanked} />

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
                              disabled={busy}
                              onPick={() => setChosen(index)}
                              onGrab={(mode, event) => grabBox(index, mode, event)}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="clip-editor-transport shrink-0 gap-x-3 gap-y-2 px-4 pb-3 pt-1">
                      <PlayheadClock live={live} view={view} color={accentColor.value} />
                      <div className="clip-editor-transport-buttons flex shrink-0 items-center gap-1.5">
                        <ClipIconButton
                          icon="solar:skip-previous-bold"
                          label={t("clips.editor.transport.to_start")}
                          tooltipPosition="top"
                          onClick={() => jump(start)}
                        />
                        <ClipIconButton
                          icon="solar:rewind-back-bold"
                          label={t("clips.editor.transport.step_back")}
                          tooltipPosition="top"
                          onClick={() => jump(view.shift(playhead, -STEP_SECONDS))}
                        />
                        <ClipIconButton
                          icon={playing ? "solar:pause-bold" : "solar:play-bold"}
                          label={playing ? t("clips.editor.transport.pause") : t("clips.trim.preview")}
                          tooltipPosition="top"
                          onClick={preview}
                          className="mx-1 h-10 w-10 [&_svg]:h-5 [&_svg]:w-5"
                        />
                        <ClipIconButton
                          icon="solar:rewind-forward-bold"
                          label={t("clips.editor.transport.step_forward")}
                          tooltipPosition="top"
                          onClick={() => jump(view.shift(playhead, STEP_SECONDS))}
                        />
                        <ClipIconButton
                          icon="solar:skip-next-bold"
                          label={t("clips.editor.transport.to_end")}
                          tooltipPosition="top"
                          onClick={() => jump(end)}
                        />
                      </div>
                      <span className="clip-editor-duration shrink-0 whitespace-nowrap font-minecraft text-sm tabular-nums leading-none text-white/50">
                        {formatTime(view.length)}
                      </span>
                    </div>
                  </main>
                </LayoutPanel>

                <ResizeBar
                  orientation="vertical"
                  label={t("clips.editor.menu.resize")}
                  color={accentColor.value}
                  disabled={!inspecting}
                />

                <LayoutPanel
                  id="inspector"
                  panelRef={inspectorPanel}
                  defaultSize={INSPECTOR.default}
                  minSize={INSPECTOR.min}
                  maxSize={INSPECTOR.max}
                  collapsible
                  collapsedSize={0}
                  groupResizeBehavior="preserve-pixel-size"
                  className="flex"
                  style={{ overflow: "hidden" }}
                >
                  <OverlayInspector
                    picked={picked}
                    chosen={chosen}
                    accent={accentColor.value}
                    busy={busy}
                    editOverlay={editOverlay}
                    dropOverlay={dropOverlay}
                    t={t}
                  />
                </LayoutPanel>
              </Group>
            </div>
          </LayoutPanel>

          <ResizeBar orientation="horizontal" label={t("clips.editor.menu.resize")} color={accentColor.value} />

          <LayoutPanel
            id="timeline"
            panelRef={timelinePanel}
            defaultSize={TIMELINE.default}
            minSize={TIMELINE.min}
            maxSize={TIMELINE.max}
            collapsible
            collapsedSize={TIMELINE.collapsed}
            groupResizeBehavior="preserve-pixel-size"
            onResize={(size) => {
              const shown = size.inPixels > TIMELINE.collapsed;
              if (!shown && timelineBody.current?.contains(document.activeElement)) {
                timelineHeader.current?.focus({ preventScroll: true });
              }
              setTimelineShown(shown);
            }}
            className="flex flex-col"
            style={{ overflow: "hidden" }}
          >
            <section ref={timelineCard} className={CARD}>
              <div ref={timelineHeader} tabIndex={-1} className={PANEL_HEAD}>
                <div className="flex shrink-0 items-center gap-1.5">
                  <ClipIconButton
                    icon="solar:undo-left-bold"
                    label={t("clips.editor.transport.undo")}
                    onClick={history.undo}
                    disabled={!history.canUndo}
                  />
                  <ClipIconButton
                    icon="solar:undo-right-bold"
                    label={t("clips.editor.transport.redo")}
                    onClick={history.redo}
                    disabled={!history.canRedo}
                  />
                  {FULL_EDITOR && (
                    <>
                      <span className="mx-1 h-6 w-px bg-white/10" />
                      <ClipIconButton
                        icon="solar:scissors-square-bold"
                        label={t("clips.editor.cut.start")}
                        aria-pressed={mark !== null}
                        onClick={toggleMark}
                        disabled={busy}
                        className={cn(mark && "bg-white/10")}
                        style={mark ? { color: accentColor.value, borderColor: accentColor.value } : undefined}
                      />
                    </>
                  )}
                </div>
                <span className="h-6 w-px shrink-0 bg-white/10" />
                <div className="flex min-w-0 items-center gap-4 overflow-hidden">
                  <Readout label={t("clips.trim.from")} value={formatTime(view.toView(shot.from))} />
                  <Readout
                    label={t("clips.trim.kept_label")}
                    value={`${kept.toFixed(1)} s`}
                    strong
                  />
                  <Readout label={t("clips.trim.to")} value={formatTime(view.toView(shot.to))} />
                </div>
                <Button
                  variant="success"
                  size="xs"
                  className="ml-auto shrink-0"
                  onClick={() => void save()}
                  disabled={!canSave}
                  icon={
                    <Icon
                      icon={busy ? "svg-spinners:ring-resize" : "solar:check-circle-bold"}
                      className="h-4 w-4"
                    />
                  }
                >
                  {t("clips.trim.save")}
                </Button>
                <EdgeGrip
                  panel={timelinePanel}
                  label={t("clips.editor.menu.resize")}
                  color={accentColor.value}
                  onDrag={(active) => {
                    gripping.current = active;
                    if (active) timelineSized.current = true;
                  }}
                />
              </div>
              <div
                ref={timelineBody}
                hidden={!timelineShown}
                className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
              >
                <div ref={timelineContent} className="px-3 py-2">
                  <div className="mb-2 flex h-7 items-center gap-3">
                    {FULL_EDITOR && movable.length > 0 && (
                      <>
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
                      </>
                    )}
                    {mark ? (
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        <span className="font-minecraft text-xs text-white/60">{t("clips.editor.cut.label")}</span>
                        <span className="font-minecraft text-sm tabular-nums" style={{ color: accentColor.value }}>
                          {`${(view.toView(mark.endSeconds) - view.toView(mark.startSeconds)).toFixed(1)} s`}
                        </span>
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={cancelMark}
                          icon={<Icon icon="solar:close-circle-bold" className="h-4 w-4" />}
                        >
                          {t("common.cancel")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="xs"
                          onClick={removeMark}
                          disabled={busy}
                          icon={<Icon icon="solar:trash-bin-trash-bold" className="h-4 w-4" />}
                        >
                          {t("clips.editor.cut.apply")}
                        </Button>
                      </div>
                    ) : (
                      <p className="ml-auto min-w-0 truncate font-minecraft text-[11px] text-white/40">
                        {overlays.length > 0
                          ? t("clips.editor.overlay.hint")
                          : FULL_EDITOR
                            ? t("clips.editor.remove.hint")
                            : t("clips.trim.hint")}
                      </p>
                    )}
                  </div>

                  <div className="relative flex select-none flex-col gap-1.5">
                    <div className="flex">
                      <div className="w-[9.5rem] shrink-0" />
                      <Ruler
                        scale={scaleRef}
                        duration={view.length}
                        onScrub={(clientX) => {
                          scrubTo(clientX);
                          setScrubbing(true);
                        }}
                      />
                    </div>

                    <Lane
                      icon="solar:videocamera-bold"
                      name={t("clips.editor.timeline.video")}
                      tint={accentColor.value}
                      height="h-16"
                      active={separate && lane === "video"}
                      onPick={() => {
                        setLane("video");
                        setChosen(null);
                      }}
                      onScrub={(clientX) => {
                        scrubTo(clientX);
                        setScrubbing(true);
                        setLane("video");
                        setChosen(null);
                      }}
                    >
                      {filmstrip ? (
                        <Pieces view={view}>
                          <img
                            src={filmstrip}
                            alt=""
                            draggable={false}
                            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-90"
                          />
                        </Pieces>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Icon icon="svg-spinners:ring-resize" className="h-4 w-4 text-white/40" />
                        </div>
                      )}

                      {laneMarks("video", blanked, unblank)}

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
                          view={view}
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
                          active={separate && lane === track.stream}
                          onSelect={() => {
                            setLane(track.stream);
                            setChosen(null);
                          }}
                          onPick={(clientX) => {
                            scrubTo(clientX);
                            setScrubbing(true);
                            setLane(track.stream);
                            setChosen(null);
                          }}
                          marks={laneMarks(track.stream, muted[track.stream] ?? [], (index) =>
                            unmute(track.stream, index),
                          )}
                          onTrim={(edge) => setLaneTrim({ stream: track.stream, edge })}
                          onTrimNudge={(edge, by) =>
                            trimTrack(track.stream, edge, view.shift(edge === "start" ? own.from : own.to, by))
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
                        view={view}
                        active={chosen === index}
                        accent={accentColor.value}
                        name={t(OVERLAY_NAME[overlay.kind], { index: index + 1 })}
                        disabled={busy}
                        onPick={() => setChosen(index)}
                        onGrab={(mode, event) => grabBar(index, mode, event)}
                      />
                    ))}

                    <div className="pointer-events-none absolute inset-y-0 left-[9.5rem] right-0">
                      {!separate && clipMasks(start, end)}
                      {removed.map((span, index) => (
                        <JoinMark
                          key={index}
                          span={span}
                          color={accentColor.value}
                          disabled={busy}
                          view={view}
                          onRestore={() => unremove(index)}
                          t={t}
                        />
                      ))}
                      <PlayheadMark live={live} view={view} color={accentColor.value} />

                      {!separate && clipHandles(start, end)}
                      {target === "all" && cutRange("bottom-0 top-[1.875rem]")}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </LayoutPanel>
        </Group>
      </div>
    </WindowFrame>
  );
}

export function WindowButton({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  iconClassName = "h-4 w-4",
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  iconClassName?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        danger ? "enabled:hover:bg-red-500/80" : "enabled:hover:bg-white/10",
      )}
    >
      <Icon icon={icon} className={cn(iconClassName, "text-white/70")} />
    </button>
  );
}
