"use client";

import { useMemo } from "react";

import { RangeSlider } from "../ui/RangeSlider";
import { ClipIconButton } from "./ClipIconButton";
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
  const muteLabel = muted ? t("clips.trim.unmute") : t("clips.trim.mute");

  return (
    <div className="flex items-center gap-4">
      <ClipIconButton
        icon={
          muted
            ? "solar:volume-cross-bold"
            : track.label === "Microphone"
              ? "solar:microphone-bold"
              : "solar:volume-loud-bold"
        }
        label={muteLabel}
        tooltipPosition="top"
        aria-pressed={muted}
        disabled={disabled}
        onClick={() => onChange(muted ? 100 : 0)}
        className={cn("shrink-0", muted && "text-white/40 hover:text-white/70")}
      />

      <span className="w-28 shrink-0 truncate font-minecraft text-sm text-white/80">{name}</span>

      <div className="flex-1 min-w-0">
        <RangeSlider
          value={volume}
          onChange={onChange}
          min={0}
          max={200}
          step={5}
          size="sm"
          showValue={false}
          recommendedValue={100}
          disabled={disabled}
          label={t("clips.trim.volume_for", { name })}
        />
      </div>

      <span
        className={cn(
          "w-12 shrink-0 text-right font-minecraft text-sm",
          volume === 100 ? "text-white/50" : "text-white",
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
