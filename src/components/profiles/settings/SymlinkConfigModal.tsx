import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Button } from "../../ui/buttons/Button";
import { Modal } from "../../ui/Modal";
import { open } from "@tauri-apps/plugin-dialog";

interface SymlinkConfigModalProps {
  externalPath: string;
  profileInstancePath: string; // Path to the profile's instance folder
  onConfirm: (targetPath: string) => void;
  onCancel: () => void;
}

export function SymlinkConfigModal({
  externalPath,
  profileInstancePath,
  onConfirm,
  onCancel,
}: SymlinkConfigModalProps) {
  const { t } = useTranslation();
  // Extract the folder name from the external path - this stays fixed
  const getFolderName = (path: string) => {
    const parts = path.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || "folder";
  };

  const folderName = getFolderName(externalPath);
  const [targetDirectory, setTargetDirectory] = useState<string>("");
  const [selectedAbsolutePath, setSelectedAbsolutePath] = useState<string | null>(null);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const handleSelectTargetDirectory = async () => {
    try {
      // Use the last selected path or the profile instance path as default
      const defaultPath = selectedAbsolutePath || profileInstancePath;
      
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: defaultPath,
        title: "Select target location in profile",
      });

      if (selected && typeof selected === "string") {
        setSelectedAbsolutePath(selected);
        
        // Calculate relative path from profile instance path
        const normalizedProfile = profileInstancePath.replace(/\\/g, "/");
        const normalizedSelected = selected.replace(/\\/g, "/");
        
        if (normalizedSelected.startsWith(normalizedProfile)) {
          const relativePath = normalizedSelected
            .substring(normalizedProfile.length)
            .replace(/^\/+/, "");
          setTargetDirectory(relativePath);
        } else {
          // Selected folder is outside profile
          setTargetDirectory("");
          alert(t('symlink.select_folder_inside_profile'));
        }
      }
    } catch (error) {
      console.error("Failed to open directory picker:", error);
    }
  };

  const handleConfirm = () => {
    // Build the final path: targetDirectory/folderName
    const finalPath = targetDirectory 
      ? `${targetDirectory.replace(/^\/+|\/+$/g, "")}/${folderName}`
      : folderName;
    onConfirm(finalPath);
  };

  // Calculate the final absolute path where the symlink will be created
  const getFinalAbsolutePath = () => {
    const normalizedBase = profileInstancePath.replace(/\\/g, "/").replace(/\/$/, "");
    if (targetDirectory) {
      return `${normalizedBase}/${targetDirectory}/${folderName}`;
    }
    return `${normalizedBase}/${folderName}`;
  };

  return (
    <Modal
      title={t('symlink.configure')}
      onClose={onCancel}
      width="md"
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="default"
            onClick={handleConfirm}
          >
            <span className="flex items-center gap-2">
              <Icon icon="solar:link-bold" className="w-4 h-4" />
              <span>{t('symlink.create')}</span>
            </span>
          </Button>
        </div>
      }
    >
      <div className="p-6 space-y-5">
        {/* External Source */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Icon 
              icon={externalPath.includes('.') && !externalPath.endsWith('/') && !externalPath.endsWith('\\') ? "solar:file-bold" : "solar:folder-bold"} 
              className="w-5 h-5 text-white/70" 
            />
            <h4 className="text-xl font-minecraft text-white">
              {externalPath.includes('.') && !externalPath.endsWith('/') && !externalPath.endsWith('\\') ? t('symlink.external_file') : t('symlink.external_folder')}
            </h4>
          </div>
          <div className="p-3 bg-white/5 rounded border border-white/10">
            <p className="text-white/80 text-sm break-all font-mono">
              {externalPath}
            </p>
          </div>
          <p className="text-xs text-white/60 mt-2 font-minecraft-ten tracking-wide select-none">
            <Icon icon="solar:refresh-bold" className="w-3 h-3 inline mr-1" />
            {externalPath.includes('.') && !externalPath.endsWith('/') && !externalPath.endsWith('\\') ? t('symlink.file_sync_hint') : t('symlink.folder_sync_hint')}
          </p>
        </div>

        {/* Advanced Settings - Collapsible */}
        <div className="border border-white/10 rounded bg-white/5">
          <button
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
            className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Icon icon="solar:settings-bold" className="w-4 h-4 text-white/70" />
              <span className="text-sm font-minecraft-ten text-white tracking-wide">
                {t('symlink.advanced_custom_location')}
              </span>
              {targetDirectory && (
                <span className="text-xs text-accent font-minecraft-ten">
                  ({targetDirectory})
                </span>
              )}
            </div>
            <Icon 
              icon={isAdvancedOpen ? "solar:alt-arrow-up-bold" : "solar:alt-arrow-down-bold"} 
              className="w-4 h-4 text-white/50" 
            />
          </button>

          {isAdvancedOpen && (
            <div className="p-4 pt-0 space-y-3">
              <p className="text-xs text-white/60 font-minecraft-ten tracking-wide select-none">
                By default, <code className="text-white/80">{folderName}</code> will be placed in the profile root.
                <br />
                Change the location if you want to organize it in a subfolder.
              </p>
              
              <Button 
                onClick={handleSelectTargetDirectory}
                variant="secondary" 
                size="md" 
                className="w-full font-minecraft-ten text-sm"
              >
                <span className="flex items-center gap-2">
                  <Icon icon="solar:folder-path-bold" className="w-4 h-4" />
                  <span>{targetDirectory ? `Current: ${targetDirectory}/` : "Select Custom Location"}</span>
                </span>
              </Button>

              {/* Show final path where symlink will be created */}
              <div className="p-3 bg-white/5 rounded border border-white/10">
                <div className="flex items-center gap-2 mb-1">
                  <Icon icon="solar:map-point-bold" className="w-4 h-4 text-accent" />
                  <span className="text-xs font-minecraft-ten text-accent tracking-wide">
                    Symlink will be created at:
                  </span>
                </div>
                <p className="text-white/70 text-xs break-all font-mono pl-6">
                  {getFinalAbsolutePath()}
                </p>
              </div>

              {targetDirectory && (
                <button
                  onClick={() => {
                    setTargetDirectory("");
                    setSelectedAbsolutePath(null);
                  }}
                  className="text-xs text-white/50 hover:text-white transition-colors font-minecraft-ten flex items-center gap-1"
                >
                  <Icon icon="solar:restart-bold" className="w-3 h-3" />
                  Reset to Profile Root
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

