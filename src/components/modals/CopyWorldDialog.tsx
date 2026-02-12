"use client";

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { Input }  from "../ui/Input";
import { Select } from "../ui/Select";
import { Icon } from "@iconify/react";
import type { Profile } from "../../types/profile"; // Assuming this path is correct

interface CopyWorldDialogProps {
  isOpen: boolean;
  sourceWorldName: string;
  sourceProfileId: string;
  availableProfiles: Profile[];
  isLoadingProfiles: boolean;
  isCopying: boolean;
  onClose: () => void;
  onConfirm: (params: {
    targetProfileId: string;
    targetWorldName: string;
  }) => void;
  initialError?: string | null;
}

export function CopyWorldDialog({
  isOpen,
  sourceWorldName,
  sourceProfileId,
  availableProfiles,
  isLoadingProfiles,
  isCopying,
  onClose,
  onConfirm,
  initialError,
}: CopyWorldDialogProps) {
  const { t } = useTranslation();
  const [targetProfileId, setTargetProfileId] = useState(sourceProfileId);
  const [targetWorldName, setTargetWorldName] = useState(sourceWorldName);
  const [internalError, setInternalError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Reset state when dialog opens
      setTargetProfileId(sourceProfileId);
      setTargetWorldName(sourceWorldName);
      setInternalError(null); // Clear previous internal errors
    }
  }, [isOpen, sourceProfileId, sourceWorldName]);

  const handleConfirm = () => {
    if (!targetProfileId) {
      setInternalError(t('copy_world.error.select_profile'));
      return;
    }
    if (!targetWorldName.trim()) {
      setInternalError(t('copy_world.error.enter_name'));
      return;
    }
    setInternalError(null);
    onConfirm({
      targetProfileId,
      targetWorldName: targetWorldName.trim(),
    });
  };

  const displayError = internalError || initialError;

  if (!isOpen) {
    return null;
  }

  const profileOptions = availableProfiles.map(p => ({
    value: p.id,
    label: `${p.name} (${p.game_version} ${p.loader})`
  }));

  return (
    <Modal
      title={t('copy_world.title', { name: sourceWorldName })}
      titleIcon={<Icon icon="solar:copy-bold-duotone" className="w-6 h-6" />}
      onClose={onClose}
      width="md"
    >
      <div className="p-6 flex flex-col gap-4">
        {displayError && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
            <strong className="font-bold">{t('common.error')}: </strong>
            <span className="block sm:inline">{displayError}</span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="copy-dialog-target-profile" className="font-medium text-white/80">
            {t('copy_world.copy_to_profile')}:
          </label>
          {isLoadingProfiles ? (
            <div className="text-white/60">{t('copy_world.loading_profiles')}</div>
          ) : (
            <Select
              value={targetProfileId}
              onChange={setTargetProfileId}
              options={profileOptions}
              disabled={isCopying || isLoadingProfiles}
              placeholder={t('copy_world.select_target_placeholder')}
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="target-world-name" className="font-medium text-white/80">
            {t('copy_world.new_world_name')}:
          </label>
          <Input
            id="target-world-name"
            type="text"
            value={targetWorldName}
            onChange={(e) => setTargetWorldName(e.target.value)}
            placeholder={t('copy_world.enter_name_placeholder')}
            disabled={isCopying}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 flex justify-end items-center gap-3">
        <Button variant="secondary" onClick={onClose} disabled={isCopying}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="success"
          onClick={handleConfirm}
          disabled={isCopying || isLoadingProfiles || !targetProfileId || !targetWorldName.trim()}
          icon={isCopying ? <Icon icon="solar:refresh-bold" className="animate-spin h-4 w-4" /> : null}
        >
          {isCopying ? t('copy_world.button.copying') : t('copy_world.button.copy')}
        </Button>
      </div>
    </Modal>
  );
} 