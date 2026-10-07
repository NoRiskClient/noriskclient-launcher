"use client";

import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";

interface ConfirmUnequipModalProps {
  onConfirmUnequip: () => void | Promise<void>;
  onCancelUnequip: () => void;
}

export function ConfirmUnequipModal({
  onConfirmUnequip,
  onCancelUnequip,
}: ConfirmUnequipModalProps) {
  const { t } = useTranslation();
  const [isUnequipping, setIsUnequipping] = useState(false);
  const [failure, setFailure] = useState<"request" | "busy" | null>(null);
  const pendingRef = useRef(false);

  const guardedDismiss = () => {
    if (!pendingRef.current) onCancelUnequip();
  };

  const handleConfirmUnequip = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setIsUnequipping(true);
    setFailure(null);
    try {
      await onConfirmUnequip();
    } catch (error) {
      setFailure((error as { capeOperationPending?: boolean } | null)?.capeOperationPending ? "busy" : "request");
    } finally {
      pendingRef.current = false;
      setIsUnequipping(false);
    }
  };

  return (
    <Modal
      title={t('capes.unequipCape')}
      onClose={guardedDismiss}
      canClose={() => !pendingRef.current}
      closeOnClickOutside={!isUnequipping}
      closeOnEscape={!isUnequipping}
      hideCloseButton={isUnequipping}
      width="md"
      variant="flat"
      footer={
        <div className="flex justify-end gap-3">
          <Button onClick={guardedDismiss} variant="flat-secondary" disabled={isUnequipping} size="md">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirmUnequip} variant="destructive" disabled={isUnequipping}
            aria-busy={isUnequipping || undefined} size="md">
            {isUnequipping ? t('capes.unequipping') : failure ? t('common.try_again') : t('capes.unequipCape')}
          </Button>
        </div>
      }
    >
      <div className="p-4">
        <p className="text-white/90 mb-8 mt-4 text-center font-minecraft">
          {t('capes.confirmUnequipMessage')}
        </p>
        <p role={failure ? "alert" : undefined} className="min-h-6 text-red-300 text-sm font-minecraft text-center break-words">
          {failure ? t(failure === "busy" ? 'capes.operationInProgress' : 'capes.failedToUnequipCape') : null}
        </p>
      </div>
    </Modal>
  );
}
