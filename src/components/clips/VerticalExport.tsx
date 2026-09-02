"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";

import { exportVertical, type ExportedClip, type ExportProgress } from "../../services/clip-service";
import { parseErrorMessage } from "../../utils/error-utils";
import { cn } from "../../lib/utils";

const RATIO = 9 / 16;

interface Props {
  src: string;
  path: string;
  onClose: () => void;
  onDone: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

type Stage =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "failed"; why: string };

export function VerticalExport({ src, path, onClose, onDone, t }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let alive = true;

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stops = await Promise.all([
        listen<ExportProgress>("clip_export_progress", (event) => {
          if (!samePath(event.payload.source, path)) return;
          setStage({ kind: "running", done: event.payload.done, total: event.payload.total });
        }),
        listen<ExportedClip>("clip_exported", (event) => {
          if (!samePath(event.payload.source, path)) return;
          onDone();
        }),
      ]);
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
  }, [path, onDone]);

  const start = async () => {
    setStage({ kind: "running", done: 0, total: 0 });
    try {
      await exportVertical(path);
    } catch (e) {
      console.error("Could not start the vertical export", e);
      setStage({ kind: "failed", why: parseErrorMessage(e) });
    }
  };

  const kept = size
    ? size.width / size.height > RATIO
      ? { width: Math.round(size.height * RATIO) & ~1, height: size.height & ~1 }
      : { width: size.width & ~1, height: Math.round(size.width / RATIO) & ~1 }
    : null;

  const running = stage.kind === "running";
  const percent =
    stage.kind === "running" && stage.total > 0
      ? Math.round((stage.done / stage.total) * 100)
      : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
      onClick={running ? undefined : onClose}
      role="presentation"
    >
      <div
        className="flex w-full max-w-3xl flex-col gap-4 rounded-xl border border-white/10 bg-[#141414] p-5"
        onClick={(event) => event.stopPropagation()}
        role="presentation"
      >
        <div className="flex items-center gap-3">
          <Icon icon="solar:smartphone-bold" className="h-5 w-5 shrink-0 text-white/70" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white">{t("clips.vertical.title")}</p>
            <p className="truncate text-xs text-white/40">{t("clips.vertical.subtitle")}</p>
          </div>
          {!running && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("clips.gallery.close")}
              className="rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Icon icon="solar:close-circle-linear" className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="relative overflow-hidden rounded-lg bg-black">
          <video
            src={src}
            muted
            playsInline
            loop
            autoPlay
            onLoadedMetadata={(event) =>
              setSize({
                width: event.currentTarget.videoWidth,
                height: event.currentTarget.videoHeight,
              })
            }
            className="max-h-[46vh] w-full object-contain"
          />

          {kept && size && (
            <div className="pointer-events-none absolute inset-0 flex justify-center">
              <div className="h-full flex-1 bg-black/65" />
              <div
                className="h-full shrink-0 border-x-2 border-white/80"
                style={{ width: `${(kept.width / size.width) * 100}%` }}
              />
              <div className="h-full flex-1 bg-black/65" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {stage.kind === "failed" ? (
              <p className="text-xs text-red-300/90">{stage.why}</p>
            ) : running ? (
              <div className="flex flex-col gap-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={cn(
                      "h-full rounded-full bg-white transition-[width] duration-200",
                      percent === null && "w-1/3 animate-pulse",
                    )}
                    style={percent === null ? undefined : { width: `${Math.max(2, percent)}%` }}
                  />
                </div>
                <p className="text-xs text-white/45">
                  {percent === null
                    ? t("clips.vertical.starting")
                    : t("clips.vertical.progress", { percent })}
                </p>
              </div>
            ) : (
              <p className="text-xs text-white/40">
                {kept
                  ? t("clips.vertical.result", {
                      width: kept.width,
                      height: kept.height,
                    })
                  : t("clips.vertical.measuring")}
              </p>
            )}
          </div>

          {!running && (
            <button
              type="button"
              onClick={() => void start()}
              disabled={!kept}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg bg-white px-4 py-2",
                "text-sm font-medium text-black transition-opacity hover:opacity-90",
                !kept && "cursor-not-allowed opacity-40",
              )}
            >
              <Icon icon="solar:smartphone-bold" className="h-4 w-4" />
              {stage.kind === "failed"
                ? t("clips.vertical.retry")
                : t("clips.vertical.create")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function samePath(a: string, b: string): boolean {
  const flatten = (path: string) => path.replace(/\\/g, "/").toLowerCase();
  return flatten(a) === flatten(b);
}
