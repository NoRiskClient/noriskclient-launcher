import type { TFunction } from "i18next";
import { toast } from "react-hot-toast";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";

import { revealItemInDir } from "./opener-utils";
import { logError } from "./logging-utils";

export async function copyScreenshotImage(path: string, t: TFunction): Promise<void> {
  await toast
    .promise(writeImage(path), {
      loading: t("screenshots.copying"),
      success: t("screenshots.copy_success"),
      error: (err) => t("screenshots.copy_failed", { error: String(err) }),
    })
    .catch((err) => logError(`Failed to copy screenshot image: ${err}`));
}

export async function revealScreenshot(path: string, t: TFunction): Promise<void> {
  try {
    await revealItemInDir(path);
  } catch (err) {
    logError(`Failed to reveal screenshot in folder: ${err}`);
    toast.error(t("profiles.errors.open_folder_failed"));
  }
}
