"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import type { CosmeticCape } from "../../types/noriskCapes";

interface ConfirmDeletionModalProps {
  capeToDelete: CosmeticCape;
  onConfirmDelete: (reason?: string) => void;
  onCancelDelete: () => void;
  showReasonInput?: boolean;
}

export function ConfirmDeletionModal({
  capeToDelete,
  onConfirmDelete,
  onCancelDelete,
  showReasonInput = false,
}: ConfirmDeletionModalProps) {
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);
  const [reason, setReason] = useState("");

  const handleConfirmDelete = async () => {
    if (showReasonInput && !reason.trim()) return;
    setIsDeleting(true);
    try {
      await onConfirmDelete(showReasonInput ? reason.trim() : undefined);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      title={showReasonInput ? t('capes.moderatorDeleteTitle') : t('capes.confirmDeletion')}
      onClose={onCancelDelete}
      width="sm"
      variant="flat"
    >
      <div className="p-4">
        <p className="text-white/90 mb-4 text-center font-minecraft-ten">
          {t('capes.confirmDeleteMessagePrefix')}{" "}
          <span style={{ color: "var(--accent)" }}>{capeToDelete._id}</span>
          {t('capes.confirmDeleteMessageSuffix')}
        </p>
        {showReasonInput && (
          <div className="mb-4">
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('capes.deleteReasonPlaceholder')}
              className="w-full px-3 py-2 bg-black/30 border border-white/20 rounded-lg text-white font-minecraft-ten text-sm placeholder:text-white/40 focus:outline-none focus:border-white/40"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmDelete();
              }}
            />
          </div>
        )}
        <div className="flex justify-center gap-4">
          <Button
            onClick={handleConfirmDelete}
            variant="destructive"
            disabled={isDeleting || (showReasonInput && !reason.trim())}
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
