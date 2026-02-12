import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import type { Profile, SymlinkInfo } from "../../../types/profile";
import { Button } from "../../ui/buttons/Button";
import { IconButton } from "../../ui/buttons/IconButton";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useLaunchStateStore, LaunchState } from "../../../store/launch-state-store";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
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

interface SymlinkSettingsTabProps {
  editedProfile: Profile;
  updateProfile: (updates: Partial<Profile>) => void;
  allProfiles: Profile[];
}

export function SymlinkSettingsTab({
  editedProfile,
  updateProfile,
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

  // Load symlinks from filesystem
  useEffect(() => {
    loadSymlinks();
  }, [editedProfile.id]);

  const loadSymlinks = async () => {
    try {
      setLoading(true);
      const links = await getProfileSymlinks(editedProfile.id);
      setSymlinks(links);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error.message);
      logError(`Failed to load symlinks for profile ${editedProfile.id}: ${errorMessage}`);
      console.error("Failed to load symlinks:", error);
      toast.error(t('symlinks.load_failed'));
    } finally {
      setLoading(false);
    }
  };

  const openFolderPickerAndConfigure = async () => {
    try {
      // Step 1: Open folder picker
      const profilesPath = await getDefaultProfilePath();
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: profilesPath,
        title: t('symlinks.dialog_title_folder'),
      });

      if (selected && typeof selected === "string") {
        // Step 2: Get the profile instance path from backend
        const profileInstancePath = await getProfileInstancePath(editedProfile.id);
        
        // Step 3: Open configuration modal
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
          />
        );
      }
    } catch (error) {
      console.error("Failed to open folder picker:", error);
      toast.error(t('symlinks.folder_picker_failed'));
    }
  };

  const openFilePickerAndConfigure = async () => {
    try {
      // Step 1: Open file picker
      const profilesPath = await getDefaultProfilePath();
      const selected = await open({
        directory: false,
        multiple: false,
        defaultPath: profilesPath,
        title: t('symlinks.dialog_title_file'),
      });

      if (selected && typeof selected === "string") {
        // Step 2: Get the profile instance path from backend
        const profileInstancePath = await getProfileInstancePath(editedProfile.id);
        
        // Step 3: Open configuration modal
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
          />
        );
      }
    } catch (error) {
      console.error("Failed to open file picker:", error);
      toast.error(t('symlinks.file_picker_failed'));
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
      await loadSymlinks(); // Reload symlinks from filesystem
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      logError(`Symlink creation failed for profile ${editedProfile.id}: ${errorMessage}. Target: ${targetPath}, External: ${externalPath}`);
      console.error("Symlink creation failed:", error);
      
      // Check if it's a permission error on Windows
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
      await loadSymlinks(); // Reload symlinks from filesystem
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error.message);
      logError(`Failed to remove symlink for profile ${editedProfile.id}: ${errorMessage}. Path: ${path}`);
      toast.error(t('symlinks.remove_failed', { error: errorMessage }));
    }
  };

  const openInternalPath = async (relativePath: string) => {
    try {
      const instancePath = await getProfileInstancePath(editedProfile.id);
      // Normalize path separators for the platform
      const normalizedInstancePath = instancePath.replace(/\\/g, '/');
      const normalizedRelativePath = relativePath.replace(/\\/g, '/');
      const fullPath = `${normalizedInstancePath}/${normalizedRelativePath}`.replace(/\//g, '\\');
      
      logInfo(`Opening internal path for profile ${editedProfile.id}: ${fullPath}`);
      console.log('Opening internal path:', {
        instancePath,
        relativePath,
        fullPath
      });
      
      await openPath(fullPath);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error.message);
      logError(`Failed to open internal path for profile ${editedProfile.id}: ${errorMessage}. Path: ${relativePath}`);
      console.error("Failed to open internal path:", error);
      toast.error(t('symlinks.open_path_failed', { error: errorMessage }));
    }
  };

  if (isProfileRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
        <Icon icon="solar:lock-bold" className="w-16 h-16 text-white/40" />
        <div>
          <h3 className="text-3xl font-minecraft text-white mb-2 lowercase">{t('symlinks.profile_running')}</h3>
          <p className="text-xs text-white/70 font-minecraft-ten tracking-wide select-none">
            {t('symlinks.stop_profile_to_manage')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {confirmDialog}
      <div className="space-y-6 overflow-x-hidden" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
        <h3 className="text-3xl font-minecraft text-white mb-2 lowercase">{t('symlinks.title')}</h3>
        <p className="text-xs text-white/70 font-minecraft-ten tracking-wide select-none">
          {t('symlinks.description')}
        </p>
      </div>

      {/* Existing Symlinks */}
      <div className="overflow-x-hidden" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
        <h4 className="text-3xl font-minecraft text-white mb-3 lowercase">{t('symlinks.active_symlinks')}</h4>
        <div className="space-y-2 overflow-x-hidden" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
          {loading ? (
            <p className="text-white/50 text-sm font-minecraft-ten">{t('symlinks.loading')}</p>
          ) : symlinks.length === 0 ? (
            <p className="text-white/50 text-sm font-minecraft-ten">{t('symlinks.no_symlinks')}</p>
          ) : (
            symlinks.map((symlink) => (
              <div
                key={symlink.link_path}
                className="flex items-start justify-between gap-3 p-4 bg-white/5 rounded border border-white/10 hover:bg-white/[0.07] transition-colors overflow-hidden"
                style={{ 
                  width: '100%',
                  maxWidth: '100%',
                  boxSizing: 'border-box',
                  minWidth: 0
                }}
              >
                <div className="flex-1 min-w-0 overflow-hidden" style={{ boxSizing: 'border-box' }}>
                  <div className="flex items-center gap-2 mb-2 min-w-0 overflow-hidden">
                    <Icon 
                      icon={symlink.is_directory ? "solar:folder-bold" : "solar:file-bold"} 
                      className="w-5 h-5 text-accent flex-shrink-0" 
                    />
                    <span 
                      className="text-white text-base font-medium truncate font-minecraft-ten min-w-0 flex-1"
                      style={{ 
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '100%'
                      }}
                      title={symlink.link_path}
                    >
                      {symlink.link_path}
                    </span>
                    <span className="text-xs text-white/40 font-minecraft-ten flex-shrink-0 whitespace-nowrap">
                      ({symlink.link_type})
                    </span>
                  </div>
                  <div className="flex items-start gap-2 ml-7 min-w-0 overflow-hidden">
                    <Icon icon="solar:arrow-right-bold" className="w-3 h-3 text-white/40 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1 overflow-hidden" style={{ maxWidth: '100%' }}>
                      <span 
                        className="text-white/60 text-xs font-mono block"
                        style={{ 
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '100%'
                        }}
                        title={symlink.target_path}
                      >
                        {symlink.target_path}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <IconButton
                    variant="secondary"
                    size="sm"
                    onClick={() => openInternalPath(symlink.link_path)}
                    icon={<Icon icon="solar:folder-bold" className="w-3.5 h-3.5" />}
                    label={t('symlink.open_in_profile')}
                  />
                  <IconButton
                    variant="destructive"
                    size="sm"
                    onClick={() => removeSymlink(symlink.link_path)}
                    icon={<Icon icon="solar:trash-bin-minimalistic-bold" className="w-3.5 h-3.5" />}
                    label={t('symlink.remove_symlink')}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add New Symlink */}
      <div>
        <h4 className="text-3xl font-minecraft text-white mb-3 lowercase">{t('symlink.add_new')}</h4>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={openFolderPickerAndConfigure}
              variant="default"
              size="lg"
              className="w-full lowercase"
            >
              <span className="flex items-center gap-2">
                <Icon icon="solar:folder-bold" className="w-5 h-5" />
                <span>{t('symlinks.link_folder')}</span>
              </span>
            </Button>

            <Button
              onClick={openFilePickerAndConfigure}
              variant="default"
              size="lg"
              className="w-full lowercase"
            >
              <span className="flex items-center gap-2">
                <Icon icon="solar:file-bold" className="w-5 h-5" />
                <span>{t('symlinks.link_file')}</span>
              </span>
            </Button>
          </div>

          <div className="p-4 bg-white/5 rounded border border-white/10">
            <div className="flex items-start gap-3">
              <Icon icon="solar:info-circle-bold" className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
              <div className="text-xs text-white/70 font-minecraft-ten tracking-wide select-none space-y-2">
                <p className="text-white">{t('symlinks.how_it_works')}</p>
                <ol className="list-decimal list-inside space-y-1 text-white/60">
                  <li>{t('symlinks.step_1')}</li>
                  <li>{t('symlinks.step_2')}</li>
                  <li>{t('symlinks.step_3')}</li>
                </ol>
                <p className="text-white/50 text-xs mt-2">
                  {t('symlinks.perfect_for')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

