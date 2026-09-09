"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";

interface ConfirmUnequipModalProps {
  onConfirmUnequip: () => void;
  onCancelUnequip: () => void;
}

export function ConfirmUnequipModal({
  onConfirmUnequip,
  onCancelUnequip,
}: ConfirmUnequipModalProps) {
  const { t } = useTranslation();
  const [isUnequipping, setIsUnequipping] = useState(false);

  const handleConfirmUnequip = async () => {
    setIsUnequipping(true);
    try {
      await onConfirmUnequip();
    } finally {
      setIsUnequipping(false);
    }
  };

  return (
    <Modal
      title={t('capes.unequipCape')}
      onClose={onCancelUnequip}
      width="md"
      variant="flat"
    >
      <div className="p-4">
        <p className="text-white/90 mb-8 mt-4 text-center font-minecraft">
          {t('capes.confirmUnequipMessage')}
        </p>
        <div className="flex justify-end gap-4">
          <Button
            onClick={onCancelUnequip}
            variant="flat-secondary"
            disabled={isUnequipping}
            size="md"
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleConfirmUnequip}
            variant="destructive"
            disabled={isUnequipping}
            size="md"
          >
            {isUnequipping ? t('capes.unequipping') : t('capes.unequipCape')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
