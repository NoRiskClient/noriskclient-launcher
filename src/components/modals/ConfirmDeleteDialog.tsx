"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { Icon } from "@iconify/react";

interface ConfirmDeleteDialogProps {
  isOpen: boolean;
  itemName: string;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
  title?: string;
  message?: React.ReactNode;
}

export function ConfirmDeleteDialog({
  isOpen,
  itemName,
  onClose,
  onConfirm,
  isDeleting,
  title,
  message,
}: ConfirmDeleteDialogProps) {
  const { t } = useTranslation();

  if (!isOpen) {
    return null;
  }

  const dialogTitle = title || t('confirm_delete.title', { name: itemName });
  const dialogMessage = message || (
    <p className="text-white/80 font-minecraft-ten">
      {t('confirm_delete.message', { name: itemName })}
      <br />
      {t('confirm_delete.cannot_undo')}
    </p>
  );

  const dialogFooter = (
    <div className="flex justify-end items-center gap-3">
      <Button variant="secondary" onClick={onClose} disabled={isDeleting}>
        {t('common.cancel')}
      </Button>
      <Button
        variant="destructive"
        onClick={onConfirm}
        disabled={isDeleting}
        icon={isDeleting ? <Icon icon="solar:refresh-bold" className="animate-spin h-4 w-4" /> : null}
      >
        {isDeleting ? t('confirm_delete.button.deleting') : t('confirm_delete.button.delete')}
      </Button>
    </div>
  );

  return (
    <Modal
      title={dialogTitle}
      titleIcon={<Icon icon="solar:trash-bin-trash-bold-duotone" className="w-6 h-6 text-red-400" />}
      onClose={onClose}
      width="sm"
      footer={dialogFooter}
    >
      <div className="p-6">
        {dialogMessage}
      </div>
    </Modal>
  );
} 