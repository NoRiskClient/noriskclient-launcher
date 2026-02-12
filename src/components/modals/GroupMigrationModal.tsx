"use client";

import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";

interface GroupMigrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunch: () => void;
  onMigrate?: () => void;
  profileId?: string;
}

export function GroupMigrationModal({
  isOpen,
  onClose,
  onLaunch,
  onMigrate,
  profileId
}: GroupMigrationModalProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const handleLaunch = () => {
    onLaunch();
  };

  const handleMigrate = () => {
    if (onMigrate) {
      onMigrate();
    }
  };

  return (
    <Modal
      title={t('group_migration.title')}
      onClose={onClose}
      width="md"
    >
      <div className="p-6">
        <p className="text-white/80 mb-6 text-center font-minecraft-ten">
          {t('group_migration.description')}
        </p>

        <div className="flex gap-4 justify-center mt-8">
          {onMigrate && (
            <Button
              onClick={handleMigrate}
              variant="default"
              size="md"
            >
              {t('group_migration.button.copy_files')}
            </Button>
          )}
          <Button
            onClick={handleLaunch}
            variant="flat-secondary"
            size="md"
          >
            {t('group_migration.button.skip_launch')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
