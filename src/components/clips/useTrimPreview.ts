"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import {
  prepareClipPreview,
  samePath,
  type PreviewTrack,
  type Span,
  type TrackLevel,
} from "../../services/clip-service";

export type PreviewState = "unavailable" | "loading" | "live";

interface Options {
  path: string;
  video: React.RefObject<HTMLVideoElement | null>;
  levels: TrackLevel[];
  muted: Record<number, Span[]>;
  active: boolean;
}

export function useTrimPreview({ path, video, levels, muted, active }: Options): PreviewState {
  const [state, setState] = useState<PreviewState>("loading");
  const context = useRef<AudioContext | null>(null);
  const buffers = useRef<Map<number, AudioBuffer>>(new Map());
  const gains = useRef<Map<number, GainNode>>(new Map());
  const playing = useRef<Voice[]>([]);
  const restart = useRef<(() => void) | null>(null);

  const wanted = useRef(levels);
  wanted.current = levels;
  const quiet = useRef(muted);
  quiet.current = muted;

  useEffect(() => {
    if (!active) return;

    let alive = true;
    let stopListening: (() => void) | undefined;

    const load = async (tracks: PreviewTrack[]) => {
      const controlled = new Set(wanted.current.map((level) => level.stream));
      const wanted_tracks = tracks.filter((track) => controlled.has(track.stream));

      if (wanted_tracks.length === 0) {
        setState("unavailable");
        return;
      }

      const audio = new AudioContext();
      context.current = audio;

      try {
        await Promise.all(
          wanted_tracks.map(async (track) => {
            const response = await fetch(convertFileSrc(track.path));
            const bytes = await response.arrayBuffer();
            const buffer = await audio.decodeAudioData(bytes);
            if (!alive) return;

            const gain = audio.createGain();
            gain.gain.value = levelOf(wanted.current, track.stream);
            gain.connect(audio.destination);

            buffers.current.set(track.stream, buffer);
            gains.current.set(track.stream, gain);
          }),
        );
      } catch (e) {
        console.warn("Could not load the preview audio", e);
        if (alive) setState("unavailable");
        return;
      }

      if (alive) setState("live");
    };

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<{ source: string; tracks: PreviewTrack[] }>(
        "clip_audio_preview",
        (event) => {
          if (!samePath(event.payload.source, path)) return;
          void load(event.payload.tracks);
        },
      );
      if (!alive) {
        unlisten();
        return;
      }
      stopListening = unlisten;

      try {
        await prepareClipPreview(path);
      } catch (e) {
        console.warn("Could not ask for the preview audio", e);
        if (alive) setState("unavailable");
      }
    })();

    return () => {
      alive = false;
      stopListening?.();
      playing.current.forEach(silence);
      playing.current = [];
      gains.current.clear();
      buffers.current.clear();
      void context.current?.close().catch(() => {});
      context.current = null;
    };
  }, [path, active]);

  useEffect(() => {
    for (const level of levels) {
      const gain = gains.current.get(level.stream);
      if (gain) gain.gain.value = level.volume / 100;
    }
  }, [levels]);

  const timing = useMemo(
    () =>
      JSON.stringify([
        levels.map((level) => [level.stream, level.offsetSeconds, level.startSeconds, level.endSeconds]),
        muted,
      ]),
    [levels, muted],
  );

  useEffect(() => {
    restart.current?.();
  }, [timing]);

  useEffect(() => {
    const element = video.current;
    if (!element || state !== "live") return;

    element.muted = true;

    const stopAll = () => {
      playing.current.forEach(silence);
      playing.current = [];
    };

    const startAll = () => {
      const audio = context.current;
      if (!audio) return;
      stopAll();
      void audio.resume().catch(() => {});

      const at = element.currentTime;
      for (const [stream, buffer] of buffers.current) {
        const gain = gains.current.get(stream);
        if (!gain) continue;

        const level = wanted.current.find((one) => one.stream === stream);
        const shift = level?.offsetSeconds ?? 0;
        const opens = level?.startSeconds ?? null;
        const closes = level?.endSeconds ?? null;

        const from = opens === null ? at : Math.max(at, opens);
        const seek = from - shift;
        const enter = seek < 0 ? from - seek : from;
        const head = Math.max(seek, 0);
        if (head >= buffer.duration) continue;

        const span = closes === null ? undefined : closes - enter;
        if (span !== undefined && span <= 0) continue;

        const now = audio.currentTime;
        const hush = audio.createGain();
        for (const gap of quiet.current[stream] ?? []) {
          if (gap.endSeconds <= at) continue;
          hush.gain.setValueAtTime(0, now + Math.max(0, gap.startSeconds - at));
          hush.gain.setValueAtTime(1, now + gap.endSeconds - at);
        }
        hush.connect(gain);

        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.connect(hush);
        source.onended = () => hush.disconnect();
        source.start(now + (enter - at), head, span);
        playing.current.push({ source, hush });
      }
    };

    restart.current = () => {
      if (!element.paused && !element.seeking) startAll();
    };

    const onSeek = () => {
      if (!element.paused) startAll();
    };

    element.addEventListener("playing", startAll);
    element.addEventListener("waiting", stopAll);
    element.addEventListener("pause", stopAll);
    element.addEventListener("ended", stopAll);
    element.addEventListener("seeked", onSeek);
    element.addEventListener("seeking", stopAll);

    if (!element.paused) startAll();

    return () => {
      element.removeEventListener("playing", startAll);
      element.removeEventListener("waiting", stopAll);
      element.removeEventListener("pause", stopAll);
      element.removeEventListener("ended", stopAll);
      element.removeEventListener("seeked", onSeek);
      element.removeEventListener("seeking", stopAll);
      restart.current = null;
      stopAll();
      element.muted = false;
    };
  }, [state, video]);

  return state;
}

function levelOf(levels: TrackLevel[], stream: number): number {
  return (levels.find((level) => level.stream === stream)?.volume ?? 100) / 100;
}

interface Voice {
  source: AudioBufferSourceNode;
  hush: GainNode;
}

function silence({ source, hush }: Voice) {
  try {
    source.stop();
  } catch {
  }
  source.disconnect();
  hush.disconnect();
}
