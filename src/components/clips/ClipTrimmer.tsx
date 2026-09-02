"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";

import type { ClipDetails, TrackLevel } from "../../services/clip-service";
import { TrackLevelControl, Waveform, trackName } from "./ClipTimeline";
import { cn } from "../../lib/utils";
import { useTrimPreview } from "./useTrimPreview";

const MIN_LENGTH = 0.5;

const FILMSTRIP_FRAMES = 14;

const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;

const NUDGE = 0.1;

interface Props {
  src: string;
  path: string;
  duration: number;
  busy: boolean;
  details: ClipDetails | null;
  onCancel: () => void;
  onSave: (startSeconds: number, endSeconds: number, levels: TrackLevel[]) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function ClipTrimmer({
  src,
  path,
  duration,
  busy,
  details,
  onCancel,
  onSave,
  t,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);

  const lanes = useMemo(() => details?.audioTracks ?? [], [details]);
  const adjustable = useMemo(() => lanes.filter((track) => track.adjustable), [lanes]);

  const [volumes, setVolumes] = useState<Record<number, number>>({});
  useEffect(() => {
    setVolumes(Object.fromEntries(adjustable.map((track) => [track.stream, 100])));
  }, [adjustable]);

  const levels: TrackLevel[] = useMemo(
    () => adjustable.map((track) => ({ stream: track.stream, volume: volumes[track.stream] ?? 100 })),
    [adjustable, volumes],
  );
  const rebalanced = levels.some((level) => level.volume !== 100);

  const previewState = useTrimPreview({
    path,
    video: videoRef,
    levels,
    active: adjustable.length > 0,
  });

  const drawn = adjustable.length > 0 ? adjustable : lanes;

  useEffect(() => {
    if (duration > 0) setEnd((current) => (current === 0 ? duration : Math.min(current, duration)));
  }, [duration]);

  const filmstrip = useFilmstrip(src, duration);

  const kept = Math.max(0, end - start);
  const percent = useCallback(
    (seconds: number) => (duration > 0 ? (seconds / duration) * 100 : 0),
    [duration],
  );

  const seek = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (video) video.currentTime = Math.max(0, Math.min(seconds, duration));
    },
    [duration],
  );

  const secondsAt = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      if (!bar || duration <= 0) return 0;
      const rect = bar.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
    },
    [duration],
  );

  const moveHandle = useCallback(
    (which: "start" | "end", seconds: number) => {
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
    [duration, end, seek, start],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => moveHandle(dragging, secondsAt(event.clientX));
    const up = () => setDragging(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, moveHandle, secondsAt]);

  const preview = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    video.currentTime = start;
    void video.play().catch(() => {});
  }, [start]);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <video
          ref={videoRef}
          src={src}
          className="max-h-[52vh] w-full rounded-xl bg-black"
          onClick={preview}
        />
        {!playing && (
          <button
            type="button"
            onClick={preview}
            aria-label={t("clips.trim.preview")}
            className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/20 transition-colors hover:bg-black/30"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
              <Icon icon="solar:play-bold" className="ml-0.5 h-6 w-6 text-white" />
            </span>
          </button>
        )}
      </div>

      <div className="flex items-end justify-center gap-6">
        <Readout label={t("clips.trim.from")} value={formatTime(start)} />
        <div className="flex flex-col items-center pb-1">
          <span className="text-2xl font-light tabular-nums text-white">
            {kept.toFixed(1)}
            <span className="ml-0.5 text-base text-white/50">s</span>
          </span>
          <span className="text-[10px] uppercase tracking-wider text-white/35">
            {t("clips.trim.kept_label")}
          </span>
        </div>
        <Readout label={t("clips.trim.to")} value={formatTime(end)} />
      </div>

      <div className="flex flex-col gap-2">
        <div
          ref={barRef}
          className="relative select-none overflow-hidden rounded-lg bg-black/40 ring-1 ring-white/10"
          onPointerDown={(event) => {
            const seconds = secondsAt(event.clientX);
            seek(seconds);
            setPlayhead(seconds);
          }}
          role="presentation"
        >
          <div className="relative h-16">
            {filmstrip ? (
              <img
                src={filmstrip}
                alt=""
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-90"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Icon icon="solar:refresh-linear" className="h-4 w-4 animate-spin text-white/25" />
              </div>
            )}
          </div>

          {drawn.map((track) => {
            const volume = track.adjustable ? (volumes[track.stream] ?? 100) : 100;
            return (
              <div
                key={track.stream}
                className="relative h-12 border-t border-white/[0.07] text-emerald-300"
              >
                <Waveform peaks={track.peaks} gain={volume / 100} muted={volume === 0} />
                <span className="pointer-events-none absolute left-2 top-1.5 text-[10px] uppercase tracking-wider text-white/40">
                  {trackName(track.label, t)}
                </span>
              </div>
            );
          })}

          <div
            className="pointer-events-none absolute inset-y-0 left-0 bg-black/70"
            style={{ width: `${percent(start)}%` }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 bg-black/70"
            style={{ width: `${100 - percent(end)}%` }}
          />

          <div
            className="pointer-events-none absolute inset-y-0 border-x-2 border-white/80"
            style={{ left: `${percent(start)}%`, width: `${percent(kept)}%` }}
          />

          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]"
            style={{ left: `${percent(playhead)}%` }}
          />

          <Handle
            left={percent(start)}
            active={dragging === "start"}
            time={formatTime(start)}
            label={t("clips.trim.handle_start")}
            onGrab={() => setDragging("start")}
            onNudge={(by) => moveHandle("start", start + by)}
          />
          <Handle
            left={percent(end)}
            active={dragging === "end"}
            time={formatTime(end)}
            label={t("clips.trim.handle_end")}
            onGrab={() => setDragging("end")}
            onNudge={(by) => moveHandle("end", end + by)}
          />
        </div>

        <p className="min-h-[1.25rem] text-xs text-white/30">{t("clips.trim.hint")}</p>
      </div>

      {adjustable.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-lg bg-white/[0.03] px-3 py-3 ring-1 ring-white/[0.06]">
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
          <p className="text-[11px] leading-relaxed text-white/30">
            {previewState === "live"
              ? t("clips.trim.levels.live")
              : previewState === "loading"
                ? t("clips.trim.levels.preparing")
                : rebalanced
                  ? t("clips.trim.levels.rebuilt")
                  : t("clips.trim.levels.untouched")}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={preview}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Icon icon={playing ? "solar:pause-bold" : "solar:play-bold"} className="h-3.5 w-3.5" />
          {t("clips.trim.preview")}
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg px-3 py-2 text-xs text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          {t("clips.trim.cancel")}
        </button>
        <button
          type="button"
          onClick={() => onSave(start, end, levels)}
          disabled={busy || kept < MIN_LENGTH}
          className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          <Icon
            icon={busy ? "solar:refresh-linear" : "solar:scissors-bold"}
            className={cn("h-3.5 w-3.5", busy && "animate-spin")}
          />
          {t("clips.trim.save")}
        </button>
      </div>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center pb-1">
      <span className="text-sm tabular-nums text-white/70">{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-white/35">{label}</span>
    </div>
  );
}

