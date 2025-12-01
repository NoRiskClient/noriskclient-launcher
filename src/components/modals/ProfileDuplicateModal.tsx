"use client";

import { useState, useEffect } from "react";
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
      toast.error("Please enter a name for the new profile");
      return;
    }

    try {
      setIsLoading(true);

      await copyProfile({
        source_profile_id: sourceProfile.id,
        new_profile_name: newProfileName.trim(),
        include_files: undefined,
      });

      toast.success(`Profile '${newProfileName.trim()}' created successfully!`);
      
      // Refresh profiles and close modal
      await fetchProfiles();
      closeModal();
      setNewProfileName("");
    } catch (err) {
      console.error("Failed to duplicate profile:", err);
      toast.error(
        `Failed to duplicate profile: ${err instanceof Error ? err.message : String(err)}`
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
      title="duplicate profile"
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
            cancel
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
                <span>duplicating...</span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Icon icon="solar:copy-bold" className="w-6 h-6 text-white" />
                <span>duplicate</span>
              </div>
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-6 p-6">
        <div className="text-center">
          <p className="text-2xl font-minecraft text-white/80 mb-4 lowercase">
            duplicate profile "{sourceProfile.name}"
          </p>
          <p className="text-xs text-white/60 font-minecraft-ten tracking-wide">
            This will create a copy of the profile including worlds, configs, mods, and settings.
          </p>
        </div>

        <div>
          <label className="block text-2xl font-minecraft text-white mb-2 lowercase">
            new profile name
          </label>
          <SearchStyleInput
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            placeholder="Enter name for the new profile"
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
