"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { Span } from "../../services/clip-service";
import { logWarn } from "../../utils/logging-utils";

const END_SLACK = 1 / 60;
const LOOKAHEAD_SECONDS = 1.5;
const HANDOVER_LEAD_SECONDS = 0.3;
const PRIMED_SLACK_SECONDS = 0.05;

interface Options {
  video: RefObject<HTMLVideoElement | null>;
  standby: RefObject<HTMLVideoElement | null>;
  start: number;
  end: number;
  removed: Span[];
  quiet: Span[];
  ownsSound: boolean;
  onTime: (seconds: number) => void;
}

interface Cover {
  resumeAt: number;
}

function within(spans: Span[], seconds: number): Span | undefined {
  return spans.find((span) => seconds >= span.startSeconds && seconds < span.endSeconds);
}

function upcoming(spans: Span[], seconds: number): Span | undefined {
  return spans
    .filter((span) => span.startSeconds >= seconds && span.startSeconds - seconds <= LOOKAHEAD_SECONDS)
    .sort((a, b) => a.startSeconds - b.startSeconds)[0];
}

function refuse(error: unknown) {
  logWarn(`[ClipPreview] play() was refused: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
}

export function usePlayback({ video, standby, start, end, removed, quiet, ownsSound, onTime }: Options) {
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const latest = useRef({ end, removed, quiet, ownsSound, onTime });
  latest.current = { end, removed, quiet, ownsSound, onTime };
  const cover = useRef<Cover | null>(null);
  const uncover = useRef<(resume: boolean) => void>(() => {});

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const spare = standby.current;
    let frame = 0;

    const silent = (at: number) => !latest.current.ownsSound || within(latest.current.quiet, at) !== undefined;

    const ready = (hole: Span) =>
      !!spare && !spare.seeking && Math.abs(spare.currentTime - hole.endSeconds) <= PRIMED_SLACK_SECONDS;

    const hide = () => {
      cover.current = null;
      if (!spare) return;
      spare.pause();
      spare.muted = true;
      spare.style.visibility = "hidden";
    };
    uncover.current = (resume) => {
      if (!cover.current || !spare) return;
      const at = spare.currentTime;
      hide();
      element.currentTime = at;
      if (resume) void element.play().catch(refuse);
      else setPlaying(false);
    };

    const handOver = (hole: Span) => {
      if (!spare || !ready(hole) || spare.readyState < 2) return false;
      const { end, removed } = latest.current;
      const after = upcoming(removed, hole.endSeconds)?.startSeconds ?? end;
      const resumeAt = Math.min(hole.endSeconds + HANDOVER_LEAD_SECONDS, end, after);
      if (resumeAt <= hole.endSeconds) return false;
      cover.current = { resumeAt };
      spare.muted = silent(hole.endSeconds);
      spare.style.visibility = "visible";
      void spare.play().catch(refuse);
      element.pause();
      element.currentTime = resumeAt;
      return true;
    };

    const tick = () => {
      const { end, removed, ownsSound, onTime } = latest.current;
      const covering = cover.current;

      if (covering && spare) {
        const now = spare.currentTime;
        spare.muted = silent(now);
        onTime(now);
        if (now >= covering.resumeAt && !element.seeking && element.readyState >= 2) {
          void element.play().catch(refuse);
          hide();
        }
        frame = requestAnimationFrame(tick);
        return;
      }

      let now = element.currentTime;
      const hole = within(removed, now);
      if (spare && !spare.seeking) {
        const next = hole ?? upcoming(removed, now);
        if (next && !ready(next)) spare.currentTime = next.endSeconds;
      }

      if (hole) {
        if (handOver(hole)) {
          onTime(hole.endSeconds);
          frame = requestAnimationFrame(tick);
          return;
        }
        element.currentTime = hole.endSeconds;
        now = hole.endSeconds;
      }
      if (ownsSound) element.muted = silent(now);
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
      if (cover.current) return;
      setPlaying(false);
      setBuffering(false);
      cancelAnimationFrame(frame);
      latest.current.onTime(element.currentTime);
    };
    const onSeeked = () => {
      if (element.paused && !cover.current) latest.current.onTime(element.currentTime);
    };
    const onWaiting = () => {
      if (!cover.current) setBuffering(true);
    };
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
      hide();
      uncover.current = () => {};
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("seeked", onSeeked);
      element.removeEventListener("waiting", onWaiting);
      element.removeEventListener("playing", onReady);
      element.removeEventListener("canplay", onReady);
    };
  }, [standby, video]);

  const toggle = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (cover.current) {
      uncover.current(false);
      return;
    }
    if (!element.paused) {
      element.pause();
      return;
    }
    if (element.currentTime < start || element.currentTime >= end - END_SLACK) {
      element.currentTime = start;
    }
    void element.play().catch(refuse);
  }, [end, start, video]);

  const settle = useCallback(() => uncover.current(true), []);

  return { playing, buffering, toggle, settle };
}
