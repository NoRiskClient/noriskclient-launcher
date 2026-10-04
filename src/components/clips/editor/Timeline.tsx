"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Icon } from "@iconify/react";

import type { ClipAudioTrack, ClipOverlay, Span } from "../../../services/clip-service";
import { Waveform } from "../ClipTimeline";
import { ClipIconButton } from "../ClipIconButton";
import { Tooltip } from "../../ui/Tooltip";
import { cn } from "../../../lib/utils";
import { NUDGE, OVERLAY_ICON, type Translate, overlayTint, formatTime, formatTick, rulerTicks } from "./shared";
import { holdPointer } from "./useWindowDrag";

const LINK_MODES: { separate: boolean; icon: string; label: string }[] = [
  { separate: false, icon: "solar:link-bold", label: "clips.editor.link.linked" },
  { separate: true, icon: "solar:link-broken-bold", label: "clips.editor.link.separate" },
];

const LABEL_GAP = 6;

export function Ruler({
  scale,
  duration,
  percent,
  onScrub,
}: {
  scale: RefObject<HTMLDivElement>;
  duration: number;
  percent: (seconds: number) => number;
  onScrub: (clientX: number) => void;
}) {
  const probe = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [room, setRoom] = useState(0);
  const ticks = useMemo(() => rulerTicks(duration), [duration]);
  const labels = useMemo(
    () => ticks.majors.map((at) => formatTick(at, ticks.step)),
    [ticks],
  );
  const widest = labels.reduce((longest, label) => (label.length > longest.length ? label : longest), "");

  useEffect(() => {
    const track = scale.current;
    const sample = probe.current;
    if (!track || !sample) return;
    const observer = new ResizeObserver(() => {
      setWidth(track.clientWidth);
      setRoom(sample.offsetWidth);
    });
    observer.observe(track);
    observer.observe(sample);
    return () => observer.disconnect();
  }, [scale]);

  const marks = useMemo(() => {
    let edge = -Infinity;
    return ticks.majors.map((at) => {
      const x = (percent(at) / 100) * width;
      const measured = room > 0 && width > 0;
      if (measured && x >= edge && x + room <= width) {
        edge = x + room + LABEL_GAP;
        return { end: false, shown: true };
      }
      if (measured && x - room >= edge) {
        edge = x + LABEL_GAP;
        return { end: true, shown: true };
      }
      return { end: x + 1 > width, shown: false };
    });
  }, [percent, room, ticks, width]);

  return (
    <div
      ref={scale}
      role="presentation"
      onPointerDown={(event) => {
        holdPointer(event);
        onScrub(event.clientX);
      }}
      className="relative h-6 min-w-0 flex-1 cursor-ew-resize overflow-hidden border-b border-white/10"
    >
      <span
        ref={probe}
        aria-hidden="true"
        className="invisible absolute left-0 top-0 whitespace-nowrap border-l pl-1 font-minecraft text-[10px]"
      >
        {widest}
      </span>
      {ticks.minors.map((at) => (
        <span
          key={`minor-${at}`}
          className="absolute bottom-0 h-1.5 w-px bg-white/15"
          style={{ left: `${percent(at)}%` }}
        />
      ))}
      {ticks.majors.map((at, index) => (
        <span
          key={`major-${at}`}
          className={cn(
            "absolute bottom-0 top-0 whitespace-nowrap border-white/25 font-minecraft text-[10px] leading-4 text-white/50",
            marks[index].end ? "border-r pr-1 text-right" : "border-l pl-1",
          )}
          style={marks[index].end ? { right: `${100 - percent(at)}%` } : { left: `${percent(at)}%` }}
        >
          {marks[index].shown && labels[index]}
        </span>
      ))}
    </div>
  );
}

