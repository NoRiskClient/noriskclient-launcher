"use client";

import { useState, useRef, useId } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import type { CosmeticCape } from "../../types/noriskCapes";

interface ConfirmDeletionModalProps {
  capeToDelete: CosmeticCape;
  onConfirmDelete: (reason?: string) => void | Promise<void>;
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
  const [failure, setFailure] = useState<"request" | "busy" | null>(null);
  const pendingRef = useRef(false);
  const reasonId = useId();
  const reasonDescriptionId = `${reasonId}-description`;

  const guardedDismiss = () => {
    if (!pendingRef.current) onCancelDelete();
  };

  const handleConfirmDelete = async () => {
    if (pendingRef.current || (showReasonInput && !reason.trim())) return;
    pendingRef.current = true;
    setIsDeleting(true);
    setFailure(null);
    try {
      await onConfirmDelete(showReasonInput ? reason.trim() : undefined);
    } catch (error) {
      setFailure((error as { capeOperationPending?: boolean } | null)?.capeOperationPending ? "busy" : "request");
    } finally {
      pendingRef.current = false;
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      title={showReasonInput ? t('capes.moderatorDeleteTitle') : t('capes.confirmDeletion')}
      onClose={guardedDismiss}
      canClose={() => !pendingRef.current}
      closeOnClickOutside={!isDeleting}
      closeOnEscape={!isDeleting}
      hideCloseButton={isDeleting}
      width="sm"
      variant="flat"
      footer={
        <div className="flex justify-end gap-3">
          <Button onClick={guardedDismiss} variant="flat-secondary" disabled={isDeleting} size="md">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirmDelete} variant="destructive"
            disabled={isDeleting || (showReasonInput && !reason.trim())} aria-busy={isDeleting || undefined} size="md">
            {isDeleting ? t('capes.deleting') : failure ? t('common.try_again') : t('capes.deleteCape')}
          </Button>
        </div>
      }
    >
      <div className="p-4">
        <p className="text-white/90 mb-4 text-center font-minecraft">
          {t('capes.confirmDeleteMessagePrefix')}{" "}
          <span className="block max-w-full my-2 break-all select-text" style={{ color: "var(--accent)" }}>{capeToDelete._id}</span>
          {t('capes.confirmDeleteMessageSuffix')}
        </p>
        {showReasonInput && (
          <div className="mb-4">
            <label htmlFor={reasonId} className="block mb-2 text-white/80 font-minecraft text-sm">
              {t('capes.deleteReasonPlaceholder')}
            </label>
            <input
              id={reasonId}
              name="cape-delete-reason"
              aria-describedby={reasonDescriptionId}
              required
              disabled={isDeleting}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('capes.deleteReasonPlaceholder')}
              className="w-full px-3 py-2 bg-black/30 border border-white/20 rounded-lg text-white font-minecraft text-sm placeholder:text-white/40 focus:outline-none focus:border-white/40"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmDelete();
              }}
            />
            <p id={reasonDescriptionId} className="mt-2 text-white/60 font-minecraft text-xs">
              {t('common.field_required')}
            </p>
          </div>
        )}
        <p role={failure ? "alert" : undefined} className="min-h-6 text-red-300 text-sm font-minecraft text-center break-words">
          {failure ? t(failure === "busy" ? 'capes.operationInProgress' : 'capes.failedToDeleteCape') : null}
        </p>
      </div>
    </Modal>
  );
}
