"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { Span } from "../../services/clip-service";
import { logWarn } from "../../utils/logging-utils";

const END_SLACK = 1 / 60;

interface Options {
  video: RefObject<HTMLVideoElement | null>;
  start: number;
  end: number;
  removed: Span[];
  quiet: Span[];
  ownsSound: boolean;
  onTime: (seconds: number) => void;
}

function within(spans: Span[], seconds: number): Span | undefined {
  return spans.find((span) => seconds >= span.startSeconds && seconds < span.endSeconds);
}

export function usePlayback({ video, start, end, removed, quiet, ownsSound, onTime }: Options) {
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const latest = useRef({ end, removed, quiet, ownsSound, onTime });
  latest.current = { end, removed, quiet, ownsSound, onTime };

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let frame = 0;

    const tick = () => {
      const { end, removed, quiet, ownsSound, onTime } = latest.current;
      let now = element.currentTime;
      const hole = within(removed, now);
      if (hole) {
        element.currentTime = hole.endSeconds;
        now = hole.endSeconds;
      }
      if (ownsSound && quiet.length > 0) element.muted = within(quiet, now) !== undefined;
      if (now >= end) {
        element.pause();
        element.currentTime = end;
        now = end;
      }
      onTime(now);
      if (!element.paused) frame = requestAnimationFrame(tick);
    };

    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      setBuffering(false);
      cancelAnimationFrame(frame);
      latest.current.onTime(element.currentTime);
    };
    const onSeeked = () => {
      if (element.paused) latest.current.onTime(element.currentTime);
    };
    const onWaiting = () => setBuffering(true);
    const onReady = () => setBuffering(false);

    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("seeked", onSeeked);
    element.addEventListener("waiting", onWaiting);
    element.addEventListener("playing", onReady);
    element.addEventListener("canplay", onReady);
    if (!element.paused) onPlay();

    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("seeked", onSeeked);
      element.removeEventListener("waiting", onWaiting);
      element.removeEventListener("playing", onReady);
      element.removeEventListener("canplay", onReady);
    };
  }, [video]);

  useEffect(() => {
    const element = video.current;
    if (element && ownsSound && quiet.length === 0) element.muted = false;
  }, [ownsSound, quiet, video]);

  const toggle = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    if (element.currentTime < start || element.currentTime >= end - END_SLACK) {
      element.currentTime = start;
    }
    void element.play().catch((error: unknown) => {
      logWarn(`[ClipPreview] play() was refused: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    });
  }, [end, start, video]);

  return { playing, buffering, toggle };
}
