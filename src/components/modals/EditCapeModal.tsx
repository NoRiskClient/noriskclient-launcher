"use client";

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { Icon } from "@iconify/react";
import type { CosmeticCape } from "../../types/noriskCapes";
import { cn } from "../../lib/utils";

interface EditCapeModalProps {
  cape: CosmeticCape;
  onSave: (capeId: string, title: string) => void;
  onCancel: () => void;
}

export function EditCapeModal({ cape, onSave, onCancel }: EditCapeModalProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(cape.title || "");

  const handleSave = () => {
    onSave(cape._id, title);
  };

  return (
    <Modal
      title={t('capes.editCape')}
      onClose={onCancel}
      width="md"
      variant="flat"
    >
      <div className="space-y-6">
        {/* Title Input */}
        <div>
          <label className="block font-minecraft-ten text-sm text-white/80 mb-2">
            {t('capes.title')}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('capes.titlePlaceholder')}
            className="w-full px-4 py-2 bg-black/30 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-white/30 transition-colors"
          />
          <p className="mt-2 text-xs text-white/50">
            {t('capes.titleApprovalInfo')}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
          <Button
            onClick={onCancel}
            variant="flat"
            size="sm"
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            variant="flat"
            size="sm"
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
