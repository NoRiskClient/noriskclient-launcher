import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { Icon } from "@iconify/react";

interface ConfirmDeleteDialogProps {
  isOpen: boolean;
  itemName: string;
  onClose: () => void;
  onConfirm: () => void | Promise<unknown>;
  isDeleting?: boolean;
  title?: string;
  message?: React.ReactNode;
}

export function ConfirmDeleteDialog({
  isOpen,
  itemName,
  onClose,
  onConfirm,
  isDeleting = false,
  title,
  message,
}: ConfirmDeleteDialogProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const busy = isDeleting || pending;

  const confirm = async () => {
    if (busy) return;
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  const dialogTitle = title || t('confirm_delete.title', { name: itemName });
  const dialogMessage = message || (
    <p className="text-white/80 font-minecraft">
      {t('confirm_delete.message', { name: itemName })}
      <br />
      {t('confirm_delete.cannot_undo')}
    </p>
  );

  const dialogFooter = (
    <div className="flex justify-end items-center gap-3">
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        {t('common.cancel')}
      </Button>
      <Button
        variant="destructive"
        onClick={confirm}
        disabled={busy}
        icon={busy ? <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" /> : null}
      >
        {busy ? t('confirm_delete.button.deleting') : t('confirm_delete.button.delete')}
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