function Handle({
  left,
  active,
  time,
  label,
  onGrab,
  onNudge,
}: {
  left: number;
  active: boolean;
  time: string;
  label: string;
  onGrab: () => void;
  onNudge: (by: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
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
      className="group absolute inset-y-0 w-6 -translate-x-1/2 cursor-ew-resize focus:outline-none"
      style={{ left: `${left}%` }}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full transition-colors",
          active
            ? "bg-white"
            : "bg-white/80 group-hover:bg-white group-focus-visible:bg-white group-focus-visible:ring-2 group-focus-visible:ring-white/40",
        )}
      />
      <span
        className={cn(
          "pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded bg-black/80 px-1.5 py-0.5 text-[10px] tabular-nums text-white transition-opacity",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        {time}
      </span>
    </button>
  );
}

function useFilmstrip(src: string, duration: number): string | null {
  const [strip, setStrip] = useState<string | null>(null);

  useEffect(() => {
    setStrip(null);
    if (duration <= 0) return;

    let cancelled = false;
    const video = document.createElement("video");
    video.src = src;
    video.muted = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";

    const canvas = document.createElement("canvas");
    canvas.width = THUMB_WIDTH * FILMSTRIP_FRAMES;
    canvas.height = THUMB_HEIGHT;
    const context = canvas.getContext("2d");

    const seekTo = (seconds: number) =>
      new Promise<void>((resolve, reject) => {
        const done = () => {
          video.removeEventListener("seeked", done);
          video.removeEventListener("error", fail);
          resolve();
        };
        const fail = () => {
          video.removeEventListener("seeked", done);
          video.removeEventListener("error", fail);
          reject(new Error("seek failed"));
        };
        video.addEventListener("seeked", done);
        video.addEventListener("error", fail);
        video.currentTime = seconds;
      });

    void (async () => {
      try {
        if (!context) return;
        await new Promise<void>((resolve, reject) => {
          video.addEventListener("loadeddata", () => resolve(), { once: true });
          video.addEventListener("error", () => reject(new Error("load failed")), { once: true });
        });

        for (let i = 0; i < FILMSTRIP_FRAMES; i++) {
          if (cancelled) return;
          await seekTo(((i + 0.5) / FILMSTRIP_FRAMES) * duration);
          if (cancelled) return;
          context.drawImage(video, i * THUMB_WIDTH, 0, THUMB_WIDTH, THUMB_HEIGHT);
        }

        if (!cancelled) setStrip(canvas.toDataURL("image/jpeg", 0.7));
      } catch {}
    })();

    return () => {
      cancelled = true;
      video.removeAttribute("src");
      video.load();
    };
  }, [src, duration]);

  return strip;
}

function formatTime(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  const tenths = Math.floor((seconds - whole) * 10);
  return `${minutes}:${String(rest).padStart(2, "0")}.${tenths}`;
}
