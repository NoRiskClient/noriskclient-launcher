"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useProfileDuplicateStore } from "../../store/profile-duplicate-store";
import { Modal } from "../ui/Modal";
import { SearchStyleInput } from "../ui/Input";
import { Button } from "../ui/buttons/Button";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "react-hot-toast";
import { useProfileStore } from "../../store/profile-store";
import { copyProfile } from "../../services/profile-service";

export function ProfileDuplicateModal() {
  const { t } = useTranslation();
  const { isModalOpen, sourceProfile, closeModal } = useProfileDuplicateStore();
  const { fetchProfiles } = useProfileStore();
  const [newProfileName, setNewProfileName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Set default name when modal opens
  useEffect(() => {
    if (isModalOpen && sourceProfile) {
      const defaultName = `${sourceProfile.name} (copy)`;
      setNewProfileName(defaultName);
    }
  }, [isModalOpen, sourceProfile]);

  if (!isModalOpen || !sourceProfile) {
    return null;
  }

  const handleDuplicate = async () => {
    if (!newProfileName.trim()) {
      toast.error(t('profile_duplicate.error.enter_name'));
      return;
    }

    try {
      setIsLoading(true);

      await copyProfile({
        source_profile_id: sourceProfile.id,
        new_profile_name: newProfileName.trim(),
        include_files: undefined,
      });

      toast.success(t('profile_duplicate.toast.success', { name: newProfileName.trim() }));
      
      // Refresh profiles and close modal
      await fetchProfiles();
      closeModal();
      setNewProfileName("");
    } catch (err) {
      console.error("Failed to duplicate profile:", err);
      toast.error(
        t('profile_duplicate.toast.failed', { error: err instanceof Error ? err.message : String(err) })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    closeModal();
    setNewProfileName("");
  };

  return (
    <Modal
      title={t('profile_duplicate.title')}
      onClose={handleClose}
      width="md"
      footer={
        <div className="flex justify-between">
          <Button
            variant="secondary"
            onClick={handleClose}
            size="md"
            className="text-2xl"
            disabled={isLoading}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="default"
            onClick={handleDuplicate}
            disabled={isLoading || !newProfileName.trim()}
            size="md"
            className="text-2xl"
          >
            {isLoading ? (
              <div className="flex items-center gap-3">
                <Icon
                  icon="solar:refresh-bold"
                  className="w-6 h-6 animate-spin text-white"
                />
                <span>{t('profile_duplicate.button.duplicating')}</span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Icon icon="solar:copy-bold" className="w-6 h-6 text-white" />
                <span>{t('profile_duplicate.button.duplicate')}</span>
              </div>
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-6 p-6">
        <div className="text-center">
          <p className="text-2xl font-minecraft text-white/80 mb-4 lowercase">
            {t('profile_duplicate.description', { name: sourceProfile.name })}
          </p>
          <p className="text-xs text-white/60 font-minecraft-ten tracking-wide">
            {t('profile_duplicate.copy_notice')}
          </p>
        </div>

        <div>
          <label className="block text-2xl font-minecraft text-white mb-2 lowercase">
            {t('profile_duplicate.new_name_label')}
          </label>
          <SearchStyleInput
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            placeholder={t('profile_duplicate.name_placeholder')}
            disabled={isLoading}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isLoading && newProfileName.trim()) {
                handleDuplicate();
              }
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
