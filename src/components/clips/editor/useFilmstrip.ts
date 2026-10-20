"use client";

import { useEffect, useState } from "react";

const FILMSTRIP_FRAMES = 14;

const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 90;

export function useFilmstrip(src: string, duration: number): string | null {
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
