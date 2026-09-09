"use client";

import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { SearchStyleInput } from "../ui/Input";

interface Props {
  currentName: string;
  onClose: () => void;
  onConfirm: (name: string) => Promise<boolean>;
}

export function RenameClipModal({ currentName, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  const wanted = name.trim();
  const unchanged = !wanted || wanted === currentName;

  const submit = async () => {
    if (unchanged || saving) return;
    setSaving(true);
    const done = await onConfirm(wanted);
    setSaving(false);
    if (done) onClose();
  };

  return (
    <Modal
      title={t("clips.gallery.rename")}
      titleIcon={<Icon icon="solar:pen-bold" className="w-5 h-5" />}
      onClose={onClose}
      width="md"
      closeOnClickOutside={!saving}
      footer={
        <div className="flex justify-between">
          <Button variant="secondary" size="md" className="text-base" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="default"
            size="md"
            className="text-base"
            onClick={() => void submit()}
            disabled={saving || unchanged}
            icon={
              <Icon
                icon={saving ? "svg-spinners:ring-resize" : "solar:pen-bold"}
                className="w-5 h-5 text-white"
              />
            }
          >
            {t("clips.gallery.rename")}
          </Button>
        </div>
      }
    >
      <div className="space-y-6 p-6">
        <p className="text-center font-minecraft text-xs tracking-wide text-white/60 normal-case">
          {currentName}
        </p>

        <div>
          <label className="mb-2 block font-smallcaps text-base text-white">
            {t("clips.gallery.rename_label")}
          </label>
          <SearchStyleInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={currentName}
            disabled={saving}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
