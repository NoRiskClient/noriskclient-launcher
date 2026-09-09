import { toast } from "react-hot-toast";

import * as LauncherImportService from "../services/launcher-import-service";
import { useLauncherImportStore } from "../store/launcher-import-store";
import { useProfileStore } from "../store/profile-store";
import { runTrackedImport } from "./tracked-import";
import i18n from "../i18n/i18n";
import type {
  ExternalInstanceRef,
  ImportSelection,
} from "../types/launcherImport";

export interface LauncherImportOverrides {
  name?: string;
  group?: string;
  selection: ImportSelection;
  noriskPackId?: string;
  clearNoriskPack?: boolean;
}

export async function runLauncherInstanceImport(
  target: ExternalInstanceRef,
  overrides: LauncherImportOverrides,
  batch?: { toastId: string; current: number; total: number; onCancelled?: () => void },
): Promise<string | null> {
  const label = overrides.name?.trim() || target.name;

  const profileId = await runTrackedImport<string>({
    dedupeKey: target.instanceDir,
    label,
    toastId: batch?.toastId,
    progressMessage: (name) =>
      batch
        ? i18n.t("profiles.launcherImport.toast.batch", {
            current: batch.current,
            total: batch.total,
            name,
          })
        : i18n.t("profiles.launcherImport.toast.importing", { name }),
    successMessage: (name) => i18n.t("profiles.launcherImport.toast.success", { name }),
    cancelledMessage: (name) =>
      i18n.t("profiles.launcherImport.toast.cancelled", { name }),
    onCancel: (eventId) => LauncherImportService.cancelExternalImport(eventId),
    onCancelled: batch?.onCancelled,
    errorMessage: (name, error) =>
      i18n.t("profiles.launcherImport.toast.failed", { name, error }),
    alreadyRunningMessage: () =>
      i18n.t("profiles.launcherImport.toast.already_running"),
    run: (eventId) =>
      LauncherImportService.importExternalInstance({
        launcher: target.launcher,
        root: target.root,
        instanceDir: target.instanceDir,
        selection: overrides.selection,
        nameOverride: overrides.name,
        groupOverride: overrides.group,
        noriskPackId: overrides.noriskPackId,
        clearNoriskPack: overrides.clearNoriskPack,
        eventId,
      }),
  });

  if (profileId) {
    useLauncherImportStore.getState().markImported(target.instanceDir, profileId);
  }

  return profileId;
}

export interface QueuedImport {
  target: ExternalInstanceRef;
  overrides: LauncherImportOverrides;
}

export interface QueueOutcome {
  imported: string[];
  failed: ExternalInstanceRef[];
  cancelled: boolean;
}

export async function runLauncherImportQueue(
  jobs: QueuedImport[],
): Promise<QueueOutcome> {
  const outcome: QueueOutcome = { imported: [], failed: [], cancelled: false };
  const toastId = `launcher-import-queue-${crypto.randomUUID()}`;

  for (const [index, job] of jobs.entries()) {
    const profileId = await runLauncherInstanceImport(job.target, job.overrides, {
      toastId,
      current: index + 1,
      total: jobs.length,
      onCancelled: () => {
        outcome.cancelled = true;
      },
    });
    if (profileId) outcome.imported.push(profileId);
    else if (!outcome.cancelled) outcome.failed.push(job.target);

    if (outcome.cancelled) break;
    await useProfileStore.getState().fetchProfiles();
  }

  toast.dismiss(toastId);

  if (outcome.cancelled) {
    await useProfileStore.getState().fetchProfiles();
    toast(
      i18n.t("profiles.launcherImport.queue.cancelled", { done: outcome.imported.length }),
    );
  } else if (outcome.failed.length === 0) {
    toast.success(
      i18n.t("profiles.launcherImport.queue.summary_all_ok", {
        count: outcome.imported.length,
      }),
    );
  } else if (outcome.imported.length === 0) {
    toast.error(i18n.t("profiles.launcherImport.queue.summary_none"));
  } else {
    toast(
      i18n.t("profiles.launcherImport.queue.summary_partial", {
        done: outcome.imported.length,
        failed: outcome.failed.length,
      }),
    );
  }

  return outcome;
}
