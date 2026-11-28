import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import type { Profile, SymlinkInfo } from "../../../types/profile";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useLaunchStateStore, LaunchState } from "../../../store/launch-state-store";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { join } from "@tauri-apps/api/path";
import { useGlobalModal } from "../../../hooks/useGlobalModal";
import { useConfirmDialog } from "../../../hooks/useConfirmDialog";
import { SymlinkConfigModal } from "./SymlinkConfigModal";
import { logError, logWarn, logInfo } from "../../../utils/logging-utils";
import {
  getProfileInstancePath,
  addProfileSymlink,
  removeProfileSymlink,
  getProfileSymlinks, getDefaultProfilePath
} from "../../../services/profile-service";
import { parseErrorMessage } from "../../../utils/error-utils";
import { IconAction, Section, SectionButton } from "./SettingsSection";

interface SymlinkSettingsTabProps {
  editedProfile: Profile;
  allProfiles: Profile[];
}

export function SymlinkSettingsTab({
  editedProfile,
  allProfiles,
}: SymlinkSettingsTabProps) {
  const { t } = useTranslation();
  const { showModal, hideModal } = useGlobalModal();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [symlinks, setSymlinks] = useState<SymlinkInfo[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { getProfileState } = useLaunchStateStore();
  const profileState = getProfileState(editedProfile.id);
  const isProfileRunning = profileState.launchState === LaunchState.RUNNING || 
                          profileState.launchState === LaunchState.LAUNCHING;

  useEffect(() => {
    loadSymlinks();
  }, [editedProfile.id]);

  const loadSymlinks = async () => {
    try {
      setLoading(true);
      const links = await getProfileSymlinks(editedProfile.id);
      setSymlinks(links);
    } catch (error) {
      const errorMessage = parseErrorMessage(error);
      logError(`Failed to load symlinks for profile ${editedProfile.id}: ${errorMessage}`);
      toast.error(t('symlinks.load_failed'));
    } finally {
      setLoading(false);
    }
  };

  const pickAndConfigure = async (directory: boolean) => {
    try {
      const selected = await open({
        directory,
        multiple: false,
        defaultPath: await getDefaultProfilePath(),
        title: directory ? t("symlinks.dialog_title_folder") : t("symlinks.dialog_title_file"),
      });
      if (!selected || typeof selected !== "string") return;
      const profileInstancePath = await getProfileInstancePath(editedProfile.id);
      const modalId = "symlink-config";
      showModal(
        modalId,
        <SymlinkConfigModal
          externalPath={selected}
          profileInstancePath={profileInstancePath}
          onConfirm={async (targetPath) => {
            hideModal(modalId);
            await createSymlink(selected, targetPath);
          }}
          onCancel={() => hideModal(modalId)}
        />,
      );
    } catch (error) {
      logError(`Failed to open the ${directory ? "folder" : "file"} picker: ${parseErrorMessage(error)}`);
      toast.error(directory ? t("symlinks.folder_picker_failed") : t("symlinks.file_picker_failed"));
    }
  };

  const createSymlink = async (externalPath: string, targetPath: string) => {
    try {
      logInfo(`Creating symlink for profile ${editedProfile.id}: ${targetPath} → ${externalPath}`);
      await addProfileSymlink({
        profile_id: editedProfile.id,
        relative_path: targetPath,
        external_path: externalPath,
      });

      toast.success(t('symlinks.created_success', { target: targetPath, external: externalPath }));
      await loadSymlinks();
    } catch (error: any) {
      const errorMessage = error?.message || parseErrorMessage(error);
      logError(`Symlink creation failed for profile ${editedProfile.id}: ${errorMessage}. Target: ${targetPath}, External: ${externalPath}`);
      
      if (errorMessage.includes("os error 1314") || errorMessage.includes("erforderliches Recht")) {
        logWarn(`Symlink creation failed due to Windows permissions. Profile: ${editedProfile.id}`);
        toast.error(
          t('symlinks.windows_admin_required'),
          { duration: 8000 }
        );
      } else {
        toast.error(t('symlinks.create_failed', { error: errorMessage }));
      }
    }
  };

  const removeSymlink = async (path: string) => {
    const confirmed = await confirm({
      title: t('symlinks.remove_title'),
      message: t('symlinks.remove_confirm', { path }),
      confirmText: t('symlinks.remove_button'),
      cancelText: t('common.cancel'),
      type: "danger",
    });

    if (!confirmed) return;

    try {
      logInfo(`Removing symlink for profile ${editedProfile.id}: ${path}`);
      await removeProfileSymlink(editedProfile.id, path);
      toast.success(t('symlinks.removed_success', { path }));
      await loadSymlinks();
    } catch (error) {
      const errorMessage = parseErrorMessage(error);
      logError(`Failed to remove symlink for profile ${editedProfile.id}: ${errorMessage}. Path: ${path}`);
      toast.error(t('symlinks.remove_failed', { error: errorMessage }));
    }
  };

  const openInternalPath = async (relativePath: string) => {
    try {
      const fullPath = await join(await getProfileInstancePath(editedProfile.id), relativePath);
      
      logInfo(`Opening internal path for profile ${editedProfile.id}: ${fullPath}`);
      
      await openPath(fullPath);
    } catch (error) {
      const errorMessage = parseErrorMessage(error);
      logError(`Failed to open internal path for profile ${editedProfile.id}: ${errorMessage}. Path: ${relativePath}`);
      toast.error(t('symlinks.open_path_failed', { error: errorMessage }));
    }
  };

  if (isProfileRunning) {
    return (
      <Section title={t("symlinks.profile_running")} description={t("symlinks.stop_profile_to_manage")}>
        <Icon icon="solar:lock-bold" className="mx-auto h-10 w-10 text-white/30" />
      </Section>
    );
  }

  return (
    <>
      {confirmDialog}
      <div className="space-y-4 select-none">
        <Section
          title={t("symlinks.title")}
          description={t("symlinks.description")}
          aside={
            <div className="flex shrink-0 gap-2">
              <SectionButton icon="solar:folder-bold" tone="accent" onClick={() => pickAndConfigure(true)}>
                {t("symlinks.link_folder")}
              </SectionButton>
              <SectionButton icon="solar:file-bold" onClick={() => pickAndConfigure(false)}>
                {t("symlinks.link_file")}
              </SectionButton>
            </div>
          }
        >
          {loading ? (
            <p className="flex items-center gap-2 font-minecraft text-sm text-white/50">
              <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" />
              {t("symlinks.loading")}
            </p>
          ) : symlinks.length === 0 ? (
            <p className="font-minecraft text-sm text-white/50">{t("symlinks.no_symlinks")}</p>
          ) : (
            <div className="space-y-1.5">
              {symlinks.map((symlink) => (
                <div
                  key={symlink.link_path}
                  className="flex items-center gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2"
                >
                  <Icon
                    icon={symlink.is_directory ? "solar:folder-bold" : "solar:file-bold"}
                    className="h-5 w-5 shrink-0 text-white/60"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-minecraft text-sm text-white">
                      <span className="truncate normal-case" title={symlink.link_path}>
                        {symlink.link_path}
                      </span>
                      <span className="shrink-0 text-xs text-white/40">{symlink.link_type}</span>
                    </p>
                    <p className="flex items-center gap-1.5 font-minecraft text-xs text-white/40">
                      <Icon icon="solar:arrow-right-bold" className="h-3 w-3 shrink-0" />
                      <span className="truncate normal-case" title={symlink.target_path}>
                        {symlink.target_path}
                      </span>
                    </p>
                  </div>
                  <IconAction
                    icon="solar:folder-open-bold"
                    label={t("symlink.open_in_profile")}
                    onClick={() => openInternalPath(symlink.link_path)}
                  />
                  <IconAction
                    icon="solar:trash-bin-trash-bold"
                    label={t("symlink.remove_symlink")}
                    tone="danger"
                    onClick={() => removeSymlink(symlink.link_path)}
                  />
                </div>
              ))}
            </div>
          )}
        </Section>

        <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 p-4 font-minecraft text-xs text-white/60">
          <Icon icon="solar:info-circle-bold" className="mt-0.5 h-4 w-4 shrink-0 text-white/50" />
          <div className="space-y-1.5">
            <p className="text-white/80">{t("symlinks.how_it_works")}</p>
            <ol className="list-inside list-decimal space-y-0.5">
              <li>{t("symlinks.step_1")}</li>
              <li>{t("symlinks.step_2")}</li>
              <li>{t("symlinks.step_3")}</li>
            </ol>
            <p className="text-white/40">{t("symlinks.perfect_for")}</p>
          </div>
        </div>
      </div>
    </>
  );
}
