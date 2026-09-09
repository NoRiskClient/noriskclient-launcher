"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";

import { Button } from "../ui/buttons/Button";
import { Modal } from "../ui/Modal";
import { StatusMessage } from "../ui/StatusMessage";
import { useThemeStore } from "../../store/useThemeStore";
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
  const accentColor = useThemeStore((state) => state.accentColor);
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

  const footer = (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        {running ? (
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-black/40 border border-white/10">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-200",
                  percent === null && "w-1/3 animate-pulse",
                )}
                style={{
                  backgroundColor: accentColor.value,
                  width: percent === null ? undefined : `${Math.max(2, percent)}%`,
                }}
              />
            </div>
            <p className="font-minecraft text-xs text-white/60">
              {percent === null
                ? t("clips.vertical.starting")
                : t("clips.vertical.progress", { percent })}
            </p>
          </div>
        ) : (
          <p className="font-minecraft text-xs text-white/60">
            {kept
              ? t("clips.vertical.result", { width: kept.width, height: kept.height })
              : t("clips.vertical.measuring")}
          </p>
        )}
      </div>

      {!running && (
        <Button
          variant="default"
          size="sm"
          icon={<Icon icon="solar:smartphone-bold" className="w-4 h-4" />}
          onClick={() => void start()}
          disabled={!kept}
        >
          {stage.kind === "failed" ? t("clips.vertical.retry") : t("clips.vertical.create")}
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      title={t("clips.vertical.title")}
      titleIcon={<Icon icon="solar:smartphone-bold" className="w-5 h-5" />}
      titleSubtitle={
        <span className="font-minecraft text-xs text-white/60">{t("clips.vertical.subtitle")}</span>
      }
      onClose={onClose}
      width="lg"
      closeOnClickOutside={!running}
      footer={footer}
    >
      <div className="flex flex-col gap-4 p-4">
        {stage.kind === "failed" && (
          <StatusMessage type="error" message={stage.why} className="mb-0" />
        )}

        <div className="relative overflow-hidden rounded-lg bg-black border border-white/10">
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
            className="max-h-[52vh] w-full object-contain"
          />

          {kept && size && (
            <div className="pointer-events-none absolute inset-0 flex justify-center">
              <div className="h-full flex-1 bg-black/65" />
              <div
                className="h-full shrink-0 border-x-2"
                style={{
                  width: `${(kept.width / size.width) * 100}%`,
                  borderColor: accentColor.value,
                }}
              />
              <div className="h-full flex-1 bg-black/65" />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function samePath(a: string, b: string): boolean {
  const flatten = (path: string) => path.replace(/\\/g, "/").toLowerCase();
  return flatten(a) === flatten(b);
}
