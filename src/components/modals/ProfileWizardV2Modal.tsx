"use client";

import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";

import { useProfileWizardStore } from "../../store/profile-wizard-store";
import { useProfileStore } from "../../store/profile-store";
import { useImportConfirmStore } from "../../store/import-confirm-store";
import { useModSearchStore } from "../../store/useModSearchStore";
import { ProfileWizardV2 } from "../profiles/wizard-v2/ProfileWizardV2";
import type { ProfileSource } from "../profiles/ProfileSourceChooser";
import { logInfo } from "../../utils/logging-utils";

export function ProfileWizardV2Modal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isModalOpen, defaultGroup, entry, closeModal } = useProfileWizardStore();
  const { fetchProfiles } = useProfileStore();
  const requestImport = useImportConfirmStore((state) => state.requestImport);
  const setProjectType = useModSearchStore((state) => state.setProjectType);

  if (!isModalOpen) {
    return null;
  }

  const handleSave = async (profile: any) => {
    await fetchProfiles();

    if (profile && profile.id) {
      navigate(`/profilesv2/${profile.id}`);
    }

    closeModal();
  };

  const importFromFile = async () => {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: [
        {
          name: t("profiles.import.modpack_files"),
          extensions: ["noriskpack", "mrpack", "zip"],
        },
      ],
      title: t("profiles.import.select_modpack"),
    });

    if (typeof selected !== "string") {
      logInfo("[ProfileWizard] File import cancelled by user.");
      return;
    }

    closeModal();
    await requestImport(selected);
  };

  const handleSource = (source: Exclude<ProfileSource, "blank" | "launcher">) => {
    switch (source) {
      case "file":
        void importFromFile().catch(() => toast.error(t("profiles.errors.file_path_failed")));
        return;
      case "modpack":
        closeModal();
        setProjectType("modpack");
        navigate("/mods");
        return;
    }
  };

  const handleImported = async (profileIds: string[]) => {
    await fetchProfiles();
    closeModal();
    navigate(profileIds.length === 1 ? `/profilesv2/${profileIds[0]}` : "/profiles");
  };

  return (
    <ProfileWizardV2
      onClose={closeModal}
      onSave={handleSave}
      onSource={handleSource}
      onImported={(ids) => void handleImported(ids)}
      startAtSource={entry === "source"}
      defaultGroup={defaultGroup}
    />
  );
}
