"use client";

import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import type { MigrationInfo } from "../../types/profile";

interface GroupMigrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunch: () => void;
  onMigrate?: () => void;
  profileId?: string;
  migrationInfo?: MigrationInfo;
}

export function GroupMigrationModal({
  isOpen,
  onClose,
  onLaunch,
  onMigrate,
  profileId,
  migrationInfo,
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
        <p className="text-white/80 mb-6 text-center font-minecraft">
          {t('group_migration.description')}
        </p>
        {migrationInfo && migrationInfo.direction !== 'None' && (
          <div className="space-y-3 text-sm font-minecraft text-white/80">
            <p className="text-center">{migrationInfo.direction === 'FromInstanceToGroup'
              ? t('group_migration.instance_to_group', { defaultValue: 'Copy files from this instance to the shared group.' })
              : t('group_migration.group_to_instance', { defaultValue: 'Copy files from the shared group to this instance.' })}</p>
            {(migrationInfo.source_path || migrationInfo.target_path) && <dl className="rounded border border-white/10 p-3 space-y-2">
              {migrationInfo.source_path && <div><dt className="text-white/60">{t('group_migration.source', { defaultValue: 'From' })}</dt><dd className="break-all">{migrationInfo.source_path}</dd></div>}
              {migrationInfo.target_path && <div><dt className="text-white/60">{t('group_migration.target', { defaultValue: 'To' })}</dt><dd className="break-all">{migrationInfo.target_path}</dd></div>}
            </dl>}
          </div>
        )}

        <div className="flex flex-wrap gap-4 justify-center mt-8">
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
