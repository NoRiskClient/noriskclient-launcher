import { useEffect, useLayoutEffect, useRef } from "react";

import { parseErrorMessage } from "../../utils/error-utils";

import {
  samePath,
  type AudioPreview,
  type ExportProgress,
  type ExportedClip,
  type ExportedGif,
  type TrimmedClip,
} from "../../services/clip-service";

export interface CaptureError {
  code: string;
  message?: string;
  recoverable?: boolean;
  source?: string | null;
}

export function clipFailure(error: unknown, t: (key: string) => string, fallback?: string): string {
  if ((error as { kind?: unknown } | null)?.kind === "ClipEngineOff") return t("clips.engine_off");
  return fallback ?? parseErrorMessage(error);
}

export function writeFailed(error: CaptureError, path: string): boolean {
  if (error.code !== "clip_write" && error.code !== "protocol") return false;
  return error.source == null || samePath(error.source, path);
}

export interface ClipEngineHandlers {
  clip_saved?: () => void;
  clip_trimmed?: (clip: TrimmedClip) => void;
  clip_export_progress?: (progress: ExportProgress) => void;
  clip_exported?: (clip: ExportedClip) => void;
  clip_gif_exported?: (gif: ExportedGif) => void;
  clip_error?: (error: CaptureError) => void;
  clip_engine_stopped?: () => void;
  clip_audio_preview?: (preview: AudioPreview) => void;
}

const EVENTS: (keyof ClipEngineHandlers)[] = [
  "clip_saved",
  "clip_trimmed",
  "clip_export_progress",
  "clip_exported",
  "clip_gif_exported",
  "clip_error",
  "clip_engine_stopped",
  "clip_audio_preview",
];

export function useClipEngineEvents(handlers: ClipEngineHandlers) {
  const latest = useRef(handlers);

  useLayoutEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stops = await Promise.all(
        EVENTS.map((name) =>
          listen<unknown>(name, (event) => {
            const handler = latest.current[name] as ((payload: unknown) => void) | undefined;
            handler?.(event.payload);
          }),
        ),
      );
      if (!alive) {
        stops.forEach((off) => off());
        return;
      }
      stop = () => stops.forEach((off) => off());
    })();

    return () => {
      alive = false;
      stop?.();
    };
  }, []);
}
