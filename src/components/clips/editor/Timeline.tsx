"use client";

import type { ReactNode } from "react";
import { Icon } from "@iconify/react";

import type { ClipAudioTrack, ClipOverlay } from "../../../services/clip-service";
import { Waveform } from "../ClipTimeline";
import { ClipIconButton } from "../ClipIconButton";
import { cn } from "../../../lib/utils";
import { NUDGE, OVERLAY_ICON, type Translate, overlayTint, formatTime } from "./shared";

const LINK_MODES: { separate: boolean; icon: string; label: string }[] = [
  { separate: false, icon: "solar:link-bold", label: "clips.editor.link.linked" },
  { separate: true, icon: "solar:link-broken-bold", label: "clips.editor.link.separate" },
];

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
      <Icon icon={icon} className="h-3.5 w-3.5 shrink-0 text-white/50" />
      <span className="min-w-0 flex-1 truncate text-left font-minecraft text-xs text-white/70">
        {name}
      </span>
    </>
  );

  return (
    <div className="flex">
      <div
        className={cn(
          "flex w-44 shrink-0 items-center gap-2 rounded-l-lg border-y border-l border-white/10 bg-black/20 px-2.5",
          height,
        )}
        style={active ? { backgroundColor: `${tint}25`, borderColor: `${tint}80` } : undefined}
      >
        {onPick ? (
          <button
            type="button"
            onClick={onPick}
            aria-pressed={active}
            className="flex min-w-0 flex-1 items-center gap-2 focus:outline-none"
          >
            {head}
          </button>
        ) : (
          head
        )}
        {control}
      </div>
      <div
        role="presentation"
        onPointerDown={onScrub ? (event) => onScrub(event.clientX) : undefined}
        className={cn(
          "relative min-w-0 flex-1 overflow-hidden rounded-r-lg border border-white/10 bg-black/20",
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
    <div className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
      {LINK_MODES.map((mode) => {
        const on = separate === mode.separate;
        return (
          <button
            key={mode.label}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            title={t(mode.label)}
            onClick={() => onChange(mode.separate)}
            className={cn(
              "flex items-center gap-1.5 rounded border border-transparent px-2 py-1 font-minecraft text-xs transition-colors",
              on ? "text-white" : "text-white/50 hover:text-white",
              disabled && "cursor-not-allowed opacity-40",
            )}
            style={on ? { borderColor: color, backgroundColor: `${color}30` } : undefined}
          >
            <Icon icon={mode.icon} className="h-3.5 w-3.5 shrink-0" />
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
      height="h-12"
      active={active}
      onPick={onSelect}
      onScrub={onPick}
      control={
        track.adjustable ? (
          <div className="flex shrink-0 items-center gap-1">
            <span
              className={cn(
                "w-9 text-right font-minecraft text-[0.7rem] tabular-nums",
                volume === 100 ? "text-white/40" : "text-white",
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
              className={cn("h-7 w-7", muted && "text-white/40 hover:text-white/70")}
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
        <button
          type="button"
          title={t("clips.editor.audio.trim_reset")}
          aria-label={t("clips.editor.audio.trim_reset")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onTrimReset}
          className="absolute left-1/2 top-1 z-20 -translate-x-1/2 rounded border border-white/20 bg-black/70 px-1.5 py-0.5 font-minecraft text-[0.7rem] tabular-nums text-white transition-colors hover:border-white/60"
        >
          {`${(to - from).toFixed(1)} s`}
        </button>
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
  onPick,
  onGrab,
}: {
  overlay: ClipOverlay;
  duration: number;
  active: boolean;
  accent: string;
  name: string;
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
          onGrab("move", event);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onPick();
        }}
        className="absolute inset-y-1 flex cursor-grab items-center justify-center rounded border focus:outline-none"
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
            onGrab("start", event);
          }}
          className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l bg-white/30 hover:bg-white/60"
        />
        <span
          role="presentation"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onGrab("end", event);
          }}
          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r bg-white/30 hover:bg-white/60"
        />
      </div>
    </Lane>
  );
}

export function Readout({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col items-center leading-tight">
      <span
        className={cn(
          "font-minecraft tabular-nums",
          strong ? "text-base text-white" : "text-sm text-white/80",
        )}
      >
        {value}
      </span>
      <span className="font-smallcaps text-[0.65rem] uppercase tracking-wider text-white/50">
        {label}
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
  onGrab,
  onNudge,
}: {
  left: number;
  active: boolean;
  time: string;
  label: string;
  color: string;
  onGrab: () => void;
  onNudge: (by: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(event) => {
        event.stopPropagation();
        onGrab();
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const step = event.shiftKey ? NUDGE * 10 : NUDGE;
        onNudge(event.key === "ArrowLeft" ? -step : step);
      }}
      className="group pointer-events-auto absolute inset-y-0 w-6 -translate-x-1/2 cursor-ew-resize focus:outline-none"
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
          "pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg bg-black/70 border border-white/10 px-1.5 py-0.5 font-minecraft text-xs text-white transition-opacity",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        {time}
      </span>
    </button>
  );
}
