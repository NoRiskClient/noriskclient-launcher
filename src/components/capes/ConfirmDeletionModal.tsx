"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import type { CosmeticCape } from "../../types/noriskCapes";

interface ConfirmDeletionModalProps {
  capeToDelete: CosmeticCape;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

export function ConfirmDeletionModal({
  capeToDelete,
  onConfirmDelete,
  onCancelDelete
}: ConfirmDeletionModalProps) {
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await onConfirmDelete();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      title={t('capes.confirmDeletion')}
      onClose={onCancelDelete}
      width="sm"
      variant="flat"
    >
      <div className="p-4">
        <p className="text-white/90 mb-6 text-center font-minecraft-ten">
          {t('capes.confirmDeleteMessagePrefix')}{" "}
          <span style={{ color: "var(--accent)" }}>{capeToDelete._id}</span>
          {t('capes.confirmDeleteMessageSuffix')}
        </p>
        <div className="flex justify-center gap-4">
          <Button
            onClick={handleConfirmDelete}
            variant="destructive"
            disabled={isDeleting}
            size="md"
          >
            {isDeleting ? t('capes.deleting') : t('capes.deleteCape')}
          </Button>
          <Button
            onClick={onCancelDelete}
            variant="flat-secondary"
            disabled={isDeleting}
            size="md"
          >
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
