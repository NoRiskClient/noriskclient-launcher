import { toast } from "react-hot-toast";
import i18n from "../i18n/i18n";
import * as ProfileService from "../services/profile-service";
import { parseErrorMessage } from "./error-utils";

export async function openProfileFolder(profileId: string): Promise<void> {
  try {
    await ProfileService.openProfileFolder(profileId);
  } catch (err) {
    toast.error(i18n.t("profiles.openFolderError", { error: parseErrorMessage(err) }));
  }
}
