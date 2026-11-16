"use client";

import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import type { ShareChoices, ShareExpiry } from "../../services/share-service";

interface Props {
  name: string;
  choices: ShareChoices;
  onClose: () => void;
  onShare: (expiry: ShareExpiry) => void;
}

const PERMANENT = "permanent";

/** How long a clip stays on norisk.gg; payback's default is picked to start with. */
export function ShareExpiryModal({ name, choices, onClose, onShare }: Props) {
  const { t } = useTranslation();
  const start = choices.expiryChoices.includes(choices.expiryDays)
    ? choices.expiryDays
    : choices.expiryChoices[choices.expiryChoices.length - 1];
  const [picked, setPicked] = useState<number | typeof PERMANENT>(start ?? PERMANENT);

  const options: (number | typeof PERMANENT)[] = [
    ...choices.expiryChoices,
    ...(choices.permanentChoice ? [PERMANENT as typeof PERMANENT] : []),
  ];

  const share = () => onShare(picked === PERMANENT ? { permanent: true } : { days: picked });

  return (
    <Modal
      title={t("share.expiry.title")}
      titleIcon={<Icon icon="solar:cloud-upload-bold" className="w-5 h-5" />}
      onClose={onClose}
      width="md"
      footer={
        <div className="flex justify-between">
          <Button variant="secondary" size="md" className="text-base" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="default"
            size="md"
            className="text-base"
            onClick={share}
            icon={<Icon icon="solar:cloud-upload-bold" className="w-5 h-5 text-white" />}
          >
            {t("share.expiry.share")}
          </Button>
        </div>
      }
    >
      <div className="space-y-6 p-6">
        <p className="text-center font-minecraft text-xs tracking-wide text-white/60 normal-case">{name}</p>

        <div>
          <label className="mb-3 block font-smallcaps text-base text-white">{t("share.expiry.label")}</label>
          <div className="grid grid-cols-3 gap-2">
            {options.map((option) => (
              <Button
                key={option}
                variant={picked === option ? "default" : "secondary"}
                size="sm"
                className="text-sm"
                onClick={() => setPicked(option)}
              >
                {option === PERMANENT ? t("share.expiry.permanent") : t("share.expiry.days", { count: option })}
              </Button>
            ))}
          </div>
          {picked === PERMANENT && (
            <p className="mt-3 text-xs text-white/60">
              {t("share.expiry.permanent_hint", { max: choices.maxPinned })}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
