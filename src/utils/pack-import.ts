import { toast } from "react-hot-toast";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createElement } from "react";

import * as ProfileService from "../services/profile-service";
import { useProfileStore } from "../store/profile-store";
import { EventType, type EventPayload } from "../types/events";
import { ProgressToast } from "../components/ui/ProgressToast";
import { parseErrorMessage } from "../utils/error-utils";
import { logError, logInfo } from "../utils/logging-utils";
import i18n from "../i18n/i18n";

export interface PackImportOverrides {
  name?: string;
  group?: string;
  noriskPackId?: string;
  clearNoriskPack?: boolean;
}

export async function runPackImport(
  filePath: string,
  overrides: PackImportOverrides = {},
): Promise<string | null> {
  const { isPathImporting, addImportingPath, removeImportingPath } =
    useProfileStore.getState();

  if (isPathImporting(filePath)) {
    toast.error(i18n.t("profiles.errors.already_importing"));
    return null;
  }

  const eventId = crypto.randomUUID();
  const toastId = `import-${eventId}`;
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  let unlisten: UnlistenFn | null = null;

  addImportingPath(filePath);

  try {
    unlisten = await listen<EventPayload>("state_event", (event) => {
      const payload = event.payload;
      if (payload.event_type !== EventType.TaskProgress) return;
      if (payload.event_id !== eventId) return;

      toast.custom(
        () =>
          createElement(ProgressToast, {
            message: i18n.t("dragdrop.importing", { fileName }),
            progress: (payload.progress ?? 0) * 100,
          }),
        { id: toastId, duration: Infinity },
      );
    });

    toast.custom(
      () =>
        createElement(ProgressToast, {
          message: i18n.t("dragdrop.importing", { fileName }),
          progress: 0,
        }),
      { id: toastId, duration: Infinity },
    );

    const newProfileId = await ProfileService.importProfileByPath(
      filePath,
      eventId,
      overrides.name,
      overrides.group,
      overrides.noriskPackId,
      overrides.clearNoriskPack,
    );
    logInfo(`[PackImport] Imported '${fileName}' as profile ${newProfileId}`);

    unlisten?.();
    unlisten = null;

    toast.success(i18n.t("profiles.import_success", { fileName }), {
      id: toastId,
      duration: 3000,
    });
    useProfileStore.getState().fetchProfiles();

    return newProfileId;
  } catch (err) {
    const errorMessage = parseErrorMessage(err);
    logError(`[PackImport] Failed to import '${fileName}': ${errorMessage}`);

    if (errorMessage.toLowerCase().includes("insufficient disk space")) {
      toast.error(`${errorMessage}\n\n${i18n.t("profiles.disk_space_tip")}`, {
        id: toastId,
        duration: 8000,
      });
    } else {
      toast.error(i18n.t("profiles.import_failed", { error: errorMessage }), {
        id: toastId,
      });
    }
    return null;
  } finally {
    unlisten?.();
    removeImportingPath(filePath);
  }
}
