"use client";

import { useMemo } from "react";
import { Icon } from "@iconify/react";

import type { ClipAudioTrack } from "../../services/clip-service";
import { cn } from "../../lib/utils";

const COLUMNS = 320;

const VIEW_HEIGHT = 100;

interface WaveformProps {
  peaks: number[];
  gain: number;
  muted: boolean;
}

export function Waveform({ peaks, gain, muted }: WaveformProps) {
  const path = useMemo(() => {
    if (peaks.length === 0) return null;

    const columns = Math.min(COLUMNS, peaks.length);
    const per = peaks.length / columns;
    const half = VIEW_HEIGHT / 2;

    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i < columns; i++) {
      let loudest = 0;
      for (let j = Math.floor(i * per); j < Math.floor((i + 1) * per); j++) {
        loudest = Math.max(loudest, peaks[j] ?? 0);
      }
      const height = Math.sqrt(loudest / 255) * half * Math.min(1, gain);
      const x = (i / (columns - 1 || 1)) * 1000;
      top.push(`${x.toFixed(1)},${(half - height).toFixed(1)}`);
      bottom.push(`${x.toFixed(1)},${(half + height).toFixed(1)}`);
    }

    return `M${top.join(" L")} L${bottom.reverse().join(" L")} Z`;
  }, [peaks, gain]);

  if (!path) return null;

  return (
    <svg
      viewBox={`0 0 1000 ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full transition-opacity",
        muted ? "opacity-20" : "opacity-70",
      )}
      aria-hidden="true"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}

interface LevelProps {
  track: ClipAudioTrack;
  name: string;
  volume: number;
  onChange: (volume: number) => void;
  disabled: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function TrackLevelControl({ track, name, volume, onChange, disabled, t }: LevelProps) {
  const muted = volume === 0;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(muted ? 100 : 0)}
        disabled={disabled}
        aria-pressed={muted}
        title={muted ? t("clips.trim.unmute") : t("clips.trim.mute")}
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
          muted
            ? "bg-white/[0.06] text-white/30 hover:text-white/60"
            : "text-white/70 hover:bg-white/10 hover:text-white",
          disabled && "cursor-not-allowed opacity-40",
        )}
      >
        <Icon
          icon={
            muted
              ? "solar:volume-cross-bold"
              : track.label === "Microphone"
                ? "solar:microphone-bold"
                : "solar:volume-loud-bold"
          }
          className="h-4 w-4"
        />
      </button>

      <span className="w-24 shrink-0 truncate text-xs text-white/60">{name}</span>

      <input
        type="range"
        min={0}
        max={200}
        step={5}
        value={volume}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={t("clips.trim.volume_for", { name })}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-white disabled:cursor-not-allowed disabled:opacity-40"
      />

      <span
        className={cn(
          "w-11 shrink-0 text-right text-xs tabular-nums",
          volume === 100 ? "text-white/35" : "text-white/70",
        )}
      >
        {volume}%
      </span>
    </div>
  );
}

export function trackName(
  label: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (label) {
    case "Mix":
      return t("clips.trim.track.mix");
    case "Game":
      return t("clips.trim.track.game");
    case "Microphone":
      return t("clips.trim.track.microphone");
    default:
      return label;
  }
}
