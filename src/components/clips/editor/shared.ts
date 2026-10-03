import type { ClipCorner, ClipOverlay, ClipShape, Span } from "../../../services/clip-service";
import { isMacOS } from "../../../utils/platform";

export const MIN_LENGTH = 0.5;

export const NUDGE = 0.1;

export const MIN_BOX = 0.05;

const DEFAULT_BLUR = 12;

export const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300];

export const MAX_TICKS = 12;

export type NewOverlay =
  | { kind: "blur"; strength: number }
  | { kind: "box"; colour: number }
  | { kind: "arrow"; colour: number; thickness: number; towards: ClipCorner }
  | { kind: "text"; content: string; size: number; colour: number };

export const TOOLS: { icon: string; label: string; seed: NewOverlay }[] = [
  {
    icon: "solar:magic-stick-bold",
    label: "clips.editor.tool.blur",
    seed: { kind: "blur", strength: DEFAULT_BLUR },
  },
  {
    icon: "solar:stop-bold",
    label: "clips.editor.tool.box",
    seed: { kind: "box", colour: 0xffffff },
  },
  {
    icon: "solar:arrow-right-up-bold",
    label: "clips.editor.tool.arrow",
    seed: { kind: "arrow", colour: 0xffffff, thickness: 6, towards: "bottom_right" },
  },
  {
    icon: "solar:text-bold",
    label: "clips.editor.tool.text",
    seed: { kind: "text", content: "", size: 48, colour: 0xffffff },
  },
];

export const OVERLAY_NAME: Record<ClipOverlay["kind"], string> = {
  blur: "clips.editor.overlay.name",
  box: "clips.editor.overlay.name_box",
  arrow: "clips.editor.overlay.name_arrow",
  text: "clips.editor.overlay.name_text",
};

export const OVERLAY_ICON: Record<ClipOverlay["kind"], string> = {
  blur: "solar:magic-stick-bold",
  box: "solar:stop-bold",
  arrow: "solar:arrow-right-up-bold",
  text: "solar:text-bold",
};

export function toHex(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
}

export const SHAPES: { choice: ClipShape; ratio: number | null; label: string }[] = [
  { choice: "original", ratio: null, label: "clips.editor.shape.original" },
  { choice: "vertical", ratio: 9 / 16, label: "clips.editor.shape.vertical" },
  { choice: "square", ratio: 1, label: "clips.editor.shape.square" },
  { choice: "wide", ratio: 21 / 9, label: "clips.editor.shape.wide" },
];

export type Panel = "tools" | "audio" | "format";

const PANELS: { id: Panel; icon: string; label: string }[] = [
  { id: "tools", icon: "solar:widget-bold", label: "clips.editor.tools" },
  { id: "audio", icon: "solar:soundwave-bold", label: "clips.editor.audio" },
  { id: "format", icon: "solar:smartphone-bold", label: "clips.editor.shape.label" },
];

export const FULL_EDITOR = !isMacOS();
export const OFFERED_PANELS = FULL_EDITOR ? PANELS : PANELS.filter((entry) => entry.id === "audio");

export interface LaneWindow {
  start: number | null;
  end: number | null;
}

export const NO_WINDOW: LaneWindow = { start: null, end: null };

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export function overlayTint(overlay: ClipOverlay, fallback: string): string {
  return overlay.kind === "blur" ? fallback : toHex(overlay.colour);
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, Math.max(low, high)));
}

export function merged(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const span of [...spans].sort((a, b) => a.startSeconds - b.startSeconds)) {
    const last = out[out.length - 1];
    if (last && span.startSeconds <= last.endSeconds) {
      last.endSeconds = Math.max(last.endSeconds, span.endSeconds);
    } else {
      out.push({ ...span });
    }
  }
  return out;
}

export function hollowed(spans: Span[], from: number, to: number): number {
  return spans.reduce(
    (sum, span) =>
      sum + Math.max(0, Math.min(span.endSeconds, to) - Math.max(span.startSeconds, from)),
    0,
  );
}

export function tidy(value: number): number {
  return Number(value.toFixed(2));
}

export function laneWindow(
  own: LaneWindow | undefined,
  start: number,
  end: number,
): { from: number; to: number; start: number | null; end: number | null } {
  const kept = own ?? NO_WINDOW;
  const from = kept.start === null ? null : clamp(kept.start, start, end - MIN_LENGTH);
  const to = kept.end === null ? null : clamp(kept.end, (from ?? start) + MIN_LENGTH, end);
  return { from: from ?? start, to: to ?? end, start: from, end: to };
}

export function formatTime(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  const tenths = Math.floor((seconds - whole) * 10);
  return `${minutes}:${String(rest).padStart(2, "0")}.${tenths}`;
}

export function formatTick(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
