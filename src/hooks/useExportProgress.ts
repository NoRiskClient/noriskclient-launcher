import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { TFunction } from "i18next";
import { EventType, type EventPayload, type ExportStep } from "../types/events";

const MB = 1024 * 1024;

function parseStep(message: string): ExportStep | null {
  try {
    return JSON.parse(message) as ExportStep;
  } catch {
    return null;
  }
}

export function exportStepText(t: TFunction, step: ExportStep): string {
  if (step.phase === "uploading") {
    return t("export.progress.uploading", { sent: (step.done / MB).toFixed(1), total: (step.total / MB).toFixed(1) });
  }
  if (step.phase === "checking") return t("export.progress.checking");
  return t("export.progress.collecting", { done: step.done, total: step.total });
}

export function useExportProgress(
  profileId: string | undefined,
  onProgress: (step: ExportStep, percent: number | null) => void,
  enabled = true,
) {
  const callback = useRef(onProgress);
  callback.current = onProgress;

  useEffect(() => {
    if (!enabled || !profileId) return;
    const stop = listen<EventPayload>("state_event", ({ payload }) => {
      if (payload.target_id !== profileId || payload.event_type !== EventType.ExportingProfile) return;
      const step = parseStep(payload.message);
      if (!step) return;
      callback.current(step, payload.progress === null ? null : Math.round(payload.progress * 100));
    });
    return () => {
      void stop.then((unlisten) => unlisten());
    };
  }, [profileId, enabled]);
}