export function Lane({
  icon,
  name,
  tint,
  height,
  active,
  control,
  tone,
  onPick,
  onScrub,
  children,
}: {
  icon: string;
  name: string;
  tint: string;
  height: string;
  active?: boolean;
  control?: ReactNode;
  tone?: string;
  onPick?: () => void;
  onScrub?: (clientX: number) => void;
  children?: ReactNode;
}) {
  const head = (
    <>
      <span className="h-4 w-1 shrink-0 rounded-full" style={{ backgroundColor: tint }} />
      <Icon icon={icon} className={cn("h-3.5 w-3.5 shrink-0", active ? "text-white" : "text-white/50")} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left font-minecraft text-xs uppercase tracking-wide",
          active ? "text-white" : "text-white/60",
        )}
      >
        {name}
      </span>
    </>
  );

  return (
    <div className="flex">
      <div
        className={cn(
          "flex w-[9.5rem] shrink-0 flex-col justify-center gap-1 rounded-l border-y border-l px-2 transition-colors",
          active ? "border-white/20 bg-white/10" : "border-white/10 bg-black/30",
          height,
        )}
      >
        {onPick ? (
          <button
            type="button"
            onClick={onPick}
            aria-pressed={active}
            className="flex w-full min-w-0 items-center gap-2 focus:outline-none"
          >
            {head}
          </button>
        ) : (
          <div className="flex min-w-0 items-center gap-2">{head}</div>
        )}
        {control}
      </div>
      <div
        role="presentation"
        onPointerDown={
          onScrub
            ? (event) => {
                holdPointer(event);
                onScrub(event.clientX);
              }
            : undefined
        }
        className={cn(
          "relative min-w-0 flex-1 overflow-hidden rounded-r border border-white/10 bg-black/30",
          height,
          onScrub && "cursor-ew-resize",
        )}
        style={{
          color: tone,
          ...(active ? { borderColor: tint, boxShadow: `inset 0 0 0 1px ${tint}` } : {}),
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function TrackLink({
  separate,
  color,
  disabled,
  onChange,
  t,
}: {
  separate: boolean;
  color: string;
  disabled: boolean;
  onChange: (separate: boolean) => void;
  t: Translate;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded border border-white/10 bg-black/30 p-0.5">
      {LINK_MODES.map((mode) => {
        const on = separate === mode.separate;
        return (
          <button
            key={mode.label}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(mode.separate)}
            className={cn(
              "flex items-center gap-1.5 rounded border px-2 py-0.5 font-minecraft text-xs transition-colors",
              on ? "border-white/20 bg-white/10 text-white" : "border-transparent text-white/60",
              disabled
                ? "cursor-not-allowed opacity-40"
                : !on && "hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon
              icon={mode.icon}
              className="h-3.5 w-3.5 shrink-0"
              style={on ? { color } : undefined}
            />
            {t(mode.label)}
          </button>
        );
      })}
    </div>
  );
}

export function AudioLane({
  track,
  name,
  movable,
  volume,
  duration,
  tone,
  disabled,
  clipFrom,
  clipTo,
  from,
  to,
  trimmed,
  trimming,
  onChange,
  active,
  onSelect,
  onPick,
  onTrim,
  onTrimNudge,
  onTrimReset,
  marks,
  t,
}: {
  track: ClipAudioTrack;
  name: string;
  movable: boolean;
  volume: number;
  duration: number;
  tone: string;
  disabled: boolean;
  clipFrom: number;
  clipTo: number;
  from: number;
  to: number;
  trimmed: boolean;
  trimming: "start" | "end" | null;
  onChange: (volume: number) => void;
  active: boolean;
  onSelect: () => void;
  onPick: (clientX: number) => void;
  onTrim: (edge: "start" | "end") => void;
  onTrimNudge: (edge: "start" | "end", by: number) => void;
  onTrimReset: () => void;
  marks: ReactNode;
  t: Translate;
}) {
  const muted = volume === 0;
  const trimmable = movable && !disabled;
  const span = duration > 0 ? duration : 1;
  const at = (seconds: number) => (seconds / span) * 100;

  return (
    <Lane
      icon={track.label === "Microphone" ? "solar:microphone-bold" : "solar:soundwave-bold"}
      name={name}
      tint={tone}
      tone={tone}
      height="h-14"
      active={active}
      onPick={onSelect}
      onScrub={onPick}
      control={
        track.adjustable ? (
          <div className="flex items-center justify-end gap-1">
            <span
              className={cn(
                "w-9 text-right font-minecraft text-[11px] tabular-nums",
                volume === 100 ? "text-white/50" : "text-white",
              )}
            >
              {volume}%
            </span>
            <ClipIconButton
              icon={muted ? "solar:volume-cross-bold" : "solar:volume-loud-bold"}
              label={muted ? t("clips.trim.unmute") : t("clips.trim.mute")}
              tooltipPosition="top"
              aria-pressed={muted}
              disabled={disabled}
              onClick={() => onChange(muted ? 100 : 0)}
              className={cn("h-7 w-7", muted && "text-white/40 enabled:hover:text-white/70")}
            />
          </div>
        ) : undefined
      }
    >
      <div className="absolute inset-0">
        <Waveform peaks={track.peaks} gain={volume / 100} muted={muted} />
      </div>

      {marks}

      {trimmable && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <div
            className="absolute inset-y-0 bg-black/70"
            style={{
              left: `${at(clipFrom)}%`,
              width: `${Math.max(0, at(from) - at(clipFrom))}%`,
            }}
          />
          <div
            className="absolute inset-y-0 bg-black/70"
            style={{ left: `${at(to)}%`, width: `${Math.max(0, at(clipTo) - at(to))}%` }}
          />
          <Handle
            left={at(from)}
            active={trimming === "start"}
            time={formatTime(from)}
            label={t("clips.editor.audio.trim_start", { name })}
            color={tone}
            onGrab={() => onTrim("start")}
            onNudge={(by) => onTrimNudge("start", by)}
          />
          <Handle
            left={at(to)}
            active={trimming === "end"}
            time={formatTime(to)}
            label={t("clips.editor.audio.trim_end", { name })}
            color={tone}
            onGrab={() => onTrim("end")}
            onNudge={(by) => onTrimNudge("end", by)}
          />
        </div>
      )}

      {trimmable && trimmed && (
        <Tooltip
          content={t("clips.editor.audio.trim_reset")}
          position="top"
          wrapperClassName="absolute left-1/2 top-1 z-20 -translate-x-1/2"
        >
          <button
            type="button"
            aria-label={t("clips.editor.audio.trim_reset")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onTrimReset}
            className="rounded border border-white/20 bg-black/80 px-1.5 py-0.5 font-minecraft text-[11px] tabular-nums text-white transition-colors hover:border-white/60"
          >
            {`${(to - from).toFixed(1)} s`}
          </button>
        </Tooltip>
      )}
    </Lane>
  );
}

export function OverlayLane({
  overlay,
  duration,
  active,
  accent,
  name,
  disabled,
  onPick,
  onGrab,
}: {
  overlay: ClipOverlay;
  duration: number;
  active: boolean;
  accent: string;
  name: string;
  disabled: boolean;
  onPick: () => void;
  onGrab: (mode: "move" | "start" | "end", event: { clientX: number }) => void;
}) {
  const tint = overlayTint(overlay, accent);
  const span = duration > 0 ? duration : 1;
  const left = (overlay.startSeconds / span) * 100;
  const width = ((overlay.endSeconds - overlay.startSeconds) / span) * 100;

  return (
    <Lane
      icon={OVERLAY_ICON[overlay.kind]}
      name={name}
      tint={tint}
      height="h-9"
      active={active}
      onPick={onPick}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={name}
        aria-pressed={active}
        onPointerDown={(event) => {
          event.preventDefault();
          if (disabled) return;
          holdPointer(event);
          onGrab("move", event);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onPick();
        }}
        className={cn(
          "absolute inset-y-1 flex items-center justify-center rounded border focus:outline-none",
          disabled ? "cursor-not-allowed" : "cursor-grab",
        )}
        style={{
          left: `${left}%`,
          width: `${width}%`,
          borderColor: tint,
          backgroundColor: `${tint}${active ? "60" : "30"}`,
          boxShadow: active ? `0 0 10px ${tint}80` : undefined,
        }}
      >
        <span className="pointer-events-none truncate px-3 font-minecraft text-xs text-white">
          {name}
        </span>
        <span
          role="presentation"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (disabled) return;
            holdPointer(event);
            onGrab("start", event);
          }}
          className={cn("absolute inset-y-0 left-0 w-2 rounded-l bg-white/30", !disabled && "cursor-ew-resize hover:bg-white/60")}
        />
        <span
          role="presentation"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (disabled) return;
            holdPointer(event);
            onGrab("end", event);
          }}
          className={cn("absolute inset-y-0 right-0 w-2 rounded-r bg-white/30", !disabled && "cursor-ew-resize hover:bg-white/60")}
        />
      </div>
    </Lane>
  );
}

