"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";
import type { DetachMode } from "../../types/syncPacks";

export interface DetachModeModalProps {
  profileName: string;
  packName: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (mode: DetachMode) => void;
}

const CHOICES: { mode: DetachMode; icon: string }[] = [
  { mode: "keep_copy", icon: "solar:copy-bold" },
  { mode: "drop", icon: "solar:link-broken-bold" },
];

export function DetachModeModal({
  profileName,
  packName,
  busy,
  onCancel,
  onConfirm,
}: DetachModeModalProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const [mode, setMode] = useState<DetachMode>("keep_copy");

  return (
    <Modal
      title={t("syncPacks.detachDialog.title", { pack: packName })}
      titleSubtitle={
        <span className="font-minecraft text-xs normal-case text-white/45">
          {t("syncPacks.detachDialog.subtitle", { profile: profileName })}
        </span>
      }
      onClose={onCancel}
      width="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="default"
            size="md"
            onClick={() => onConfirm(mode)}
            disabled={busy}
          >
            {t("syncPacks.detachDialog.confirm")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 px-8 pb-6 pt-5">
        {CHOICES.map((choice) => {
          const active = mode === choice.mode;
          return (
            <button
              key={choice.mode}
              onClick={() => setMode(choice.mode)}
              className="flex w-full items-start gap-4 rounded-lg border px-5 py-4 text-left transition-colors"
              style={{
                borderColor: active
                  ? `${accentColor.value}66`
                  : "rgba(255,255,255,0.1)",
                backgroundColor: active
                  ? `${accentColor.value}12`
                  : "rgba(255,255,255,0.02)",
              }}
            >
              <Icon
                icon={choice.icon}
                className="mt-0.5 h-5 w-5 flex-shrink-0"
                style={{
                  color: active ? accentColor.value : "rgba(255,255,255,0.35)",
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-minecraft text-base text-white/90">
                  {t(`syncPacks.detachDialog.${choice.mode}.title`)}
                </div>
                <div className="mt-1 font-minecraft text-sm leading-relaxed text-white/45">
                  {t(`syncPacks.detachDialog.${choice.mode}.hint`)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

export default DetachModeModal;
