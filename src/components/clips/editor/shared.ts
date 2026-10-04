import type { ClipCorner, ClipOverlay, ClipShape, ClipTextAlign, ClipTextVertical, Span } from "../../../services/clip-service";
import { isMacOS } from "../../../utils/platform";

export const MIN_LENGTH = 0.5;

export const NUDGE = 0.1;

export const MIN_BOX = 0.05;

const DEFAULT_BLUR = 12;

const TICK_STEPS: { step: number; minor: number }[] = [
  { step: 0.1, minor: 5 },
  { step: 0.2, minor: 4 },
  { step: 0.5, minor: 5 },
  { step: 1, minor: 4 },
  { step: 2, minor: 4 },
  { step: 5, minor: 5 },
  { step: 10, minor: 5 },
  { step: 15, minor: 3 },
  { step: 30, minor: 6 },
  { step: 60, minor: 4 },
  { step: 120, minor: 4 },
  { step: 300, minor: 5 },
];

const MAX_TICKS = 12;

interface Ruler {
  step: number;
  majors: number[];
  minors: number[];
}

export function rulerTicks(duration: number): Ruler {
  if (duration <= 0) return { step: 1, majors: [], minors: [] };
  const { step, minor } = TICK_STEPS.find((entry) => duration / entry.step <= MAX_TICKS) ?? {
    step: Math.ceil(duration / MAX_TICKS / 600) * 600,
    minor: 6,
  };
  const fine = step / minor;
  const majors: number[] = [];
  const minors: number[] = [];
  for (let index = 0; index * fine <= duration + 0.001; index++) {
    const at = Number((index * fine).toFixed(3));
    if (index % minor === 0) majors.push(at);
    else minors.push(at);
  }
  return { step, majors, minors };
}

export type NewOverlay =
  | { kind: "blur"; strength: number }
  | { kind: "box"; colour: number }
  | { kind: "arrow"; colour: number; thickness: number; towards: ClipCorner }
  | { kind: "text"; content: string; size: number; colour: number; align: ClipTextAlign; vertical: ClipTextVertical };

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
    seed: { kind: "text", content: "", size: 48, colour: 0xffffff, align: "center", vertical: "center" },
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

const PANELS: { id: Panel; icon: string; label: string; hint: string }[] = [
  { id: "tools", icon: "solar:widget-bold", label: "clips.editor.tools", hint: "clips.editor.tools.hint" },
  { id: "audio", icon: "solar:soundwave-bold", label: "clips.editor.audio", hint: "clips.editor.audio.hint" },
  { id: "format", icon: "solar:smartphone-bold", label: "clips.editor.shape.label", hint: "clips.editor.shape.hint" },
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

export function formatTick(seconds: number, step: number): string {
  const tenths = Math.round(seconds * 10);
  const whole = Math.floor(tenths / 10);
  const clock = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  return step >= 1 ? clock : `${clock}.${tenths % 10}`;
}