export function Readout({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex shrink-0 items-baseline gap-1.5 leading-none">
      <span className="font-minecraft text-[10px] uppercase tracking-wider text-white/50">
        {label}
      </span>
      <span
        className={cn(
          "font-minecraft tabular-nums",
          strong ? "text-sm text-white" : "text-xs text-white/80",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function Handle({
  left,
  active,
  time,
  label,
  color,
  disabled = false,
  onGrab,
  onNudge,
}: {
  left: number;
  active: boolean;
  time: string;
  label: string;
  color: string;
  disabled?: boolean;
  onGrab: () => void;
  onNudge: (by: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (disabled) return;
        holdPointer(event);
        onGrab();
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        if (disabled) return;
        const step = event.shiftKey ? NUDGE * 10 : NUDGE;
        onNudge(event.key === "ArrowLeft" ? -step : step);
      }}
      className={cn(
        "group pointer-events-auto absolute inset-y-0 w-6 -translate-x-1/2 focus:outline-none",
        disabled ? "cursor-not-allowed" : "cursor-ew-resize",
      )}
      style={{ left: `${left}%` }}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full transition-all",
          active ? "opacity-100" : "opacity-80 group-hover:opacity-100 group-focus-visible:opacity-100",
        )}
        style={{ backgroundColor: color, boxShadow: active ? `0 0 8px ${color}` : undefined }}
      />
      <span
        className={cn(
          "pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded border border-white/10 bg-black/80 px-1.5 py-0.5 font-minecraft text-xs text-white transition-opacity",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        {time}
      </span>
    </button>
  );
}

export function ClipMasks({
  from,
  to,
  color,
  percent,
}: {
  from: number;
  to: number;
  color: string;
  percent: (seconds: number) => number;
}) {
  return (
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
          borderColor: color,
        }}
      />
    </>
  );
}

export function ClipHandles({
  from,
  to,
  dragging,
  color,
  disabled,
  percent,
  onGrab,
  onMove,
  t,
}: {
  from: number;
  to: number;
  dragging: "start" | "end" | null;
  color: string;
  disabled: boolean;
  percent: (seconds: number) => number;
  onGrab: (which: "start" | "end") => void;
  onMove: (which: "start" | "end", seconds: number) => void;
  t: Translate;
}) {
  return (
    <>
      <Handle
        left={percent(from)}
        active={dragging === "start"}
        time={formatTime(from)}
        label={t("clips.trim.handle_start")}
        color={color}
        disabled={disabled}
        onGrab={() => onGrab("start")}
        onNudge={(by) => onMove("start", from + by)}
      />
      <Handle
        left={percent(to)}
        active={dragging === "end"}
        time={formatTime(to)}
        label={t("clips.trim.handle_end")}
        color={color}
        disabled={disabled}
        onGrab={() => onGrab("end")}
        onNudge={(by) => onMove("end", to + by)}
      />
    </>
  );
}

export function SpanHighlight({
  span,
  color,
  percent,
}: {
  span: Span;
  color: string;
  percent: (seconds: number) => number;
}) {
  return (
    <div
      className="absolute inset-y-0 rounded border-2"
      style={{
        left: `${percent(span.startSeconds)}%`,
        width: `${percent(span.endSeconds - span.startSeconds)}%`,
        borderColor: color,
        backgroundColor: `${color}1f`,
      }}
    />
  );
}

export function GapBlock({
  span,
  disabled,
  percent,
  onRestore,
  t,
}: {
  span: Span;
  disabled: boolean;
  percent: (seconds: number) => number;
  onRestore: () => void;
  t: Translate;
}) {
  return (
    <div
      className="absolute inset-y-0 border-x border-dashed border-white/30 bg-[#08080b]/90"
      style={{
        left: `${percent(span.startSeconds)}%`,
        width: `${percent(span.endSeconds - span.startSeconds)}%`,
      }}
    >
      <Tooltip
        content={t("clips.editor.remove.restore")}
        position="top"
        wrapperClassName="pointer-events-auto absolute left-1/2 top-0.5 -translate-x-1/2"
      >
        <button
          type="button"
          aria-label={t("clips.editor.remove.restore")}
          disabled={disabled}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onRestore}
          className="flex h-4 w-4 items-center justify-center rounded-full text-white/40 transition-colors hover:text-white"
        >
          <Icon icon="solar:restart-bold" className="h-3 w-3" />
        </button>
      </Tooltip>
    </div>
  );
}

export function SplitMark({
  at,
  disabled,
  percent,
  onRemove,
  t,
}: {
  at: number;
  disabled: boolean;
  percent: (seconds: number) => number;
  onRemove: () => void;
  t: Translate;
}) {
  return (
    <div
      className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/70"
      style={{ left: `${percent(at)}%` }}
    >
      <Tooltip
        content={t("clips.editor.split.remove")}
        position="top"
        wrapperClassName="pointer-events-auto absolute left-1/2 top-0 -translate-x-1/2"
      >
        <button
          type="button"
          aria-label={t("clips.editor.split.remove")}
          disabled={disabled}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onRemove}
          className="group flex h-4 w-4 items-center justify-center rounded-full border border-white/30 bg-black/80 text-white/70 transition-colors hover:text-white"
        >
          <Icon icon="solar:scissors-bold" className="h-2.5 w-2.5 group-hover:hidden" />
          <Icon icon="solar:close-circle-bold" className="hidden h-3.5 w-3.5 group-hover:block" />
        </button>
      </Tooltip>
    </div>
  );
}
