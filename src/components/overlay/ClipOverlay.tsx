"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

const HOLD_MS = 2600;
const FADE_MS = 400;

interface ClipManifest {
  path: string;
  duration_seconds: number;
  size_bytes: number;
  width: number;
  height: number;
}

interface CaptureError {
  code: string;
  message: string;
  recoverable: boolean;
}

type Shown =
  | { kind: "saved"; clip: ClipManifest }
  | { kind: "error"; error: CaptureError };

export function ClipOverlay() {
  const { t } = useTranslation();
  const [shown, setShown] = useState<Shown | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  const present = useCallback(
    (next: Shown) => {
      clearTimers();
      setShown(next);
      setLeaving(false);

      playChime(next.kind === "error");

      requestAnimationFrame(() => {
        invoke("capture_show_overlay").catch(() => {});
      });

      timers.current.push(
        window.setTimeout(() => setLeaving(true), HOLD_MS),
        window.setTimeout(() => {
          invoke("capture_hide_overlay").catch(() => {});
          setShown(null);
        }, HOLD_MS + FADE_MS),
      );
    },
    [clearTimers],
  );

  useEffect(() => {
    const saved = listen<ClipManifest>("clip_saved", (event) => {
      present({ kind: "saved", clip: event.payload });
    });

    const failed = listen<CaptureError>("clip_error", (event) => {
      if (event.payload.code === "AudioDevice") return;
      present({ kind: "error", error: event.payload });
    });

    return () => {
      clearTimers();
      saved.then((stop) => stop()).catch(() => {});
      failed.then((stop) => stop()).catch(() => {});
    };
  }, [clearTimers, present]);

  if (!shown) return null;

  if (shown.kind === "error") {
    return (
      <OverlayPanel leaving={leaving}>
        <Icon
          icon="solar:info-circle-bold"
          className="h-6 w-6 shrink-0 text-amber-300"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">
            {t(`overlay.clip.error.${shown.error.code}`, {
              defaultValue: t("overlay.clip.error.generic"),
            })}
          </p>
          <p className="mt-0.5 truncate text-xs text-white/50">
            {t(`overlay.clip.error.${shown.error.code}.hint`, { defaultValue: "" })}
          </p>
        </div>
      </OverlayPanel>
    );
  }

  const clip = shown.clip;

  const seconds = Math.round(clip.duration_seconds);
  const megabytes = Math.round(clip.size_bytes / 1_000_000);

  return (
    <OverlayPanel leaving={leaving}>
      <Icon
        icon="solar:videocamera-record-bold"
        className="h-6 w-6 shrink-0 text-emerald-300"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">
          {t("overlay.clip.saved")}
        </p>
        <p className="mt-0.5 truncate font-mono text-xs tabular-nums text-white/50">
          {t("overlay.clip.details", { seconds, megabytes })}
        </p>
      </div>
    </OverlayPanel>
  );
}

function OverlayPanel({
  leaving,
  children,
}: {
  leaving: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex h-screen w-screen items-center justify-center"
      style={{
        opacity: leaving ? 0 : 1,
        transform: leaving ? "translateY(8px)" : "translateY(0)",
        transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
      }}
    >
      <div className="flex h-full w-full items-center gap-3 rounded-lg border border-white/10 bg-neutral-800/95 px-4">
        {children}
      </div>
    </div>
  );
}

function playChime(failed = false) {
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const now = context.currentTime;

    const notes = failed
      ? ([
          [740, 0],
          [554, 0.09],
        ] as const)
      : ([
          [880, 0],
          [1318.5, 0.09],
        ] as const);

    for (const [frequency, start] of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;

      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.16, now + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.22);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + start);
      oscillator.stop(now + start + 0.24);
    }

    window.setTimeout(() => context.close().catch(() => {}), 800);
  } catch {}
}
