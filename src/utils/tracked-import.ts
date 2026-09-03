import { toast } from "react-hot-toast";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createElement } from "react";

import { useProfileStore } from "../store/profile-store";
import { EventType, type EventPayload } from "../types/events";
import { ProgressToast } from "../components/ui/ProgressToast";
import { parseErrorMessage } from "./error-utils";
import { logError, logInfo } from "./logging-utils";
import i18n from "../i18n/i18n";

export interface TrackedImportOptions<T> {
  dedupeKey: string;
  label: string;
  run: (eventId: string) => Promise<T>;
  onCancel?: (eventId: string) => Promise<unknown>;
  onCancelled?: () => void;
  progressMessage?: (label: string) => string;
  successMessage?: (label: string) => string;
  errorMessage?: (label: string, error: string) => string;
  cancelledMessage?: (label: string) => string;
  alreadyRunningMessage?: () => string;
  refreshProfiles?: boolean;
  toastId?: string;
}

function wasCancelled(error: string): boolean {
  return error.toLowerCase().includes("cancelled");
}

export async function runTrackedImport<T>({
  dedupeKey,
  label,
  run,
  onCancel,
  onCancelled,
  progressMessage = (name) => i18n.t("dragdrop.importing", { fileName: name }),
  successMessage = (name) => i18n.t("profiles.import_success", { fileName: name }),
  errorMessage = (_name, error) => i18n.t("profiles.import_failed", { error }),
  cancelledMessage = (name) => i18n.t("profiles.import_cancelled", { name }),
  alreadyRunningMessage = () => i18n.t("profiles.errors.already_importing"),
  refreshProfiles = true,
  toastId: sharedToastId,
}: TrackedImportOptions<T>): Promise<T | null> {
  const { isPathImporting, addImportingPath, removeImportingPath } =
    useProfileStore.getState();

  if (isPathImporting(dedupeKey)) {
    toast.error(alreadyRunningMessage());
    return null;
  }

  const eventId = crypto.randomUUID();
  const toastId = sharedToastId ?? `import-${eventId}`;
  let unlisten: UnlistenFn | null = null;
  let cancelRequested = false;

  addImportingPath(dedupeKey);

  const requestCancel = async () => {
    if (cancelRequested || !onCancel) return;
    cancelRequested = true;
    logInfo(`[TrackedImport] Cancelling '${label}'`);
    try {
      await onCancel(eventId);
    } catch (err) {
      logError(`[TrackedImport] Cancel failed: ${parseErrorMessage(err)}`);
    }
  };

  const cancelButton = () =>
    createElement(
      "button",
      {
        type: "button",
        onClick: () => void requestCancel(),
        disabled: cancelRequested,
        className:
          "shrink-0 px-2 py-1 rounded-md border border-white/15 text-white/60 hover:text-white hover:border-white/35 transition-colors disabled:opacity-40",
      },
      i18n.t("common.cancel"),
    );

  const renderProgress = (progress: number) =>
    toast.custom(
      () =>
        createElement(ProgressToast, {
          message: progressMessage(label),
          progress,
          action: onCancel ? cancelButton() : undefined,
        }),
      { id: toastId, duration: Infinity },
    );

  try {
    unlisten = await listen<EventPayload>("state_event", (event) => {
      const payload = event.payload;
      if (payload.event_type !== EventType.TaskProgress) return;
      if (payload.event_id !== eventId) return;

      renderProgress((payload.progress ?? 0) * 100);
    });

    renderProgress(0);

    const result = await run(eventId);
    logInfo(`[TrackedImport] Finished '${label}'`);

    toast.success(successMessage(label), { id: toastId, duration: 3000 });

    if (refreshProfiles) {
      await useProfileStore.getState().fetchProfiles();
    }

    return result;
  } catch (err) {
    const error = parseErrorMessage(err);

    if (cancelRequested || wasCancelled(error)) {
      logInfo(`[TrackedImport] Cancelled '${label}'`);
      toast(cancelledMessage(label), { id: toastId, duration: 3000 });
      onCancelled?.();
      return null;
    }

    logError(`[TrackedImport] Failed '${label}': ${error}`);

    if (error.toLowerCase().includes("insufficient disk space")) {
      toast.error(`${error}\n\n${i18n.t("profiles.disk_space_tip")}`, {
        id: toastId,
        duration: 8000,
      });
    } else {
      toast.error(errorMessage(label, error), { id: toastId });
    }
    return null;
  } finally {
    unlisten?.();
    removeImportingPath(dedupeKey);
  }
}
