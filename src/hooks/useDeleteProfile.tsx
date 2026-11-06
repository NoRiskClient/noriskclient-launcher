import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import type { Profile } from "../types/profile";
import { useProfileStore } from "../store/profile-store";
import { parseErrorMessage } from "../utils/error-utils";
import { useConfirmDialog } from "./useConfirmDialog";

function isNoRiskProfile(profile: Profile): boolean {
  return profile.is_standard_version || !!profile.source_standard_profile_id;
}

export function useDeleteProfile() {
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirmDialog();

  const requestDelete = async (profile: Profile): Promise<boolean> => {
    const name = profile.name;
    const noRisk = isNoRiskProfile(profile);
    const confirmed = await confirm({
      title: t("profiles.deleteProfileTitle"),
      message: noRisk
        ? t("profiles.deleteNoRiskProfileMessage", { name })
        : t("profiles.deleteConfirmMessage", { name }),
      confirmText: t("profiles.deleteConfirm"),
      cancelText: t("profiles.cancelAction"),
      type: "danger",
      fullscreen: true,
    });
    if (!confirmed) return false;

    const store = useProfileStore.getState();
    try {
      await toast.promise(store.deleteProfile(profile.id), {
        loading: t("profiles.deletingProfile", { name }),
        success: t("profiles.deleteSuccess", { name }),
        error: (err) => t("profiles.deleteError", { error: parseErrorMessage(err) }),
      });
    } catch {
      return false;
    }
    store.fetchProfiles();
    return true;
  };

  return { requestDelete, deleteDialog: confirmDialog };
}
